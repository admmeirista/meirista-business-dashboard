import type { Order, OrderItem } from '../types';
import { check, redact, type RawRecord, type Rejected, type SourceFile, type TotalCheck } from './common';
import { columnIndex, contentHash, idr0, isBlankRow, parseDate, parseGram, productKey, rowToObject, sheetRows, str, uniqueHeaders, type Row } from './util';

export const COMPLETED_REQUIRED = [
  'No. Pesanan', 'Status Pesanan', 'Waktu Pesanan Dibuat', 'Waktu Pembayaran Dilakukan', 'Waktu Pesanan Selesai',
  'Nama Produk', 'SKU Induk', 'Nomor Referensi SKU', 'Nama Variasi', 'Jumlah', 'Harga Setelah Diskon', 'Subtotal Pesanan',
  'Diskon Dari Penjual', 'Diskon Dari Shopee', 'Total Pembayaran', 'Username (Pembeli)', 'Metode Pembayaran',
  'Kota/Kabupaten', 'Provinsi',
] as const;

/** Kolom level pesanan: nilainya diulang di setiap baris item dan hanya boleh dihitung SEKALI per pesanan. */
const ORDER_LEVEL = [
  'Status Pesanan', 'No. Resi', 'Waktu Pesanan Dibuat', 'Waktu Pembayaran Dilakukan', 'Metode Pembayaran',
  'Voucher Ditanggung Penjual', 'Voucher Ditanggung Shopee', 'Ongkos Kirim Dibayar oleh Pembeli', 'Total Pembayaran',
  'Username (Pembeli)', 'Kota/Kabupaten', 'Provinsi', 'Waktu Pesanan Selesai',
];

export interface CompletedParse {
  orders: Omit<Order, 'batchId'>[];
  items: OrderItem[];
  raw: RawRecord[];
  rejected: Rejected[];
  warnings: string[];
  duplicatesInFiles: number;
  rowsRead: number;
  checks: TotalCheck[];
}

interface Line { file: string; rowNo: number; row: Row; obj: Record<string, unknown> }

