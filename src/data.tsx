import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from './lib/db';
import { loadDataset } from './lib/load';
import { buildIndex, emptyDataset, type DateBasis, type Filter, type Index } from './lib/metrics/dataset';

interface Ctx {
  ix: Index;
  loading: boolean;
  ready: boolean; // data awal sudah dimuat (reload berikutnya tidak menyembunyikan halaman)
  reload: () => Promise<void>;
  filter: Filter;
  setFilter: (f: Filter) => void;
  mask: boolean;
  setMask: (v: boolean) => void;
  months: string[]; // bulan yang punya data (YYYY-MM), terbaru dulu
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

export const monthRange = (m: string): { from: string; to: string } => {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
};

export function DataProvider({ children }: { children: ReactNode }) {
  const [ix, setIx] = useState<Index>(() => buildIndex(emptyDataset()));
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [filter, setFilterState] = useState<Filter | null>(() => store.get<Filter | null>('bi.filter', null));
  const [mask, setMaskState] = useState<boolean>(() => store.get('bi.mask', true));

  const reload = useCallback(async () => {
    setLoading(true);
    try { setIx(buildIndex(await loadDataset(db()))); } finally { setLoading(false); setReady(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const months = useMemo(() => {
    const s = new Set<string>();
    for (const o of ix.ds.orders) { if (o.createdAt) s.add(o.createdAt.slice(0, 7)); if (o.completedAt) s.add(o.completedAt.slice(0, 7)); }
    for (const r of ix.incomeOrders) if (r.releaseDate) s.add(r.releaseDate.slice(0, 7));
    return [...s].sort().reverse();
  }, [ix]);

  const effective: Filter = useMemo(() => {
    if (filter) return filter;
    const basis: DateBasis = 'created';
    const m = [...new Set(ix.ds.orders.map((o) => o.createdAt?.slice(0, 7)).filter(Boolean) as string[])].sort().pop() ?? months[0] ?? new Date().toISOString().slice(0, 7);
    return { basis, ...monthRange(m) };
  }, [filter, ix, months]);

  const value: Ctx = {
    ix, loading, ready, reload, months, mask,
    filter: effective,
    setFilter: (f) => { setFilterState(f); store.set('bi.filter', f); },
    setMask: (v) => { setMaskState(v); store.set('bi.mask', v); },
  };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
