// Cache lokal: dibaca dari satu blok bila database tidak berubah; diabaikan setelah data berubah.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { BizDb } from '../src/lib/db';
import { loadDataset } from '../src/lib/load';
import { fingerprint, invalidateSnapshot, readSnapshot, SNAPSHOT_TABLES, writeSnapshot } from '../src/lib/snapshot';

const tablesOf = async (db: BizDb) => Object.fromEntries(await Promise.all(SNAPSHOT_TABLES.map(async (t) => [t, await (db as unknown as Record<string, { toArray(): Promise<unknown[]> }>)[t].toArray()])));

describe('cache snapshot', () => {
  it('blok cache mengembalikan data yang sama; master produk tetap dibaca langsung', async () => {
    const db = new BizDb('snap-' + Date.now());
    await db.orders.bulkPut([{ orderNo: 'A', status: 'Selesai', totalPayment: 1000 }, { orderNo: 'B', status: 'Batal', totalPayment: 0 }] as never);
    await db.batches.bulkPut([{ id: 1, kind: 'all', importedAt: '2026-01-01T00:00:00Z' }, { id: 2, kind: 'returns', importedAt: '2026-02-01T00:00:00Z' }] as never);
    const fp = await fingerprint(db);
    await writeSnapshot(db, await tablesOf(db), fp);
    expect(await readSnapshot(db, fp)).not.toBeNull();
    await db.products.add({ name: 'P', brand: 'B', category: 'K', active: true });
    const ds = await loadDataset(db);
    expect(ds.orders.map((o) => o.orderNo)).toEqual(['A', 'B']);
    expect(ds.batches.map((b) => b.id)).toEqual([2, 1]);
    expect(ds.products).toHaveLength(1);
  });

  it('data berubah → sidik berbeda, cache tidak dipakai', async () => {
    const db = new BizDb('snap2-' + Date.now());
    await db.orders.put({ orderNo: 'A' } as never);
    const fp = await fingerprint(db);
    await writeSnapshot(db, await tablesOf(db), fp);
    await db.orders.put({ orderNo: 'C' } as never);
    const fp2 = await fingerprint(db);
    expect(fp2).not.toBe(fp);
    expect(await readSnapshot(db, fp2)).toBeNull();
    expect((await loadDataset(db)).orders).toHaveLength(2);
    await invalidateSnapshot(db);
    expect(await db.settings.get('snapshot')).toBeUndefined();
  });
});
