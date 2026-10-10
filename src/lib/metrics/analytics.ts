import type { IncomeRecord, Order, OrderItem, ReturnRequest } from '../types';
import { FEE_GROUPS, groupTotal, marketplaceFees } from '../fees';
import { RETURN_VOID_STATUSES } from '../parse/returns';
import { day, incomeOrdersIn, inRange, itemCogs, orderDate, ordersIn, productOf, type DateBasis, type Filter, type Index } from './dataset';

const sum = <T>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);
export const safeDiv = (a: number, b: number) => (b ? a / b : null);

// ───────────────────────── Penjualan ─────────────────────────
export interface SalesSummary {
  orders: number; lines: number; units: number; gmv: number; originalValue: number; sellerDiscount: number;
  voucherSeller: number; buyerPaid: number; aov: number | null; buyers: number; daily: { d: string; gmv: number; orders: number }[];
}

/**
 * Penjualan (GMV) = Σ Subtotal Pesanan per item (Harga Setelah Diskon × Jumlah) pesanan selesai.
 * Total Pembayaran, voucher & ongkir adalah nilai level pesanan → dijumlahkan sekali per pesanan.
 */
export function salesSummary(ix: Index, f: Filter): SalesSummary {
  const orders = ordersIn(ix, f);
  const items = orders.flatMap((o) => ix.itemsByOrder.get(o.orderNo) ?? []);
  const daily = new Map<string, { gmv: number; orders: number }>();
  for (const o of orders) {
    const d = orderDate(ix, o, f.basis)!;
    const e = daily.get(d) ?? { gmv: 0, orders: 0 };
    e.orders++;
    e.gmv += sum(ix.itemsByOrder.get(o.orderNo) ?? [], (i) => i.subtotal);
    daily.set(d, e);
  }
  const gmv = sum(items, (i) => i.subtotal);
  return {
    orders: orders.length, lines: items.length, units: sum(items, (i) => i.qty), gmv,
    originalValue: sum(items, (i) => i.priceOriginal * i.qty), sellerDiscount: sum(items, (i) => i.sellerDiscount),
    voucherSeller: sum(orders, (o) => o.voucherSeller), buyerPaid: sum(orders, (o) => o.totalPayment),
    aov: safeDiv(gmv, orders.length), buyers: new Set(orders.map((o) => o.buyer)).size,
    daily: fillDays(f, daily, { gmv: 0, orders: 0 }),
  };
}

export function fillDays<T extends object>(f: Filter, m: Map<string, T>, zero: T): ({ d: string } & T)[] {
  const out: ({ d: string } & T)[] = [];
  const end = new Date(f.to + 'T00:00:00Z');
  const span = (end.getTime() - new Date(f.from + 'T00:00:00Z').getTime()) / 864e5;
  if (span > 800 || span < 0) return [...m.entries()].sort().map(([d, v]) => ({ d, ...v }));
  for (let t = new Date(f.from + 'T00:00:00Z'); t <= end; t.setUTCDate(t.getUTCDate() + 1)) {
    const d = t.toISOString().slice(0, 10);
    out.push({ d, ...(m.get(d) ?? zero) });
  }
  return out;
}

export type Dim = 'product' | 'listing' | 'brand' | 'category' | 'customer' | 'province' | 'city' | 'payment' | 'shipping';
export interface DimRow { key: string; label: string; sub?: string; gmv: number; units: number; orders: number; buyers: number; share: number; aov: number | null; returnedQty: number }

export const UNMAPPED = 'Belum dipetakan';

