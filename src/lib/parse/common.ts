import type { WorkBook } from 'xlsx';

export interface SourceFile {
  name: string;
  hash: string;
  wb: WorkBook;
}

export interface RawRecord {
  file: string;
  sheet: string;
  rowNo: number;
  data: Record<string, unknown>;
}

export interface Rejected {
  file: string;
  sheet: string;
  rowNo: number;
  reason: string;
}

/** Pemeriksaan total: nilai laporan Shopee vs hasil hitung ulang dari data ternormalisasi. */
export interface TotalCheck {
  scope: string;
  label: string;
  reported: number | null;
  computed: number | null;
  diff: number | null;
  ok: boolean | null; // null = tidak dapat diverifikasi
}

/**
 * Kolom berisi data pribadi pembeli. Laporan Pengembalian memuat nomor telepon & alamat TANPA disamarkan,
 * jadi kolom ini tidak pernah disimpan — termasuk di baris audit.
 */
export const REDACTED_COLUMNS = new Set([
  'Nama Penerima',
  'No. Telepon',
  'Alamat Pengiriman',
  'Buyer contact number',
  'Alamat Pickup Pengembalian Barang',
]);
export const REDACTED = '[disembunyikan]';

export function redact(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const base = k.replace(/ \(\d+\)$/, '');
    r[k] = REDACTED_COLUMNS.has(base) && v !== null && v !== '' ? REDACTED : v;
  }
  return r;
}

export const check = (scope: string, label: string, reported: number | null, computed: number | null, tol = 1): TotalCheck => {
  if (reported === null || computed === null) return { scope, label, reported, computed, diff: null, ok: null };
  const diff = computed - reported;
  return { scope, label, reported, computed, diff, ok: Math.abs(diff) < tol };
};
