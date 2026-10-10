import * as XLSX from 'xlsx';
import type { BizDb } from './db';
import type { Index } from './metrics/dataset';
import { unitCostAt } from './metrics/dataset';
import { guessPackSize, parseDate, parseIdr, productKey, str } from './parse/util';

export interface Listing { key: string; name: string; variation: string; units: number; gmv: number; orders: number; lastSold: string | null }

/** Semua listing (nama + variasi) yang pernah terjual, dari data Pesanan Selesai. */
export function listings(ix: Index): Listing[] {
  const m = new Map<string, Listing & { os: Set<string> }>();
  for (const it of ix.ds.items) {
    const e = m.get(it.productKey) ?? { key: it.productKey, name: it.productName, variation: it.variation, units: 0, gmv: 0, orders: 0, lastSold: null, os: new Set<string>() };
    e.units += it.qty; e.gmv += it.subtotal; e.os.add(it.orderNo);
    const d = ix.orderByNo.get(it.orderNo)?.createdAt?.slice(0, 10) ?? null;
    if (d && (!e.lastSold || d > e.lastSold)) e.lastSold = d;
    m.set(it.productKey, e);
  }
  return [...m.values()].map(({ os, ...l }) => ({ ...l, orders: os.size })).sort((a, b) => b.gmv - a.gmv);
}

export const TEMPLATE_HEADERS = ['Nama Listing', 'Variasi', 'Produk', 'Brand', 'Kategori', 'Isi per Paket', 'HPP per Unit', 'Berlaku Mulai', 'Unit Terjual', 'GMV'] as const;

/** Template Excel master: satu baris per listing, terisi dengan pemetaan & HPP yang berlaku hari ini. */
export function exportMasterWorkbook(ix: Index): Blob {
  const today = new Date().toISOString().slice(0, 10);
  const rows = listings(ix).map((l) => {
    const mp = ix.mapping.get(l.key);
    const p = mp ? ix.productById.get(mp.productId) : undefined;
    const cost = mp ? unitCostAt(ix, mp.productId, today) : null;
    return {
      'Nama Listing': l.name, Variasi: l.variation, Produk: p?.name ?? '', Brand: p?.brand ?? '', Kategori: p?.category ?? '',
      'Isi per Paket': mp?.packQty ?? guessPackSize(l.name) ?? '', 'HPP per Unit': cost ?? '', 'Berlaku Mulai': cost !== null ? '' : '',
      'Unit Terjual': l.units, GMV: l.gmv,
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...TEMPLATE_HEADERS] });
  ws['!cols'] = [{ wch: 60 }, { wch: 18 }, { wch: 36 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
  const help = XLSX.utils.aoa_to_sheet([
    ['Petunjuk'],
    ['1. Isi kolom Produk (nama produk internal), Brand, Kategori, dan Isi per Paket (mis. listing "[ 6 PCS ]" = 6).'],
    ['2. HPP per Unit = harga pokok SATU unit produk. HPP listing = Isi per Paket × HPP per Unit.'],
    ['3. Berlaku Mulai (YYYY-MM-DD) wajib bila HPP diisi. HPP lama tetap tersimpan untuk pesanan sebelum tanggal ini.'],
    ['4. Baris dengan Produk kosong diabaikan. HPP kosong TIDAK dianggap 0.'],
    ['5. Jangan ubah kolom Nama Listing & Variasi — keduanya kunci pencocokan.'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Master');
  XLSX.utils.book_append_sheet(wb, help, 'Petunjuk');
  return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export interface MasterImportResult { products: number; mappings: number; costs: number; skipped: number; errors: string[] }

/** Import template master: buat/ubah produk (berdasarkan nama), pemetaan listing, dan entri HPP baru. */
export async function importMasterWorkbook(db: BizDb, buf: ArrayBuffer): Promise<MasterImportResult> {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const ws = wb.Sheets['Master'] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
  const res: MasterImportResult = { products: 0, mappings: 0, costs: 0, skipped: 0, errors: [] };
  await db.transaction('rw', db.products, db.mappings, db.costs, async () => {
    const byName = new Map((await db.products.toArray()).map((p) => [p.name.toLowerCase(), p]));
    for (const [i, r] of rows.entries()) {
      const line = i + 2;
      const name = str(r['Nama Listing'] as string), variation = str(r['Variasi'] as string), prod = str(r['Produk'] as string);
      if (!name || !prod) { res.skipped++; continue; }
      const pack = parseIdr(r['Isi per Paket'] as string) ?? 1;
      if (!(pack > 0)) { res.errors.push(`Baris ${line}: Isi per Paket harus > 0.`); continue; }
      let p = byName.get(prod.toLowerCase());
      const brand = str(r['Brand'] as string), category = str(r['Kategori'] as string);
      if (!p) {
        p = { name: prod, brand, category, active: true };
        p.id = await db.products.add(p);
        byName.set(prod.toLowerCase(), p);
        res.products++;
      } else if ((brand && brand !== p.brand) || (category && category !== p.category)) {
        p.brand = brand || p.brand; p.category = category || p.category;
        await db.products.put(p);
        res.products++;
      }
      await db.mappings.put({ listingKey: productKey(name, variation), listingName: name, variation, productId: p.id!, packQty: pack });
      res.mappings++;
      const cost = parseIdr(r['HPP per Unit'] as string);
      if (cost !== null) {
        const eff = parseDate(r['Berlaku Mulai'] as string);
        if (!eff) { res.errors.push(`Baris ${line}: HPP diisi tetapi Berlaku Mulai kosong/tidak valid — HPP dilewati.`); continue; }
        if (cost < 0) { res.errors.push(`Baris ${line}: HPP negatif.`); continue; }
        const exists = (await db.costs.where('productId').equals(p.id!).toArray()).some((c) => c.effectiveFrom === eff.slice(0, 10) && c.unitCost === cost);
        if (!exists) { await db.costs.add({ productId: p.id!, unitCost: cost, effectiveFrom: eff.slice(0, 10), note: 'Import template' }); res.costs++; }
      }
    }
  });
  return res;
}
