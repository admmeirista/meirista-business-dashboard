// Kelengkapan data per bulan untuk tiga jenis laporan: Pesanan, Retur, Penghasilan.
// Dasar: periode file yang pernah diimport (nama file Shopee memuat periode) + jumlah record per bulan.
import type { Index } from './metrics/dataset';
import { day } from './metrics/dataset';

export type CovStatus = 'full' | 'partial' | 'none';
export interface MonthCoverage {
  month: string; // YYYY-MM
  orders: { status: CovStatus; source: 'all' | 'completed' | null; missingParts: boolean; count: number; cancelled: number };
  returns: { status: CovStatus; count: number };
  income: { status: CovStatus; count: number; value: number };
}

const dim = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
const addMonth = (m: string, n: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
/** Jumlah hari bulan m yang tercakup rentang [from, to]. */
function overlapDays(m: string, from: string, to: string) {
  const a = from > `${m}-01` ? from : `${m}-01`;
  const end = `${m}-${String(dim(m)).padStart(2, '0')}`;
  const b = to < end ? to : end;
  return b < a ? 0 : Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
}

interface Group { kind: string; from: string; to: string; complete: boolean }

/** File dikelompokkan per (jenis, periode); kelompok multi-part lengkap bila semua part ada. */
function fileGroups(ix: Index): Group[] {
  const m = new Map<string, { kind: string; from: string; to: string; total: number | null; parts: Set<number | null> }>();
  for (const f of ix.ds.files) {
    if (!f.periodFrom || !f.periodTo) continue;
    const k = `${f.kind}|${f.periodFrom}|${f.periodTo}`;
    const g = m.get(k) ?? { kind: f.kind, from: f.periodFrom, to: f.periodTo, total: f.partsTotal, parts: new Set() };
    g.parts.add(f.part);
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ kind: g.kind, from: g.from, to: g.to, complete: !g.total || g.parts.size >= g.total }));
}

/** Status cakupan file untuk satu bulan: penuh bila ≥ separuh hari bulan itu tercakup file yang lengkap. */
function covered(groups: Group[], kinds: string[], m: string): { status: CovStatus; missingParts: boolean; kind: string | null } {
  let best: { status: CovStatus; missingParts: boolean; kind: string | null } = { status: 'none', missingParts: false, kind: null };
  for (const g of groups.filter((x) => kinds.includes(x.kind))) {
    const days = overlapDays(m, g.from, g.to);
    if (days * 2 < dim(m)) continue;
    if (g.complete) { if (best.status !== 'full' || g.kind === kinds[0]) best = { status: 'full', missingParts: false, kind: g.kind }; }
    else if (best.status === 'none') best = { status: 'partial', missingParts: true, kind: g.kind };
  }
  return best;
}

export function monthlyCoverage(ix: Index, today = new Date().toISOString().slice(0, 7)): MonthCoverage[] {
  const groups = fileGroups(ix);
  const ordersBy = new Map<string, { n: number; c: number }>();
  for (const o of ix.ds.orders) { const m = day(o.createdAt)?.slice(0, 7); if (m) { const e = ordersBy.get(m) ?? { n: 0, c: 0 }; e.n++; ordersBy.set(m, e); } }
  for (const o of ix.cancelled) { const m = day(o.createdAt)?.slice(0, 7); if (m) { const e = ordersBy.get(m) ?? { n: 0, c: 0 }; e.n++; e.c++; ordersBy.set(m, e); } }
  const returnsBy = new Map<string, number>();
  for (const r of ix.ds.returns) { const m = day(r.requestedAt)?.slice(0, 7); if (m) returnsBy.set(m, (returnsBy.get(m) ?? 0) + 1); }
  const incomeBy = new Map<string, { n: number; v: number }>();
  for (const r of ix.incomeOrders) { const m = day(r.releaseDate)?.slice(0, 7); if (m) { const e = incomeBy.get(m) ?? { n: 0, v: 0 }; e.n++; e.v += r.amounts['Total Penghasilan']; incomeBy.set(m, e); } }

  const months = [...ordersBy.keys(), ...returnsBy.keys(), ...incomeBy.keys(), ...groups.flatMap((g) => [g.from.slice(0, 7), g.to.slice(0, 7)])].sort();
  if (!months.length) return [];
  const out: MonthCoverage[] = [];
  for (let m = months[0]; m <= (months[months.length - 1] > today ? months[months.length - 1] : today); m = addMonth(m, 1)) {
    const oc = covered(groups, ['all', 'completed'], m);
    const rc = covered(groups, ['returns'], m);
    const ic = covered(groups, ['income'], m);
    const o = ordersBy.get(m), inc = incomeBy.get(m);
    out.push({
      month: m,
      orders: { status: oc.status, source: oc.kind as 'all' | 'completed' | null, missingParts: oc.missingParts, count: o?.n ?? 0, cancelled: o?.c ?? 0 },
      returns: { status: rc.status, count: returnsBy.get(m) ?? 0 },
      income: { status: ic.status, count: inc?.n ?? 0, value: inc?.v ?? 0 },
    });
  }
  return out.reverse();
}

/** Bulan yang punya data apa pun (pesanan, retur, atau penghasilan) — untuk pemilih periode. */
export function monthsWithData(ix: Index): Set<string> {
  const s = new Set<string>();
  for (const o of [...ix.ds.orders, ...ix.cancelled]) { const d = day(o.paidAt ?? o.createdAt); if (d) s.add(d.slice(0, 7)); const c = day(o.createdAt); if (c) s.add(c.slice(0, 7)); }
  for (const r of ix.ds.returns) { const d = day(r.requestedAt); if (d) s.add(d.slice(0, 7)); }
  for (const r of ix.incomeOrders) { const d = day(r.releaseDate); if (d) s.add(d.slice(0, 7)); }
  return s;
}
