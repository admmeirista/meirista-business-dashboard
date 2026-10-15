import type { ReportKind } from './types';
import { detectFile, type FileInfo } from './parse/detect';
import { readWorkbook, sha256Hex } from './parse/util';
import type { SourceFile } from './parse/common';
import { parseCompleted, type CompletedParse } from './parse/completed';
import { parseReturns, type ReturnsParse } from './parse/returns';
import { parseIncome, type IncomeParse } from './parse/income';

export interface UploadFile { name: string; buf: ArrayBuffer }
export interface FileResult { name: string; hash: string; size: number; info: FileInfo }

export interface KindParse<K extends ReportKind = ReportKind> {
  kind: K;
  files: FileResult[];
  result?: K extends 'completed' | 'all' ? CompletedParse : K extends 'returns' ? ReturnsParse : IncomeParse;
  error?: string;
}

export interface ParsedUpload {
  files: FileResult[];
  unknown: FileResult[];
  completed?: KindParse<'completed'>;
  all?: KindParse<'all'>;
  returns?: KindParse<'returns'>;
  income?: KindParse<'income'>;
}

/** Baca & parse semua file unggahan, dikelompokkan per jenis laporan (multi-file per jenis). Murni — dipakai worker & uji. */
export async function parseUploads(uploads: UploadFile[], skipHashes: Set<string> = new Set()): Promise<ParsedUpload> {
  const out: ParsedUpload = { files: [], unknown: [] };
  const groups: Record<ReportKind, { src: SourceFile; fr: FileResult }[]> = { completed: [], all: [], returns: [], income: [] };
  for (const u of uploads) {
    const hash = await sha256Hex(u.buf);
    let fr: FileResult;
    try {
      const wb = readWorkbook(u.buf);
      fr = { name: u.name, hash, size: u.buf.byteLength, info: detectFile(u.name, wb) };
      out.files.push(fr);
      if (fr.info.problem || !fr.info.kind) { out.unknown.push(fr); continue; }
      if (skipHashes.has(hash) || groups[fr.info.kind].some((g) => g.fr.hash === hash)) continue; // file identik sudah pernah diimport
      groups[fr.info.kind].push({ src: { name: u.name, hash, wb }, fr });
    } catch (e) {
      fr = { name: u.name, hash, size: u.buf.byteLength, info: { kind: null, periodFrom: null, periodTo: null, part: null, partsTotal: null, problem: `File tidak bisa dibaca: ${(e as Error).message}` } };
      out.files.push(fr);
      out.unknown.push(fr);
    }
  }
  const run = <K extends ReportKind>(kind: K, fn: (s: SourceFile[]) => unknown) => {
    const g = groups[kind];
    if (!g.length) return undefined;
    const kp = { kind, files: g.map((x) => x.fr) } as KindParse<K>;
    try { (kp as { result?: unknown }).result = fn(g.map((x) => x.src)); } catch (e) { kp.error = (e as Error).message; }
    return kp;
  };
  out.completed = run('completed', parseCompleted);
  out.all = run('all', parseCompleted);
  out.returns = run('returns', parseReturns);
  out.income = run('income', parseIncome);
  return out;
}
