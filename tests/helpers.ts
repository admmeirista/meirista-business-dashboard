import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readWorkbook, sha256Hex } from '../src/lib/parse/util';
import type { SourceFile } from '../src/lib/parse/common';

/** Folder file Shopee asli (tidak di-commit). Default ./fixtures, bisa diganti env SHOPEE_FIXTURES. */
export const FIXTURES = process.env.SHOPEE_FIXTURES ?? join(__dirname, '..', 'fixtures');
export const hasFixtures = existsSync(FIXTURES) && readdirSync(FIXTURES).some((f) => /\.xlsx?$/i.test(f));

export async function load(pattern: RegExp): Promise<SourceFile[]> {
  const names = readdirSync(FIXTURES).filter((f) => pattern.test(f)).sort();
  return Promise.all(names.map(async (name) => {
    const buf = readFileSync(join(FIXTURES, name));
    return { name, hash: await sha256Hex(buf), wb: readWorkbook(buf) };
  }));
}
