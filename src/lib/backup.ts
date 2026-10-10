import type { BizDb } from './db';
import { AUDIT_TABLES, DATA_TABLES, MASTER_TABLES } from './db';

const ALL_TABLES = [...DATA_TABLES, ...MASTER_TABLES, ...AUDIT_TABLES] as const;
type TableName = (typeof ALL_TABLES)[number];
type AnyTable = { toArray(): Promise<unknown[]>; clear(): Promise<void>; bulkPut(r: unknown[]): Promise<unknown> };

export interface BackupMeta { app: 'meirista-bi'; version: 1; exportedAt: string; counts: Record<string, number> }

/**
 * Backup lengkap (data ternormalisasi + master + riwayat + baris audit asli), dikompres gzip.
 * Cukup untuk memulihkan dashboard walau file Excel aslinya hilang.
 */
export async function createBackup(db: BizDb): Promise<{ blob: Blob; meta: BackupMeta }> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of ALL_TABLES) {
    tables[t] = await (db as unknown as Record<TableName, AnyTable>)[t].toArray();
    counts[t] = tables[t].length;
  }
  const meta: BackupMeta = { app: 'meirista-bi', version: 1, exportedAt: new Date().toISOString(), counts };
  const json = new Blob([JSON.stringify({ ...meta, tables })], { type: 'application/json' });
  const gz = await new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { blob: new Blob([gz], { type: 'application/gzip' }), meta };
}

/** Membaca .json maupun .json.gz (dideteksi dari magic byte gzip). */
async function readBackup(blob: Blob): Promise<{ tables: Record<string, unknown[]> } & BackupMeta> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const text = head[0] === 0x1f && head[1] === 0x8b
    ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : await blob.text();
  const j = JSON.parse(text);
  if (j.app !== 'meirista-bi' || !j.tables) throw new Error('Bukan file backup Meirista BI.');
  return j;
}

/** Ganti seluruh isi database lokal dengan isi backup. */
export async function restoreBackup(db: BizDb, blob: Blob): Promise<BackupMeta> {
  const j = await readBackup(blob);
  await db.transaction('rw', db.tables, async () => {
    for (const t of ALL_TABLES) {
      const tbl = (db as unknown as Record<TableName, AnyTable>)[t];
      await tbl.clear();
      if (Array.isArray(j.tables[t])) await tbl.bulkPut(j.tables[t]);
    }
  });
  return { app: j.app, version: j.version, exportedAt: j.exportedAt, counts: j.counts ?? {} };
}

export const backupFileName = (d = new Date()) =>
  `meirista-bi-backup-${d.toISOString().slice(0, 16).replace('T', '_').replace(':', '')}.json.gz`;