/** Agregasi penjualan per dimensi. Dimensi level item (produk/brand/kategori) memakai subtotal item; level pesanan memakai Σ item pesanan. */
export function salesBy(ix: Index, f: Filter, dim: Dim): DimRow[] {
  const orders = ordersIn(ix, f);
  const m = new Map<string, { label: string; sub?: string; gmv: number; units: number; orders: Set<string>; buyers: Set<string>; returnedQty: number }>();
  const add = (key: string, label: string, o: Order, gmv: number, units: number, ret: number, sub?: string) => {
    const e = m.get(key) ?? { label, sub, gmv: 0, units: 0, orders: new Set(), buyers: new Set(), returnedQty: 0 };
    e.gmv += gmv; e.units += units; e.returnedQty += ret; e.orders.add(o.orderNo); e.buyers.add(o.buyer);
    m.set(key, e);
  };
  for (const o of orders) {
    const items = ix.itemsByOrder.get(o.orderNo) ?? [];
    if (dim === 'listing' || dim === 'product' || dim === 'brand' || dim === 'category') {
      for (const it of items) {
        const p = productOf(ix, it);
        if (dim === 'listing') add(it.productKey, it.productName, o, it.subtotal, it.qty, it.returnedQty, it.variation);
        else if (dim === 'product') add(p ? `p${p.id}` : `l:${it.productKey}`, p ? p.name : it.productName, o, it.subtotal, it.qty, it.returnedQty, p ? p.brand : `${UNMAPPED}${it.variation ? ' · ' + it.variation : ''}`);
        else { const v = p ? (dim === 'brand' ? p.brand : p.category) || '(kosong)' : UNMAPPED; add(v, v, o, it.subtotal, it.qty, it.returnedQty); }
      }
    } else {
      const key = dim === 'customer' ? o.buyer : dim === 'province' ? o.province || '(kosong)' : dim === 'city' ? `${o.city}|${o.province}` : dim === 'payment' ? o.paymentMethod || '(kosong)' : (o.shippingOption.split('-').pop() || o.shippingOption || '(kosong)');
      const label = dim === 'city' ? o.city : key;
      add(key, label, o, sum(items, (i) => i.subtotal), sum(items, (i) => i.qty), sum(items, (i) => i.returnedQty), dim === 'city' ? o.province : undefined);
    }
  }
  const total = sum([...m.values()], (e) => e.gmv);
  return [...m.entries()].map(([key, e]) => ({
    key, label: e.label, sub: e.sub, gmv: e.gmv, units: e.units, orders: e.orders.size, buyers: e.buyers.size,
    share: total ? e.gmv / total : 0, aov: safeDiv(e.gmv, e.orders.size), returnedQty: e.returnedQty,
  })).sort((a, b) => b.gmv - a.gmv);
}

// ───────────────────────── Penghasilan & biaya ─────────────────────────
export interface SettlementSummary {
  records: number; totalIncome: number; productPrice: number; refund: number; marketplaceFees: number; feeRate: number | null;
  groups: { key: string; label: string; total: number; fields: { label: string; total: number }[] }[];
  adjustments: number; adjustmentsByType: { type: string; total: number; count: number }[];
  netWithAdjustments: number; daily: { d: string; income: number; fees: number }[];
  missingOrderJoin: number;
}

/**
 * Dana Dilepas = Σ "Total Penghasilan" baris Order (bukan Sku) laporan Penghasilan.
 * Biaya marketplace = Σ biaya platform + XTRA + layanan + promosi + lainnya + pajak (tanda asli, negatif).
 * Fee rate = −Biaya marketplace ÷ Harga Produk.
 * Penyesuaian dihitung terpisah: basis "Dana dilepas" memakai Tanggal Penyesuaian Dibuat; basis lain memakai tanggal pesanan terhubung.
 */
