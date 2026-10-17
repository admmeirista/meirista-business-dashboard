import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from './lib/db';
import { loadDataset } from './lib/load';
import { monthsWithData } from './lib/coverage';
import { fetchBundle, fetchBundleHeader, forgetKey, loadedBundleAt, loadedBundleId, tryAutoUnlock, unlockWithPassword, type BundleState } from './lib/bundleClient';
import { buildIndex, emptyDataset, orderDate, type DateBasis, type Filter, type Index } from './lib/metrics/dataset';

export interface Period { from: string; to: string }
export type CompareMode = 'prev' | 'yoy';

interface Ctx {
  ix: Index;
  ready: boolean;
  reload: () => Promise<void>;
  /** Periode + basis omzet (default: definisi Seller Centre). */
  filter: Filter;
  /** Periode pembanding (periode sebelumnya atau tahun lalu). */
  prev: Filter;
  setPeriod: (p: Period) => void;
  compare: CompareMode;
  setCompare: (c: CompareMode) => void;
  basis: DateBasis;
  setBasis: (b: DateBasis) => void;
  mask: boolean;
  setMask: (v: boolean) => void;
  /** Jumlah pesanan per bulan (YYYY-MM) menurut basis omzet. */
  monthCounts: Map<string, number>;
  months: string[]; // bulan yang punya data apa pun (pesanan/retur/penghasilan), terbaru dulu
  /** Bulan yang punya data apa pun — pemilih periode mengaktifkan bulan ini walau belum ada pesanan. */
  dataMonths: Set<string>;
  /** Paket data terenkripsi baru yang menunggu password (null = tidak ada / sudah dimuat). */
  pendingBundle: BundleState | null;
  /** Waktu pembuatan paket data yang sedang dipakai perangkat ini. */
  bundleAt: string | null;
  /** Sedang memuat paket data baru secara otomatis (kunci diingat perangkat). */
  syncing: boolean;
  unlock: (password: string, remember: boolean) => Promise<void>;
  skipBundle: () => void;
  forgetDevice: () => Promise<void>;
  checkBundle: () => Promise<void>;
}

const DataCtx = createContext<Ctx | null>(null);
export const useData = () => {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData di luar DataProvider');
  return c;
};

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* penyimpanan browser tidak tersedia */ } },
};

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');
export const monthRange = (m: string): Period => {
  const [y, mo] = m.split('-').map(Number);
  return { from: `${m}-01`, to: `${m}-${pad(lastDay(y, mo))}` };
};
export const quarterRange = (y: number, q: number): Period => ({ from: `${y}-${pad(q * 3 - 2)}-01`, to: `${y}-${pad(q * 3)}-${pad(lastDay(y, q * 3))}` });
export const yearRange = (y: number): Period => ({ from: `${y}-01-01`, to: `${y}-12-31` });

export type PeriodKind = { kind: 'month'; y: number; m: number } | { kind: 'quarter'; y: number; q: number } | { kind: 'year'; y: number } | { kind: 'custom' };

/** Kenali bentuk periode (bulan / kuartal / tahun / rentang bebas). */
export function periodKind(p: Period): PeriodKind {
  const y = Number(p.from.slice(0, 4)), m = Number(p.from.slice(5, 7));
  const eq = (r: Period) => r.from === p.from && r.to === p.to;
  if (eq(yearRange(y))) return { kind: 'year', y };
  if (m % 3 === 1 && eq(quarterRange(y, (m + 2) / 3))) return { kind: 'quarter', y, q: (m + 2) / 3 };
  if (eq(monthRange(p.from.slice(0, 7)))) return { kind: 'month', y, m };
  return { kind: 'custom' };
}

const shiftDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const shiftYear = (d: string, n: number) => {
  const y = Number(d.slice(0, 4)) + n, m = Number(d.slice(5, 7));
  return `${y}-${d.slice(5, 7)}-${pad(Math.min(Number(d.slice(8, 10)), lastDay(y, m)))}`;
};

/** Periode sebelumnya dengan bentuk yang sama: bulan → bulan lalu, kuartal → kuartal lalu, tahun → tahun lalu. */
export function previousPeriod(p: Period): Period {
  const k = periodKind(p);
  if (k.kind === 'year') return yearRange(k.y - 1);
  if (k.kind === 'quarter') return k.q === 1 ? quarterRange(k.y - 1, 4) : quarterRange(k.y, k.q - 1);
  if (k.kind === 'month') return monthRange(k.m === 1 ? `${k.y - 1}-12` : `${k.y}-${pad(k.m - 1)}`);
  const len = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 864e5);
  return { from: shiftDays(p.from, -len - 1), to: shiftDays(p.from, -1) };
}

