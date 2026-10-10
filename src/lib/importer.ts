import type { BizDb } from './db';
import type { ImportBatch, ReportKind } from './types';
import type { KindParse, ParsedUpload, UploadFile } from './pipeline';
import type { RawRecord, Rejected, TotalCheck } from './parse/common';

const KIND_LABEL: Record<ReportKind, string> = { completed: 'Pesanan Selesai', returns: 'Pengembalian', income: 'Penghasilan' };
export const kindLabel = (k: ReportKind) => KIND_LABEL[k];

/** Parse di Web Worker (browser). */
export function parseInWorker(uploads: UploadFile[], skipHashes: string[]): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { w.terminate(); e.data.ok ? resolve(e.data.res) : reject(new Error(e.data.error)); };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Worker gagal')); };
    w.postMessage({ uploads, skipHashes }, uploads.map((u) => u.buf));
  });
}

interface Counts { inserted: number; updated: number; duplicates: number }

/** Upsert berdasarkan kunci + hash isi: baru → insert, sama → duplikat, berbeda → update. */
async function upsertByHash<T extends { hash: string }>(
  table: { bulkGet(keys: string[]): Promise<(T | undefined)[]>; bulkPut(items: T[]): Promise<unknown> },
  rows: T[], key: (r: T) => string,
  onReplace?: (keys: string[]) => Promise<void>,
): Promise<Counts & { changedKeys: Set<string> }> {
  const existing = await table.bulkGet(rows.map(key));
  const c = { inserted: 0, updated: 0, duplicates: 0, changedKeys: new Set<string>() };
  const put: T[] = [];
  rows.forEach((r, i) => {
    const ex = existing[i];
    if (!ex) { c.inserted++; put.push(r); c.changedKeys.add(key(r)); }
    else if (ex.hash === r.hash) c.duplicates++;
    else { c.updated++; put.push(r); c.changedKeys.add(key(r)); }
  });
  if (onReplace && c.updated) await onReplace(rows.filter((r, i) => existing[i] && existing[i]!.hash !== r.hash).map(key));
  await table.bulkPut(put);
  return c;
}

/** Insert hanya kunci yang belum ada (record keuangan Shopee tidak berubah setelah dana dilepas). */
async function insertNew<T extends { id: string }>(table: { bulkGet(keys: string[]): Promise<(T | undefined)[]>; bulkPut(items: T[]): Promise<unknown> }, rows: T[]): Promise<Counts> {
  const existing = await table.bulkGet(rows.map((r) => r.id));
  const fresh = rows.filter((_, i) => !existing[i]);
  await table.bulkPut(fresh);
  return { inserted: fresh.length, updated: 0, duplicates: rows.length - fresh.length };
}

async function addAudit(db: BizDb, batchId: number, raw: RawRecord[], checks: TotalCheck[], rejected: Rejected[]) {
  for (let i = 0; i < raw.length; i += 5000) await db.raw.bulkAdd(raw.slice(i, i + 5000).map((r) => ({ ...r, batchId })));
  await db.checks.bulkAdd(checks.map((c) => ({ ...c, batchId })));
  await db.rejected.bulkAdd(rejected.map((r) => ({ ...r, batchId })));
}

/** Peringatan part laporan yang belum lengkap (mis. part_1_of_2 tanpa part_2_of_2). */
async function partWarnings(db: BizDb, kp: KindParse): Promise<string[]> {
  const known = await db.files.where('kind').equals(kp.kind).toArray();
  const all = [...known.map((f) => ({ ...f })), ...kp.files.map((f) => ({ part: f.info.part, partsTotal: f.info.partsTotal, periodFrom: f.info.periodFrom, periodTo: f.info.periodTo }))];
  const w: string[] = [];
  for (const f of kp.files) {
    const { partsTotal, periodFrom, periodTo } = f.info;
    if (!partsTotal) continue;
    const have = new Set(all.filter((x) => x.partsTotal === partsTotal && x.periodFrom === periodFrom && x.periodTo === periodTo).map((x) => x.part));
    const missing = Array.from({ length: partsTotal }, (_, i) => i + 1).filter((p) => !have.has(p));
    const msg = `Laporan ${periodFrom} s/d ${periodTo} terdiri dari ${partsTotal} part; part ${missing.join(', ')} belum diimport — data periode ini belum lengkap.`;
    if (missing.length && !w.includes(msg)) w.push(msg);
  }
  return w;
}

