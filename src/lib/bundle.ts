// Paket data terenkripsi (dipakai script publish di Node dan dashboard di browser).
// File: "MBI1" | panjang header (uint32 BE) | header JSON | ciphertext AES-256-GCM dari isi ter-gzip.
// Isi v2: [uint32 panjang manifest][manifest JSON][segmen tabel …]; tiap segmen = JSON berformat kolom
// (nama kolom sekali, baris sebagai array) agar bisa diurai per tabel — tidak ada satu teks raksasa.
// Kunci diturunkan dari password dengan PBKDF2-SHA256. Tanpa password, isi file tidak dapat dibaca.
import type { BizDb } from './db';
import { AUDIT_TABLES, DATA_TABLES } from './db';
import { INCOME_AMOUNT_FIELDS } from './types';

export const BUNDLE_PATH = 'data/bundle.bin';
const MAGIC = 'MBI1';
const ITERATIONS = 600_000;

/** Tabel yang ikut paket. Master produk/HPP tetap di perangkat; baris audit mentah tidak ikut (ukuran). */
export const BUNDLE_TABLES = [...DATA_TABLES, ...AUDIT_TABLES.filter((t) => t !== 'raw')] as const;
type TableName = (typeof BUNDLE_TABLES)[number];
type AnyTable = { toArray(): Promise<unknown[]>; clear(): Promise<void>; bulkPut(r: unknown[]): Promise<unknown> };

export interface BundleHeader {
  v: 1 | 2;
  id: string;
  createdAt: string;
  kdf: { alg: 'PBKDF2-SHA256'; iter: number; salt: string };
  iv: string;
}
export interface BundlePayload {
  createdAt: string;
  files: { folder: string; name: string; modified: string }[];
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
}
interface Manifest extends Omit<BundlePayload, 'tables'> { segments: { table: string; bytes: number }[] }

const subtle = () => globalThis.crypto.subtle;
const b64 = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rnd = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const enc = new TextEncoder();

async function streamBytes(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(t)).arrayBuffer());
}

/** Kunci AES dari password + salt (tidak dapat diekspor, aman disimpan di IndexedDB). */
export async function deriveKey(password: string, salt: string, iter = ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt) as BufferSource, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function readHeader(bytes: Uint8Array): { header: BundleHeader; body: Uint8Array } {
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== MAGIC) throw new Error('Bukan file paket data Meirista BI.');
  const len = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(bytes.slice(8, 8 + len))) as BundleHeader;
  return { header, body: bytes.slice(8 + len) };
}

// ── Format kolom ──
const AMT = 'amounts.';
/** Baris objek → { c: nama kolom, r: baris array }. Objek `amounts` (penghasilan) diratakan menjadi kolom tetap. */
export function toColumns(rows: unknown[]): { c: string[]; r: unknown[][] } {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row as object)) {
    if (k === 'amounts') { for (const f of INCOME_AMOUNT_FIELDS) if (!seen.has(AMT + f)) { seen.add(AMT + f); cols.push(AMT + f); } }
    else if (!seen.has(k)) { seen.add(k); cols.push(k); }
  }
  const r = rows.map((row) => {
    const o = row as Record<string, unknown> & { amounts?: Record<string, number> };
    return cols.map((c) => (c.startsWith(AMT) ? (o.amounts?.[c.slice(AMT.length)] ?? 0) : (o[c] === undefined ? null : o[c])));
  });
  return { c: cols, r };
}
export function fromColumns(t: { c: string[]; r: unknown[][] }): unknown[] {
  const amt = t.c.map((c) => (c.startsWith(AMT) ? c.slice(AMT.length) : null));
  const hasAmt = amt.some(Boolean);
  return t.r.map((vals) => {
    const o: Record<string, unknown> = {};
    const amounts: Record<string, number> = {};
    vals.forEach((v, i) => { const a = amt[i]; if (a) amounts[a] = v as number; else o[t.c[i]] = v; });
    if (hasAmt) o.amounts = amounts;
    return o;
  });
}

