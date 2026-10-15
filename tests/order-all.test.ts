// Export "Semua Pesanan" (Order.all): pesanan batal, angka versi Seller Centre, dan anti-duplikat dengan export Selesai.
import 'fake-indexeddb/auto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { FIXTURES, hasFixtures, load } from './helpers';
import { BizDb } from '../src/lib/db';
import { parseUploads, type UploadFile } from '../src/lib/pipeline';
import { commitUpload } from '../src/lib/importer';
import { loadDataset } from '../src/lib/load';
import { buildIndex } from '../src/lib/metrics/dataset';
import { profitability, returnsAnalysis, salesSummary } from '../src/lib/metrics/analytics';
import { cancellationAnalysis } from '../src/lib/metrics/cancellations';
import { reconcile } from '../src/lib/metrics/reconcile';
import { detectFile } from '../src/lib/parse/detect';
import { parseCompleted, COMPLETED_REQUIRED } from '../src/lib/parse/completed';

const hasAll = hasFixtures && readdirSync(FIXTURES).some((f) => /^Order\.all\./.test(f));
const read = (pattern: RegExp): UploadFile[] => readdirSync(FIXTURES).filter((f) => pattern.test(f)).map((name) => {
  const b = readFileSync(join(FIXTURES, name));
  return { name, buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
});

describe.skipIf(!hasAll)('Order.all Agustus 2026 (file asli)', () => {
  it('terdeteksi sebagai Semua Pesanan; status & alasan batal terbaca', async () => {
    const files = await load(/^Order\.all\./);
    expect(files.map((f) => detectFile(f.name, f.wb))).toMatchObject([
      { kind: 'all', periodFrom: '2026-08-01', periodTo: '2026-08-31', part: 1, partsTotal: 2, problem: null },
      { kind: 'all', part: 2, partsTotal: 2, problem: null },
    ]);
    const p = parseCompleted(files);
    expect(p.orders).toHaveLength(6799);
    expect(p.orders.filter((o) => o.status === 'Batal')).toHaveLength(949);
    expect(p.orders.filter((o) => o.status === 'Selesai')).toHaveLength(5850);
    expect(p.orders.find((o) => o.orderNo === '2608016B0SCBMV')).toMatchObject({ status: 'Batal', cancelReason: 'Dibatalkan oleh Pembeli. Alasan: Ubah Pesanan yang Ada', shippedAt: null });
    expect(p.checks.every((c) => c.ok !== false)).toBe(true);
  });

  it('mereproduksi kartu Seller Centre: Penjualan, Pesanan, Pesanan Dibatalkan', async () => {
    const db = new BizDb('all-' + Date.now());
    const batches = await commitUpload(db, await parseUploads([...read(/^Order\.(completed|all)\./), ...read(/^Income\./)]));
    expect(batches.map((b) => [b.kind, b.status])).toEqual([['completed', 'OK'], ['all', 'OK'], ['income', 'OK']]);
    const ix = buildIndex(await loadDataset(db));
    // Pesanan batal tidak masuk analisis penjualan, tetapi tersedia untuk analisis pembatalan.
    expect(ix.cancelled).toHaveLength(949);
    expect(ix.ds.orders).toHaveLength(9322 + 5850);
    const aug = { basis: 'shipped' as const, from: '2026-08-01', to: '2026-08-31' };
    const a = cancellationAnalysis(ix, aug);
    expect(a.covered).toBe(true);
    // Seller Centre: Rp 743.052,26K · 6.615 pesanan · 764 dibatalkan. Selisih 1 pesanan = dibuat 31 Juli (tidak ada di export buatan Agustus).
    expect(a.sellerCentre).toEqual({ orders: 6614, value: 742897194 });
    expect(a.cancelled).toEqual({ orders: 764, value: 103215239 });
    expect(a.failed).toEqual({ orders: 155, value: 21188646 });
    expect(a.unpaidCancelled.orders).toBe(185);
    // Jembatan Seller Centre → omzet dashboard harus pas ke rupiah terakhir.
    expect(a.bridgeMatches).toBe(true);
    expect(a.omzet).toEqual({ orders: 5751, value: 629572136 });
    expect(salesSummary(ix, aug).orders).toBe(5751);
    expect(a.actors.map((x) => [x.actor, x.orders])).toEqual([['Pembeli', 455], ['Sistem Shopee', 298], ['Penjual', 11]]);
    // Basis omzet default "Seller Centre": angka Ringkasan = kartu Penjualan Seller Centre.
    const sc = salesSummary(ix, { ...aug, basis: 'sc' });
    expect([sc.orders, sc.gmv]).toEqual([6614, 742897194]);
    // Juni (tanpa export Semua Pesanan) = pesanan dibayar Juni yang tidak batal.
    expect(salesSummary(ix, { basis: 'sc', from: '2026-06-01', to: '2026-06-30' })).toMatchObject({ orders: 9322, gmv: 880252044 });
    // Laba & kohort retur tidak memasukkan pesanan batal.
    expect(profitability(ix, { ...aug, basis: 'sc' }, 'product').totals.unsettledOrders + profitability(ix, { ...aug, basis: 'sc' }, 'product').totals.settledOrders).toBe(5850);
    expect(returnsAnalysis(ix, { ...aug, basis: 'sc' }, 'requested').cohortOrders).toBe(5850);
    // Jembatan pada basis Seller Centre membandingkan ke omzet bersih per tanggal kirim.
    const b = cancellationAnalysis(ix, { ...aug, basis: 'sc' });
    expect([b.netBasis, b.omzet.orders, b.bridgeMatches]).toEqual(['shipped', 5751, true]);
    // Pesanan batal tidak dianggap "belum dilepas".
    expect(reconcile(ix).exceptions.filter((e) => e.type === 'UNSETTLED' && ix.cancelled.some((c) => c.orderNo === e.orderNo))).toHaveLength(0);
  });
});

// ── Sintetis: pesanan yang sama dari export Selesai dan Semua Pesanan tidak digandakan ──
const HEAD = [...COMPLETED_REQUIRED, 'Harga Awal', 'Jumlah Produk di Pesan', 'Waktu Pengiriman Diatur'];
const row = (o: Record<string, string>) => HEAD.map((h) => o[h] ?? '');
const base = {
  'No. Pesanan': 'X1', 'Status Pesanan': 'Selesai', 'Waktu Pesanan Dibuat': '2026-08-01 10:00', 'Waktu Pembayaran Dilakukan': '2026-08-01 10:01',
  'Waktu Pengiriman Diatur': '2026-08-02 09:00', 'Waktu Pesanan Selesai': '2026-08-06 10:00', 'Nama Produk': 'Produk X', Jumlah: '1',
  'Harga Setelah Diskon': '10.000', 'Subtotal Pesanan': '10.000', 'Diskon Dari Penjual': '0', 'Diskon Dari Shopee': '0', 'Total Pembayaran': '12.000',
  'Username (Pembeli)': 'b1', 'Metode Pembayaran': 'COD (Bayar di Tempat)', 'Kota/Kabupaten': 'KOTA BANDUNG', Provinsi: 'JAWA BARAT', 'Harga Awal': '10.000', 'Jumlah Produk di Pesan': '1',
};
const file = (name: string, headers: string[], rows: string[][]): UploadFile => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'orders');
  return { name, buf: XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer };
};

