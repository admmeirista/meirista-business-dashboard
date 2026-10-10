import type { Adjustment, IncomeAmounts, IncomeRecord, IncomeReport, SellerFee, ShippingDiscrepancy, SummaryLine } from '../types';
import { INCOME_AMOUNT_FIELDS } from '../types';
import { FEE_GROUPS, componentSum, groupTotal } from '../fees';
import { check, redact, type RawRecord, type Rejected, type SourceFile, type TotalCheck } from './common';
import { idr0, isBlankRow, parseDate, parseIdr, rowToObject, sheetRows, str, uniqueHeaders, type Row } from './util';

export const INCOME_SHEETS = ['Summary', 'Shipping Fee Discrepancy', 'Adjustment', 'Seller Fee'] as const;

export interface IncomeParse {
  reports: Omit<IncomeReport, 'batchId'>[];
  records: Omit<IncomeRecord, 'batchId'>[];
  adjustments: Omit<Adjustment, 'batchId'>[];
  sellerFees: Omit<SellerFee, 'batchId'>[];
  discrepancies: Omit<ShippingDiscrepancy, 'batchId'>[];
  raw: RawRecord[];
  rejected: Rejected[];
  warnings: string[];
  duplicatesInFiles: number;
  rowsRead: number;
  checks: TotalCheck[];
}

const findRow = (rows: Row[], pred: (r: Row) => boolean, from = 0) => {
  for (let i = from; i < rows.length; i++) if (rows[i] && pred(rows[i])) return i;
  return -1;
};

function parseSummary(rows: Row[]) {
  const meta = { seller: '', from: '', to: '' };
  const lines: SummaryLine[] = [];
  let started = false;
  rows.forEach((r) => {
    const a = str(r[0]), b = str(r[1]);
    if (a === 'Username (Penjual)') meta.seller = b;
    if (a === 'Dari') meta.from = parseDate(r[1]) ?? b;
    if (a === 'ke') meta.to = parseDate(r[1]) ?? b;
    if (a === 'Ringkasan Penghasilan') { started = true; return; }
    if (!started) return;
    if (a) lines.push({ order: lines.length, level: 0, label: a, value: parseIdr(r[3]) });
    else if (b) lines.push({ order: lines.length, level: 1, label: b, value: parseIdr(r[2]) });
  });
  return { meta, lines };
}

function parseAdjustment(rows: Row[], reportId: string, file: string, out: IncomeParse) {
  const summary: SummaryLine[] = [];
  const s0 = findRow(rows, (r) => str(r[0]) === 'Ringkasan Biaya Penyesuaian');
  const d0 = findRow(rows, (r) => str(r[0]) === 'Rincian Transaksi Penyesuaian');
  if (s0 >= 0) {
    for (let i = s0 + 1; i < (d0 > 0 ? d0 : rows.length); i++) {
      const r = rows[i];
      if (isBlankRow(r)) continue;
      if (str(r[0])) summary.push({ order: summary.length, level: 0, label: str(r[0]), value: parseIdr(r[4]) });
      else if (str(r[1])) summary.push({ order: summary.length, level: 1, label: str(r[1]), value: parseIdr(r[3]) });
    }
  }
  const h = findRow(rows, (r) => str(r[0]) === 'No.' && r.some((v) => str(v).startsWith('Tipe Penyesuaian')), Math.max(d0, 0));
  const adjustments: Omit<Adjustment, 'batchId'>[] = [];
  let reportedTotal: number | null = null;
  if (h >= 0) {
    const headers = uniqueHeaders(rows[h]);
    const col = (name: string) => headers.findIndex((x) => x.startsWith(name));
    const c = { no: col('No.'), date: col('Tanggal Penyesuaian'), type: col('Tipe Penyesuaian'), reason: col('Alasan'), amount: col('Biaya Penyesuaian'), order: col('No. Pesanan'), rel: col('Tanggal Dana Dilepaskan') };
    const seen = new Map<string, number>();
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      if (isBlankRow(r)) continue;
      if (str(r[0]) === 'Total Biaya') { reportedTotal = parseIdr(r[c.amount]); break; }
      out.rowsRead++;
      out.raw.push({ file, sheet: 'Adjustment', rowNo: i + 1, data: rowToObject(headers, r) });
      const amount = parseIdr(r[c.amount]);
      if (amount === null) { out.rejected.push({ file, sheet: 'Adjustment', rowNo: i + 1, reason: 'Biaya Penyesuaian tidak terbaca' }); continue; }
      const a = {
        no: idr0(r[c.no]), date: parseDate(r[c.date]), type: str(r[c.type]), reason: str(r[c.reason]),
        amount, orderNo: str(r[c.order]), releaseDate: parseDate(r[c.rel]),
      };
      // Kunci isi (bukan nomor urut) agar laporan dengan periode tumpang tindih tidak menggandakan penyesuaian.
      const base = [a.date, a.type, a.reason, a.amount, a.orderNo, a.releaseDate].join('|');
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      adjustments.push({ id: `${base}|${n}`, reportId, ...a });
    }
  }
  const total = summary.find((l) => l.label === 'Total Penyesuaian')?.value ?? null;
  const detailSum = adjustments.reduce((s, a) => s + a.amount, 0);
  out.checks.push(check(`Penyesuaian ${reportId}`, 'Total Penyesuaian (ringkasan) = Σ rincian transaksi', total, detailSum));
  if (reportedTotal !== null) out.checks.push(check(`Penyesuaian ${reportId}`, 'Total Biaya (baris akhir) = Σ rincian transaksi', reportedTotal, detailSum));
  for (const l of summary.filter((x) => x.level === 1)) {
    const s = adjustments.filter((a) => a.type === l.label).reduce((t, a) => t + a.amount, 0);
    out.checks.push(check(`Penyesuaian ${reportId}`, `Ringkasan "${l.label}" = Σ rincian tipe tsb.`, l.value, s));
  }
  return { summary, adjustments };
}

