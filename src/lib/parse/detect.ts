import type { WorkBook } from 'xlsx';
import type { ReportKind } from '../types';
import { sheetRows, str } from './util';

export interface FileInfo {
  kind: ReportKind | null;
  periodFrom: string | null;
  periodTo: string | null;
  part: number | null;
  partsTotal: number | null;
  problem: string | null;
}

const NAME_RULES: { kind: ReportKind; re: RegExp }[] = [
  { kind: 'completed', re: /^Order\.completed\..*\.xlsx$/i },
  { kind: 'returns', re: /^Order\.return_refund\..*\.xlsx?$/i },
  { kind: 'income', re: /^Income\.sudah dilepas\..*\.xlsx$/i },
];

const ymd = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/** Jenis laporan dari isi workbook (dipakai untuk memverifikasi nama file). */
export function kindFromContent(wb: WorkBook): ReportKind | null {
  const names = wb.SheetNames;
  if (names.includes('Summary') && names.some((n) => /^Penghasilan - \d+$/.test(n))) return 'income';
  for (const n of names.slice(0, 3)) {
    const head = (sheetRows(wb, n)[0] ?? []).map(str);
    if (head.includes('No. Pengembalian') && head.includes('No. Pesanan')) return 'returns';
    if (head.includes('No. Pesanan') && head.includes('Waktu Pesanan Selesai')) return 'completed';
  }
  return null;
}

export function detectFile(fileName: string, wb: WorkBook): FileInfo {
  // Nama dari browser bisa berakhiran " (1)" bila file diunduh ulang.
  const base = fileName.replace(/^.*[\\/]/, '').replace(/ \(\d+\)(?=\.xlsx?$)/i, '');
  const byName = NAME_RULES.find((r) => r.re.test(base))?.kind ?? null;
  const byContent = kindFromContent(wb);
  const period = base.match(/(\d{8})_(\d{8})/);
  const part = base.match(/part_(\d+)_of_(\d+)/i);
  const info: FileInfo = {
    kind: byName ?? byContent,
    periodFrom: period ? ymd(period[1]) : null,
    periodTo: period ? ymd(period[2]) : null,
    part: part ? Number(part[1]) : null,
    partsTotal: part ? Number(part[2]) : null,
    problem: null,
  };
  if (!byContent) info.problem = 'Struktur file tidak dikenali sebagai laporan Shopee (Pesanan Selesai / Pengembalian / Penghasilan).';
  else if (byName && byName !== byContent) info.problem = `Nama file menunjukkan "${byName}" tetapi isinya "${byContent}".`;
  return info;
}
