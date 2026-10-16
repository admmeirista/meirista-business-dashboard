// Paket data terenkripsi: enkripsi/dekripsi, password salah, dan master produk di perangkat tidak tertimpa.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { BizDb } from '../src/lib/db';
import { applyBundle, decodeBundle, deriveKey, dumpTables, encodeBundle, readHeader, WrongPasswordError, type BundlePayload } from '../src/lib/bundle';
import { INCOME_AMOUNT_FIELDS } from '../src/lib/types';

const payload = (tables: Record<string, unknown[]>): BundlePayload => ({ createdAt: '2026-10-15T10:00:00.000Z', files: [], counts: {}, tables });

describe('paket data terenkripsi', () => {
  it('enkripsi → dekripsi mengembalikan isi yang sama; isi tidak terbaca tanpa password', async () => {
    const p = payload({ orders: [{ orderNo: 'A1', buyer: 'pembeli_rahasia', totalPayment: 123456 }] });
    const bytes = await encodeBundle(p, 'password-sangat-rahasia');
    expect(new TextDecoder('latin1').decode(bytes)).not.toContain('pembeli_rahasia');
    const { header } = readHeader(bytes);
    expect(header.kdf).toMatchObject({ alg: 'PBKDF2-SHA256', iter: 600000 });
    const back = await decodeBundle(bytes, await deriveKey('password-sangat-rahasia', header.kdf.salt));
    expect(back).toEqual(p);
  });

  it('password salah → WrongPasswordError', async () => {
    const bytes = await encodeBundle(payload({}), 'password-benar-123');
    const { header } = readHeader(bytes);
    await expect(decodeBundle(bytes, await deriveKey('password-salah-123', header.kdf.salt))).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('salt dipakai ulang tetapi IV selalu baru', async () => {
    const a = readHeader(await encodeBundle(payload({}), 'password-benar-123')).header;
    const b = readHeader(await encodeBundle(payload({}), 'password-benar-123', a.kdf.salt)).header;
    expect(b.kdf.salt).toBe(a.kdf.salt);
    expect(b.iv).not.toBe(a.iv);
    expect(b.id).not.toBe(a.id);
  });

  it('penghasilan: baris Sku tidak ikut paket; nominal utuh setelah enkripsi → dekripsi → dimuat', async () => {
    const src = new BizDb('inc-' + Date.now());
    const amounts = Object.fromEntries(INCOME_AMOUNT_FIELDS.map((f) => [f, 0]));
    await src.income.bulkPut([
      { id: 'O|1', recordType: 'Order', orderNo: '1', compensation: null, amounts: { ...amounts, 'Total Penghasilan': 900, 'Biaya Administrasi': -100 } },
      { id: 'S|1|1', recordType: 'Sku', orderNo: '1', amounts: { ...amounts, 'Total Penghasilan': 900 } },
    ] as never);
    const tables = await dumpTables(src);
    expect(tables.income.map((r) => (r as { id: string }).id)).toEqual(['O|1']);
    const bytes = await encodeBundle(payload(tables), 'password-benar-123');
    const decoded = await decodeBundle(bytes, await deriveKey('password-benar-123', readHeader(bytes).header.kdf.salt));
    const dst = new BizDb('inc2-' + Date.now());
    await applyBundle(dst, decoded);
    const back = (await dst.income.toArray())[0];
    expect(Object.keys(back.amounts)).toHaveLength(INCOME_AMOUNT_FIELDS.length);
    expect(back.amounts).toMatchObject({ 'Total Penghasilan': 900, 'Biaya Administrasi': -100, 'Biaya Layanan': 0 });
    expect(back.compensation).toBeNull();
  });

  it('format kolom: nama kolom tidak diulang per baris', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ orderNo: `O${i}`, paymentMethod: 'COD (Bayar di Tempat)', shippedAt: null }));
    const v2 = await encodeBundle(payload({ orders: rows }), 'password-benar-123');
    const back = await decodeBundle(v2, await deriveKey('password-benar-123', readHeader(v2).header.kdf.salt));
    expect(back.tables.orders).toEqual(rows);
    expect(readHeader(v2).header.v).toBe(2);
  });

  it('memuat paket mengganti data laporan, master produk & HPP di perangkat tetap', async () => {
    const src = new BizDb('src-' + Date.now());
    await src.checks.add({ batchId: 1, scope: 's', label: 'l', reported: 1, computed: 1, diff: 0, ok: true });
    const tables = await dumpTables(src);
    tables.orders = [{ orderNo: 'BARU', status: 'Selesai' }];
    const dst = new BizDb('dst-' + Date.now());
    await dst.orders.put({ orderNo: 'LAMA' } as never);
    await dst.products.add({ name: 'Produk', brand: 'B', category: 'K', active: true });
    await dst.costs.add({ productId: 1, unitCost: 5000, effectiveFrom: '2026-01-01', note: '' });
    await applyBundle(dst, payload(tables));
    expect((await dst.orders.toArray()).map((o) => o.orderNo)).toEqual(['BARU']);
    expect(await dst.checks.count()).toBe(1);
    expect(await dst.products.count()).toBe(1);
    expect(await dst.costs.count()).toBe(1);
  });
});
