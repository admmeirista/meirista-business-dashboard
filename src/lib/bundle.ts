// Paket data terenkripsi (dipakai script publish di Node dan dashboard di browser).
// Format file: "MBI1" | panjang header (uint32 BE) | header JSON | ciphertext AES-256-GCM dari JSON ter-gzip.
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
  v: 1;
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

const subtle = () => globalThis.crypto.subtle;
const b64 = (u: Uint8Array) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rnd = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function streamBytes(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(t)).arrayBuffer());
}

/** Kunci AES dari password + salt (tidak dapat diekspor, aman disimpan di IndexedDB). */
export async function deriveKey(password: string, salt: string, iter = ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt) as BufferSource, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function readHeader(bytes: Uint8Array): { header: BundleHeader; body: Uint8Array } {
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== MAGIC) throw new Error('Bukan file paket data Meirista BI.');
  const len = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(bytes.slice(8, 8 + len))) as BundleHeader;
  return { header, body: bytes.slice(8 + len) };
}

/** Enkripsi paket. Salt boleh dipakai ulang agar kunci yang "diingat" perangkat tetap berlaku; IV selalu baru. */
export async function encodeBundle(payload: BundlePayload, password: string, salt = b64(rnd(16))): Promise<Uint8Array> {
  const iv = rnd(12);
  const key = await deriveKey(password, salt);
  const zipped = await streamBytes(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('gzip'));
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, zipped as BufferSource));
  const header: BundleHeader = { v: 1, id: b64(rnd(9)).replace(/[+/=]/g, ''), createdAt: payload.createdAt, kdf: { alg: 'PBKDF2-SHA256', iter: ITERATIONS, salt }, iv: b64(iv) };
  const h = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + h.length + cipher.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, h.length);
  out.set(h, 8);
  out.set(cipher, 8 + h.length);
  return out;
}

export class WrongPasswordError extends Error { constructor() { super('Password salah.'); } }

export async function decodeBundle(bytes: Uint8Array, key: CryptoKey): Promise<BundlePayload> {
  const { header, body } = readHeader(bytes);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(header.iv) as BufferSource }, key, body as BufferSource));
  } catch {
    throw new WrongPasswordError();
  }
  return JSON.parse(new TextDecoder().decode(await streamBytes(plain, new DecompressionStream('gzip'))));
}

type Amounts = Record<string, number>;
/** Nominal penghasilan yang nol tidak disimpan di paket (sebagian besar kolom biaya bernilai 0) — dipulihkan saat dimuat. */
const compactIncome = (rows: unknown[]) => rows.map((r) => {
  const x = r as { amounts: Amounts };
  return { ...x, amounts: Object.fromEntries(Object.entries(x.amounts).filter(([, v]) => v !== 0)) };
});
const expandIncome = (rows: unknown[]) => rows.map((r) => {
  const x = r as { amounts: Amounts };
  return { ...x, amounts: { ...Object.fromEntries(INCOME_AMOUNT_FIELDS.map((f) => [f, 0])), ...x.amounts } };
});

/** Ambil isi tabel dari database (dipakai script publish). */
export async function dumpTables(db: BizDb): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of BUNDLE_TABLES) out[t] = await (db as unknown as Record<TableName, AnyTable>)[t].toArray();
  out.income = compactIncome(out.income);
  return out;
}

/** Ganti data laporan di perangkat dengan isi paket. Master produk & HPP di perangkat tidak disentuh. */
export async function applyBundle(db: BizDb, payload: BundlePayload) {
  await db.transaction('rw', db.tables, async () => {
    for (const t of [...BUNDLE_TABLES, 'raw' as const]) {
      const tbl = (db as unknown as Record<string, AnyTable>)[t];
      await tbl.clear();
      const rows = payload.tables[t];
      if (Array.isArray(rows)) await tbl.bulkPut(t === 'income' ? expandIncome(rows) : rows);
    }
  });
}
