import { day, type Index } from './dataset';
import { returnState } from './analytics';

export type ExceptionType = 'UNSETTLED' | 'NO_ORDER' | 'REFUND_DIFF' | 'PRICE_DIFF' | 'PAID_DIFF' | 'FEE_SHEET_DIFF' | 'ADJUSTMENT' | 'SHIPPING_DISCREPANCY';

export const EXCEPTION_INFO: Record<ExceptionType, { label: string; desc: string; level: 'err' | 'warn' | 'info' }> = {
  UNSETTLED: { label: 'Belum dilepas', desc: 'Pesanan selesai yang belum ada di laporan Penghasilan mana pun yang diimport.', level: 'warn' },
  NO_ORDER: { label: 'Tanpa data pesanan', desc: 'Record Penghasilan yang No. Pesanan-nya tidak ada di data Pesanan Selesai yang diimport (biasanya pesanan periode lain).', level: 'info' },
  REFUND_DIFF: { label: 'Selisih refund', desc: 'Σ Total Pengembalian Dana (laporan Pengembalian, status dana selesai) ≠ |Jumlah Pengembalian Dana ke Pembeli| di Penghasilan.', level: 'warn' },
  PRICE_DIFF: { label: 'Selisih harga produk', desc: 'Harga Produk di Penghasilan ≠ Σ Subtotal Pesanan item di Pesanan Selesai.', level: 'err' },
  PAID_DIFF: { label: 'Selisih dibayar pembeli', desc: 'Jumlah Dibayar Pembeli (Penghasilan) ≠ Total Pembayaran (Pesanan Selesai) tanpa penjelasan pengembalian.', level: 'warn' },
  FEE_SHEET_DIFF: { label: 'Selisih sheet Seller Fee', desc: 'Biaya di sheet Seller Fee ≠ biaya pada baris Order sheet Penghasilan untuk pesanan yang sama.', level: 'warn' },
  ADJUSTMENT: { label: 'Penyesuaian', desc: 'Pesanan dengan penyesuaian/kompensasi di luar transaksi reguler.', level: 'info' },
  SHIPPING_DISCREPANCY: { label: 'Selisih ongkir', desc: 'Ongkir yang dibayar ke jasa kirim lebih tinggi dari estimasi (sheet Shipping Fee Discrepancy).', level: 'info' },
};

export interface ReconException {
  type: ExceptionType;
  orderNo: string;
  date: string | null;
  expected: number | null;
  actual: number | null;
  diff: number | null;
  note: string;
}

export interface OrderRecon {
  orderNo: string;
  completedAt: string | null;
  gmv: number;
  buyerPaid: number;
  settled: number | null;
  releaseDate: string | null;
  refundReturns: number;
  refundIncome: number;
  adjustments: number;
  status: 'SETTLED' | 'UNSETTLED' | 'NO_ORDER';
}

const near = (a: number, b: number) => Math.abs(a - b) < 1;