export function parseCompleted(files: SourceFile[]): CompletedParse {
  const out: CompletedParse = { orders: [], items: [], raw: [], rejected: [], warnings: [], duplicatesInFiles: 0, rowsRead: 0, checks: [] };
  // orderNo → file → baris (urut sesuai file). Laporan multi-part digabung sebelum dikelompokkan.
  const byOrder = new Map<string, Map<string, Line[]>>();
  let headers: string[] = [];
  let ix: Record<string, number> = {};
  let fileSubtotal = 0;

  for (const f of files) {
    const sheet = f.wb.SheetNames.includes('orders') ? 'orders' : f.wb.SheetNames[0];
    const rows = sheetRows(f.wb, sheet);
    if (!rows.length) { out.warnings.push(`${f.name}: sheet "${sheet}" kosong.`); continue; }
    headers = uniqueHeaders(rows[0]);
    ix = columnIndex(headers, COMPLETED_REQUIRED, f.name);
    if (headers.length !== 51 && headers.length !== 50) out.warnings.push(`${f.name}: ${headers.length} kolom (format acuan 50–51 kolom). Kolom wajib tetap lengkap.`);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (isBlankRow(row)) continue;
      out.rowsRead++;
      const obj = rowToObject(headers, row);
      out.raw.push({ file: f.name, sheet, rowNo: i + 1, data: redact(obj) });
      const orderNo = str(row[ix['No. Pesanan']]);
      if (!orderNo) { out.rejected.push({ file: f.name, sheet, rowNo: i + 1, reason: 'No. Pesanan kosong' }); continue; }
      fileSubtotal += idr0(row[ix['Subtotal Pesanan']]);
      let m = byOrder.get(orderNo);
      if (!m) byOrder.set(orderNo, (m = new Map()));
      const arr = m.get(f.name) ?? [];
      arr.push({ file: f.name, rowNo: i + 1, row, obj });
      m.set(f.name, arr);
    }
  }

  const g = (row: Row, h: string) => row[ix[h] ?? -1] ?? null;
  for (const [orderNo, perFile] of byOrder) {
    let lines = [...perFile.values()][0];
    if (perFile.size > 1) {
      // Pesanan yang sama muncul di beberapa file (file ganda / periode tumpang tindih).
      const versions = [...perFile.values()];
      const hashes = new Set(versions.map((v) => contentHash(v.map((l) => l.row))));
      out.duplicatesInFiles += perFile.size - 1;
      lines = versions[versions.length - 1];
      if (hashes.size > 1) out.warnings.push(`Pesanan ${orderNo} ada di ${perFile.size} file dengan isi berbeda — dipakai versi dari ${lines[0].file}.`);
    }
    const first = lines[0].row;
    for (const h of ORDER_LEVEL) {
      if (!(h in ix)) continue;
      const vals = new Set(lines.map((l) => String(g(l.row, h) ?? '')));
      if (vals.size > 1) out.warnings.push(`Pesanan ${orderNo}: kolom level pesanan "${h}" berbeda antar baris item — dipakai baris pertama.`);
    }
    const items: OrderItem[] = lines.map((l, n) => {
      const r = l.row;
      const productName = str(g(r, 'Nama Produk'));
      const variation = str(g(r, 'Nama Variasi'));
      return {
        id: `${orderNo}#${n + 1}`,
        orderNo,
        lineNo: n + 1,
        productName,
        variation,
        skuParent: str(g(r, 'SKU Induk')),
        skuRef: str(g(r, 'Nomor Referensi SKU')),
        priceOriginal: idr0(g(r, 'Harga Awal')),
        priceAfterDiscount: idr0(g(r, 'Harga Setelah Diskon')),
        qty: idr0(g(r, 'Jumlah')),
        returnedQty: idr0(g(r, 'Returned quantity')),
        subtotal: idr0(g(r, 'Subtotal Pesanan')),
        totalDiscount: idr0(g(r, 'Total Diskon')),
        sellerDiscount: idr0(g(r, 'Diskon Dari Penjual')),
        shopeeDiscount: idr0(g(r, 'Diskon Dari Shopee')),
        weightGr: parseGram(g(r, 'Berat Produk')),
        returnStatus: str(g(r, 'Status Pembatalan/ Pengembalian')),
        productKey: productKey(productName, variation),
      };
    });
    const order: Omit<Order, 'batchId'> = {
      orderNo,
      status: str(g(first, 'Status Pesanan')),
      cancelReason: str(g(first, 'Alasan Pembatalan')),
      resi: str(g(first, 'No. Resi')),
      shippingOption: str(g(first, 'Opsi Pengiriman')),
      pickupMode: str(g(first, 'Antar ke counter/ pick-up')),
      shipBy: parseDate(g(first, 'Pesanan Harus Dikirimkan Sebelum (Menghindari keterlambatan)')),
      shippedAt: parseDate(g(first, 'Waktu Pengiriman Diatur')),
      createdAt: parseDate(g(first, 'Waktu Pesanan Dibuat')),
      paidAt: parseDate(g(first, 'Waktu Pembayaran Dilakukan')),
      completedAt: parseDate(g(first, 'Waktu Pesanan Selesai')),
      orderType: str(g(first, 'Tipe Pesanan')),
      paymentMethod: str(g(first, 'Metode Pembayaran')),
      itemCount: idr0(g(first, 'Jumlah Produk di Pesan')),
      totalWeightGr: parseGram(g(first, 'Total Berat')),
      voucherSeller: idr0(g(first, 'Voucher Ditanggung Penjual')),
      cashbackCoin: idr0(g(first, 'Cashback Koin')),
      voucherShopee: idr0(g(first, 'Voucher Ditanggung Shopee')),
      bundleDiscount: str(g(first, 'Paket Diskon')),
      bundleDiscountShopee: idr0(g(first, 'Paket Diskon (Diskon dari Shopee)')),
      bundleDiscountSeller: idr0(g(first, 'Paket Diskon (Diskon dari Penjual)')),
      coinDiscount: idr0(g(first, 'Potongan Koin Shopee')),
      cardDiscount: idr0(g(first, 'Diskon Kartu Kredit')),
      shippingPaidByBuyer: idr0(g(first, 'Ongkos Kirim Dibayar oleh Pembeli')),
      estShippingDiscount: idr0(g(first, 'Estimasi Potongan Biaya Pengiriman')),
      returnShippingFee: idr0(g(first, 'Ongkos Kirim Pengembalian Barang')),
      totalPayment: idr0(g(first, 'Total Pembayaran')),
      estShippingFee: idr0(g(first, 'Perkiraan Ongkos Kirim')),
      buyer: str(g(first, 'Username (Pembeli)')),
      city: str(g(first, 'Kota/Kabupaten')),
      province: str(g(first, 'Provinsi')),
      lineCount: items.length,
      hash: '',
      sourceFile: lines[0].file,
    };
    // Hash dari data ternormalisasi (bukan baris mentah) agar pesanan yang sama dari export Selesai
    // maupun Semua Pesanan dikenali sebagai duplikat; berubah hanya bila isinya (mis. status) berubah.
    const { sourceFile: _src, hash: _h, ...core } = order;
    order.hash = contentHash({ core, items });
    if (!order.createdAt) out.warnings.push(`Pesanan ${orderNo}: Waktu Pesanan Dibuat kosong/tidak terbaca.`);
    const qtySum = items.reduce((s, i) => s + i.qty, 0);
    if (order.itemCount && qtySum !== order.itemCount) out.warnings.push(`Pesanan ${orderNo}: jumlah item (${qtySum}) ≠ Jumlah Produk di Pesan (${order.itemCount}).`);
    out.orders.push(order);
    out.items.push(...items);
  }

  const normSubtotal = out.items.reduce((s, i) => s + i.subtotal, 0);
  const uniqueFileSubtotal = out.duplicatesInFiles ? null : fileSubtotal;
  out.checks.push(check('Pesanan Selesai', 'Σ Subtotal Pesanan (baris item file) = Σ subtotal item ternormalisasi', uniqueFileSubtotal, normSubtotal));
  out.checks.push(check('Pesanan Selesai', 'Jumlah baris item file = jumlah item ternormalisasi', out.duplicatesInFiles ? null : out.rowsRead - out.rejected.length, out.items.length, 0.5));
  return out;
}