/** Geser periode maju/mundur satu unit (dipakai tombol ‹ ›). */
export function stepPeriod(p: Period, dir: 1 | -1): Period {
  if (dir === -1) return previousPeriod(p);
  const k = periodKind(p);
  if (k.kind === 'year') return yearRange(k.y + 1);
  if (k.kind === 'quarter') return k.q === 4 ? quarterRange(k.y + 1, 1) : quarterRange(k.y, k.q + 1);
  if (k.kind === 'month') return monthRange(k.m === 12 ? `${k.y + 1}-01` : `${k.y}-${pad(k.m + 1)}`);
  const len = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 864e5);
  return { from: shiftDays(p.to, 1), to: shiftDays(p.to, len + 1) };
}

export const yearAgo = (p: Period): Period => ({ from: shiftYear(p.from, -1), to: shiftYear(p.to, -1) });

export function DataProvider({ children }: { children: ReactNode }) {
  const [ix, setIx] = useState<Index>(() => buildIndex(emptyDataset()));
  const [ready, setReady] = useState(false);
  const [period, setPeriodState] = useState<Period | null>(() => store.get<Period | null>('bi.period', null));
  const [compare, setCompareState] = useState<CompareMode>(() => store.get<CompareMode>('bi.compare', 'prev'));
  // Kunci baru: default omzet = definisi Seller Centre.
  const [basis, setBasisState] = useState<DateBasis>(() => store.get<DateBasis>('bi.basis.v3', 'sc'));
  const [mask, setMaskState] = useState<boolean>(() => store.get('bi.mask', true));

  const [pendingBundle, setPendingBundle] = useState<BundleState | null>(null);
  const [bundleAt, setBundleAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    try { setIx(buildIndex(await loadDataset(db()))); } finally { setReady(true); }
  }, []);
  // Paket data dari folder data-inbox (dipublikasikan terenkripsi). Dimuat otomatis bila perangkat mengingat kuncinya.
  const checkBundle = useCallback(async () => {
    const h = await fetchBundleHeader();
    setBundleAt((await loadedBundleAt(db())) ?? null);
    if (!h || h.header.id === (await loadedBundleId(db()))) return;
    const b = h.full ?? await fetchBundle();
    if (!b) return;
    setSyncing(true);
    const ok = await tryAutoUnlock(db(), b).finally(() => setSyncing(false));
    if (ok) { setBundleAt(b.header.createdAt); await reload(); return; }
    setPendingBundle(b);
  }, [reload]);
  useEffect(() => { void reload().then(checkBundle); }, [reload, checkBundle]);
  const unlock = useCallback(async (password: string, remember: boolean) => {
    if (!pendingBundle) return;
    await unlockWithPassword(db(), pendingBundle, password, remember);
    setBundleAt(pendingBundle.header.createdAt);
    setPendingBundle(null);
    await reload();
  }, [pendingBundle, reload]);

  const monthCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of basis === 'sc' ? [...ix.ds.orders, ...ix.cancelled] : ix.ds.orders) {
      const d = orderDate(ix, o, basis === 'released' ? 'shipped' : basis);
      if (d) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + 1);
    }
    return m;
  }, [ix, basis]);
  const dataMonths = useMemo(() => { const s = monthsWithData(ix); for (const k of monthCounts.keys()) s.add(k); return s; }, [ix, monthCounts]);
  const months = useMemo(() => [...dataMonths].sort().reverse(), [dataMonths]);

  // Default: bulan dengan pesanan terbanyak di antara 3 bulan terakhir yang punya data
  // (export Shopee difilter per tanggal dibuat, jadi bulan paling ujung bisa hanya berisi sisa).
  const effective: Period = useMemo(() => {
    if (period) return period;
    // Bulan default dipilih dari bulan yang punya pesanan; bila belum ada pesanan sama sekali, bulan data terbaru.
    const withOrders = months.filter((m) => monthCounts.has(m));
    const recent = (withOrders.length ? withOrders : months).slice(0, 3).sort((a, b) => (monthCounts.get(b) ?? 0) - (monthCounts.get(a) ?? 0));
    return monthRange(recent[0] ?? new Date().toISOString().slice(0, 7));
  }, [period, months, monthCounts]);

  const filter: Filter = useMemo(() => ({ basis: basis === 'released' ? 'shipped' : basis, ...effective }), [basis, effective]);
  const prev: Filter = useMemo(() => ({ ...filter, ...(compare === 'yoy' ? yearAgo(effective) : previousPeriod(effective)) }), [filter, effective, compare]);
  const value: Ctx = {
    ix, ready, reload, months, monthCounts, dataMonths, pendingBundle, bundleAt, syncing, unlock, checkBundle,
    skipBundle: () => setPendingBundle(null),
    forgetDevice: async () => { await forgetKey(db()); }, mask, basis: filter.basis, filter, prev, compare,
    setPeriod: (p) => { setPeriodState(p); store.set('bi.period', p); },
    setCompare: (c) => { setCompareState(c); store.set('bi.compare', c); },
    setBasis: (b) => { setBasisState(b); store.set('bi.basis.v3', b); },
    setMask: (v) => { setMaskState(v); store.set('bi.mask', v); },
  };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
