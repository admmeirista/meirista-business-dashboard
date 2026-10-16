// Diagnostik: ukuran isi paket data (setelah dekripsi) per tabel. Password dibaca dari .data-password; isi data tidak dicetak.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUNDLE_PATH, decodeBundle, deriveKey, readHeader } from '../src/lib/bundle';

const ROOT = resolve(import.meta.dirname ?? '.', '..');
const bytes = new Uint8Array(readFileSync(join(ROOT, 'public', BUNDLE_PATH)));
const { header } = readHeader(bytes);
const pw = process.env.BI_DATA_PASSWORD ?? readFileSync(join(ROOT, '.data-password'), 'utf8').trim();
const payload = await decodeBundle(bytes, await deriveKey(pw, header.kdf.salt, header.kdf.iter));
const json = JSON.stringify(payload);
console.log(`file terenkripsi: ${(bytes.length / 1048576).toFixed(1)} MB · JSON: ${(json.length / 1048576).toFixed(1)} juta karakter`);
for (const [t, rows] of Object.entries(payload.tables)) console.log(`  ${t.padEnd(14)} ${String(rows.length).padStart(7)} baris · ${(JSON.stringify(rows).length / 1048576).toFixed(1)} jt karakter`);