export function settlementSummary(ix: Index, f: Filter): SettlementSummary {
  const recs = incomeOrdersIn(ix, f);
  const groups = FEE_GROUPS.map((g) => ({
    key: g.key, label: g.label, total: sum(recs, (r) => groupTotal(r.amounts, g)),
    fields: g.fields.map((fd) => ({ label: fd.summaryLabel, total: sum(recs, (r) => r.amounts[fd.field]) })),
  }));
  const productPrice = sum(recs, (r) => r.amounts['Harga Produk']);
  const fees = sum(recs, (r) => marketplaceFees(r.amounts));
  const adj = ix.ds.adjustments.filter((a) => {
    if (f.basis === 'released') return inRange(day(a.date), f);
    const o = ix.orderByNo.get(a.orderNo);
    if (o) return inRange(orderDate(ix, o, f.basis), f);
    return f.basis === 'created' && inRange(orderNoDate(a.orderNo), f);
  });
  const byType = new Map<string, { total: number; count: number }>();
  for (const a of adj) { const e = byType.get(a.type) ?? { total: 0, count: 0 }; e.total += a.amount; e.count++; byType.set(a.type, e); }
  const daily = new Map<string, { income: number; fees: number }>();
  for (const r of recs) {
    const d = day(r.releaseDate)!;
    if (!d) continue;
    const e = daily.get(d) ?? { income: 0, fees: 0 };
    e.income += r.amounts['Total Penghasilan']; e.fees += marketplaceFees(r.amounts);
    daily.set(d, e);
  }
  const totalIncome = sum(recs, (r) => r.amounts['Total Penghasilan']);
  const adjTotal = sum(adj, (a) => a.amount);
  const missingOrderJoin = f.basis === 'paid' || f.basis === 'completed' ? ix.incomeOrders.filter((r) => !ix.orderByNo.has(r.orderNo)).length : 0;
  return {
    records: recs.length, totalIncome, productPrice, refund: sum(recs, (r) => r.amounts['Jumlah Pengembalian Dana ke Pembeli']),
    marketplaceFees: fees, feeRate: safeDiv(-fees, productPrice), groups,
    adjustments: adjTotal, adjustmentsByType: [...byType.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.total - a.total),
    netWithAdjustments: totalIncome + adjTotal, daily: f.basis === 'released' ? fillDays(f, daily, { income: 0, fees: 0 }) : [...daily.entries()].sort().map(([d, v]) => ({ d, ...v })),
    missingOrderJoin,
  };
}

