// Backup .json.gz harus memulihkan seluruh isi database (data, master, audit) apa adanya.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { BizDb } from '../src/lib/db';
import { createBackup, restoreBackup } from '../src/lib/backup';

describe('backup & pemulihan', () => {
  it('round-trip gzip memulihkan semua tabel; restore mengganti data lama', async () => {
    const a = new BizDb('bk-a-' + Date.now());
    await a.products.add({ name: 'Produk A', brand: 'B', category: 'C', active: true });
    await a.costs.add({ productId: 1, unitCost: 1500, effectiveFrom: '2026-06-01', note: '' });
    await a.raw.add({ batchId: 1, file: 'x.xlsx', sheet: 'orders', rowNo: 2, data: { 'No. Pesanan': 'A1' } });
    await a.checks.add({ batchId: 1, scope: 's', label: 'l', reported: 10, computed: 10, diff: 0, ok: true });
    const { blob, meta } = await createBackup(a);
    expect(meta.counts).toMatchObject({ products: 1, costs: 1, raw: 1, checks: 1, orders: 0 });
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    expect([head[0], head[1]]).toEqual([0x1f, 0x8b]); // gzip

    const b = new BizDb('bk-b-' + Date.now());
    await b.products.add({ name: 'Akan terhapus', brand: '', category: '', active: true });
    await b.products.add({ name: 'Akan terhapus 2', brand: '', category: '', active: true });
    await restoreBackup(b, blob);
    expect((await b.products.toArray()).map((p) => p.name)).toEqual(['Produk A']);
    expect(await b.costs.count()).toBe(1);
    expect((await b.raw.toArray())[0].data).toEqual({ 'No. Pesanan': 'A1' });
  });
  it('menolak file yang bukan backup', async () => {
    await expect(restoreBackup(new BizDb('bk-c-' + Date.now()), new Blob(['{"hello":1}']))).rejects.toThrow(/Bukan file backup/);
  });
});
