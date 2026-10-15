import type {
  Adjustment, CostEntry, ImportBatch, IncomeRecord, IncomeReport, Order, OrderItem, Product, ReturnLine, ReturnRequest,
  SellerFee, ShippingDiscrepancy, SkuMapping,
} from '../types';
import type { StoredCheck, ImportedFile } from '../db';

export interface Dataset {
  orders: Order[];
  items: OrderItem[];
  returns: ReturnRequest[];
  returnLines: ReturnLine[];
  reports: IncomeReport[];
  income: IncomeRecord[]; // baris Order + Sku
  adjustments: Adjustment[];
  sellerFees: SellerFee[];
  discrepancies: ShippingDiscrepancy[];
  products: Product[];
  mappings: SkuMapping[];
  costs: CostEntry[];
  batches: ImportBatch[];
  files: ImportedFile[];
  checks: StoredCheck[];
}

export const emptyDataset = (): Dataset => ({
  orders: [], items: [], returns: [], returnLines: [], reports: [], income: [], adjustments: [], sellerFees: [], discrepancies: [],
  products: [], mappings: [], costs: [], batches: [], files: [], checks: [],
});

/** Basis tanggal pelaporan. */
export type DateBasis = 'created' | 'paid' | 'shipped' | 'completed' | 'released';
export const BASIS_LABEL: Record<DateBasis, string> = {
  created: 'Pesanan dibuat',
  paid: 'Pembayaran',
  shipped: 'Pengiriman',
  completed: 'Pesanan selesai',
  released: 'Dana dilepas',
};

export interface Filter { basis: DateBasis; from: string; to: string } // YYYY-MM-DD, inklusif

export const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
export const inRange = (d: string | null, f: Filter) => !!d && d >= f.from && d <= f.to;

/** Indeks turunan yang dipakai banyak halaman — dibangun sekali per perubahan data. */
export interface Index {
  ds: Dataset;
  orderByNo: Map<string, Order>;
  itemsByOrder: Map<string, OrderItem[]>;
  incomeOrders: IncomeRecord[];
  incomeSkus: IncomeRecord[];
  incomeByOrder: Map<string, IncomeRecord[]>; // hanya baris Order
  releaseByOrder: Map<string, string>; // tanggal dana dilepas pertama
  returnsByOrder: Map<string, ReturnRequest[]>;
  linesByReturn: Map<string, ReturnLine[]>;
  adjByOrder: Map<string, Adjustment[]>;
  mapping: Map<string, SkuMapping>;
  productById: Map<number, Product>;
  costsByProduct: Map<number, CostEntry[]>; // urut effectiveFrom naik
  dataFrom: string | null;
  dataTo: string | null;
}

const group = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); }
  return m;
};

export function buildIndex(ds: Dataset): Index {
  const incomeOrders = ds.income.filter((r) => r.recordType === 'Order');
  const releaseByOrder = new Map<string, string>();
  for (const r of incomeOrders) {
    const d = day(r.releaseDate);
    if (d && (!releaseByOrder.has(r.orderNo) || d < releaseByOrder.get(r.orderNo)!)) releaseByOrder.set(r.orderNo, d);
  }
  const costsByProduct = group(ds.costs, (c) => String(c.productId));
  const cbp = new Map<number, CostEntry[]>();
  for (const [k, v] of costsByProduct) cbp.set(Number(k), v.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)));
  const dates = [
    ...ds.orders.map((o) => day(o.createdAt)), ...ds.orders.map((o) => day(o.completedAt)),
    ...incomeOrders.map((r) => day(r.releaseDate)), ...ds.returns.map((r) => day(r.requestedAt)),
  ].filter(Boolean) as string[];
  dates.sort();
  return {
    ds,
    orderByNo: new Map(ds.orders.map((o) => [o.orderNo, o])),
    itemsByOrder: group(ds.items, (i) => i.orderNo),
    incomeOrders,
    incomeSkus: ds.income.filter((r) => r.recordType === 'Sku'),
    incomeByOrder: group(incomeOrders, (r) => r.orderNo),
    releaseByOrder,
    returnsByOrder: group(ds.returns, (r) => r.orderNo),
    linesByReturn: group(ds.returnLines, (l) => l.returnNo),
    adjByOrder: group(ds.adjustments, (a) => a.orderNo),
    mapping: new Map(ds.mappings.map((m) => [m.listingKey, m])),
    productById: new Map(ds.products.filter((p) => p.id != null).map((p) => [p.id!, p])),
    costsByProduct: cbp,
    dataFrom: dates[0] ?? null,
    dataTo: dates[dates.length - 1] ?? null,
  };
}

/** Tanggal pesanan menurut basis. Basis "Dana dilepas" memakai tanggal pelepasan pertama di laporan Penghasilan. */
export function orderDate(ix: Index, o: Order, basis: DateBasis): string | null {
  switch (basis) {
    case 'created': return day(o.createdAt);
    case 'paid': return day(o.paidAt);
    case 'shipped': return day(o.shippedAt);
    case 'completed': return day(o.completedAt);
    case 'released': return ix.releaseByOrder.get(o.orderNo) ?? null;
  }
}

/** Tanggal record penghasilan menurut basis. Basis bayar/selesai butuh data Pesanan Selesai (join No. Pesanan). */
export function incomeDate(ix: Index, r: IncomeRecord, basis: DateBasis): string | null {
  if (basis === 'released') return day(r.releaseDate);
  if (basis === 'created') return day(r.createdDate);
  const o = ix.orderByNo.get(r.orderNo);
  return o ? orderDate(ix, o, basis) : null;
}

export const ordersIn = (ix: Index, f: Filter) => ix.ds.orders.filter((o) => inRange(orderDate(ix, o, f.basis), f));
export const incomeOrdersIn = (ix: Index, f: Filter) => ix.incomeOrders.filter((r) => inRange(incomeDate(ix, r, f.basis), f));

/** HPP per unit produk yang berlaku pada tanggal tertentu (entri terakhir dengan effectiveFrom ≤ tanggal). */
export function unitCostAt(ix: Index, productId: number, date: string | null): number | null {
  const list = ix.costsByProduct.get(productId);
  if (!list || !date) return null;
  let c: number | null = null;
  for (const e of list) if (e.effectiveFrom <= date) c = e.unitCost;
  return c;
}

/** HPP satu baris item = isi paket × HPP unit × jumlah. null bila pemetaan/HPP belum ada (TIDAK dianggap 0). */
export function itemCogs(ix: Index, it: OrderItem, date: string | null): number | null {
  const m = ix.mapping.get(it.productKey);
  if (!m) return null;
  const u = unitCostAt(ix, m.productId, date);
  return u === null ? null : u * m.packQty * it.qty;
}

export const productOf = (ix: Index, it: { productKey: string }) => {
  const m = ix.mapping.get(it.productKey);
  return m ? ix.productById.get(m.productId) ?? null : null;
};
