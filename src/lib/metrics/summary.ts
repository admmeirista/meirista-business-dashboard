// Ringkasan eksekutif (kalimat otomatis) + paket data agregat untuk analisis AI.
// Paket AI hanya berisi angka agregat & nama produk — tidak ada username, alamat, atau No. Pesanan.
import { marketplaceFees } from '../fees';
import { FEE_GROUPS } from '../fees';
import { BASIS_DESC, incomeOrdersIn, orderDate, ordersIn, type Filter, type Index } from './dataset';
import { profitability, retention, returnsAnalysis, salesBy, salesSummary, settlementSummary, safeDiv } from './analytics';
import { insights } from './insights';
import { cancellationAnalysis } from './cancellations';

const rp = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  const t = a >= 1e9 ? `${(a / 1e9).toFixed(2)} M` : a >= 1e6 ? `${(a / 1e6).toFixed(1)} jt` : a >= 1e3 ? `${Math.round(a / 1e3)} rb` : String(Math.round(a));
  return `${s}Rp ${t.replace('.', ',')}`;
};
const pct = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(d).replace('.', ',')}%`);
const num = (v: number) => Math.round(v).toLocaleString('id-ID');
const nm = (s: string) => { const x = s.replace(/^\[[^\]]*\]\s*/, '').split('/')[0].trim(); return x.length > 48 ? x.slice(0, 46) + '…' : x; };
const change = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : null);
const dir = (c: number | null) => (c === null ? '' : Math.abs(c) < 0.005 ? 'stabil' : c > 0 ? `naik ${pct(c)}` : `turun ${pct(-c)}`);

/** "JAWA BARAT" → "Jawa Barat", "DKI JAKARTA" tetap "DKI Jakarta". */
const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (x) => x.toUpperCase()).replace(/\bDki\b/, 'DKI').replace(/\bDi\b/, 'DI');

export interface SummaryPoint { key: string; label: string; text: string; tone: 'up' | 'down' | 'warn' | 'neutral' }

/** Poin ringkasan eksekutif: satu baris singkat per topik. Penanda **…** ditebalkan saat ditampilkan. */
export function executiveSummary(ix: Index, f: Filter, prev: Filter, label: string, prevLabel: string): SummaryPoint[] {
  const s = salesSummary(ix, f), sp = salesSummary(ix, prev);
  if (!s.orders) return [{ key: 'empty', label: 'Data', text: `Belum ada pesanan pada **${label}**.`, tone: 'warn' }];
  const out: SummaryPoint[] = [];
  const c = change(s.gmv, sp.gmv);
  out.push({ key: 'sales', label: 'Omzet', tone: c === null ? 'neutral' : c >= 0 ? 'up' : 'down',
    text: `**${rp(s.gmv)}** dari ${num(s.orders)} pesanan${sp.orders ? ` · ${dir(c)} vs ${prevLabel}` : ''}` });

  const prod = salesBy(ix, f, 'product');
  const top5 = prod.slice(0, 5).reduce((t, r) => t + r.share, 0);
  if (prod[0]) out.push({ key: 'product', label: 'Produk', tone: top5 > 0.6 ? 'warn' : 'neutral',
    text: `**${nm(prod[0].label)}** ${pct(prod[0].share)} omzet · 5 teratas ${pct(top5)}` });

  const pay = salesBy(ix, f, 'payment'), prov = salesBy(ix, f, 'province');
  out.push({ key: 'channel', label: 'Pembeli', tone: 'neutral',
    text: `**${pay[0]?.label.replace(/ \(.*\)$/, '') ?? '–'}** ${pct(pay[0]?.share ?? null, 0)} · terbanyak **${titleCase(prov[0]?.label ?? '–')}**` });

  const ret = retention(ix, f);
  out.push({ key: 'repeat', label: 'Loyalitas', tone: 'neutral', text: `${num(ret.buyers)} pembeli · **${pct(ret.repeatRate)}** beli lagi` });

  const fs = settlementSummary(ix, f);
  out.push(fs.records
    ? { key: 'fees', label: 'Biaya', tone: 'neutral', text: `Potongan Shopee **${pct(fs.feeRate)}** · dana bersih ${pct(safeDiv(fs.totalIncome, fs.productPrice), 0)} dari harga` }
    : { key: 'fees', label: 'Biaya', tone: 'warn', text: 'Belum ada data pencairan untuk pesanan periode ini' });

  // Retur hanya diringkas bila ada laporan Pengembalian yang mencakup periode ini (tanpa itu 0% menyesatkan).
  const returnsCovered = ix.ds.files.some((x) => x.kind === 'returns' && x.periodFrom && x.periodTo && x.periodFrom <= f.to && x.periodTo >= f.from);
  if (ix.ds.returns.length && !returnsCovered) out.push({ key: 'returns', label: 'Retur', tone: 'warn', text: 'Laporan Pengembalian periode ini belum diimport' });
  else if (ix.ds.returns.length) {
    const ra = returnsAnalysis(ix, f, 'requested');
    out.push({ key: 'returns', label: 'Retur', tone: (ra.returnRate ?? 0) > 0.03 ? 'warn' : 'neutral',
      text: `**${pct(ra.returnRate, 2)}** pesanan${ra.byReason[0] ? ` · utama: ${ra.byReason[0].key.toLowerCase().replace(/\.$/, '')}` : ''}` });
  }

  const ca = cancellationAnalysis(ix, f);
  if (ca.covered && ca.sellerCentre.orders) out.push({ key: 'cancel', label: 'Pembatalan', tone: (ca.cancelRate ?? 0) > 0.1 ? 'warn' : 'neutral',
    text: `**${pct(ca.cancelRate)}** pesanan batal · ${num(ca.failed.orders)} gagal kirim` });

  const pr = profitability(ix, f, 'product');
  out.push(pr.totals.coverage
    ? { key: 'profit', label: 'Laba', tone: (pr.totals.profit ?? 0) >= 0 ? 'up' : 'down', text: `**${rp(pr.totals.profit)}** · margin ${pct(pr.totals.margin)}` }
    : { key: 'profit', label: 'Laba', tone: 'warn', text: 'HPP produk belum diisi' });
  return out;
}

const round = (v: number | null) => (v === null ? null : Math.round(v));
const r4 = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);

/** Catatan kualitas data agar AI tidak salah menyimpulkan. */
function dataNotes(ix: Index, f: Filter): string[] {
  const n: string[] = [
    `Omzet dihitung ${BASIS_DESC[f.basis]}.`,
    'Omzet bersih (tanpa pesanan batal) dan rincian pembatalan ada di bagian pembatalan bila export Semua Pesanan sudah diimport.',
    'Export Shopee "Pesanan Selesai" difilter per tanggal pesanan dibuat; bulan di tepi rentang data yang diimport bisa belum lengkap.',
  ];
  const months = [...new Set(ix.ds.orders.map((o) => o.createdAt?.slice(0, 7)).filter(Boolean))].sort();
  if (months.length) n.push(`Data pesanan yang diimport mencakup pesanan dibuat ${months[0]} s/d ${months[months.length - 1]}.`);
  n.push(ix.ds.reports.length ? `Laporan Penghasilan yang diimport: ${ix.ds.reports.map((r) => `${r.from}..${r.to}`).join(', ')}.` : 'Belum ada laporan Penghasilan.');
  if (!ix.ds.returns.length) n.push('Belum ada laporan Pengembalian.');
  if (!ix.ds.costs.length) n.push('HPP belum diisi — laba tidak tersedia.');
  return n;
}

const top = <T>(a: T[], n = 12) => a.slice(0, n);

export type AiTopic = 'overview' | 'sales' | 'returns' | 'costs';

/** Paket data agregat per topik untuk dikirim ke AI. */
export function aiPayload(ix: Index, f: Filter, prev: Filter, label: string, prevLabel: string, topic: AiTopic) {
  const s = salesSummary(ix, f), sp = salesSummary(ix, prev);
  const base = {
    toko: 'meirista_shop (Shopee)', periode: { label, dari: f.from, sampai: f.to }, pembanding: { label: prevLabel, dari: prev.from, sampai: prev.to },
    data_notes: dataNotes(ix, f),
    penjualan: { omzet: s.gmv, pesanan: s.orders, unit: s.units, rata_rata_per_pesanan: round(s.aov), pembeli: s.buyers, pembanding: { omzet: sp.gmv, pesanan: sp.orders, unit: sp.units } },
  };
  const products = () => {
    const prevMap = new Map(salesBy(ix, prev, 'product').map((r) => [r.key, r.gmv]));
    return top(salesBy(ix, f, 'product'), 15).map((r) => ({ produk: nm(r.label), omzet: r.gmv, porsi: r4(r.share), unit: r.units, pesanan: r.orders, omzet_pembanding: prevMap.get(r.key) ?? 0, qty_retur: r.returnedQty }));
  };
  const dim = (d: 'province' | 'payment' | 'brand' | 'category', n = 10) => top(salesBy(ix, f, d), n).map((r) => ({ nama: r.label, omzet: r.gmv, porsi: r4(r.share), pesanan: r.orders, rata_rata: round(r.aov) }));
  const fees = () => {
    const rel = settlementSummary(ix, { ...f, basis: 'released' });
    const ord = settlementSummary(ix, f);
    const g = (x: typeof rel) => Object.fromEntries(x.groups.filter((y) => y.total).map((y) => [y.label.replace(' (Opsional)', ''), { total: y.total, rincian: Object.fromEntries(y.fields.filter((z) => z.total).map((z) => [z.label, z.total])) }]));
    return {
      dana_dilepas_di_periode: { pesanan: rel.records, harga_produk: rel.productPrice, potongan_shopee: rel.marketplaceFees, rasio_potongan: r4(rel.feeRate), dana_diterima: rel.totalIncome, penyesuaian: rel.adjustments, penyesuaian_per_jenis: rel.adjustmentsByType, rincian: g(rel) },
      pesanan_periode_ini_yang_sudah_dicairkan: { pesanan: ord.records, dari_total_pesanan: s.orders, harga_produk: ord.productPrice, potongan_shopee: ord.marketplaceFees, rasio_potongan: r4(ord.feeRate), dana_diterima: ord.totalIncome, rincian: g(ord) },
    };
  };
  const returns = () => {
    const ra = returnsAnalysis(ix, f, 'requested');
    return { pengajuan: ra.requests, diproses: ra.valid, dana_dikembalikan: ra.refundTotal, tingkat_retur: r4(ra.returnRate), pesanan_dengan_retur: ra.cohortReturned, alasan: top(ra.byReason, 8).map((x) => ({ alasan: x.key, jumlah: x.n })), produk: top(ra.byProduct, 10).map((x) => ({ produk: nm(x.label), qty: x.qty, pengajuan: x.requests })), status: ra.byState.map((x) => ({ status: x.key, jumlah: x.n })) };
  };
  const customers = () => { const r = retention(ix, f); return { pembeli: r.buyers, pembeli_berulang: r.repeatBuyers, rasio_berulang: r4(r.repeatRate), baru_vs_kembali_per_bulan: r.monthly }; };
  const profit = () => { const p = profitability(ix, f, 'product'); return p.totals.coverage ? { laba_kotor: round(p.totals.profit), margin: r4(p.totals.margin), cakupan_hpp: r4(p.totals.coverage), produk: top(p.rows.filter((x) => x.profit !== null).sort((a, b) => b.profit! - a.profit!), 10).map((x) => ({ produk: nm(x.label), laba: round(x.profit), margin: r4(x.margin) })) } : 'HPP belum diisi'; };
  const monthly = () => {
    const m = new Map<string, { omzet: number; pesanan: number }>();
    for (const o of ordersIn(ix, f)) {
      const d = orderDate(ix, o, f.basis)!.slice(0, 7);
      const e = m.get(d) ?? { omzet: 0, pesanan: 0 };
      e.pesanan++; e.omzet += (ix.itemsByOrder.get(o.orderNo) ?? []).reduce((t, i) => t + i.subtotal, 0);
      m.set(d, e);
    }
    return [...m.entries()].sort().map(([bulan, v]) => ({ bulan, ...v }));
  };
  const auto = insights(ix, f).map((x) => `${x.title}: ${x.detail}`);
  const cancel = () => {
    const c = cancellationAnalysis(ix, f);
    if (!c.covered) return 'Belum ada export Semua Pesanan untuk periode ini (pembatalan tidak diketahui).';
    return { penjualan_versi_seller_centre: c.sellerCentre, dibatalkan: c.cancelled, rasio_batal: r4(c.cancelRate), gagal_kirim: c.failed, batal_sebelum_kirim: c.beforeShip,
      penyebab: c.actors, alasan: top(c.reasons, 10).map((x) => ({ alasan: x.detail, oleh: x.actor, pesanan: x.orders, nilai: x.value })),
      per_metode_bayar: c.payments.map((x) => ({ metode: x.method, pesanan: x.total, batal: x.cancelled, gagal_kirim: x.failed, rasio: r4(x.rate) })) };
  };

  switch (topic) {
    case 'overview': return { ...base, per_bulan: monthly(), produk_teratas: products(), provinsi: dim('province', 8), pembayaran: dim('payment', 6), pelanggan: customers(), biaya: fees(), retur: returns(), laba: profit(), pembatalan: cancel(), temuan_otomatis: auto };
    case 'sales': return { ...base, per_bulan: monthly(), produk_teratas: products(), brand: dim('brand'), kategori: dim('category'), provinsi: dim('province', 15), pembayaran: dim('payment'), pelanggan: customers(), pembatalan: cancel(), laba: profit() };
    case 'returns': return { ...base, retur: returns(), produk_teratas: products() };
    case 'costs': {
      const recs = incomeOrdersIn(ix, { ...f, basis: 'released' });
      const byCourier = new Map<string, { pesanan: number; ongkir_ke_kurir: number }>();
      for (const r of recs) { const k = r.courierName || r.courierService || '(kosong)'; const e = byCourier.get(k) ?? { pesanan: 0, ongkir_ke_kurir: 0 }; e.pesanan++; e.ongkir_ke_kurir += r.amounts['Ongkos Kirim yang Dibayarkan ke Jasa Kirim']; byCourier.set(k, e); }
      const rates = recs.filter((r) => r.amounts['Harga Produk'] > 0).map((r) => -marketplaceFees(r.amounts) / r.amounts['Harga Produk']).sort((a, b) => a - b);
      return { ...base, biaya: fees(), struktur_biaya: FEE_GROUPS.map((g) => g.label), kurir: [...byCourier.entries()].map(([k, v]) => ({ kurir: k, ...v })).sort((a, b) => b.pesanan - a.pesanan), sebaran_rasio_potongan_per_pesanan: rates.length ? { median: r4(rates[Math.floor(rates.length / 2)]), p90: r4(rates[Math.floor(rates.length * 0.9)]), p99: r4(rates[Math.floor(rates.length * 0.99)]) } : null };
    }
  }
}

export const AI_TASK: Record<AiTopic, string> = {
  overview: 'Buat analisis eksekutif kinerja toko untuk periode ini: apa yang berjalan baik, apa yang memburuk, dan apa yang harus dilakukan.',
  sales: 'Analisis penjualan periode ini: produk, brand/kategori, wilayah, metode pembayaran, dan pelanggan. Cari peluang menaikkan omzet.',
  returns: 'Analisis pengembalian/retur periode ini: penyebab utama, produk bermasalah, dan cara menurunkan retur.',
  costs: 'Analisis biaya yang dipotong Shopee dan biaya logistik periode ini: komponen terbesar, perubahan, dan cara menekan biaya.',
};

/** Contoh pertanyaan yang ditawarkan di jendela AI, per halaman. */
export const AI_SUGGEST: Record<AiTopic, string[]> = {
  overview: ['Apa 3 hal terpenting yang harus saya lakukan minggu ini?', 'Kenapa omzet berubah dibanding periode pembanding?', 'Produk mana yang perlu stok tambahan?'],
  sales: ['Produk mana yang sebaiknya dipromosikan?', 'Wilayah mana yang paling berpotensi ditingkatkan?', 'Bagaimana cara menaikkan pembeli berulang?'],
  returns: ['Apa penyebab utama retur?', 'Produk mana yang paling bermasalah dan apa solusinya?'],
  costs: ['Biaya apa yang paling besar dan bisa ditekan?', 'Apakah program Gratis Ongkir XTRA masih menguntungkan?', 'Jasa kirim mana yang paling efisien?'],
};