/** Rekonsiliasi Penjualan → Penghasilan berbasis No. Pesanan, lintas periode (tidak mengasumsikan bulan selesai = bulan dilepas). */
export function reconcile(ix: Index) {
  const ex: ReconException[] = [];
  const rows: OrderRecon[] = [];
  const latestReportEnd = ix.ds.reports.map((r) => r.to).sort().pop() ?? null;

  for (const o of ix.ds.orders) {
    const items = ix.itemsByOrder.get(o.orderNo) ?? [];
    const gmv = items.reduce((s, i) => s + i.subtotal, 0);
    const inc = ix.incomeByOrder.get(o.orderNo);
    const reqs = (ix.returnsByOrder.get(o.orderNo) ?? []).filter((r) => returnState(r) === 'REFUNDED');
    const refundReturns = reqs.reduce((s, r) => s + r.refundTotal, 0);
    const adj = (ix.adjByOrder.get(o.orderNo) ?? []).reduce((s, a) => s + a.amount, 0);
    if (!inc) {
      rows.push({ orderNo: o.orderNo, completedAt: o.completedAt, gmv, buyerPaid: o.totalPayment, settled: null, releaseDate: null, refundReturns, refundIncome: 0, adjustments: adj, status: 'UNSETTLED' });
      const done = day(o.completedAt);
      const age = done && latestReportEnd ? Math.round((Date.parse(latestReportEnd) - Date.parse(done)) / 864e5) : null;
      ex.push({
        type: 'UNSETTLED', orderNo: o.orderNo, date: done, expected: gmv, actual: null, diff: null,
        note: !latestReportEnd ? 'Belum ada laporan Penghasilan.' : age !== null && age < 0 ? `Selesai setelah laporan terakhir (${latestReportEnd}).` : `${age} hari antara selesai dan akhir laporan terakhir — cek laporan Penghasilan periode lain.`,
      });
      continue;
    }
    const settled = inc.reduce((s, r) => s + r.amounts['Total Penghasilan'], 0);
    const price = inc.reduce((s, r) => s + r.amounts['Harga Produk'], 0);
    const refundIncome = -inc.reduce((s, r) => s + r.amounts['Jumlah Pengembalian Dana ke Pembeli'], 0);
    const releaseDate = inc.map((r) => day(r.releaseDate)).filter(Boolean).sort()[0] ?? null;
    rows.push({ orderNo: o.orderNo, completedAt: o.completedAt, gmv, buyerPaid: o.totalPayment, settled, releaseDate, refundReturns, refundIncome, adjustments: adj, status: 'SETTLED' });
    if (!near(price, gmv)) ex.push({ type: 'PRICE_DIFF', orderNo: o.orderNo, date: releaseDate, expected: gmv, actual: price, diff: price - gmv, note: `${inc.length} record penghasilan` });
    const allReqs = ix.returnsByOrder.get(o.orderNo) ?? [];
    if ((refundIncome || refundReturns) && !near(refundIncome, refundReturns)) {
      ex.push({
        type: 'REFUND_DIFF', orderNo: o.orderNo, date: releaseDate, expected: refundReturns, actual: refundIncome, diff: refundIncome - refundReturns,
        note: allReqs.length ? allReqs.map((r) => `${r.returnNo}: ${r.status}`).join('; ') : 'Tidak ada pengajuan di laporan Pengembalian yang diimport.',
      });
    }
    const paid = inc.find((r) => r.buyerPaid !== null)?.buyerPaid;
    if (paid != null && !near(paid, o.totalPayment) && !refundIncome && !allReqs.length)
      ex.push({ type: 'PAID_DIFF', orderNo: o.orderNo, date: releaseDate, expected: o.totalPayment, actual: paid, diff: paid - o.totalPayment, note: o.paymentMethod });
  }

  for (const [orderNo, recs] of ix.incomeByOrder) {
    if (ix.orderByNo.has(orderNo)) continue;
    const settled = recs.reduce((s, r) => s + r.amounts['Total Penghasilan'], 0);
    const releaseDate = recs.map((r) => day(r.releaseDate)).filter(Boolean).sort()[0] ?? null;
    rows.push({ orderNo, completedAt: null, gmv: 0, buyerPaid: 0, settled, releaseDate, refundReturns: 0, refundIncome: -recs.reduce((s, r) => s + r.amounts['Jumlah Pengembalian Dana ke Pembeli'], 0), adjustments: 0, status: 'NO_ORDER' });
    ex.push({ type: 'NO_ORDER', orderNo, date: releaseDate, expected: null, actual: settled, diff: null, note: `Dibuat ${day(recs[0].createdDate) ?? '?'} · import Pesanan Selesai periode tersebut untuk mencocokkan.` });
  }

  // Sheet "Seller Fee" vs kolom biaya baris Order (pesanan & laporan yang sama).
  for (const sf of ix.ds.sellerFees) {
    const recs = (ix.incomeByOrder.get(sf.orderNo) ?? []).filter((r) => r.reportId === sf.reportId);
    if (!recs.length) { ex.push({ type: 'FEE_SHEET_DIFF', orderNo: sf.orderNo, date: null, expected: sf.platform + sf.freeShippingXtra + sf.service + sf.promotion + sf.other, actual: null, diff: null, note: 'Pesanan di sheet Seller Fee tidak ada di sheet Penghasilan laporan yang sama.' }); continue; }
    const a = (f: Parameters<typeof pick>[1]) => recs.reduce((s, r) => s + pick(r, f), 0);
    const platform = a('platform'), xtra = a('xtra'), service = a('service');
    const exp = sf.platform + sf.freeShippingXtra + sf.service;
    const act = platform + xtra + service;
    if (!near(exp, act)) ex.push({ type: 'FEE_SHEET_DIFF', orderNo: sf.orderNo, date: day(recs[0].releaseDate), expected: exp, actual: act, diff: act - exp, note: `Platform ${sf.platform}/${platform} · XTRA ${sf.freeShippingXtra}/${xtra} · Layanan ${sf.service}/${service}` });
  }
  for (const a of ix.ds.adjustments) ex.push({ type: 'ADJUSTMENT', orderNo: a.orderNo, date: day(a.date), expected: null, actual: a.amount, diff: null, note: [a.type, a.reason].filter(Boolean).join(' — ') });
  for (const d of ix.ds.discrepancies) ex.push({ type: 'SHIPPING_DISCREPANCY', orderNo: d.orderNo, date: null, expected: d.estimated, actual: d.actual, diff: d.actual - d.estimated, note: d.reason });

  const counts = Object.fromEntries((Object.keys(EXCEPTION_INFO) as ExceptionType[]).map((t) => [t, ex.filter((e) => e.type === t).length])) as Record<ExceptionType, number>;
  return { rows, exceptions: ex, counts, latestReportEnd };
}

function pick(r: { amounts: Record<string, number> }, f: 'platform' | 'xtra' | 'service') {
  const a = r.amounts;
  if (f === 'platform') return a['Biaya Administrasi'] + a['Biaya Proses Pesanan'];
  if (f === 'xtra') return a['Biaya Gratis Ongkir XTRA - Ukuran Khusus (Kategori D)'] + a['Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)'] + a['Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori E)'];
  return a['Biaya Layanan Promo XTRA'];
}
