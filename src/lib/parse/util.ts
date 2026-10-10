import * as XLSX from 'xlsx';

export type Cell = string | number | boolean | null;
export type Row = Cell[];

/** Membaca workbook dari ArrayBuffer. Format (.xls/.xlsx) dideteksi dari isi file, bukan ekstensi. */
export function readWorkbook(buf: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(buf instanceof Uint8Array ? buf : new Uint8Array(buf), { type: 'array', cellDates: false, dense: true });
}

/** Semua baris sheet sebagai array mentah (nilai asli, sel kosong = null). */
export function sheetRows(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

/**
 * Angka rupiah format Indonesia → number.
 * "90.000" → 90000 · "RP -22.000\n" → -22000 · "1.234,5" → 1234.5 · 67800 → 67800 · "-" / "" / null → null
 */
export function parseIdr(v: Cell | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  let s = String(v).replace(/rp/gi, '').replace(/\s+/g, '').trim();
  if (s === '' || s === '-') return null;
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  let n: number;
  if (s.includes(',')) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ''));
  else if (/^\d+(\.\d+)?$/.test(s)) n = Number(s);
  else return null;
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Seperti parseIdr tetapi kosong → 0 (untuk kolom nominal yang selalu ada). */
export const idr0 = (v: Cell | undefined): number => parseIdr(v) ?? 0;

/** "1400 gr" → 1400 */
export function parseGram(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const m = String(v).replace(/\./g, '').match(/-?\d+(,\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Tanggal/waktu → "YYYY-MM-DD HH:mm" atau "YYYY-MM-DD" (waktu lokal toko, tanpa konversi zona). Kosong → null. */
export function parseDate(v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const base = `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    return d.H || d.M ? `${base} ${pad(d.H)}:${pad(d.M)}` : base;
  }
  const s = String(v).trim();
  if (!s || s === '-') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return m[4] ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (m2) return m2[4] ? `${m2[3]}-${m2[2]}-${m2[1]} ${m2[4]}:${m2[5]}` : `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

export function str(v: Cell | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s === '-' ? '' : s;
}

/**
 * Header yang berulang (mis. "Provinsi" dua kali di laporan pengembalian) diberi akhiran " (2)", " (3)".
 * Kolom tanpa judul menjadi "Kolom <n>".
 */
export function uniqueHeaders(row: Row): string[] {
  const seen = new Map<string, number>();
  return row.map((h, i) => {
    const base = str(h) || `Kolom ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/** Index kolom wajib berdasarkan nama header. Melempar error yang jelas bila ada yang hilang. */
export function columnIndex(headers: string[], required: readonly string[], context: string): Record<string, number> {
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => { if (!(h in idx)) idx[h] = i; });
  const missing = required.filter((r) => !(r in idx));
  if (missing.length) throw new Error(`${context}: kolom wajib tidak ditemukan: ${missing.join(', ')}`);
  return idx;
}

export function rowToObject(headers: string[], row: Row): Record<string, Cell> {
  const o: Record<string, Cell> = {};
  headers.forEach((h, i) => { o[h] = row[i] ?? null; });
  return o;
}

export const isBlankRow = (r: Row | undefined) => !r || r.every((v) => v === null || v === '');

/** Kunci pencocokan produk: nama + variasi, huruf kecil, spasi dirapikan. */
export function productKey(name: string, variation: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(name)}||${norm(variation)}`;
}

/** "[ 6 PCS ]", "ISI 1 LUSIN", "12 Pcs" → saran isi per paket. */
export function guessPackSize(name: string): number | null {
  const s = name.toLowerCase();
  if (/1\s*lusin/.test(s)) return 12;
  const m = s.match(/(\d{1,3})\s*(pcs|pc|pcs\.|botol|pack|sachet|buah)\b/);
  return m ? Number(m[1]) : null;
}

export async function sha256Hex(buf: ArrayBuffer | Uint8Array): Promise<string> {
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const h = await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash ringan (FNV-1a) untuk mendeteksi perubahan isi record saat import ulang. */
export function contentHash(o: unknown): string {
  const s = JSON.stringify(o);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