/** No. Pesanan Shopee diawali YYMMDD tanggal pesanan dibuat. */
export function orderNoDate(orderNo: string): string | null {
  const m = orderNo.match(/^(\d{2})(\d{2})(\d{2})/);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

// ───────────────────────── Pengembalian ─────────────────────────
export type ReturnBasis = 'requested' | 'orderCreated' | 'refunded';
export const RETURN_BASIS_LABEL: Record<ReturnBasis, string> = { requested: 'Tanggal pengajuan', orderCreated: 'Tanggal pesanan dibuat', refunded: 'Dana pengembalian selesai' };

export type ReturnState = 'REFUNDED' | 'IN_PROGRESS' | 'VOID';
export const returnState = (r: ReturnRequest): ReturnState =>
  RETURN_VOID_STATUSES.includes(r.status) ? 'VOID' : r.refundCompletedAt ? 'REFUNDED' : 'IN_PROGRESS';
export const RETURN_STATE_LABEL: Record<ReturnState, string> = { REFUNDED: 'Dana selesai', IN_PROGRESS: 'Dalam proses', VOID: 'Batal / ditolak' };

export function returnDate(r: ReturnRequest, b: ReturnBasis) {
  return day(b === 'requested' ? r.requestedAt : b === 'orderCreated' ? r.orderCreatedAt : r.refundCompletedAt);
}

/**
 * Refund terealisasi = Σ Total Pengembalian Dana pengajuan berstatus bukan Dibatalkan/Ditolak dan memiliki Waktu Pengembalian Dana Selesai.
 * Tingkat pengembalian = pesanan dengan pengajuan (bukan batal) ÷ pesanan selesai, keduanya pada rentang & basis tanggal pesanan dibuat.
 */
export function returnsAnalysis(ix: Index, f: Filter, b: ReturnBasis) {
  const reqs = ix.ds.returns.filter((r) => inRange(returnDate(r, b), f));
  const valid = reqs.filter((r) => returnState(r) !== 'VOID');
  const refunded = reqs.filter((r) => returnState(r) === 'REFUNDED');
  const count = <K extends string>(key: (r: ReturnRequest) => K, rows = reqs) => {
    const m = new Map<K, { n: number; refund: number }>();
    for (const r of rows) { const e = m.get(key(r)) ?? { n: 0, refund: 0 }; e.n++; e.refund += returnState(r) === 'REFUNDED' ? r.refundTotal : 0; m.set(key(r), e); }
    return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b2) => b2.n - a.n);
  };
  const lines = valid.flatMap((r) => (ix.linesByReturn.get(r.returnNo) ?? []).map((l) => ({ l, r })));
  const prod = new Map<string, { label: string; sub: string; qty: number; requests: Set<string> }>();
  for (const { l, r } of lines) {
    const p = productOf(ix, l);
    const k = p ? `p${p.id}` : l.productKey;
    const e = prod.get(k) ?? { label: p?.name ?? l.productName, sub: p ? p.brand : l.variation, qty: 0, requests: new Set() };
    e.qty += l.qty; e.requests.add(r.returnNo); prod.set(k, e);
  }
  // Tingkat pengembalian dihitung pada kohort pesanan dibuat di rentang ini (pengajuan bisa terjadi di bulan berikutnya).
  const cohort = ix.ds.orders.filter((o) => inRange(day(o.createdAt), f));
  const cohortReturned = cohort.filter((o) => (ix.returnsByOrder.get(o.orderNo) ?? []).some((r) => returnState(r) !== 'VOID'));
  return {
    requests: reqs.length, valid: valid.length, refundedCount: refunded.length, refundTotal: sum(refunded, (r) => r.refundTotal),
    inProgressTotal: sum(reqs.filter((r) => returnState(r) === 'IN_PROGRESS'), (r) => r.refundTotal),
    compensation: sum(reqs, (r) => r.compensation), orders: new Set(reqs.map((r) => r.orderNo)).size,
    multiRequestOrders: [...new Set(reqs.map((r) => r.orderNo))].filter((o) => (ix.returnsByOrder.get(o)?.length ?? 0) > 1).length,
    byStatus: count((r) => r.status), byState: count((r) => returnState(r)), byReason: count((r) => r.reason || '(kosong)', valid),
    byType: count((r) => `${r.returnType} · ${r.solution}`, valid),
    byProduct: [...prod.entries()].map(([key, e]) => ({ key, label: e.label, sub: e.sub, qty: e.qty, requests: e.requests.size })).sort((a, b2) => b2.qty - a.qty),
    cohortOrders: cohort.length, cohortReturned: cohortReturned.length, returnRate: safeDiv(cohortReturned.length, cohort.length),
    list: reqs.sort((a, b2) => (b2.requestedAt ?? '').localeCompare(a.requestedAt ?? '')),
  };
}

// ───────────────────────── Pelanggan: retensi & RFM ─────────────────────────
export interface RfmRow { buyer: string; recencyDays: number; frequency: number; monetary: number; r: number; f: number; m: number; segment: string; first: string; last: string }

const quintile = (sorted: number[], v: number) => {
  if (sorted.length < 2) return 3;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
  return Math.min(5, Math.max(1, Math.ceil((lo / sorted.length) * 5)));
};

export const SEGMENTS = ['Champions', 'Loyal', 'Potensial', 'Baru', 'Perlu perhatian', 'Berisiko', 'Hibernasi'] as const;
function segmentOf(r: number, f: number, fr: number): string {
  if (fr === 1) return r >= 4 ? 'Baru' : r >= 2 ? 'Perlu perhatian' : 'Hibernasi';
  if (r >= 4 && f >= 4) return 'Champions';
  if (r >= 3 && f >= 3) return 'Loyal';
  if (r >= 4) return 'Potensial';
  if (r <= 2 && f >= 3) return 'Berisiko';
  if (r <= 2) return 'Hibernasi';
  return 'Perlu perhatian';
}