function simpleTable(rows: Row[], file: string, sheet: string, out: IncomeParse) {
  const h = findRow(rows, (r) => r.some((v) => str(v) === 'No. Pesanan'));
  if (h < 0) return { headers: [] as string[], body: [] as { rowNo: number; o: Record<string, unknown> }[] };
  const headers = uniqueHeaders(rows[h]);
  const body: { rowNo: number; o: Record<string, unknown> }[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    if (isBlankRow(rows[i])) continue;
    const o = rowToObject(headers, rows[i]);
    if (!str(o['No. Pesanan'] as string)) continue;
    out.rowsRead++;
    out.raw.push({ file, sheet, rowNo: i + 1, data: o });
    body.push({ rowNo: i + 1, o });
  }
  return { headers, body };
}

export function parseIncome(files: SourceFile[]): IncomeParse {
  const out: IncomeParse = { reports: [], records: [], adjustments: [], sellerFees: [], discrepancies: [], raw: [], rejected: [], warnings: [], duplicatesInFiles: 0, rowsRead: 0, checks: [] };
  const seenIds = new Set<string>();

  for (const f of files) {
    const missing = INCOME_SHEETS.filter((s) => !f.wb.SheetNames.includes(s));
    const incomeSheets = f.wb.SheetNames.filter((n) => /^Penghasilan - \d+$/.test(n));
    if (missing.length) out.warnings.push(`${f.name}: sheet tidak ditemukan: ${missing.join(', ')}.`);
    if (!incomeSheets.length) throw new Error(`${f.name}: sheet "Penghasilan - n" tidak ditemukan.`);

    const { meta, lines } = parseSummary(sheetRows(f.wb, 'Summary'));
    if (!meta.from || !meta.to) out.warnings.push(`${f.name}: periode laporan (Dari/ke) tidak terbaca di Summary.`);
    const reportId = `${meta.seller}|${meta.from}|${meta.to}`;
    if (out.reports.some((r) => r.id === reportId)) {
      out.warnings.push(`${f.name}: laporan ${reportId} sudah ada di file lain pada import ini — dilewati.`);
      out.duplicatesInFiles++;
      continue;
    }

    const { summary: adjSummary, adjustments } = parseAdjustment(sheetRows(f.wb, 'Adjustment'), reportId, f.name, out);
    out.adjustments.push(...adjustments);
    out.reports.push({ id: reportId, seller: meta.seller, from: meta.from, to: meta.to, summary: lines, adjustmentSummary: adjSummary, sourceFile: f.name });

    const sf = simpleTable(sheetRows(f.wb, 'Seller Fee'), f.name, 'Seller Fee', out);
    for (const { o } of sf.body) {
      out.sellerFees.push({
        id: `${reportId}|${str(o['No. Pesanan'] as string)}`, reportId, orderNo: str(o['No. Pesanan'] as string),
        platform: idr0(o['Biaya Platform (Opsional)'] as number), freeShippingXtra: idr0(o['Biaya Gratis Ongkir XTRA (Opsional)'] as number),
        service: idr0(o['Biaya Layanan (Opsional)'] as number), promotion: idr0(o['Biaya Promosi (Opsional)'] as number), other: idr0(o['Biaya Lainnya (Opsional)'] as number),
      });
    }
    const sd = simpleTable(sheetRows(f.wb, 'Shipping Fee Discrepancy'), f.name, 'Shipping Fee Discrepancy', out);
    for (const { o } of sd.body) {
      const est = sd.headers.find((h) => h.startsWith('Estimasi Ongkos Kirim')) ?? '';
      const act = sd.headers.find((h) => h.startsWith('Ongkos Kirim yang Dibayarkan')) ?? '';
      out.discrepancies.push({
        id: `${reportId}|${str(o['No. Pesanan'] as string)}`, reportId, orderNo: str(o['No. Pesanan'] as string),
        estimated: idr0(o[est] as number), actual: idr0(o[act] as number), reason: str(o['Discrepancy reason'] as string),
      });
    }

    // Penghasilan - 1, - 2, … digabung menjadi satu dataset.
    const fileOrders: Omit<IncomeRecord, 'batchId'>[] = [];
    const fileSkus: Omit<IncomeRecord, 'batchId'>[] = [];
    let missingAmountCols: string[] = [];
    for (const sheet of incomeSheets) {
      const rows = sheetRows(f.wb, sheet);
      const h = findRow(rows, (r) => str(r[1]) === 'Lihat berdasarkan');
      if (h < 0) { out.warnings.push(`${f.name} / ${sheet}: baris judul kolom tidak ditemukan.`); continue; }
      const headers = uniqueHeaders(rows[h]);
      const ix: Record<string, number> = {};
      headers.forEach((x, i) => { if (!(x in ix)) ix[x] = i; });
      for (const req of ['Lihat berdasarkan', 'No. Pesanan', 'Tanggal Dana Dilepaskan', 'Total Penghasilan']) if (!(req in ix)) throw new Error(`${f.name} / ${sheet}: kolom wajib "${req}" tidak ditemukan.`);
      missingAmountCols = INCOME_AMOUNT_FIELDS.filter((x) => !(x in ix));
      const skuSeq = new Map<string, number>();
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i];
        if (isBlankRow(r)) continue;
        out.rowsRead++;
        out.raw.push({ file: f.name, sheet, rowNo: i + 1, data: redact(rowToObject(headers, r)) });
        const g = (name: string) => r[ix[name] ?? -1] ?? null;
        const type = str(g('Lihat berdasarkan'));
        const orderNo = str(g('No. Pesanan'));
        if (type !== 'Order' && type !== 'Sku') { out.rejected.push({ file: f.name, sheet, rowNo: i + 1, reason: `Lihat berdasarkan tidak dikenal: "${type}"` }); continue; }
        if (!orderNo) { out.rejected.push({ file: f.name, sheet, rowNo: i + 1, reason: 'No. Pesanan kosong' }); continue; }
        const amounts = {} as IncomeAmounts;
        for (const fld of INCOME_AMOUNT_FIELDS) amounts[fld] = idr0(g(fld));
        const releaseDate = parseDate(g('Tanggal Dana Dilepaskan'));
        const refNo = str(g('No. Pengajuan'));
        const productId = str(g('ID Produk'));
        let id: string;
        if (type === 'Order') id = `O|${orderNo}|${releaseDate}|${refNo}`;
        else {
          const k = `${orderNo}|${releaseDate}|${productId}`;
          const n = (skuSeq.get(k) ?? 0) + 1;
          skuSeq.set(k, n);
          id = `S|${k}|${n}`;
        }
        if (seenIds.has(id)) { out.duplicatesInFiles++; continue; }
        seenIds.add(id);
        const rec: Omit<IncomeRecord, 'batchId'> = {
          id, recordType: type, reportId, orderNo, refNo, productId, productName: str(g('Nama Produk')),
          createdDate: parseDate(g('Waktu Pesanan Dibuat')), releaseDate, releaseMethod: str(g('Metode Pelepasan Dana')),
          orderType: str(g('Tipe Pesanan')), amounts,
          buyer: str(g('Username (Pembeli)')), buyerPaid: parseIdr(g('Jumlah Dibayar Pembeli')),
          buyerPaymentMethod: str(g('Metode pembayaran pembeli')), paymentDetail: str(g('Rincian Metode Pembayaran')),
          installment: str(g('Rencana Cicilan (jika berlaku)')), courierService: str(g('Jasa Kirim')), courierName: str(g('Nama Kurir')),
          voucherCode: str(g('Kode Voucher')), compensation: parseIdr(g('Kompensasi')), refundToBuyer: parseIdr(g('Pengembalian Dana ke Pembeli')),
          sourceFile: f.name, sheet,
        };
        (type === 'Order' ? fileOrders : fileSkus).push(rec);
      }
    }
    if (missingAmountCols.length) out.warnings.push(`${f.name}: kolom nominal tidak ada (dianggap 0): ${missingAmountCols.join(', ')}.`);
    out.records.push(...fileOrders, ...fileSkus);

    // ── Validasi: Summary Shopee vs detail baris "Order" (baris "Sku" adalah alokasi, tidak dijumlahkan ke total) ──
    const scope = `Penghasilan ${meta.from} s/d ${meta.to}`;
    const sum = (fn: (r: Omit<IncomeRecord, 'batchId'>) => number) => fileOrders.reduce((s, r) => s + fn(r), 0);
    const findLine = (label: string, level?: 0 | 1) => lines.find((l) => l.label === label && (level === undefined || l.level === level));
    for (const grp of FEE_GROUPS) {
      const gl = findLine(grp.label, 0);
      if (gl) out.checks.push(check(scope, `${grp.label} (grup)`, gl.value, sum((r) => groupTotal(r.amounts, grp))));
      for (const fd of grp.fields) {
        const l = findLine(fd.summaryLabel, 1);
        if (l) out.checks.push(check(scope, fd.summaryLabel, l.value, sum((r) => r.amounts[fd.field])));
      }
    }
    const rev = FEE_GROUPS.filter((x) => x.section === 'revenue');
    const exp = FEE_GROUPS.filter((x) => x.section === 'expense');
    out.checks.push(check(scope, '1. Total Pendapatan', findLine('1. Total Pendapatan')?.value ?? null, sum((r) => rev.reduce((s, x) => s + groupTotal(r.amounts, x), 0))));
    out.checks.push(check(scope, '2. Total Pengeluaran', findLine('2. Total Pengeluaran')?.value ?? null, sum((r) => exp.reduce((s, x) => s + groupTotal(r.amounts, x), 0))));
    out.checks.push(check(scope, '3. Total yang Dilepas', findLine('3. Total yang Dilepas')?.value ?? null, sum((r) => r.amounts['Total Penghasilan'])));
    const skuTotal = fileSkus.reduce((s, r) => s + r.amounts['Total Penghasilan'], 0);
    out.checks.push(check(scope, 'Σ Total Penghasilan baris Sku = Σ baris Order (alokasi lengkap)', sum((r) => r.amounts['Total Penghasilan']), skuTotal));
    const badRows = fileOrders.filter((r) => Math.abs(componentSum(r.amounts) - r.amounts['Total Penghasilan']) >= 1);
    out.checks.push(check(scope, 'Baris Order dengan Total Penghasilan ≠ jumlah komponennya', 0, badRows.length, 0.5));
    if (badRows.length) out.warnings.push(`${f.name}: ${badRows.length} baris Order total ≠ jumlah komponen, contoh ${badRows.slice(0, 3).map((r) => r.orderNo).join(', ')}.`);
    const unknownSummary = lines.filter((l) => l.level === 1 && l.value && !FEE_GROUPS.some((g) => g.fields.some((x) => x.summaryLabel === l.label)));
    for (const l of unknownSummary) out.checks.push(check(scope, `${l.label} (tidak ada kolom detail)`, l.value, null));
  }
  return out;
}
