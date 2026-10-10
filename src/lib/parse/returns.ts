import type { ReturnLine, ReturnRequest } from '../types';
import { redact, type RawRecord, type Rejected, type SourceFile, type TotalCheck, check } from './common';
import { columnIndex, contentHash, idr0, isBlankRow, parseDate, productKey, rowToObject, sheetRows, str, uniqueHeaders, type Row } from './util';

export const RETURNS_REQUIRED = [
  'No. Pengembalian', 'No. Pesanan', 'Waktu Pengembalian Diajukan', 'Tipe Pengembalian', 'Status Pembatalan/ Pengembalian',
  'Nama Produk', 'Variasi', 'Jumlah Produk Dikembalikan', 'Alasan Pengembalian', 'Total Pengembalian Dana',
  'Waktu Pengembalian Dana Selesai', 'Jumlah Kompensasi',
] as const;

/** Status yang berarti pengajuan tidak berlanjut — dana tidak dikembalikan ke pembeli. */
export const RETURN_VOID_STATUSES = ['Pengembalian Barang/Dana Dibatalkan', 'Pengajuan Ditolak'];

export interface ReturnsParse {
  requests: Omit<ReturnRequest, 'batchId'>[];
  lines: ReturnLine[];
  raw: RawRecord[];
  rejected: Rejected[];
  warnings: string[];
  duplicatesInFiles: number;
  rowsRead: number;
  checks: TotalCheck[];
}

export function parseReturns(files: SourceFile[]): ReturnsParse {
  const out: ReturnsParse = { requests: [], lines: [], raw: [], rejected: [], warnings: [], duplicatesInFiles: 0, rowsRead: 0, checks: [] };
  const byReturn = new Map<string, Map<string, { rowNo: number; row: Row }[]>>();
  let ix: Record<string, number> = {};

  for (const f of files) {
    const sheet = f.wb.SheetNames[0];
    const rows = sheetRows(f.wb, sheet);
    if (!rows.length) { out.warnings.push(`${f.name}: sheet kosong.`); continue; }
    // Laporan ini memiliki judul kolom berulang (Provinsi, Kode Pos) → diberi akhiran " (2)".
    const headers = uniqueHeaders(rows[0]);
    ix = columnIndex(headers, RETURNS_REQUIRED, f.name);
    if (headers.length !== 46) out.warnings.push(`${f.name}: ${headers.length} kolom (format acuan 46 kolom).`);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (isBlankRow(row)) continue;
      out.rowsRead++;
      out.raw.push({ file: f.name, sheet, rowNo: i + 1, data: redact(rowToObject(headers, row)) });
      const returnNo = str(row[ix['No. Pengembalian']]);
      if (!returnNo) { out.rejected.push({ file: f.name, sheet, rowNo: i + 1, reason: 'No. Pengembalian kosong' }); continue; }
      if (!str(row[ix['No. Pesanan']])) { out.rejected.push({ file: f.name, sheet, rowNo: i + 1, reason: 'No. Pesanan kosong' }); continue; }
      let m = byReturn.get(returnNo);
      if (!m) byReturn.set(returnNo, (m = new Map()));
      const arr = m.get(f.name) ?? [];
      arr.push({ rowNo: i + 1, row });
      m.set(f.name, arr);
    }
  }

  const g = (row: Row, h: string) => row[ix[h] ?? -1] ?? null;
  for (const [returnNo, perFile] of byReturn) {
    const versions = [...perFile.values()];
    const rows = versions[versions.length - 1];
    if (versions.length > 1) {
      out.duplicatesInFiles += versions.length - 1;
      if (new Set(versions.map((v) => contentHash(v.map((x) => x.row)))).size > 1)
        out.warnings.push(`Pengembalian ${returnNo} ada di beberapa file dengan isi berbeda — dipakai file terakhir (status terbaru).`);
    }
    const first = rows[0].row;
    const orderNo = str(g(first, 'No. Pesanan'));
    const lines: ReturnLine[] = rows.map(({ row }, n) => {
      const productName = str(g(row, 'Nama Produk'));
      const variation = str(g(row, 'Variasi'));
      return {
        id: `${returnNo}#${n + 1}`,
        returnNo,
        orderNo,
        lineNo: n + 1,
        productName,
        skuParent: str(g(row, 'SKU Induk')),
        variation,
        variationCode: str(g(row, 'Kode Variasi')),
        unitPrice: idr0(g(row, 'Harga Satuan')),
        qty: idr0(g(row, 'Jumlah Produk Dikembalikan')),
        productKey: productKey(productName, variation),
      };
    });
    const refundVals = new Set(rows.map(({ row }) => idr0(g(row, 'Total Pengembalian Dana'))));
    if (refundVals.size > 1) out.warnings.push(`Pengembalian ${returnNo}: Total Pengembalian Dana berbeda antar baris — dipakai baris pertama.`);
    out.requests.push({
      returnNo,
      orderNo,
      orderCreatedAt: parseDate(g(first, 'Tanggal Pesanan Dibuat')),
      buyerMasked: str(g(first, 'Username (Pembeli)')),
      requestedAt: parseDate(g(first, 'Waktu Pengembalian Diajukan')),
      status: str(g(first, 'Status Pembatalan/ Pengembalian')),
      returnType: str(g(first, 'Tipe Pengembalian')),
      solution: str(g(first, 'Solusi Pengembalian Barang/Dana')),
      reason: str(g(first, 'Alasan Pengembalian')),
      refundTotal: idr0(g(first, 'Total Pengembalian Dana')),
      refundCompletedAt: parseDate(g(first, 'Waktu Pengembalian Dana Selesai')),
      toShopeeWarehouse: str(g(first, 'Dikembalikan ke Gudang Shopee')),
      returnCourier: str(g(first, 'Pilihan Jasa Kirim Pengembalian Barang')),
      returnShipStatus: str(g(first, 'Status Pengembalian Barang')),
      returnShippedAt: parseDate(g(first, 'Waktu Pengiriman Pengembalian Barang Selesai')),
      province: str(g(first, 'Provinsi')),
      city: str(g(first, 'Kota/Kabupaten')),
      appealDeadline: parseDate(g(first, 'Dapat Mengajukan Banding pada')),
      rejectReason: str(g(first, 'Alasan Penolakan')),
      compensation: idr0(g(first, 'Jumlah Kompensasi')),
      orderTotal: idr0(g(first, 'Total Pesanan')),
      paymentMethod: str(g(first, 'Metode Pembayaran')),
      releasedAmount: idr0(g(first, 'Pelepasan Dana')),
      shippingFee: idr0(g(first, 'Ongkos Kirim Pengiriman')),
      returnShippingFee: idr0(g(first, 'Ongkos Kirim Pengembalian')),
      lineCount: lines.length,
      qtyTotal: lines.reduce((s, l) => s + l.qty, 0),
      hash: contentHash(rows.map((x) => x.row)),
      sourceFile: [...perFile.keys()].pop() ?? '',
    });
    out.lines.push(...lines);
  }
  out.checks.push(check('Pengembalian', 'Jumlah baris file = jumlah baris pengembalian ternormalisasi',
    out.duplicatesInFiles ? null : out.rowsRead - out.rejected.length, out.lines.length, 0.5));
  return out;
}
