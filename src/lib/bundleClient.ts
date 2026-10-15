// Memuat paket data terenkripsi dari situs (public/data/bundle.bin) ke database lokal.
import type { BizDb } from './db';
import { applyBundle, BUNDLE_PATH, decodeBundle, deriveKey, readHeader, type BundleHeader } from './bundle';

export interface BundleState { header: BundleHeader; bytes: Uint8Array }
interface StoredKey { salt: string; iter: number; key: CryptoKey }

/** Ambil paket terbaru (null bila situs belum punya paket). Memakai revalidasi agar tidak tertahan cache. */
export async function fetchBundle(): Promise<BundleState | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}${BUNDLE_PATH}`, { cache: 'no-cache' });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { header: readHeader(bytes).header, bytes };
  } catch {
    return null;
  }
}

export const loadedBundleId = async (db: BizDb) => (await db.settings.get('bundleId'))?.value as string | undefined;
export const loadedBundleAt = async (db: BizDb) => (await db.settings.get('bundleAt'))?.value as string | undefined;

async function storedKey(db: BizDb, h: BundleHeader): Promise<CryptoKey | null> {
  const s = (await db.settings.get('bundleKey'))?.value as StoredKey | undefined;
  return s && s.salt === h.kdf.salt && s.iter === h.kdf.iter ? s.key : null;
}

async function apply(db: BizDb, b: BundleState, key: CryptoKey) {
  const payload = await decodeBundle(b.bytes, key);
  await applyBundle(db, payload);
  await db.settings.bulkPut([{ key: 'bundleId', value: b.header.id }, { key: 'bundleAt', value: b.header.createdAt }]);
}

/** Coba buka otomatis dengan kunci yang diingat perangkat. true = berhasil dimuat. */
export async function tryAutoUnlock(db: BizDb, b: BundleState): Promise<boolean> {
  const key = await storedKey(db, b.header);
  if (!key) return false;
  try { await apply(db, b, key); return true; } catch { return false; }
}

/** Buka dengan password. remember = simpan kunci (tidak dapat diekspor) di perangkat ini, bukan passwordnya. */
export async function unlockWithPassword(db: BizDb, b: BundleState, password: string, remember: boolean) {
  const key = await deriveKey(password, b.header.kdf.salt, b.header.kdf.iter);
  await apply(db, b, key); // melempar WrongPasswordError bila salah
  if (remember) await db.settings.put({ key: 'bundleKey', value: { salt: b.header.kdf.salt, iter: b.header.kdf.iter, key } satisfies StoredKey });
  else await db.settings.delete('bundleKey');
}

export async function forgetKey(db: BizDb) { await db.settings.delete('bundleKey'); }
