// Validasi wajib sebelum dashboard keuangan: data ternormalisasi harus mereproduksi total di laporan Shopee asli.
// Angka acuan di bawah diambil langsung dari file Shopee (Summary / Adjustment) — bukan angka simulasi.
import { describe, expect, it } from 'vitest';
import { hasFixtures, load } from './helpers';
import { detectFile } from '../src/lib/parse/detect';
import { parseCompleted } from '../src/lib/parse/completed';
import { parseReturns } from '../src/lib/parse/returns';
import { parseIncome } from '../src/lib/parse/income';
import { REDACTED } from '../src/lib/parse/common';

describe.skipIf(!hasFixtures)('File Shopee asli', () => {
  it('mendeteksi jenis, periode, dan part setiap file', async () => {
    const all = await load(/\.xlsx?$/i);
    const info = Object.fromEntries(all.map((f) => [f.name, detectFile(f.name, f.wb)]));
    expect(info['Order.completed.20260601_20260630_part_1_of_2.xlsx']).toMatchObject({ kind: 'completed', periodFrom: '2026-06-01', periodTo: '2026-06-30', part: 1, partsTotal: 2, problem: null });
    expect(info['Order.completed.20260601_20260630_part_2_of_2.xlsx']).toMatchObject({ kind: 'completed', part: 2, partsTotal: 2 });
    expect(info['Order.return_refund.20260601_20260701.xls']).toMatchObject({ kind: 'returns', problem: null });
    expect(info['Income.sudah dilepas.id.20260701_20260731.xlsx']).toMatchObject({ kind: 'income', periodFrom: '2026-07-01', periodTo: '2026-07-31', problem: null });
  });

  it('Pesanan Selesai (2 part): header & item terpisah, tanpa hitung ganda', async () => {
    const p = parseCompleted(await load(/^Order\.completed\./));
    expect(p.rowsRead).toBe(10799);
    expect(p.items).toHaveLength(10799);
    expect(p.orders).toHaveLength(9322);
    expect(p.orders.filter((o) => o.lineCount > 1)).toHaveLength(706);
    expect(p.rejected).toHaveLength(0);
    expect(p.duplicatesInFiles).toBe(0);
    for (const c of p.checks) expect(c.ok, c.label).toBe(true);
    // Contoh pesanan multi-item dari file: 3 item, Total Pembayaran 422.500 hanya dihitung sekali.
    const o = p.orders.find((x) => x.orderNo === '260601VE15BU3R')!;
    expect(o).toMatchObject({ lineCount: 3, totalPayment: 422500, itemCount: 6, voucherShopee: 100000, paymentMethod: 'Saldo ShopeePay', city: 'KAB. BOGOR', province: 'JAWA BARAT', createdAt: '2026-06-01 08:39', completedAt: '2026-06-02 16:04' });
    const its = p.items.filter((i) => i.orderNo === '260601VE15BU3R');
    expect(its.map((i) => i.subtotal)).toEqual([132000, 255000, 132000]);
    expect(its[0]).toMatchObject({ priceOriginal: 90000, priceAfterDiscount: 66000, qty: 2, sellerDiscount: 48000, weightGr: 1400 });
    // SKU Induk & Nomor Referensi SKU kosong di seluruh export → pemetaan memakai nama + variasi.
    expect(p.items.every((i) => i.skuParent === '' && i.skuRef === '')).toBe(true);
    // Data pribadi tidak disimpan di baris audit.
    expect(p.raw[0].data['Alamat Pengiriman']).toBe(REDACTED);
    expect(p.raw[0].data['No. Telepon']).toBe(REDACTED);
    // Bulan pesanan dibuat ≠ bulan selesai.
    expect(new Set(p.orders.map((x) => x.completedAt!.slice(0, 7)))).toEqual(new Set(['2026-06', '2026-07', '2026-08']));
  });

  it('Pengembalian: granularitas pengajuan & baris dipertahankan, header berulang ditangani', async () => {
    const p = parseReturns(await load(/^Order\.return_refund\./));
    expect(p.rowsRead).toBe(65);
    expect(p.lines).toHaveLength(65);
    expect(p.requests).toHaveLength(59);
    expect(new Set(p.requests.map((r) => r.orderNo)).size).toBe(53);
    for (const c of p.checks) expect(c.ok, c.label).toBe(true);
    // Satu pesanan dengan beberapa pengajuan (2605247CY3TNQA: 3 pengajuan, 7 baris).
    const reqs = p.requests.filter((r) => r.orderNo === '2605247CY3TNQA');
    expect(reqs.map((r) => r.returnNo).sort()).toEqual(['26060202DJQY2UD', '26060202DVT994F', '26060407BKQ9855']);
    expect(reqs.find((r) => r.returnNo === '26060407BKQ9855')).toMatchObject({ refundTotal: 270000, compensation: 122000, status: 'Dana Dicairkan ke Penjual', lineCount: 3, releasedAmount: -139000, refundCompletedAt: '2026-06-04 14:09' });
    expect(p.requests.find((r) => r.returnNo === '2606010VTHF2WA8')).toMatchObject({ refundTotal: 33300, returnType: 'Sebagian Pesanan', shippingFee: -22000 });
    // Kolom "Provinsi" kedua (alamat pickup) menjadi "Provinsi (2)"; nomor telepon pembeli dihapus.
    expect(Object.keys(p.raw[0].data)).toContain('Provinsi (2)');
    for (const r of p.raw) for (const k of ['Buyer contact number', 'No. Telepon', 'Alamat Pengiriman', 'Alamat Pickup Pengembalian Barang'])
      expect([REDACTED, '', null]).toContain(r.data[k]);
    expect(p.raw[0].data['No. Telepon']).toBe(REDACTED);
  });

  it('Penghasilan: 6 sheet, Order vs Sku, Summary & Adjustment cocok persis', async () => {
    const p = parseIncome(await load(/^Income\./));
    expect(p.reports).toHaveLength(1);
    expect(p.reports[0]).toMatchObject({ seller: 'meirista_shop', from: '2026-07-01', to: '2026-07-31' });
    const orders = p.records.filter((r) => r.recordType === 'Order');
    const skus = p.records.filter((r) => r.recordType === 'Sku');
    expect(orders).toHaveLength(7878);
    expect(skus).toHaveLength(9183);
    expect(new Set(orders.map((r) => r.sheet))).toEqual(new Set(['Penghasilan - 1', 'Penghasilan - 2']));
    expect(p.rejected).toHaveLength(0);
    const failed = p.checks.filter((c) => c.ok === false);
    expect(failed, JSON.stringify(failed, null, 1)).toHaveLength(0);
    const byLabel = (l: string) => p.checks.find((c) => c.label === l)!;
    expect(byLabel('3. Total yang Dilepas')).toMatchObject({ reported: 702523353, computed: 702523353 });
    expect(byLabel('1. Total Pendapatan')).toMatchObject({ reported: 819948804, ok: true });
    expect(byLabel('2. Total Pengeluaran')).toMatchObject({ reported: -117425451, ok: true });
    expect(byLabel('Biaya Administrasi')).toMatchObject({ reported: -42233940, ok: true });
    expect(byLabel('Biaya Layanan Promo XTRA')).toMatchObject({ reported: -36898788, ok: true });
    // Total dari baris Sku sama dengan Order → menjumlahkan keduanya akan menggandakan pendapatan.
    expect(byLabel('Σ Total Penghasilan baris Sku = Σ baris Order (alokasi lengkap)').ok).toBe(true);
    // Penyesuaian terpisah dari transaksi reguler.
    expect(p.adjustments).toHaveLength(49);
    expect(p.adjustments.reduce((s, a) => s + a.amount, 0)).toBe(3091263);
    expect(p.checks.filter((c) => c.scope.startsWith('Penyesuaian')).every((c) => c.ok)).toBe(true);
    expect(p.sellerFees).toHaveLength(2852);
    expect(p.discrepancies).toHaveLength(48);
    expect(p.discrepancies[0]).toMatchObject({ orderNo: '260723CRSY6HJU', estimated: 18000, actual: 18001 });
    // Tanda asli dipertahankan (biaya negatif).
    expect(orders[0].amounts['Biaya Administrasi']).toBeLessThan(0);
  });

  it('Lintas periode: income Juli mencakup pesanan selesai Juni', async () => {
    const c = parseCompleted(await load(/^Order\.completed\./));
    const i = parseIncome(await load(/^Income\./));
    const done = new Map(c.orders.map((o) => [o.orderNo, o]));
    const incOrders = i.records.filter((r) => r.recordType === 'Order');
    const matched = incOrders.filter((r) => done.has(r.orderNo));
    expect(matched).toHaveLength(2557);
    // Harga Produk (income) = Σ subtotal item pesanan selesai untuk seluruh pesanan yang cocok.
    const sub = new Map<string, number>();
    for (const it of c.items) sub.set(it.orderNo, (sub.get(it.orderNo) ?? 0) + it.subtotal);
    expect(matched.filter((r) => Math.abs(r.amounts['Harga Produk'] - sub.get(r.orderNo)!) >= 1)).toHaveLength(0);
  });
});