export async function commitUpload(db: BizDb, parsed: ParsedUpload): Promise<ImportBatch[]> {
  const batches: ImportBatch[] = [];
  const kinds = [parsed.completed, parsed.returns, parsed.income].filter(Boolean) as KindParse[];
  for (const kp of kinds) {
    const base: ImportBatch = {
      kind: kp.kind, fileNames: kp.files.map((f) => f.name), fileHashes: kp.files.map((f) => f.hash), importedAt: new Date().toISOString(),
      periodFrom: kp.files.map((f) => f.info.periodFrom).filter(Boolean).sort()[0] ?? null,
      periodTo: kp.files.map((f) => f.info.periodTo).filter(Boolean).sort().pop() ?? null,
      rowsRead: 0, inserted: 0, updated: 0, duplicates: 0, rejected: 0, warnings: [], errors: [], status: 'OK',
    };
    if (kp.error || !kp.result) {
      base.errors.push(kp.error ?? 'Gagal membaca file');
      base.status = 'FAILED';
      base.id = await db.batches.add(base);
      batches.push(base);
      continue;
    }
    const r = kp.result;
    base.rowsRead = r.rowsRead;
    base.rejected = r.rejected.length;
    base.duplicates = r.duplicatesInFiles;
    base.warnings.push(...r.warnings.slice(0, 200));
    if (r.warnings.length > 200) base.warnings.push(`… dan ${r.warnings.length - 200} peringatan lain.`);
    base.warnings.push(...(await partWarnings(db, kp)));

    await db.transaction('rw', db.tables, async () => {
      const batchId = (base.id = await db.batches.add(base));
      const add = (c: Counts) => { base.inserted += c.inserted; base.updated += c.updated; base.duplicates += c.duplicates; };
      if (kp.kind === 'completed') {
        const p = r as NonNullable<ParsedUpload['completed']>['result'] & object;
        const orders = p.orders.map((o) => ({ ...o, batchId }));
        const itemsByOrder = new Map<string, typeof p.items>();
        for (const it of p.items) (itemsByOrder.get(it.orderNo) ?? itemsByOrder.set(it.orderNo, []).get(it.orderNo)!).push(it);
        const c = await upsertByHash(db.orders, orders, (o) => o.orderNo, async (keys) => { await db.items.where('orderNo').anyOf(keys).delete(); });
        await db.items.bulkPut([...c.changedKeys].flatMap((k) => itemsByOrder.get(k) ?? []));
        add(c);
      } else if (kp.kind === 'returns') {
        const p = r as NonNullable<ParsedUpload['returns']>['result'] & object;
        const reqs = p.requests.map((x) => ({ ...x, batchId }));
        const linesBy = new Map<string, typeof p.lines>();
        for (const l of p.lines) (linesBy.get(l.returnNo) ?? linesBy.set(l.returnNo, []).get(l.returnNo)!).push(l);
        const c = await upsertByHash(db.returns, reqs, (x) => x.returnNo, async (keys) => { await db.returnLines.where('returnNo').anyOf(keys).delete(); });
        await db.returnLines.bulkPut([...c.changedKeys].flatMap((k) => linesBy.get(k) ?? []));
        add(c);
      } else {
        const p = r as NonNullable<ParsedUpload['income']>['result'] & object;
        for (const rep of p.reports) if (await db.reports.get(rep.id)) base.warnings.push(`Laporan penghasilan ${rep.from} s/d ${rep.to} sudah pernah diimport — hanya record baru yang ditambahkan.`);
        await db.reports.bulkPut(p.reports.map((x) => ({ ...x, batchId })));
        add(await insertNew(db.income, p.records.map((x) => ({ ...x, batchId }))));
        add(await insertNew(db.adjustments, p.adjustments.map((x) => ({ ...x, batchId }))));
        await insertNew(db.sellerFees, p.sellerFees.map((x) => ({ ...x, batchId })));
        await insertNew(db.discrepancies, p.discrepancies.map((x) => ({ ...x, batchId })));
      }
      await addAudit(db, batchId, r.raw, r.checks, r.rejected);
      for (const f of kp.files) await db.files.put({ hash: f.hash, name: f.name, kind: kp.kind, batchId, importedAt: base.importedAt, part: f.info.part, partsTotal: f.info.partsTotal, periodFrom: f.info.periodFrom, periodTo: f.info.periodTo });
      if (r.checks.some((c) => c.ok === false)) base.warnings.unshift('Ada total yang TIDAK cocok dengan laporan Shopee — lihat Rekonsiliasi.');
      base.status = base.errors.length ? 'FAILED' : base.warnings.length || base.rejected ? 'WARNING' : 'OK';
      await db.batches.put(base);
    });
    batches.push(base);
  }
  return batches;
}

/** Hapus satu batch beserta record yang terakhir ditulis oleh batch tersebut. */
export async function deleteBatch(db: BizDb, batchId: number) {
  await db.transaction('rw', db.tables, async () => {
    const orderNos = (await db.orders.where('batchId').equals(batchId).primaryKeys()) as string[];
    await db.items.where('orderNo').anyOf(orderNos).delete();
    await db.orders.bulkDelete(orderNos);
    const returnNos = (await db.returns.where('batchId').equals(batchId).primaryKeys()) as string[];
    await db.returnLines.where('returnNo').anyOf(returnNos).delete();
    await db.returns.bulkDelete(returnNos);
    for (const t of [db.reports, db.income, db.adjustments, db.sellerFees, db.discrepancies, db.raw, db.checks, db.rejected, db.files] as const)
      await (t as unknown as { where(i: string): { equals(v: number): { delete(): Promise<number> } } }).where('batchId').equals(batchId).delete();
    await db.batches.delete(batchId);
  });
}
