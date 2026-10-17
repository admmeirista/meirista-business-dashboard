// Cache lokal: seluruh data laporan disimpan sebagai satu blok terkompresi (format kolom yang sama dengan paket data).
// Membaca satu blok jauh lebih cepat daripada membaca ratusan ribu baris IndexedDB satu per satu.
// Blok hanya dipakai bila "sidik" database (jumlah baris tiap tabel + batch terakhir + paket terpasang) masih sama.
import type { BizDb } from './db';
import { AUDIT_TABLES, DATA_TABLES } from './db';
import { packTables, unpackTables } from './bundle';

export const SNAPSHOT_TABLES = [...DATA_TABLES, ...AUDIT_TABLES.filter((t) => t !== 'raw' && t !== 'rejected')] as const;
type Counted = { count(): Promise<number> };
interface Snapshot { fp: string; bytes: Uint8Array }

export async function fingerprint(db: BizDb): Promise<string> {
  const counts = await Promise.all(SNAPSHOT_TABLES.map((t) => (db as unknown as Record<string, Counted>)[t].count()));
  const lastBatch = await db.batches.orderBy('id').last();
  const bundle = (await db.settings.get('bundleId'))?.value ?? '';
  return [...counts, lastBatch?.id ?? 0, lastBatch?.importedAt ?? '', bundle].join('|');
}

export async function readSnapshot(db: BizDb, fp: string): Promise<Record<string, unknown[]> | null> {
  const s = (await db.settings.get('snapshot'))?.value as Snapshot | undefined;
  if (!s || s.fp !== fp) return null;
  try { return (await unpackTables(s.bytes)).tables; } catch { return null; }
}

/** Simpan blok cache. Dibatalkan bila database berubah sejak data dibaca. */
export async function writeSnapshot(db: BizDb, tables: Record<string, unknown[]>, fp: string) {
  const bytes = await packTables({ createdAt: new Date().toISOString(), files: [], counts: {}, tables });
  if ((await fingerprint(db)) !== fp) return;
  await db.settings.put({ key: 'snapshot', value: { fp, bytes } satisfies Snapshot });
}

export async function invalidateSnapshot(db: BizDb) { await db.settings.delete('snapshot'); }