/** Enkripsi paket (format v2). Salt boleh dipakai ulang agar kunci yang "diingat" perangkat tetap berlaku; IV selalu baru. */
export async function encodeBundle(payload: BundlePayload, password: string, salt = b64(rnd(16))): Promise<Uint8Array> {
  const segs = Object.entries(payload.tables).map(([table, rows]) => ({ table, data: enc.encode(JSON.stringify(toColumns(rows))) }));
  const manifest: Manifest = { createdAt: payload.createdAt, files: payload.files, counts: payload.counts, segments: segs.map((s) => ({ table: s.table, bytes: s.data.length })) };
  const m = enc.encode(JSON.stringify(manifest));
  const plain = new Uint8Array(4 + m.length + segs.reduce((t, s) => t + s.data.length, 0));
  new DataView(plain.buffer).setUint32(0, m.length);
  plain.set(m, 4);
  let off = 4 + m.length;
  for (const s of segs) { plain.set(s.data, off); off += s.data.length; }

  const iv = rnd(12);
  const key = await deriveKey(password, salt);
  const zipped = await streamBytes(plain, new CompressionStream('gzip'));
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, zipped as BufferSource));
  const header: BundleHeader = { v: 2, id: b64(rnd(9)).replace(/[+/=]/g, ''), createdAt: payload.createdAt, kdf: { alg: 'PBKDF2-SHA256', iter: ITERATIONS, salt }, iv: b64(iv) };
  const h = enc.encode(JSON.stringify(header));
  const out = new Uint8Array(8 + h.length + cipher.length);
  out.set(enc.encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, h.length);
  out.set(h, 8);
  out.set(cipher, 8 + h.length);
  return out;
}

export class WrongPasswordError extends Error { constructor() { super('Password salah.'); } }

/** Dekripsi & urai paket. v2 diurai per tabel (memori rendah); v1 (lama) tetap didukung. */
export async function decodeBundle(bytes: Uint8Array, key: CryptoKey): Promise<BundlePayload> {
  const { header, body } = readHeader(bytes);
  let cipherPlain: Uint8Array;
  try {
    cipherPlain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(header.iv) as BufferSource }, key, body as BufferSource));
  } catch {
    throw new WrongPasswordError();
  }
  const plain = await streamBytes(cipherPlain, new DecompressionStream('gzip'));
  const dec = new TextDecoder();
  if (header.v === 1) return JSON.parse(dec.decode(plain));
  const mlen = new DataView(plain.buffer, plain.byteOffset, 4).getUint32(0);
  const manifest = JSON.parse(dec.decode(plain.subarray(4, 4 + mlen))) as Manifest;
  const tables: Record<string, unknown[]> = {};
  let off = 4 + mlen;
  for (const s of manifest.segments) {
    tables[s.table] = fromColumns(JSON.parse(dec.decode(plain.subarray(off, off + s.bytes))));
    off += s.bytes;
  }
  return { createdAt: manifest.createdAt, files: manifest.files, counts: manifest.counts, tables };
}

const expandIncome = (rows: unknown[]) => rows.map((r) => {
  const x = r as { amounts: Record<string, number> };
  return { ...x, amounts: { ...Object.fromEntries(INCOME_AMOUNT_FIELDS.map((f) => [f, 0])), ...x.amounts } };
});

/**
 * Ambil isi tabel dari database (dipakai script publish).
 * Baris "Sku" laporan Penghasilan tidak ikut: hanya alokasi baris "Order" (sudah divalidasi saat publish) dan tidak dipakai analisis.
 */
export async function dumpTables(db: BizDb): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of BUNDLE_TABLES) out[t] = await (db as unknown as Record<TableName, AnyTable>)[t].toArray();
  out.income = out.income.filter((r) => (r as { recordType: string }).recordType === 'Order');
  return out;
}

/** Ganti data laporan di perangkat dengan isi paket. Master produk & HPP di perangkat tidak disentuh. */
export async function applyBundle(db: BizDb, payload: BundlePayload) {
  await db.transaction('rw', db.tables, async () => {
    for (const t of [...BUNDLE_TABLES, 'raw' as const]) {
      const tbl = (db as unknown as Record<string, AnyTable>)[t];
      await tbl.clear();
      const rows0 = payload.tables[t];
      if (!Array.isArray(rows0)) continue;
      const rows = t === 'income' ? expandIncome(rows0) : rows0;
      for (let i = 0; i < rows.length; i += 5000) await tbl.bulkPut(rows.slice(i, i + 5000));
    }
  });
}
