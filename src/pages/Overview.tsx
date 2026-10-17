import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Package, Wallet } from 'lucide-react';
import { monthRange, useData } from '../data';
import { FilterBar, monthLabel, periodLabel } from '../components/FilterBar';
import { LineChart } from '../components/charts';
import { Inline } from '../components/Ai';
import { executiveSummary } from '../lib/metrics/summary';
import { Chips, Delta, Kpi, PageHead, Panel, dShort, num, pct, rp, rpShort } from '../components/ui';
import { salesBy, salesSummary, settlementSummary } from '../lib/metrics/analytics';
import { BASIS_DESC } from '../lib/metrics/dataset';
import { hasCancellationData } from '../lib/metrics/cancellations';
import { insights } from '../lib/metrics/insights';
import { FEE_GROUPS } from '../lib/fees';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const addMonths = (m: string, k: number) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

type Grain = 'month' | 'day';
type Metric = 'gmv' | 'orders';

/** Kartu KPI menempel di atas saat halaman di-scroll; diringkas setelah melewati bagian atas halaman. */
function useCompactOnScroll() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const on = () => setCompact((c) => (c ? window.scrollY > 24 : window.scrollY > 96));
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return compact;
}

export default function Overview() {
  const { ix, filter, prev, monthCounts, setPeriod } = useData();
  const compact = useCompactOnScroll();
  const [grain, setGrain] = useState<Grain>('month');
  const [metric, setMetric] = useState<Metric>('gmv');
  const m = useMemo(() => {
    const rel = { ...filter, basis: 'released' as const };
    const relPrev = { ...prev, basis: 'released' as const };
    const prevProducts = new Map(salesBy(ix, prev, 'product').map((r) => [r.key, r.gmv]));
    return {
      s: salesSummary(ix, filter), sp: salesSummary(ix, prev),
      st: settlementSummary(ix, rel), stp: settlementSummary(ix, relPrev),
      flowSt: settlementSummary(ix, filter),
      top: salesBy(ix, filter, 'product').slice(0, 6).map((r) => ({ ...r, before: prevProducts.get(r.key) ?? null })),
      watch: insights(ix, filter).slice(0, 6),
      exec: executiveSummary(ix, filter, prev, periodLabel(filter), periodLabel(prev)),
    };
  }, [ix, filter, prev]);

  // Tren bulanan: 12 bulan sampai bulan terakhir periode terpilih, dibanding bulan yang sama tahun sebelumnya.
  const monthly = useMemo(() => {
    const end = filter.to.slice(0, 7);
    const months = Array.from({ length: 12 }, (_, i) => addMonths(end, i - 11));
    const s = salesSummary(ix, { ...filter, from: `${addMonths(end, -23)}-01` });
    const agg = new Map<string, { gmv: number; orders: number }>();
    for (const d of s.daily) {
      const k = d.d.slice(0, 7);
      const e = agg.get(k) ?? { gmv: 0, orders: 0 };
      e.gmv += d.gmv; e.orders += d.orders;
      agg.set(k, e);
    }
    const val = (k: string) => (monthCounts.has(k) ? agg.get(k) ?? { gmv: 0, orders: 0 } : null);
    return { months, now: months.map(val), ago: months.map((k) => val(addMonths(k, -12))) };
  }, [ix, filter, monthCounts]);

  const { s, sp, st, stp } = m;
  const fs2 = m.flowSt;
  const fmt = metric === 'gmv' ? rp : (v: number) => `${num(v)} pesanan`;
  const pickV = (x: { gmv: number; orders: number } | null) => (x ? x[metric] : null);
  const fromM = filter.from.slice(0, 7), toM = filter.to.slice(0, 7);

  // Alur uang: dari harga produk sampai dana diterima (pesanan yang dananya dilepas pada periode ini).
  const flow = FEE_GROUPS.filter((g) => g.key !== 'voucher' || fs2.groups.find((x) => x.key === g.key)!.total !== 0).map((g) => {
    const x = fs2.groups.find((y) => y.key === g.key)!;
    if (g.key === 'subtotal') return [{ label: 'Harga produk', v: x.fields[0].total }, { label: 'Refund ke pembeli', v: x.fields[1].total }];
    return [{ label: g.label.replace(' (Opsional)', '').replace('Total Biaya Pengiriman', 'Selisih ongkir').replace('Biaya Gratis Ongkir XTRA', 'Program Gratis Ongkir XTRA').replace('Biaya Layanan', 'Program Promo XTRA'), v: x.total }];
  }).flat().filter((r) => r.v !== 0);
  const base = flow[0]?.v || 1;

  const chart = grain === 'month' ? (
    <LineChart label="Tren bulanan" height={250}
      labels={monthly.months.map((k) => `${MON[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`)}
      series={[
        { label: 'Tahun ini', values: monthly.now.map(pickV), color: 'var(--acc)' },
        { label: 'Tahun lalu', values: monthly.ago.map(pickV), color: '#a9b3ab', dashed: true },
      ]}
      format={fmt} tipTitle={(i) => monthLabel(monthly.months[i])}
      active={(i) => monthly.months[i] >= fromM && monthly.months[i] <= toM}
      onPick={(i) => setPeriod(monthRange(monthly.months[i]))} />
  ) : (
    <LineChart label="Tren harian" height={250}
      labels={s.daily.map((d) => dShort(d.d))}
      series={[
        { label: periodLabel(filter), values: s.daily.map((d) => d[metric]), color: 'var(--acc)' },
        { label: periodLabel(prev), values: s.daily.map((_, i) => sp.daily[i]?.[metric] ?? null), color: '#a9b3ab', dashed: true },
      ]}
      format={fmt} tipTitle={(i) => new Date(s.daily[i].d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
  );

  return (
    <>
      <PageHead eyebrow="Performa toko" title="Ringkasan Eksekutif" actions={<FilterBar />} />
      <div className="ov">
        <div className="ov-left">
          <div className={`ov-kpis${compact ? ' compact' : ''}`}>
            <div className="kpis">
              <Kpi dark icon={<ShoppingBag className="ic" />} label="Omzet" value={rpShort(s.gmv)}
                sub={<>{filter.basis === 'sc' && !hasCancellationData(ix, filter) && ix.ds.orders.length > 0 && <div className="hint">belum termasuk pesanan batal — import Semua Pesanan</div>}<Delta dark now={s.gmv} before={sp.gmv} /></>}
                formula={filter.basis === 'sc'
                  ? 'Definisi Seller Centre 2026: harga produk − voucher/diskon penjual dari pesanan yang dibayar (non-COD) atau dikonfirmasi (COD) di periode ini, termasuk yang kemudian dibatalkan. Angka bulan lalu tidak berubah walau ada pembatalan belakangan.'
                  : `Σ (harga setelah diskon × jumlah) semua item pesanan, ${BASIS_DESC[filter.basis]}.`} />
              <Kpi icon={<Package className="ic" />} label="Pesanan" value={num(s.orders)} sub={<><div className="hint">{rp(s.aov)} per pesanan · {num(s.units)} unit</div><Delta now={s.orders} before={sp.orders} /></>}
                formula="Jumlah No. Pesanan unik. Rata-rata per pesanan = omzet ÷ pesanan." />
              <Kpi icon={<Wallet className="ic" />} label="Dana diterima" value={st.records ? rpShort(st.totalIncome) : <span className="na">–</span>}
                sub={st.records ? <><div className="hint">dilepas Shopee periode ini · biaya {pct(st.feeRate)}</div><Delta now={st.totalIncome} before={stp.records ? stp.totalIncome : null} /></> : <div className="hint">{ix.ds.reports.length ? 'Belum ada dana yang dilepas Shopee di periode ini' : <Link to="/import">Import laporan Penghasilan</Link>}</div>}
                formula="Total Penghasilan yang dilepas Shopee ke saldo penjual pada periode ini (Tanggal Dana Dilepaskan), setelah semua biaya. Belum termasuk penyesuaian." />
            </div>
          </div>

          <Panel title={metric === 'gmv' ? 'Tren omzet' : 'Tren pesanan'}
            sub={grain === 'month' ? '12 bulan terakhir vs tahun lalu · klik titik untuk membuka bulan itu' : `Per hari · ${periodLabel(filter)} vs ${periodLabel(prev)}`}
            actions={<>
              <Chips value={metric} onChange={setMetric} items={[{ key: 'gmv', label: 'Omzet' }, { key: 'orders', label: 'Pesanan' }]} />
              <Chips value={grain} onChange={setGrain} items={[{ key: 'month', label: 'Bulanan' }, { key: 'day', label: 'Harian' }]} />
            </>}>
            {chart}
          </Panel>

          <div className="g2">
            <Panel title="Produk terlaris" actions={<Link className="btn sm" to="/sales">Semua produk</Link>}>
              <div className="tablewrap flat">
                <table className="t">
                  <thead><tr><th>Produk</th><th className="num">Omzet</th><th className="num">vs lalu</th></tr></thead>
                  <tbody>
                    {m.top.map((r) => (
                      <tr key={r.key}>
                        <td className="wrap"><div className="clamp2" style={{ fontWeight: 700 }} title={r.label}>{r.label}</div><div className="sub">{num(r.units)} unit · {pct(r.share)} dari omzet</div></td>
                        <td className="num">{rpShort(r.gmv)}</td>
                        <td className="num">{r.before ? <span className={r.gmv >= r.before ? 'pos' : 'neg'}>{r.gmv >= r.before ? '▲' : '▼'} {pct(Math.abs(r.gmv - r.before) / r.before, 0)}</span> : <span className="muted">baru</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="Yang perlu diperhatikan" sub="Dibaca otomatis dari data periode ini">
              <ul className="watch">
                {m.watch.map((w, i) => <li key={i} className={`w-${w.level}`}><i className="dot" /><div><b>{w.title}</b><span className="d">{w.detail}</span></div></li>)}
              </ul>
            </Panel>
          </div>

          <Panel title="Dari harga produk ke dana diterima" sub={fs2.records ? `${num(fs2.records)} dari ${num(s.orders)} pesanan periode ini sudah dicairkan Shopee` : 'Belum ada pesanan periode ini di laporan Penghasilan'} actions={<Link className="btn sm" to="/finance">Rincian</Link>}>
            {fs2.records ? (
              <table className="t flow2">
                <tbody>
                  {flow.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td style={{ width: '40%' }}><div className="bar"><i style={{ width: `${Math.min(100, (Math.abs(r.v) / base) * 100)}%`, background: r.v < 0 ? 'var(--neg)' : 'var(--acc)' }} /></div></td>
                      <td className="num">{rpShort(r.v)}</td>
                      <td className="num muted" style={{ width: 60 }}>{pct(r.v / base)}</td>
                    </tr>
                  ))}
                  <tr className="total"><td>Dana diterima</td><td /><td className="num">{rpShort(fs2.totalIncome)}</td><td className="num">{pct(fs2.totalIncome / base)}</td></tr>
                </tbody>
              </table>
            ) : <div className="empty">Import laporan Penghasilan untuk melihat potongan biaya Shopee.</div>}
          </Panel>
        </div>

        <aside className="ov-side" aria-label="Executive summary">
          <section className="exec3">
            <div className="exec3-h"><span className="eyebrow">Executive summary</span><span className="muted">{periodLabel(filter)} · vs {periodLabel(prev)}</span></div>
            {m.exec.map((p) => (
              <div key={p.key} className={`xp t-${p.tone}`}>
                <div className="xl"><i />{p.label}</div>
                <div className="xt"><Inline text={p.text} /></div>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
