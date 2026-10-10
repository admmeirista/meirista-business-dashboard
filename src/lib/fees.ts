import type { IncomeAmountField, IncomeAmounts } from './types';

/**
 * Struktur "Ringkasan Penghasilan" Shopee → kolom detail di sheet Penghasilan.
 * Dipakai untuk (1) rekonsiliasi Summary vs detail dan (2) breakdown biaya marketplace.
 */
export interface FeeGroup {
  key: string;
  label: string; // label grup persis seperti di sheet Summary
  section: 'revenue' | 'expense';
  fields: { field: IncomeAmountField; summaryLabel: string }[];
}

export const FEE_GROUPS: FeeGroup[] = [
  {
    key: 'subtotal', label: 'Subtotal Pesanan', section: 'revenue', fields: [
      { field: 'Harga Produk', summaryLabel: 'Harga Asli Produk' },
      { field: 'Jumlah Pengembalian Dana ke Pembeli', summaryLabel: 'Jumlah Pengembalian Dana ke Pembeli' },
    ],
  },
  {
    key: 'voucher', label: 'Voucher & Subsidi', section: 'revenue', fields: [
      { field: 'Voucher disponsor oleh Penjual', summaryLabel: 'Voucher disponsor oleh Penjual' },
      { field: 'Cashback Koin disponsori Penjual', summaryLabel: 'Cashback Koin disponsori Penjual' },
      { field: 'Diskon Produk dari Shopee', summaryLabel: 'Diskon Produk dari Shopee' },
      { field: 'Voucher co-fund disponsor oleh Penjual', summaryLabel: 'Voucher co-fund disponsor oleh Penjual' },
      { field: 'Cashback Koin Co-fund disponsori Penjual', summaryLabel: 'Cashback Koin Co-fund disponsori Penjual' },
    ],
  },
  {
    key: 'shipping', label: 'Total Biaya Pengiriman', section: 'expense', fields: [
      { field: 'Ongkir Dibayar Pembeli', summaryLabel: 'Ongkir Dibayar Pembeli' },
      { field: 'Ongkos Kirim yang Dibayarkan ke Jasa Kirim', summaryLabel: 'Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim' },
      { field: 'Potongan Ongkos Kirim dari Jasa Kirim', summaryLabel: 'Diskon Ongkir Ditanggung Jasa Kirim' },
      { field: 'Gratis Ongkir dari Shopee', summaryLabel: 'Gratis Ongkir dari Shopee' },
      { field: 'Ongkos Kirim Pengembalian Barang', summaryLabel: 'Ongkos Kirim Pengembalian Barang' },
      { field: 'Return to Seller Fee', summaryLabel: 'Kembali ke Biaya Pengiriman Pengirim' },
      { field: 'Pengembalian Biaya Kirim', summaryLabel: 'Pengembalian Biaya Kirim' },
    ],
  },
  {
    key: 'platform', label: 'Biaya Platform (Opsional)', section: 'expense', fields: [
      { field: 'Biaya Administrasi', summaryLabel: 'Biaya Administrasi' },
      { field: 'Biaya Proses Pesanan', summaryLabel: 'Biaya Proses Pesanan' },
    ],
  },
  {
    key: 'xtra', label: 'Biaya Gratis Ongkir XTRA (Opsional)', section: 'expense', fields: [
      { field: 'Biaya Gratis Ongkir XTRA - Ukuran Khusus (Kategori D)', summaryLabel: 'Biaya Gratis Ongkir XTRA - Ukuran Khusus (Kategori D)' },
      { field: 'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)', summaryLabel: 'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)' },
      { field: 'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori E)', summaryLabel: 'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori E)' },
    ],
  },
  {
    key: 'service', label: 'Biaya Layanan (Opsional)', section: 'expense', fields: [
      { field: 'Biaya Layanan Promo XTRA', summaryLabel: 'Biaya Layanan Promo XTRA' },
    ],
  },
  {
    key: 'promo', label: 'Biaya Promosi (Opsional)', section: 'expense', fields: [
      { field: 'AMS Service Fee', summaryLabel: 'AMS Service Fee' },
      { field: 'Biaya Kampanye', summaryLabel: 'Biaya Kampanye' },
      { field: 'Biaya Komisi AMS', summaryLabel: 'Biaya Komisi AMS' },
      { field: 'Biaya Isi Saldo Otomatis (dari Penghasilan)', summaryLabel: 'Biaya Isi Saldo Otomatis (dari Penghasilan)' },
    ],
  },
  {
    key: 'other', label: 'Biaya Lainnya (Opsional)', section: 'expense', fields: [
      { field: 'Premi', summaryLabel: 'Premi' },
      { field: 'Biaya Transaksi', summaryLabel: 'Biaya Transaksi' },
      { field: 'FBS Fee', summaryLabel: 'FBS Fee' },
    ],
  },
  {
    key: 'tax', label: 'Pajak', section: 'expense', fields: [
      { field: 'PPh 22', summaryLabel: 'PPh 22' },
    ],
  },
];

/** Biaya marketplace murni (di luar ongkir & refund) — dasar analisis "fee rate". */
export const MARKETPLACE_FEE_GROUPS = ['platform', 'xtra', 'service', 'promo', 'other', 'tax'] as const;

export const sumFields = (a: IncomeAmounts, fields: IncomeAmountField[]) => fields.reduce((s, f) => s + (a[f] || 0), 0);
export const groupTotal = (a: IncomeAmounts, g: FeeGroup) => sumFields(a, g.fields.map((f) => f.field));
export const marketplaceFees = (a: IncomeAmounts) =>
  FEE_GROUPS.filter((g) => (MARKETPLACE_FEE_GROUPS as readonly string[]).includes(g.key)).reduce((s, g) => s + groupTotal(a, g), 0);

/** Komponen penyusun Total Penghasilan (semua kolom nominal selain Total Penghasilan). */
export const componentSum = (a: IncomeAmounts) => FEE_GROUPS.reduce((s, g) => s + groupTotal(a, g), 0);
