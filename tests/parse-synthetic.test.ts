// Uji sintetis (berjalan juga di CI, tanpa file asli): format angka, header berulang, multi-part, duplikat.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { guessPackSize, parseDate, parseIdr, uniqueHeaders } from '../src/lib/parse/util';
import { parseCompleted, COMPLETED_REQUIRED } from '../src/lib/parse/completed';
import type { SourceFile } from '../src/lib/parse/common';

describe('parseIdr — format rupiah Indonesia', () => {
  it.each([
    ['90.000', 90000], ['160.006', 160006], ['1.234.567', 1234567], ['RP 33.300\n', 33300], ['RP -22.000\n', -22000],
    ['Rp 1.234,50', 1234.5], ['67800', 67800], [62223, 62223], [-3760, -3760], ['0', 0], ['(5.000)', -5000],
  ])('%j → %d', (v, n) => expect(parseIdr(v as string)).toBe(n));
  it.each([[null], [''], ['-'], ['abc']])('%j → null', (v) => expect(parseIdr(v as string)).toBeNull());
});

describe('util', () => {
  it('header berulang diberi akhiran', () => {
    expect(uniqueHeaders(['Provinsi', 'Kota', 'Provinsi', 'Kode Pos', 'Kode Pos', null])).toEqual(['Provinsi', 'Kota', 'Provinsi (2)', 'Kode Pos', 'Kode Pos (2)', 'Kolom 6']);
  });
  it('tanggal', () => {
    expect(parseDate('2026-06-01 08:39')).toBe('2026-06-01 08:39');
    expect(parseDate('2026-07-31')).toBe('2026-07-31');
    expect(parseDate(46204)).toBe('2026-07-01');
    expect(parseDate('')).toBeNull();
  });
  it('saran isi paket', () => {
    expect(guessPackSize('[ 6 PCS ] VIVA AIR MAWAR')).toBe(6);
    expect(guessPackSize('PAKET USAHA TANCHO HAIR DYE  ISI 1 LUSIN')).toBe(12);
    expect(guessPackSize('Gatsby Water Gloss Tube 100gr')).toBeNull();
  });
});

const HEAD = [...COMPLETED_REQUIRED, 'Harga Awal', 'Jumlah Produk di Pesan'];
const line = (order: string, product: string, qty: number, sub: string, total: string) => {
  const o: Record<string, string> = Object.fromEntries(HEAD.map((h) => [h, '']));
  Object.assign(o, {
    'No. Pesanan': order, 'Status Pesanan': 'Selesai', 'Waktu Pesanan Dibuat': '2026-06-01 10:00', 'Waktu Pembayaran Dilakukan': '2026-06-01 10:01',
    'Waktu Pesanan Selesai': '2026-06-05 10:00', 'Nama Produk': product, Jumlah: String(qty), 'Harga Setelah Diskon': '10.000', 'Subtotal Pesanan': sub,
    'Diskon Dari Penjual': '0', 'Diskon Dari Shopee': '0', 'Total Pembayaran': total, 'Username (Pembeli)': 'buyer1', 'Metode Pembayaran': 'COD (Bayar di Tempat)',
    'Kota/Kabupaten': 'KOTA BANDUNG', Provinsi: 'JAWA BARAT', 'Harga Awal': '12.000', 'Jumlah Produk di Pesan': '3',
  });
  return HEAD.map((h) => o[h]);
};
const book = (name: string, rows: string[][]): SourceFile => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...rows]), 'orders');
  return { name, hash: name, wb: XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })) };
};

describe('parseCompleted — sintetis', () => {
  it('multi-part digabung; nilai level pesanan tidak dijumlahkan per item', () => {
    const p = parseCompleted([
      book('Order.completed.20260601_20260630_part_1_of_2.xlsx', [line('A1', 'Produk X', 1, '10.000', '35.000'), line('A1', 'Produk Y', 2, '20.000', '35.000')]),
      book('Order.completed.20260601_20260630_part_2_of_2.xlsx', [line('B2', 'Produk X', 3, '30.000', '33.000')]),
    ]);
    expect(p.orders.map((o) => [o.orderNo, o.lineCount, o.totalPayment])).toEqual([['A1', 2, 35000], ['B2', 1, 33000]]);
    expect(p.orders.reduce((s, o) => s + o.totalPayment, 0)).toBe(68000);
    expect(p.items.reduce((s, i) => s + i.subtotal, 0)).toBe(60000);
    expect(p.checks.every((c) => c.ok)).toBe(true);
  });
  it('file yang sama diunggah dua kali → duplikat, tidak digandakan', () => {
    const rows = [line('A1', 'Produk X', 1, '10.000', '35.000')];
    const p = parseCompleted([book('a.xlsx', rows), book('b.xlsx', rows)]);
    expect(p.orders).toHaveLength(1);
    expect(p.items).toHaveLength(1);
    expect(p.duplicatesInFiles).toBe(1);
    expect(p.warnings.filter((w) => w.includes('isi berbeda'))).toHaveLength(0);
  });
  it('kolom wajib hilang → error jelas', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['No. Pesanan', 'Nama Produk']]), 'orders');
    expect(() => parseCompleted([{ name: 'x.xlsx', hash: 'x', wb }])).toThrow(/kolom wajib tidak ditemukan/);
  });
});