/**
 * RFM per username pembeli pada rentang filter: Recency = hari dari pesanan terakhir ke akhir rentang,
 * Frequency = jumlah pesanan, Monetary = Σ GMV item. Skor 1–5 berdasarkan kuintil (R dibalik: makin baru makin tinggi).
 */
export function rfm(ix: Index, f: Filter): RfmRow[] {
  const by = new Map<string, { n: number; m: number; first: string; last: string }>();
  for (const o of ordersIn(ix, f)) {
    const d = orderDate(ix, o, f.basis)!;
    const e = by.get(o.buyer) ?? { n: 0, m: 0, first: d, last: d };
    e.n++; e.m += sum(ix.itemsByOrder.get(o.orderNo) ?? [], (i) => i.subtotal);
    if (d < e.first) e.first = d; if (d > e.last) e.last = d;
    by.set(o.buyer, e);
  }
  const end = new Date(f.to + 'T00:00:00Z').getTime();
  const rows = [...by.entries()].map(([buyer, e]) => ({ buyer, recencyDays: Math.round((end - new Date(e.last + 'T00:00:00Z').getTime()) / 864e5), frequency: e.n, monetary: e.m, first: e.first, last: e.last }));
  const R = rows.map((r) => -r.recencyDays).sort((a, b) => a - b);
  const F = rows.map((r) => r.frequency).sort((a, b) => a - b);
  const M = rows.map((r) => r.monetary).sort((a, b) => a - b);
  return rows.map((x) => {
    const r = quintile(R, -x.recencyDays), fq = quintile(F, x.frequency), m = quintile(M, x.monetary);
    return { ...x, r, f: fq, m, segment: segmentOf(r, fq, x.frequency) };
  }).sort((a, b) => b.monetary - a.monetary);
}

/** Pembeli baru vs kembali per bulan (pembelian pertama dihitung dari SELURUH data pesanan yang sudah diimport). */
export function retention(ix: Index, f: Filter) {
  const firstMonth = new Map<string, string>();
  const ordersAll = [...ix.ds.orders].map((o) => ({ o, d: orderDate(ix, o, f.basis) })).filter((x) => x.d).sort((a, b) => a.d!.localeCompare(b.d!));
  for (const { o, d } of ordersAll) if (!firstMonth.has(o.buyer)) firstMonth.set(o.buyer, d!.slice(0, 7));
  const months = new Map<string, { newB: Set<string>; retB: Set<string>; orders: number }>();
  for (const { o, d } of ordersAll) {
    if (!inRange(d, f)) continue;
    const mo = d!.slice(0, 7);
    const e = months.get(mo) ?? { newB: new Set(), retB: new Set(), orders: 0 };
    e.orders++;
    (firstMonth.get(o.buyer) === mo ? e.newB : e.retB).add(o.buyer);
    months.set(mo, e);
  }
  const monthly = [...months.entries()].sort().map(([m, e]) => ({ month: m, newBuyers: e.newB.size, returning: e.retB.size, orders: e.orders }));
  // Kohort: bulan pertama × bulan ke-n setelahnya, persentase pembeli yang membeli lagi.
  const cohorts = new Map<string, Map<number, Set<string>>>();
  const mIdx = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
  for (const { o, d } of ordersAll) {
    const fm = firstMonth.get(o.buyer)!;
    if (fm < f.from.slice(0, 7) || fm > f.to.slice(0, 7)) continue;
    const k = mIdx(d!.slice(0, 7)) - mIdx(fm);
    const c = cohorts.get(fm) ?? new Map<number, Set<string>>();
    (c.get(k) ?? c.set(k, new Set()).get(k)!).add(o.buyer);
    cohorts.set(fm, c);
  }
  const cohortRows = [...cohorts.entries()].sort().map(([month, c]) => {
    const size = c.get(0)?.size ?? 0;
    const maxK = Math.max(...c.keys());
    return { month, size, cells: Array.from({ length: maxK + 1 }, (_, k) => ({ k, n: c.get(k)?.size ?? 0, pct: size ? (c.get(k)?.size ?? 0) / size : 0 })) };
  });
  const inRangeOrders = ordersAll.filter((x) => inRange(x.d, f));
  const buyerCounts = new Map<string, number>();
  for (const { o } of inRangeOrders) buyerCounts.set(o.buyer, (buyerCounts.get(o.buyer) ?? 0) + 1);
  const repeatBuyers = [...buyerCounts.values()].filter((n) => n > 1).length;
  return { monthly, cohortRows, buyers: buyerCounts.size, repeatBuyers, repeatRate: safeDiv(repeatBuyers, buyerCounts.size) };
}

