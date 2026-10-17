import type { BizDb } from './db';
import type { Dataset } from './metrics/dataset';
import { fingerprint, readSnapshot, SNAPSHOT_TABLES, writeSnapshot } from './snapshot';

type Rows = { toArray(): Promise<unknown[]> };

export async function loadDataset(db: BizDb): Promise<Dataset> {
  const fp = await fingerprint(db);
  const [snap, products, mappings, costs] = await Promise.all([readSnapshot(db, fp), db.products.toArray(), db.mappings.toArray(), db.costs.toArray()]);
  let tables = snap;
  if (!tables) {
    // Pertama kali (atau data berubah): baca per tabel, lalu simpan blok cache di latar belakang.
    const arrs = await Promise.all(SNAPSHOT_TABLES.map((t) => (db as unknown as Record<string, Rows>)[t].toArray()));
    tables = Object.fromEntries(SNAPSHOT_TABLES.map((t, i) => [t, arrs[i]]));
    const fresh = tables;
    setTimeout(() => { void writeSnapshot(db, fresh, fp).catch(() => undefined); }, 1500);
  }
  const t = tables as unknown as Omit<Dataset, 'products' | 'mappings' | 'costs'>;
  const batches = [...t.batches].sort((a, b) => (a.importedAt < b.importedAt ? 1 : a.importedAt > b.importedAt ? -1 : 0));
  return { ...t, batches, products, mappings, costs };
}
