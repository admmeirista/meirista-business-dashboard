import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Package, Wallet, TrendingUp } from 'lucide-react';
import { useData } from '../data';
import { FilterBar, periodLabel } from '../components/FilterBar';
import { TimeChart, bucketize } from '../components/charts';
import { Inline } from '../components/Ai';
import { executiveSummary } from '../lib/metrics/summary';
import { Delta, Kpi, PageHead, Panel, num, pct, rp, rpShort } from '../components/ui';
import { profitability, salesBy, salesSummary, settlementSummary } from '../lib/metrics/analytics';
import { BASIS_LABEL } from '../lib/metrics/dataset';
import { insights } from '../lib/metrics/insights';
import { FEE_GROUPS } from '../lib/fees';

export default function Overview() {
  const { ix, filter, prev } = useData();
  const m = useMemo(() => {
    const rel = { ...filter, basis: 'released' as const };
    const relPrev = { ...prev, basis: 'released' as const };
    const prevProducts = new Map(salesBy(ix, prev, 'product').map((r) => [r.key, r.gmv]));
    return {
      s: salesSummary(ix, filter), sp: salesSummary(ix, prev),
      st: settlementSummary(ix, rel), stp: settlementSummary(ix, relPrev),
      flowSt: settlementSummary(ix, filter),
      prof: profitability(ix, filter, 'product'), profPrev: profitability(ix, prev, 'product'),
      top: salesBy(ix, filter, 'product').slice(0, 6).map((r) => ({ ...r, before: prevProducts.get(r.key) ?? null })),
      watch: insights(ix, filter).slice(0, 6),
      exec: executiveSummary(ix, filter, prev, periodLabel(filter), periodLabel(prev)),
    };
  }, [ix, filter, prev]);
  const { s, sp, st, stp, prof } = m;
  const fs2 = m.flowSt;
  const hasCogs = !!prof.totals.coverage;

  // Alur uang: dari harga produk sampai dana diterima (pesanan yang dananya dilepas pada periode ini).
  const flow = FEE_GROUPS.filter((g) => g.key !== 'voucher' || fs2.groups.find((x) => x.key === g.key)!.total !== 0).map((g) => {
    const x = fs2.groups.find((y) => y.key === g.key)!;
    if (g.key === 'subtotal') return [{ label: 'Harga produk', v: x.fields[0].total }, { label: 'Refund ke pembeli', v: x.fields[1].total }];
    return [{ label: g.label.replace(' (Opsional)', '').replace('Total Biaya Pengiriman', 'Selisih ongkir').replace('Biaya Gratis Ongkir XTRA', 'Program Gratis Ongkir XTRA').replace('Biaya Layanan', 'Program Promo XTRA'), v: x.total }];
  }).flat().filter((r) => r.v !== 0);
  const base = flow[0]?.v || 1;
  const trend = bucketize(s.daily, (d) => ({ gmv: d.gmv, orders: d.orders }));

  return (
    <>
      <PageHead eyebrow="Performa toko" title="Ringkasan Eksekutif" actions={<FilterBar />} />
      <section className="exec2" aria-label="Executive summary">
        <div className="exec2-h"><span className="eyebrow">Executive summary</span><span className="muted">{periodLabel(filter)} · vs {periodLabel(prev)}</span></div>
        <div className="exec2-grid">
          {m.exec.map((p) => (
            <div key={p.key} className={`xp t-${p.tone}`}>
              <div className="xl"><i />{p.label}</div>
              <div className="xt"><Inline text={p.text} /></div>
            </div>
          ))}
        </div>
      </section>
      <div className="kpis k4">
        <Kpi dark icon={<ShoppingBag className="ic" />} label="Omzet" value={rpShort(s.gmv)} sub={<Delta dark now={s.gmv} before={sp.gmv} />}
          formula={`Σ (harga setelah diskon × jumlah) semua item pesanan, menurut tanggal ${BASIS_LABEL[filter.basis].toLowerCase()}.`} />
        <Kpi icon={<Package className="ic" />} label="Pesanan" value={num(s.orders)} sub={<><div className="hint">{rp(s.aov)} per pesanan · {num(s.units)} unit</div><Delta now={s.orders} before={sp.orders} /></>}
          formula="Jumlah No. Pesanan unik. Rata-rata per pesanan = omzet ÷ pesanan." />
        <Kpi icon={<Wallet className="ic" />} label="Dana diterima" value={st.records ? rpShort(st.totalIncome) : <span className="na">–</span>}
          sub={st.records ? <><div className="hint">dilepas Shopee periode ini · biaya {pct(st.feeRate)}</div><Delta now={st.totalIncome} before={stp.records ? stp.totalIncome : null} /></> : <div className="hint">{ix.ds.reports.length ? 'Belum ada dana yang dilepas Shopee di periode ini' : <Link to="/import">Import laporan Penghasilan</Link>}</div>}
          formula="Total Penghasilan yang dilepas Shopee ke saldo penjual pada periode ini (Tanggal Dana Dilepaskan), setelah semua biaya. Belum termasuk penyesuaian." />
        <Kpi icon={<TrendingUp className="ic" />} label="Laba kotor" value={hasCogs ? rpShort(prof.totals.profit) : <span className="na">Belum ada HPP</span>}
          sub={hasCogs ? <><div className="hint">margin {pct(prof.totals.margin)} · cakupan HPP {pct(prof.totals.coverage, 0)}</div><Delta now={prof.totals.profit} before={m.profPrev.totals.coverage ? m.profPrev.totals.profit : null} /></> : <div className="hint"><Link to="/master">Isi HPP produk</Link> untuk melihat laba</div>}
          formula="Dana diterima per item − HPP, hanya item yang sudah dilepas dan punya HPP. Item tanpa HPP tidak dianggap 0." />
      </div>

      <div className="g21">
        <Panel title={`Omzet ${trend.unit}`} sub="Arahkan kursor ke batang untuk melihat nilainya">
          <TimeChart data={trend.rows} value={(d) => d.gmv} format={rp} label="Omzet" height={230} />
        </Panel>
        <Panel title="Yang perlu diperhatikan" sub="Dibaca otomatis dari data periode ini">
          <ul className="watch">
            {m.watch.map((w, i) => <li key={i} className={`w-${w.level}`}><i className="dot" /><div><b>{w.title}</b><span className="d">{w.detail}</span></div></li>)}
          </ul>
        </Panel>
      </div>

      <div className="g2">
        <Panel title="Produk terlaris" actions={<Link className="btn sm" to="/sales">Semua produk</Link>}>
          <div className="tablewrap flat">
            <table className="t">
              <thead><tr><th>Produk</th><th className="num">Omzet</th><th className="num">Unit</th><th className="num">vs lalu</th></tr></thead>
              <tbody>
                {m.top.map((r) => (
                  <tr key={r.key}>
                    <td className="wrap"><div style={{ fontWeight: 700 }}>{r.label}</div><div className="sub">{pct(r.share)} dari omzet</div></td>
                    <td className="num">{rpShort(r.gmv)}</td>
                    <td className="num">{num(r.units)}</td>
                    <td className="num">{r.before ? <span className={r.gmv >= r.before ? 'pos' : 'neg'}>{r.gmv >= r.before ? '▲' : '▼'} {pct(Math.abs(r.gmv - r.before) / r.before, 0)}</span> : <span className="muted">baru</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Dari harga produk ke dana diterima" sub={fs2.records ? `${num(fs2.records)} dari ${num(s.orders)} pesanan periode ini sudah dicairkan Shopee` : 'Belum ada pesanan periode ini di laporan Penghasilan'} actions={<Link className="btn sm" to="/finance">Rincian</Link>}>
          {fs2.records ? (
            <table className="t flow2">
              <tbody>
                {flow.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td style={{ width: '34%' }}><div className="bar"><i style={{ width: `${Math.min(100, (Math.abs(r.v) / base) * 100)}%`, background: r.v < 0 ? 'var(--neg)' : 'var(--acc)' }} /></div></td>
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
    </>
  );
}