// ───────────────────────── Profitabilitas ─────────────────────────
export interface ProfitRow { key: string; label: string; sub: string; gmv: number; netSettled: number; cogs: number | null; profit: number | null; margin: number | null; units: number; settledUnits: number; cogsCoverage: number }

/**
 * Laba kotor per item = alokasi Dana Dilepas pesanan − HPP.
 * Alokasi = Total Penghasilan pesanan × (subtotal item ÷ Σ subtotal pesanan). Hanya pesanan yang sudah dilepas (ada di laporan Penghasilan).
 * HPP = HPP unit (berlaku per tanggal pesanan dibuat) × isi paket × jumlah. Item tanpa HPP → laba "tidak tersedia", tidak dihitung 0.
 */
export function profitability(ix: Index, f: Filter, by: 'product' | 'brand' | 'category' | 'listing') {
  const orders = ordersIn(ix, f);
  const m = new Map<string, ProfitRow & { cogsKnownNet: number; withCogsUnits: number }>();
  let totals = { gmv: 0, net: 0, cogs: 0, profitBase: 0, settledOrders: 0, unsettledOrders: 0, itemsNoCogs: 0, itemsSettled: 0 };
  for (const o of orders) {
    const items = ix.itemsByOrder.get(o.orderNo) ?? [];
    const inc = ix.incomeByOrder.get(o.orderNo);
    const settled = !!inc;
    const net = inc ? sum(inc, (r) => r.amounts['Total Penghasilan']) : 0;
    const sub = sum(items, (i) => i.subtotal);
    settled ? totals.settledOrders++ : totals.unsettledOrders++;
    for (const it of items) {
      const p = productOf(ix, it);
      const key = by === 'listing' ? it.productKey : p ? (by === 'product' ? `p${p.id}` : (by === 'brand' ? p.brand : p.category) || '(kosong)') : `${UNMAPPED}`;
      const label = by === 'listing' ? it.productName : p ? (by === 'product' ? p.name : key) : UNMAPPED;
      const e = m.get(key) ?? { key, label, sub: by === 'listing' ? it.variation : by === 'product' && p ? p.brand : '', gmv: 0, netSettled: 0, cogs: 0, profit: 0, margin: null, units: 0, settledUnits: 0, cogsCoverage: 0, cogsKnownNet: 0, withCogsUnits: 0 };
      e.gmv += it.subtotal; e.units += it.qty; totals.gmv += it.subtotal;
      if (settled) {
        const alloc = sub ? net * (it.subtotal / sub) : 0;
        e.netSettled += alloc; e.settledUnits += it.qty; totals.net += alloc; totals.itemsSettled++;
        const c = itemCogs(ix, it, day(o.createdAt));
        if (c === null) totals.itemsNoCogs++;
        else { e.cogs! += c; e.cogsKnownNet += alloc; e.withCogsUnits += it.qty; totals.cogs += c; totals.profitBase += alloc; }
      }
      m.set(key, e);
    }
  }
  const rows: ProfitRow[] = [...m.values()].map((e) => {
    const cov = e.settledUnits ? e.withCogsUnits / e.settledUnits : 0;
    const has = e.withCogsUnits > 0;
    return {
      key: e.key, label: e.label, sub: e.sub, gmv: e.gmv, netSettled: e.netSettled, units: e.units, settledUnits: e.settledUnits,
      cogs: has ? e.cogs : null, profit: has ? e.cogsKnownNet - e.cogs! : null, margin: has ? safeDiv(e.cogsKnownNet - e.cogs!, e.cogsKnownNet) : null, cogsCoverage: cov,
    };
  }).sort((a, b) => b.gmv - a.gmv);
  return { rows, totals: { ...totals, profit: totals.profitBase - totals.cogs, margin: safeDiv(totals.profitBase - totals.cogs, totals.profitBase), coverage: safeDiv(totals.itemsSettled - totals.itemsNoCogs, totals.itemsSettled) } };
}

