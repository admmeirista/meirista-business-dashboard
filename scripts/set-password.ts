// Simpan password data di file lokal .data-password (tidak pernah di-commit), agar publish-data bisa berjalan tanpa mengetik ulang.
// Pakai: npm run data:password
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { askPassword } from './password-prompt';

const ROOT = resolve(import.meta.dirname ?? '.', '..');

async function main() {
  if (!process.stdin.isTTY) throw new Error('Jalankan perintah ini di terminal (butuh input keyboard).');
  console.log('Password ini dipakai untuk mengenkripsi data dan membukanya di dashboard. Minimal 10 karakter.');
  console.log('Simpan juga di tempat aman (mis. password manager) — password tidak bisa dipulihkan.\n');
  const a = await askPassword('Password baru      : ');
  if (a.length < 10) throw new Error('Password minimal 10 karakter.');
  const b = await askPassword('Ulangi password    : ');
  if (a !== b) throw new Error('Password tidak sama.');
  writeFileSync(join(ROOT, '.data-password'), a, { mode: 0o600 });
  console.log('\nTersimpan di .data-password (hanya di komputer ini, tidak ikut di-push).');
}

main().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
