import { marketplaceFees } from '../fees';
import { day, incomeOrdersIn, type Filter, type Index } from './dataset';
import { returnState, salesBy, salesSummary, safeDiv, type DimRow } from './analytics';

export interface Insight { level: 'ok' | 'info' | 'warn' | 'err'; title: string; detail: string; metric?: string }

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(1)}%`);
const rp = (v: number) => { const a = Math.abs(v); const t = a >= 1e9 ? (a / 1e9).toFixed(1) + ' M' : a >= 1e6 ? (a / 1e6).toFixed(1) + ' jt' : a >= 1e3 ? Math.round(a / 1e3) + ' rb' : String(Math.round(a)); return (v < 0 ? '−' : '') + 'Rp ' + t.replace('.', ','); };
/** Nama produk ringkas: buang awalan [ 6 PCS ] dan potong panjangnya. */
const nm = (s: string) => { const x = s.replace(/^\[[^\]]*\]\s*/, '').split('/')[0].trim(); return x.length > 42 ? x.slice(0, 40) + '…' : x; };

/** Membagi rentang menjadi dua paruh yang sama panjang (untuk perbandingan periode). */
function halves(f: Filter): [Filter, Filter] {
  const a = Date.parse(f.from), b = Date.parse(f.to);
  const mid = new Date(a + Math.floor((b - a) / 864e5 / 2) * 864e5).toISOString().slice(0, 10);
  const next = new Date(Date.parse(mid) + 864e5).toISOString().slice(0, 10);
  return [{ ...f, to: mid }, { ...f, from: next }];
}

/** Insight otomatis berbasis aturan statistik sederhana — tiap insight menyebut dasar perhitungannya. */
export function insights(ix: Index, f: Filter): Insight[] {
  const out: Insight[] = [];
  const s = salesSummary(ix, f);
  if (!s.orders) return [{ level: 'info', title: 'Belum ada pesanan pada rentang ini', detail: 'Ubah rentang tanggal atau import data Pesanan Selesai.' }];

  // 1. Hari dengan penjualan anomali (|z| ≥ 2 terhadap rata-rata harian rentang).
  const days = s.daily.filter((d) => d.orders > 0);
  if (days.length >= 7) {
    const g = days.map((d) => d.gmv), m = mean(g), sd = std(g);
    days.forEach((d, i) => {
      const z = sd ? (d.gmv - m) / sd : 0;
      // Penurunan di awal/akhir rentang biasanya karena cakupan export, bukan penjualan yang turun.
      const edge = i < 5 || i >= days.length - 5;
      if (z >= 2 || (z <= -2 && !edge)) out.push({ level: z > 0 ? 'info' : 'warn', title: `Omzet ${z > 0 ? 'melonjak' : 'turun tajam'} pada ${new Date(d.d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}`, detail: `${rp(d.gmv)} vs rata-rata ${rp(m)}/hari (${d.orders} pesanan).`, metric: 'z-score omzet harian' });
    });
  }

  // 2. Produk tumbuh/turun paling tajam (paruh kedua vs paruh pertama rentang).
  const [h1, h2] = halves(f);
  const a = new Map(salesBy(ix, h1, 'product').map((r) => [r.key, r]));
  const b = salesBy(ix, h2, 'product');
  const moves = b.map((r) => ({ r, prev: a.get(r.key)?.gmv ?? 0 })).filter((x) => x.prev > 0 && x.r.gmv + x.prev > s.gmv * 0.01)
    .map((x) => ({ ...x, ch: (x.r.gmv - x.prev) / x.prev })).sort((p, q) => q.ch - p.ch);
  const fmtMove = (x: { r: DimRow; prev: number; ch: number }) => `${nm(x.r.label)} (${x.ch > 0 ? '+' : ''}${(x.ch * 100).toFixed(0)}%)`;
  if (moves.length) {
    const up = moves.slice(0, 3).filter((x) => x.ch > 0.2);
    const down = moves.slice(-3).reverse().filter((x) => x.ch < -0.2);
    if (up.length) out.push({ level: 'ok', title: 'Produk yang sedang naik', detail: up.map(fmtMove).join(' · '), metric: 'paruh kedua vs paruh pertama periode' });
    if (down.length) out.push({ level: 'warn', title: 'Produk yang sedang turun', detail: down.map(fmtMove).join(' · '), metric: 'paruh kedua vs paruh pertama periode' });
  }

  // 3. Konsentrasi: porsi 5 produk teratas.
  const top = salesBy(ix, f, 'product');
  const top5 = top.slice(0, 5).reduce((t, r) => t + r.share, 0);
  if (top.length > 5) out.push({ level: top5 > 0.6 ? 'warn' : 'info', title: `5 produk teratas = ${pct(top5)} penjualan`, detail: top5 > 0.6 ? 'Ketergantungan tinggi pada sedikit produk; gangguan stok produk ini berdampak besar.' : 'Penjualan cukup tersebar.', metric: 'Porsi GMV' });

  // 4. Metode pembayaran & pengembalian.
  const pay = salesBy(ix, f, 'payment');
  const cod = pay.find((p) => /COD/i.test(p.key));
  if (cod) out.push({ level: 'info', title: `COD = ${pct(cod.share)} penjualan`, detail: `${cod.orders.toLocaleString('id-ID')} pesanan COD, AOV ${rp(cod.aov ?? 0)}.`, metric: 'Porsi GMV per metode bayar' });

  // 5. Biaya marketplace: pesanan dengan fee rate ekstrem (> p99 + 5 poin).
  const recs = incomeOrdersIn(ix, f).filter((r) => r.amounts['Harga Produk'] > 0);
  if (recs.length > 50) {
    const rates = recs.map((r) => -marketplaceFees(r.amounts) / r.amounts['Harga Produk']).sort((x, y) => x - y);
    const med = rates[Math.floor(rates.length / 2)], p99 = rates[Math.floor(rates.length * 0.99)];
    const hi = recs.filter((r) => -marketplaceFees(r.amounts) / r.amounts['Harga Produk'] > Math.max(p99, med + 0.05));
    out.push({ level: 'info', title: `Median biaya marketplace ${pct(med)} dari harga produk`, detail: `${hi.length} pesanan di atas persentil 99 (${pct(p99)}), contoh: ${hi.slice(0, 3).map((r) => r.orderNo).join(', ') || '–'}.`, metric: 'Fee rate per pesanan' });
    const neg = recs.filter((r) => r.amounts['Total Penghasilan'] < 0);
    if (neg.length) out.push({ level: 'err', title: `${neg.length} pesanan dengan dana dilepas negatif`, detail: `Total ${rp(neg.reduce((t, r) => t + r.amounts['Total Penghasilan'], 0))}. Contoh: ${neg.slice(0, 5).map((r) => r.orderNo).join(', ')}.`, metric: 'Total Penghasilan < 0' });
  }

  // 6. Provinsi dengan tingkat pengembalian tinggi (min. 30 pesanan).
  const prov = new Map<string, { n: number; r: number }>();
  for (const o of ix.ds.orders) {
    const d = day(o.createdAt);
    if (!d || d < f.from || d > f.to) continue;
    const e = prov.get(o.province) ?? { n: 0, r: 0 };
    e.n++;
    if ((ix.returnsByOrder.get(o.orderNo) ?? []).some((x) => returnState(x) !== 'VOID')) e.r++;
    prov.set(o.province, e);
  }
  const tot = [...prov.values()].reduce((t, e) => ({ n: t.n + e.n, r: t.r + e.r }), { n: 0, r: 0 });
  const avg = safeDiv(tot.r, tot.n) ?? 0;
  const hiProv = [...prov.entries()].filter(([, e]) => e.n >= 30 && e.r / e.n > Math.max(avg * 2, 0.01)).sort((x, y) => y[1].r / y[1].n - x[1].r / x[1].n);
  if (hiProv.length && ix.ds.returns.length) out.push({ level: 'warn', title: 'Provinsi dengan tingkat pengembalian di atas 2× rata-rata', detail: hiProv.slice(0, 5).map(([p, e]) => `${p} ${pct(e.r / e.n)} (${e.r}/${e.n})`).join(' · ') + ` — rata-rata ${pct(avg)}.`, metric: 'Pesanan dengan pengajuan ÷ pesanan dibuat' });

  // 7. Alasan pengembalian dominan.
  const reasons = new Map<string, number>();
  for (const r of ix.ds.returns) { const d = day(r.requestedAt); if (d && d >= f.from && d <= f.to && returnState(r) !== 'VOID') reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1); }
  const topReason = [...reasons.entries()].sort((x, y) => y[1] - x[1])[0];
  if (topReason) out.push({ level: 'info', title: 'Alasan pengembalian terbanyak', detail: `"${topReason[0]}" — ${topReason[1]} pengajuan.`, metric: 'Pengajuan bukan batal/ditolak' });

  // 8. Pelanggan berulang.
  const buyers = new Map<string, number>();
  for (const o of ix.ds.orders) { const d = day(o.createdAt); if (d && d >= f.from && d <= f.to) buyers.set(o.buyer, (buyers.get(o.buyer) ?? 0) + 1); }
  const rep = [...buyers.values()].filter((n) => n > 1).length;
  if (buyers.size) out.push({ level: 'info', title: `${pct(rep / buyers.size)} pembeli membeli lebih dari sekali`, detail: `${rep.toLocaleString('id-ID')} dari ${buyers.size.toLocaleString('id-ID')} username pada rentang ini.`, metric: 'Repeat buyer rate' });
  return out;
}