describe('Semua Pesanan vs Pesanan Selesai — sintetis', () => {
  it('pesanan sama → duplikat; status berubah → diperbarui', async () => {
    const db = new BizDb('dup-' + Date.now());
    const allHead = [...HEAD, 'Alasan Pembatalan'];
    await commitUpload(db, await parseUploads([file('Order.completed.20260801_20260831.xlsx', HEAD, [row(base)])]));
    const second = await commitUpload(db, await parseUploads([file('Order.all.20260801_20260831.xlsx', allHead, [[...row(base), '']])]));
    expect(second[0]).toMatchObject({ kind: 'all', inserted: 0, updated: 0, duplicates: 1 });
    // Export yang lebih baru menunjukkan pesanan dibatalkan (gagal kirim) → diperbarui, lalu keluar dari omzet.
    const cancelled = { ...base, 'Status Pesanan': 'Batal', 'Waktu Pesanan Selesai': '' };
    const third = await commitUpload(db, await parseUploads([file('Order.all.20260801_20260831 (1).xlsx', allHead, [[...row(cancelled), 'Dibatalkan secara otomatis oleh sistem Shopee. Alasan: Pengiriman gagal']])]));
    expect(third[0]).toMatchObject({ inserted: 0, updated: 1 });
    const ix = buildIndex(await loadDataset(db));
    expect(ix.ds.orders).toHaveLength(0);
    expect(ix.cancelled.map((o) => o.cancelReason)).toEqual(['Dibatalkan secara otomatis oleh sistem Shopee. Alasan: Pengiriman gagal']);
    expect(salesSummary(ix, { basis: 'shipped', from: '2026-08-01', to: '2026-08-31' }).gmv).toBe(0);
  });
});
