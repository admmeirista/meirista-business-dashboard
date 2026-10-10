import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from './lib/db';
import { loadDataset } from './lib/load';
import { buildIndex, day, emptyDataset, type DateBasis, type Filter, type Index } from './lib/metrics/dataset';

export interface Period { from: string; to: string }

interface Ctx {
  ix: Index;
  ready: boolean;
  reload: () => Promise<void>;
  /** Periode + basis tanggal omzet (default: Pesanan selesai). */
  filter: Filter;
  /** Periode sebelumnya dengan panjang sama — untuk perbandingan. */
  prev: Filter;
  setPeriod: (p: Period) => void;
  basis: DateBasis;
  setBasis: (b: DateBasis) => void;
  mask: boolean;
  setMask: (v: boolean) => void;
  months: string[]; // bulan yang punya pesanan menurut basis omzet, terbaru dulu
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

export const monthRange = (m: string): Period => {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
};

const shift = (d: string, days: number) => new Date(Date.parse(d + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10);

/** Periode pembanding: bulan penuh → bulan sebelumnya; rentang bebas → rentang sama panjang tepat sebelumnya. */
export function previousPeriod(p: Period): Period {
  const full = monthRange(p.from.slice(0, 7));
  if (p.from === full.from && p.to === full.to) {
    const d = new Date(Date.parse(p.from + 'T00:00:00Z'));
    d.setUTCMonth(d.getUTCMonth() - 1);
    return monthRange(d.toISOString().slice(0, 7));
  }
  const len = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 864e5);
  return { from: shift(p.from, -len - 1), to: shift(p.from, -1) };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [ix, setIx] = useState<Index>(() => buildIndex(emptyDataset()));
  const [ready, setReady] = useState(false);
  const [period, setPeriodState] = useState<Period | null>(() => store.get<Period | null>('bi.period', null));
  const [basis, setBasisState] = useState<DateBasis>(() => store.get<DateBasis>('bi.basis', 'completed'));
  const [mask, setMaskState] = useState<boolean>(() => store.get('bi.mask', true));

  const reload = useCallback(async () => {
    try { setIx(buildIndex(await loadDataset(db()))); } finally { setReady(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const monthCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of ix.ds.orders) {
      const d = day(basis === 'created' ? o.createdAt : basis === 'paid' ? o.paidAt : o.completedAt);
      if (d) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + 1);
    }
    return m;
  }, [ix, basis]);
  const months = useMemo(() => [...monthCounts.keys()].sort().reverse(), [monthCounts]);

  // Default: bulan dengan pesanan terbanyak (export Shopee difilter per tanggal dibuat, jadi bulan lain bisa hanya berisi sisa).
  const effective: Period = useMemo(() => {
    if (period) return period;
    const max = Math.max(0, ...monthCounts.values());
    const m = months.find((x) => (monthCounts.get(x) ?? 0) === max) ?? new Date().toISOString().slice(0, 7);
    return monthRange(m);
  }, [period, months, monthCounts]);

  const filter: Filter = useMemo(() => ({ basis: basis === 'released' ? 'completed' : basis, ...effective }), [basis, effective]);
  const prev: Filter = useMemo(() => ({ ...filter, ...previousPeriod(effective) }), [filter, effective]);
  const value: Ctx = {
    ix, ready, reload, months, mask, basis: filter.basis, filter,
    prev,
    setPeriod: (p) => { setPeriodState(p); store.set('bi.period', p); },
    setBasis: (b) => { setBasisState(b); store.set('bi.basis', b); },
    setMask: (v) => { setMaskState(v); store.set('bi.mask', v); },
  };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
