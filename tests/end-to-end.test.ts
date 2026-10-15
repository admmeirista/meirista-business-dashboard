// Alur penuh: file asli → parse → IndexedDB → metrik dashboard. Metrik keuangan harus sama dengan laporan Shopee.
import 'fake-indexeddb/auto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES, hasFixtures } from './helpers';
import { BizDb } from '../src/lib/db';
import { parseUploads } from '../src/lib/pipeline';
import { commitUpload } from '../src/lib/importer';
import { loadDataset } from '../src/lib/load';
import { buildIndex, type Index } from '../src/lib/metrics/dataset';
import { profitability, returnsAnalysis, salesSummary, settlementSummary } from '../src/lib/metrics/analytics';
import { reconcile } from '../src/lib/metrics/reconcile';

describe.skipIf(!hasFixtures)('End-to-end dengan file asli', () => {
  const db = new BizDb('e2e-' + Date.now());
  // Set acuan Juni/Juli (tanpa export Semua Pesanan Agustus — diuji terpisah di order-all.test.ts).
  const uploads = () => readdirSync(FIXTURES).filter((f) => /\.xlsx?$/i.test(f) && !/^Order\.all\./.test(f)).map((name) => {
    const b = readFileSync(join(FIXTURES, name));
    return { name, buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
  });
  let ix: Index;

  beforeAll(async () => {
    const batches = await commitUpload(db, await parseUploads(uploads()));
    expect(batches.map((b) => [b.kind, b.status, b.inserted])).toEqual([
      ['completed', 'OK', 9322], ['returns', 'OK', 59], ['income', 'OK', 7878 + 9183 + 49],
    ]);
    ix = buildIndex(await loadDataset(db));
  });

  it('Dana dilepas Juli (basis Dana dilepas) = Total yang Dilepas di Summary', () => {
    const s = settlementSummary(ix, { basis: 'released', from: '2026-07-01', to: '2026-07-31' });
    expect(s.totalIncome).toBe(702523353);
    expect(s.productPrice).toBe(824225350);
    expect(s.refund).toBe(-4280646);
    const g = Object.fromEntries(s.groups.map((x) => [x.key, x.total]));
    expect(g).toMatchObject({ platform: -52047533, xtra: -27958030, service: -36898788, shipping: -521100, promo: 0, tax: 0 });
    expect(s.marketplaceFees).toBe(-52047533 - 27958030 - 36898788);
    expect(s.adjustments).toBe(3091263);
    expect(s.netWithAdjustments).toBe(702523353 + 3091263);
  });

  it('Penjualan Juni (basis Pesanan dibuat): header tidak digandakan', () => {
    const s = salesSummary(ix, { basis: 'created', from: '2026-06-01', to: '2026-06-30' });
    expect(s.orders).toBe(9322);
    expect(s.lines).toBe(10799);
    expect(s.gmv).toBe(ix.ds.items.reduce((t, i) => t + i.subtotal, 0));
    expect(s.buyerPaid).toBe(ix.ds.orders.reduce((t, o) => t + o.totalPayment, 0));
    expect(s.daily).toHaveLength(30);
  });

  it('Rekonsiliasi lintas periode', () => {
    const r = reconcile(ix);
    expect(r.rows.filter((x) => x.status === 'SETTLED')).toHaveLength(2557);
    expect(r.counts.UNSETTLED).toBe(9322 - 2557);
    expect(r.counts.NO_ORDER).toBe(7878 - 2557);
    expect(r.counts.PRICE_DIFF).toBe(0);
    expect(r.counts.ADJUSTMENT).toBe(49);
    expect(r.counts.SHIPPING_DISCREPANCY).toBe(48);
    expect(r.counts.REFUND_DIFF).toBeGreaterThan(0);
  });

  it('Pengembalian & HPP: tanpa HPP → laba tidak tersedia (bukan 0)', () => {
    const ra = returnsAnalysis(ix, { basis: 'created', from: '2026-06-01', to: '2026-06-30' }, 'requested');
    expect(ra.requests).toBe(59);
    expect(ra.byState.reduce((t, x) => t + x.n, 0)).toBe(59);
    const p = profitability(ix, { basis: 'created', from: '2026-06-01', to: '2026-06-30' }, 'listing');
    expect(p.totals.coverage).toBe(0);
    expect(p.rows.every((x) => x.profit === null && x.cogs === null)).toBe(true);
  });

  it('Import ulang file yang sama → dilewati; tidak ada data ganda', async () => {
    const known = new Set((await db.files.toArray()).map((f) => f.hash));
    const again = await parseUploads(uploads(), known);
    expect(again.completed).toBeUndefined();
    expect(again.income).toBeUndefined();
    // Paksa parse ulang (mis. file sama dengan nama berbeda) → semua terhitung duplikat.
    const forced = await commitUpload(db, await parseUploads(uploads()));
    expect(forced.map((b) => [b.kind, b.inserted, b.updated])).toEqual([['completed', 0, 0], ['returns', 0, 0], ['income', 0, 0]]);
    expect(forced[0].duplicates).toBe(9322);
    expect(await db.orders.count()).toBe(9322);
    expect(await db.income.count()).toBe(7878 + 9183);
  });
});

describe.skipIf(!hasFixtures)('HPP & profitabilitas (file asli + master sintetis)', () => {
  it('HPP berlaku per tanggal, item tanpa HPP tidak dianggap 0', async () => {
    const { BizDb } = await import('../src/lib/db');
    const { parseUploads } = await import('../src/lib/pipeline');
    const { commitUpload } = await import('../src/lib/importer');
    const db = new BizDb('cogs-' + Date.now());
    const names = readdirSync(FIXTURES).filter((f) => /^(Order\.completed|Income)/.test(f));
    await commitUpload(db, await parseUploads(names.map((name) => { const b = readFileSync(join(FIXTURES, name)); return { name, buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }; })));
    let ix = buildIndex(await loadDataset(db));
    // Listing terlaris yang sudah dilepas → petakan, isi 6 per paket, HPP berubah di tengah bulan.
    const settledItems = ix.ds.items.filter((i) => ix.incomeByOrder.has(i.orderNo));
    const key = settledItems[0].productKey;
    const pid = await db.products.add({ name: 'Produk Uji', brand: 'Brand Uji', category: 'Kategori Uji', active: true });
    await db.mappings.put({ listingKey: key, listingName: settledItems[0].productName, variation: settledItems[0].variation, productId: pid, packQty: 6 });
    await db.costs.bulkAdd([{ productId: pid, unitCost: 1000, effectiveFrom: '2026-06-01', note: '' }, { productId: pid, unitCost: 2000, effectiveFrom: '2026-06-15', note: '' }]);
    ix = buildIndex(await loadDataset(db));
    const f = { basis: 'created' as const, from: '2026-06-01', to: '2026-06-30' };
    const p = profitability(ix, f, 'brand');
    const row = p.rows.find((r) => r.key === 'Brand Uji')!;
    const expectedCogs = settledItems.filter((i) => i.productKey === key).reduce((t, i) => t + 6 * i.qty * (ix.orderByNo.get(i.orderNo)!.createdAt! < '2026-06-15' ? 1000 : 2000), 0);
    expect(row.cogs).toBe(expectedCogs);
    expect(row.profit).toBeCloseTo(row.netSettled - expectedCogs, 6);
    expect(p.rows.find((r) => r.key === 'Belum dipetakan')!.cogs).toBeNull();
    expect(p.totals.coverage).toBeGreaterThan(0);
    expect(p.totals.coverage).toBeLessThan(1);
    // Alokasi dana item per pesanan dilepas = Total Penghasilan pesanan (tanpa hilang/ganda).
    const all = profitability(ix, f, 'listing');
    const netSettledJune = [...ix.incomeByOrder.entries()].filter(([o]) => ix.orderByNo.has(o)).reduce((t, [, rs]) => t + rs.reduce((s, r) => s + r.amounts['Total Penghasilan'], 0), 0);
    expect(all.totals.net).toBeCloseTo(netSettledJune, 0);
  });
});

describe.skipIf(!hasFixtures)('Ringkasan eksekutif & paket AI', () => {
  it('kalimat ringkasan memakai angka asli; paket AI tanpa data pribadi pembeli', async () => {
    const { executiveSummary, aiPayload } = await import('../src/lib/metrics/summary');
    const db2 = new BizDb('sum-' + Date.now());
    const names = readdirSync(FIXTURES).filter((f) => /\.xlsx?$/i.test(f) && !/^Order\.all\./.test(f));
    await commitUpload(db2, await parseUploads(names.map((name) => { const b = readFileSync(join(FIXTURES, name)); return { name, buf: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }; })));
    const ix2 = buildIndex(await loadDataset(db2));
    const f = { basis: 'created' as const, from: '2026-06-01', to: '2026-06-30' };
    const prev = { basis: 'created' as const, from: '2026-05-01', to: '2026-05-31' };
    const lines = executiveSummary(ix2, f, prev, 'Juni 2026', 'Mei 2026');
    expect(lines[0].text).toContain('9.322 pesanan');
    expect(lines.find((l) => l.key === 'profit')!.text).toContain('HPP produk belum diisi');
    for (const topic of ['overview', 'sales', 'returns', 'costs'] as const) {
      const json = JSON.stringify(aiPayload(ix2, f, prev, 'Juni 2026', 'Mei 2026', topic));
      // Tidak ada username pembeli maupun No. Pesanan di paket AI.
      expect(json).not.toContain(ix2.ds.orders[0].buyer);
      expect(json).not.toContain(ix2.ds.orders[0].orderNo);
      expect(json.length).toBeLessThan(60000);
    }
    const costs = aiPayload(ix2, { ...f, from: '2026-07-01', to: '2026-07-31' }, prev, 'Juli 2026', 'Juni 2026', 'costs') as { biaya: { dana_dilepas_di_periode: { dana_diterima: number } } };
    expect(costs.biaya.dana_dilepas_di_periode.dana_diterima).toBe(702523353);

    // Basis omzet default = tanggal pengiriman (Waktu Pengiriman Diatur).
    const jun = salesSummary(ix2, { basis: 'shipped', from: '2026-06-01', to: '2026-06-30' });
    const jul = salesSummary(ix2, { basis: 'shipped', from: '2026-07-01', to: '2026-07-31' });
    expect(jun.orders).toBe(9175);
    expect(jul.orders).toBe(147);
    expect(jun.gmv + jul.gmv).toBe(ix2.ds.items.reduce((t, i) => t + i.subtotal, 0));
  });
});
