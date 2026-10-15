// Publikasi data: baca file Shopee di data-inbox/{order,retur,income} → validasi → enkripsi → push.
// Pakai:  npm run publish-data              (validasi, enkripsi, commit & push)
//         npm run publish-data -- --no-push (hanya membuat file terenkripsi)
//         npm run publish-data -- --force   (tetap publikasi walau ada total yang tidak cocok)
// Password: env BI_DATA_PASSWORD, atau file .data-password (dibuat dengan `npm run data:password`), atau diketik.
import 'fake-indexeddb/auto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BizDb } from '../src/lib/db';
import { parseUploads, type UploadFile } from '../src/lib/pipeline';
import { commitUpload, kindLabel } from '../src/lib/importer';
import { BUNDLE_PATH, decodeBundle, deriveKey, dumpTables, encodeBundle, readHeader, WrongPasswordError, type BundlePayload } from '../src/lib/bundle';
import type { ReportKind } from '../src/lib/types';
import { askPassword } from './password-prompt';

const ROOT = resolve(import.meta.dirname ?? '.', '..');
const INBOX = join(ROOT, 'data-inbox');
const OUT = join(ROOT, 'public', BUNDLE_PATH);
const FOLDERS: Record<string, ReportKind[]> = { order: ['all', 'completed'], retur: ['returns'], income: ['income'] };
const args = new Set(process.argv.slice(2));
const rp = (v: number | null) => (v === null ? '–' : `Rp ${Math.round(v).toLocaleString('id-ID')}`);

async function getPassword(): Promise<string> {
  if (process.env.BI_DATA_PASSWORD) return process.env.BI_DATA_PASSWORD;
  const file = join(ROOT, '.data-password');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  if (!process.stdin.isTTY) throw new Error('Password belum diatur. Jalankan `npm run data:password` sekali di terminal, atau set BI_DATA_PASSWORD.');
  return askPassword('Password data: ');
}

async function main() {
  // 1. Kumpulkan file; urut dari yang paling lama diubah → export terbaru menang bila pesanan sama.
  const files: (UploadFile & { folder: string; modified: Date })[] = [];
  for (const folder of Object.keys(FOLDERS)) {
    const dir = join(INBOX, folder);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))) {
      const b = readFileSync(join(dir, name));
      files.push({ folder, name, modified: statSync(join(dir, name)).mtime, buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer });
    }
  }
  if (!files.length) throw new Error('Tidak ada file Excel di data-inbox/order, data-inbox/retur, atau data-inbox/income.');
  files.sort((a, b) => a.modified.getTime() - b.modified.getTime());
  console.log(`\n${files.length} file ditemukan:`);
  for (const f of files) console.log(`  ${f.folder.padEnd(6)} ${f.name}`);

  // 2. Parse & import ke database sementara — logika sama persis dengan import di web.
  const parsed = await parseUploads(files);
  const problems: string[] = [];
  for (const u of parsed.unknown) problems.push(`${u.name}: ${u.info.problem}`);
  for (const fr of parsed.files) {
    const src = files.find((f) => f.name === fr.name);
    if (src && fr.info.kind && !FOLDERS[src.folder].includes(fr.info.kind)) problems.push(`${fr.name}: ini laporan ${kindLabel(fr.info.kind)}, tetapi ada di folder "${src.folder}". Pindahkan ke folder yang benar.`);
  }
  const db = new BizDb(`publish-${Date.now()}`);
  const batches = await commitUpload(db, parsed);
  console.log('\nHasil import:');
  for (const b of batches) {
    console.log(`  ${kindLabel(b.kind).padEnd(16)} ${b.status.padEnd(8)} baru ${b.inserted} · diperbarui ${b.updated} · duplikat ${b.duplicates} · ditolak ${b.rejected}`);
    for (const e of b.errors) problems.push(`${kindLabel(b.kind)}: ${e}`);
    for (const w of b.warnings.slice(0, 5)) console.log(`    catatan: ${w}`);
  }
  const checks = await db.checks.toArray();
  const bad = checks.filter((c) => c.ok === false);
  console.log(`\nValidasi total vs laporan Shopee: ${checks.filter((c) => c.ok).length} cocok, ${bad.length} selisih.`);
  for (const c of bad) problems.push(`Tidak cocok — ${c.scope} · ${c.label}: Shopee ${rp(c.reported)}, hitung ulang ${rp(c.computed)}`);
  if (problems.length) {
    console.log('\nMasalah:');
    for (const p of problems) console.log(`  ✗ ${p}`);
    if (!args.has('--force')) throw new Error('Publikasi dibatalkan. Perbaiki masalah di atas atau jalankan dengan --force.');
  }

  // 3. Paket & enkripsi. Salt dipakai ulang bila password sama, agar perangkat yang "mengingat" kunci tetap bisa membuka.
  const tables = await dumpTables(db);
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  const payload: BundlePayload = { createdAt: new Date().toISOString(), files: files.map((f) => ({ folder: f.folder, name: f.name, modified: f.modified.toISOString() })), counts, tables };
  const password = await getPassword();
  if (password.length < 10) throw new Error('Password minimal 10 karakter.');
  let salt: string | undefined;
  if (existsSync(OUT)) {
    const old = new Uint8Array(readFileSync(OUT));
    const { header } = readHeader(old);
    try { await decodeBundle(old, await deriveKey(password, header.kdf.salt, header.kdf.iter)); salt = header.kdf.salt; }
    catch (e) { if (e instanceof WrongPasswordError) console.log('\n⚠ Password berbeda dari paket sebelumnya — semua perangkat perlu memasukkan password baru.'); else throw e; }
  }
  const bytes = await encodeBundle(payload, password, salt);
  // Verifikasi: paket harus bisa dibuka kembali dan isinya sama.
  const { header } = readHeader(bytes);
  const check = await decodeBundle(bytes, await deriveKey(password, header.kdf.salt, header.kdf.iter));
  if (JSON.stringify(check.counts) !== JSON.stringify(counts)) throw new Error('Verifikasi paket gagal.');
  mkdirSync(join(ROOT, 'public', 'data'), { recursive: true });
  writeFileSync(OUT, bytes);
  console.log(`\nPaket terenkripsi: public/${BUNDLE_PATH} (${(bytes.length / 1048576).toFixed(2)} MB) · ${counts.orders} pesanan · ${counts.income} record penghasilan · ${counts.returns} pengembalian`);

  // 4. Commit & push hanya file terenkripsi.
  if (args.has('--no-push')) { console.log('Tidak di-push (--no-push).'); return; }
  const run = (cmd: string) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  const staged = execSync(`git status --porcelain -- public/${BUNDLE_PATH}`, { cwd: ROOT }).toString().trim();
  if (!staged) { console.log('Tidak ada perubahan data.'); return; }
  run(`git add -- public/${BUNDLE_PATH}`);
  const leak = execSync('git diff --cached --name-only', { cwd: ROOT }).toString().split('\n').filter((f) => f && f !== `public/${BUNDLE_PATH}`);
  if (leak.length) throw new Error(`Ada file lain yang ikut ter-stage (${leak.join(', ')}). Batalkan dulu agar hanya paket data yang di-commit.`);
  run(`git commit -m "Update data ${payload.createdAt.slice(0, 16).replace('T', ' ')} UTC" -- public/${BUNDLE_PATH}`);
  run('git push');
  console.log('\nTerkirim. Dashboard memuat data baru ±1–2 menit lagi (setelah GitHub Actions selesai).');
}

main().catch((e) => { console.error(`\n✗ ${(e as Error).message}`); process.exit(1); });
