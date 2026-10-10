// Model data ternormalisasi. Semua nominal dalam Rupiah (number), tanda (+/−) mengikuti laporan Shopee asli.

export type ReportKind = 'completed' | 'returns' | 'income';

export interface ImportBatch {
  id?: number;
  kind: ReportKind;
  fileNames: string[];
  fileHashes: string[];
  importedAt: string; // ISO
  periodFrom: string | null;
  periodTo: string | null;
  rowsRead: number;
  inserted: number;
  updated: number;
  duplicates: number;
  rejected: number;
  warnings: string[];
  errors: string[];
  status: 'OK' | 'WARNING' | 'FAILED';
}

/** Baris asli dari Excel (untuk audit). Kolom data pribadi tak tersamarkan dihapus — lihat REDACTED_COLUMNS. */
export interface RawRow {
  id?: number;
  batchId: number;
  file: string;
  sheet: string;
  rowNo: number; // nomor baris Excel (1-based)
  data: Record<string, unknown>;
}

// ───────── Pesanan Selesai ─────────
export interface Order {
  orderNo: string;
  status: string;
  resi: string;
  shippingOption: string;
  pickupMode: string;
  shipBy: string | null;
  shippedAt: string | null;
  createdAt: string | null;
  paidAt: string | null;
  completedAt: string | null;
  orderType: string;
  paymentMethod: string;
  itemCount: number; // Jumlah Produk di Pesan
  totalWeightGr: number | null;
  voucherSeller: number;
  cashbackCoin: number;
  voucherShopee: number;
  bundleDiscount: string;
  bundleDiscountShopee: number;
  bundleDiscountSeller: number;
  coinDiscount: number;
  cardDiscount: number;
  shippingPaidByBuyer: number;
  estShippingDiscount: number;
  returnShippingFee: number;
  totalPayment: number;
  estShippingFee: number;
  buyer: string;
  city: string;
  province: string;
  lineCount: number;
  hash: string;
  batchId: number;
  sourceFile: string;
}

export interface OrderItem {
  id: string; // orderNo#lineNo
  orderNo: string;
  lineNo: number;
  productName: string;
  variation: string;
  skuParent: string;
  skuRef: string;
  priceOriginal: number;
  priceAfterDiscount: number;
  qty: number;
  returnedQty: number;
  subtotal: number;
  totalDiscount: number;
  sellerDiscount: number;
  shopeeDiscount: number;
  weightGr: number | null;
  returnStatus: string;
  productKey: string;
}

// ───────── Pengembalian ─────────
export interface ReturnRequest {
  returnNo: string;
  orderNo: string;
  orderCreatedAt: string | null;
  buyerMasked: string;
  requestedAt: string | null;
  status: string;
  returnType: string; // Seluruh / Sebagian Pesanan
  solution: string;
  reason: string;
  refundTotal: number;
  refundCompletedAt: string | null;
  toShopeeWarehouse: string;
  returnCourier: string;
  returnShipStatus: string;
  returnShippedAt: string | null;
  province: string;
  city: string;
  appealDeadline: string | null;
  rejectReason: string;
  compensation: number;
  orderTotal: number;
  paymentMethod: string;
  releasedAmount: number;
  shippingFee: number;
  returnShippingFee: number;
  lineCount: number;
  qtyTotal: number;
  hash: string;
  batchId: number;
  sourceFile: string;
}

export interface ReturnLine {
  id: string; // returnNo#lineNo
  returnNo: string;
  orderNo: string;
  lineNo: number;
  productName: string;
  skuParent: string;
  variation: string;
  variationCode: string;
  unitPrice: number;
  qty: number;
  productKey: string;
}

// ───────── Penghasilan ─────────
export interface SummaryLine {
  order: number;
  level: 0 | 1; // 0 = judul/total, 1 = rincian
  label: string;
  value: number | null;
}

export interface IncomeReport {
  id: string; // seller|from|to
  seller: string;
  from: string;
  to: string;
  summary: SummaryLine[];
  adjustmentSummary: SummaryLine[];
  batchId: number;
  sourceFile: string;
}

/** Kolom nominal di sheet Penghasilan (sama untuk baris Order & Sku). */
export const INCOME_AMOUNT_FIELDS = [
  'Total Penghasilan',
  'Harga Produk',
  'Jumlah Pengembalian Dana ke Pembeli',
  'Ongkir Dibayar Pembeli',
  'Ongkos Kirim yang Dibayarkan ke Jasa Kirim',
  'Potongan Ongkos Kirim dari Jasa Kirim',
  'Gratis Ongkir dari Shopee',
  'Ongkos Kirim Pengembalian Barang',
  'Return to Seller Fee',
  'Pengembalian Biaya Kirim',
  'Voucher disponsor oleh Penjual',
  'Cashback Koin disponsori Penjual',
  'Diskon Produk dari Shopee',
  'Voucher co-fund disponsor oleh Penjual',
  'Cashback Koin Co-fund disponsori Penjual',
  'Biaya Administrasi',
  'Biaya Proses Pesanan',
  'Biaya Gratis Ongkir XTRA - Ukuran Khusus (Kategori D)',
  'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)',
  'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori E)',
  'Biaya Layanan Promo XTRA',
  'AMS Service Fee',
  'Biaya Kampanye',
  'Biaya Komisi AMS',
  'Biaya Isi Saldo Otomatis (dari Penghasilan)',
  'Premi',
  'Biaya Transaksi',
  'FBS Fee',
  'PPh 22',
] as const;
export type IncomeAmountField = (typeof INCOME_AMOUNT_FIELDS)[number];
export type IncomeAmounts = Record<IncomeAmountField, number>;

export interface IncomeRecord {
  id: string; // Order: O|orderNo|releaseDate|refNo · Sku: S|orderNo|releaseDate|productId|n
  recordType: 'Order' | 'Sku';
  reportId: string;
  orderNo: string;
  refNo: string; // No. Pengajuan
  productId: string;
  productName: string;
  createdDate: string | null;
  releaseDate: string | null;
  releaseMethod: string;
  orderType: string;
  amounts: IncomeAmounts;
  buyer: string;
  buyerPaid: number | null;
  buyerPaymentMethod: string;
  paymentDetail: string;
  installment: string;
  courierService: string;
  courierName: string;
  voucherCode: string;
  compensation: number | null;
  refundToBuyer: number | null;
  batchId: number;
  sourceFile: string;
  sheet: string;
}

export interface Adjustment {
  id: string;
  reportId: string;
  no: number;
  date: string | null;
  type: string;
  reason: string;
  amount: number;
  orderNo: string;
  releaseDate: string | null;
  batchId: number;
}

export interface SellerFee {
  id: string; // reportId|orderNo
  reportId: string;
  orderNo: string;
  platform: number;
  freeShippingXtra: number;
  service: number;
  promotion: number;
  other: number;
  batchId: number;
}

export interface ShippingDiscrepancy {
  id: string; // reportId|orderNo
  reportId: string;
  orderNo: string;
  estimated: number;
  actual: number;
  reason: string;
  batchId: number;
}

// ───────── Master data ─────────
export interface Product {
  id?: number;
  name: string;
  brand: string;
  category: string;
  active: boolean;
}

/** Listing Shopee (nama produk + variasi) → produk internal × isi per paket. */
export interface SkuMapping {
  listingKey: string; // productKey(nama, variasi)
  listingName: string;
  variation: string;
  productId: number;
  packQty: number;
}

export interface CostEntry {
  id?: number;
  productId: number;
  unitCost: number; // HPP per unit produk
  effectiveFrom: string; // YYYY-MM-DD
  note: string;
}