// ───────────────────────── Kelengkapan data ─────────────────────────
export function dataWarnings(ix: Index, f: Filter): { level: 'warn' | 'info'; text: string }[] {
  const w: { level: 'warn' | 'info'; text: string }[] = [];
  const ds = ix.ds;
  if (!ds.orders.length) w.push({ level: 'warn', text: 'Belum ada data Pesanan Selesai. Import file Order.completed.*.xlsx.' });
  if (!ds.reports.length) w.push({ level: 'warn', text: 'Belum ada laporan Penghasilan — metrik dana dilepas, biaya, dan laba belum tersedia.' });
  if (!ds.returns.length) w.push({ level: 'info', text: 'Belum ada laporan Pengembalian.' });
  // Rentang filter yang tidak tercakup laporan penghasilan.
  const covered = (d: string) => ds.reports.some((r) => d >= r.from && d <= r.to);
  if (ds.reports.length && f.basis === 'released') {
    const gaps: string[] = [];
    for (let t = new Date(f.from + 'T00:00:00Z'); t <= new Date(f.to + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1)) {
      const d = t.toISOString().slice(0, 10);
      if (!covered(d)) gaps.push(d);
    }
    if (gaps.length) w.push({ level: 'warn', text: `${gaps.length} hari pada rentang ini belum tercakup laporan Penghasilan (${gaps[0]} … ${gaps[gaps.length - 1]}).` });
  }
  const orders = ordersIn(ix, f);
  const unsettled = orders.filter((o) => !ix.incomeByOrder.has(o.orderNo)).length;
  if (orders.length && unsettled && ds.reports.length) w.push({ level: 'info', text: `${unsettled.toLocaleString('id-ID')} dari ${orders.length.toLocaleString('id-ID')} pesanan pada rentang ini belum ditemukan di laporan Penghasilan yang diimport (bisa dilepas di periode lain).` });
  const items = orders.flatMap((o) => ix.itemsByOrder.get(o.orderNo) ?? []);
  const unmapped = items.filter((i) => !ix.mapping.has(i.productKey)).length;
  if (items.length && unmapped) w.push({ level: 'info', text: `${unmapped.toLocaleString('id-ID')} baris item belum dipetakan ke produk master (brand/kategori/HPP).` });
  const incomplete = ds.files.filter((x) => x.partsTotal).reduce((acc, x) => {
    const k = `${x.kind}|${x.periodFrom}|${x.periodTo}|${x.partsTotal}`;
    acc.set(k, (acc.get(k) ?? new Set()).add(x.part));
    return acc;
  }, new Map<string, Set<number | null>>());
  for (const [k, parts] of incomplete) { const [, from, to, tot] = k.split('|'); if (parts.size < Number(tot)) w.push({ level: 'warn', text: `Laporan Pesanan Selesai ${from} s/d ${to}: baru ${parts.size} dari ${tot} part yang diimport.` }); }
  if (ds.checks.some((c) => c.ok === false)) w.push({ level: 'warn', text: 'Ada total laporan Shopee yang tidak cocok dengan data detail — lihat Rekonsiliasi.' });
  return w;
}

export type { IncomeRecord, OrderItem, DateBasis };
