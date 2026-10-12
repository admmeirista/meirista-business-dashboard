import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Receipt, Truck, Wallet, Scale } from 'lucide-react';
import { useData, monthRange } from '../data';
import { FilterBar, periodLabel, monthLabel } from '../components/FilterBar';
import { DataTable, Delta, Kpi, PageHead, Panel, Tabs, num, pct, rp, rpShort, dt } from '../components/ui';
import { settlementSummary, type SettlementSummary } from '../lib/metrics/analytics';
import { MARKETPLACE_FEE_GROUPS } from '../lib/fees';
import { day, incomeOrdersIn, inRange } from '../lib/metrics/dataset';

type Tab = 'fees' | 'logistics' | 'adjustments' | 'trend';

/** Halaman Biaya: potongan Shopee, logistik, penyesuaian — semuanya per tanggal dana dilepas. */
export default function Fees() {
  const { ix, filter, prev } = useData();
  const [params, setParams] = useSearchParams();
  const rel = useMemo(() => ({ ...filter, basis: 'released' as const }), [filter]);
  const s = useMemo(() => settlementSummary(ix, rel), [ix, rel]);
  const sp = useMemo(() => settlementSummary(ix, { ...prev, basis: 'released' }), [ix, prev]);
  const multiMonth = filter.from.slice(0, 7) !== filter.to.slice(0, 7);
  const tab = (params.get('tab') as Tab) || 'fees';
  const ship = s.groups.find((g) => g.key === 'shipping')!;
  const shipPrev = sp.groups.find((g) => g.key === 'shipping')!;

  return (
    <>
      <PageHead eyebrow="Performa toko" title="Biaya" actions={<FilterBar note="per tanggal dana dilepas Shopee" />} />
      {!ix.ds.reports.length && <div className="warn-box" style={{ marginBottom: 14, marginTop: 0 }}>Belum ada laporan Penghasilan. Import file Income.sudah dilepas.*.xlsx.</div>}
      {ix.ds.reports.length > 0 && !s.records && <div className="info-box" style={{ marginBottom: 14, marginTop: 0 }}>Tidak ada dana yang dilepas Shopee pada {periodLabel(filter)}. Laporan yang diimport: {ix.ds.reports.map((r) => `${r.from} s/d ${r.to}`).join(', ')}.</div>}
      <div className="kpis k4">
        <Kpi dark icon={<Receipt className="ic" />} label="Potongan Shopee" value={rpShort(-s.marketplaceFees)} sub={<><div className="hint">{pct(s.feeRate)} dari harga produk</div><Delta dark now={-s.marketplaceFees} before={sp.records ? -sp.marketplaceFees : null} invert /></>}
          formula="Biaya administrasi, proses pesanan, program Gratis Ongkir XTRA, Promo XTRA, promosi/AMS, lainnya, dan pajak. Persentase = potongan ÷ harga produk." />
        <Kpi icon={<Truck className="ic" />} label="Biaya logistik (bersih)" value={rpShort(-ship.total)} sub={<><div className="hint">ongkir ditanggung penjual setelah subsidi</div><Delta now={-ship.total} before={sp.records ? -shipPrev.total : null} invert /></>}
          formula="Ongkir dibayar ke jasa kirim − ongkir dibayar pembeli − gratis ongkir dari Shopee − potongan kurir + ongkir pengembalian (tanda dibalik: angka positif = biaya)." />
        <Kpi icon={<Scale className="ic" />} label="Penyesuaian" value={rpShort(s.adjustments)} sub={<div className="hint">kompensasi & koreksi Shopee</div>} formula="Sheet Adjustment menurut tanggal penyesuaian; positif = uang masuk ke penjual." />
        <Kpi icon={<Wallet className="ic" />} label="Dana diterima" value={rpShort(s.totalIncome)} sub={<><div className="hint">{num(s.records)} pesanan · +penyesuaian {rpShort(s.netWithAdjustments)}</div><Delta now={s.totalIncome} before={sp.records ? sp.totalIncome : null} /></>}
          formula="Σ Total Penghasilan baris Order = '3. Total yang Dilepas' di laporan Shopee." />
      </div>
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} items={[
        { key: 'fees', label: 'Potongan Shopee' }, { key: 'logistics', label: 'Logistik' }, { key: 'adjustments', label: 'Penyesuaian' },
        ...(multiMonth ? [{ key: 'trend' as Tab, label: 'Tren per bulan' }] : []),
      ]} />
      {tab === 'fees' && <FeesPanel s={s} sp={sp} />}
      {tab === 'logistics' && <LogisticsPanel s={s} />}
      {tab === 'adjustments' && <AdjustmentsPanel s={s} />}
      {tab === 'trend' && multiMonth && <TrendPanel />}
    </>
  );
}

function FeesPanel({ s, sp }: { s: SettlementSummary; sp: SettlementSummary }) {
  const [open, setOpen] = useState<Set<string>>(new Set(['platform']));
  const base = s.productPrice || 1, baseP = sp.productPrice || 1;
  const groups = s.groups.filter((g) => (MARKETPLACE_FEE_GROUPS as readonly string[]).includes(g.key) && (g.total !== 0 || sp.groups.find((x) => x.key === g.key)!.total !== 0));
  return (
    <div className="g21">
      <Panel title="Rincian potongan" sub="Klik grup untuk rinciannya · % terhadap harga produk">
        <table className="t">
          <thead><tr><th>Jenis</th><th className="num">Nominal</th><th className="num">% harga</th><th className="num">pembanding</th></tr></thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = open.has(g.key), fields = g.fields.filter((x) => x.total !== 0);
              const gp = sp.groups.find((x) => x.key === g.key)!;
              return (
                <Fragment key={g.key}>
                  <tr className="click" onClick={() => { const n = new Set(open); if (isOpen) n.delete(g.key); else n.add(g.key); setOpen(n); }}>
                    <td style={{ fontWeight: 800 }}>{fields.length > 1 ? (isOpen ? <ChevronDown className="ic" style={{ width: 14 }} /> : <ChevronRight className="ic" style={{ width: 14 }} />) : <span style={{ display: 'inline-block', width: 14 }} />} {g.label.replace(' (Opsional)', '')}</td>
                    <td className="num neg" style={{ fontWeight: 800 }}>{rp(g.total)}</td>
                    <td className="num">{pct(-g.total / base, 2)}</td>
                    <td className="num muted">{sp.records ? pct(-gp.total / baseP, 2) : '–'}</td>
                  </tr>
                  {isOpen && fields.length > 1 && fields.map((x) => <tr key={x.label}><td style={{ paddingLeft: 34, color: '#4e5751' }}>{x.label}</td><td className="num">{rp(x.total)}</td><td className="num muted">{pct(-x.total / base, 2)}</td><td /></tr>)}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot><tr><td>Total potongan Shopee</td><td className="num">{rp(s.marketplaceFees)}</td><td className="num">{pct(s.feeRate, 2)}</td><td className="num muted">{sp.records ? pct(sp.feeRate, 2) : '–'}</td></tr></tfoot>
        </table>
      </Panel>
      <Panel title="Dari harga produk ke dana diterima">
        <table className="t">
          <tbody>
            {s.groups.filter((g) => g.total !== 0).map((g) => <tr key={g.key}><td>{g.label.replace(' (Opsional)', '')}</td><td className={`num ${g.total < 0 ? 'neg' : ''}`}>{rp(g.total)}</td></tr>)}
          </tbody>
          <tfoot><tr><td>Dana diterima</td><td className="num">{rp(s.totalIncome)}</td></tr></tfoot>
        </table>
      </Panel>
    </div>
  );
}

function LogisticsPanel({ s }: { s: SettlementSummary }) {
  const { ix, filter } = useData();
  const ship = s.groups.find((g) => g.key === 'shipping')!;
  const xtra = s.groups.find((g) => g.key === 'xtra')!;
  const couriers = useMemo(() => {
    const m = new Map<string, { orders: number; paid: number; buyer: number; subsidy: number }>();
    for (const r of incomeOrdersIn(ix, { ...filter, basis: 'released' })) {
      const k = r.courierName || r.courierService || '(tidak diketahui)';
      const e = m.get(k) ?? { orders: 0, paid: 0, buyer: 0, subsidy: 0 };
      e.orders++; e.paid += -r.amounts['Ongkos Kirim yang Dibayarkan ke Jasa Kirim']; e.buyer += r.amounts['Ongkir Dibayar Pembeli']; e.subsidy += r.amounts['Gratis Ongkir dari Shopee'];
      m.set(k, e);
    }
    return [...m.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.orders - a.orders);
  }, [ix, filter]);
  const disc = ix.ds.discrepancies.filter((d) => { const r = ix.ds.reports.find((x) => x.id === d.reportId); return r && r.from <= filter.to && r.to >= filter.from; });
  return (
    <>
      <div className="g2">
        <Panel title="Rincian ongkos kirim" sub="Positif = mengurangi biaya penjual">
          <table className="t">
            <tbody>{ship.fields.filter((x) => x.total !== 0).map((x) => <tr key={x.label}><td>{x.label}</td><td className={`num ${x.total < 0 ? 'neg' : 'pos'}`}>{rp(x.total)}</td></tr>)}</tbody>
            <tfoot><tr><td>Biaya logistik bersih</td><td className="num">{rp(ship.total)}</td></tr></tfoot>
          </table>
          {xtra.total !== 0 && <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Ditambah biaya program Gratis Ongkir XTRA {rp(xtra.total)} (dihitung di Potongan Shopee).</div>}
        </Panel>
        <Panel title="Per jasa kirim">
          <DataTable rows={couriers} pageSize={10} empty="Tidak ada data." cols={[
            { key: 'k', label: 'Jasa kirim', value: (c) => c.k, render: (c) => <b>{c.k}</b> },
            { key: 'o', label: 'Pesanan', num: true, value: (c) => c.orders, render: (c) => num(c.orders) },
            { key: 'p', label: 'Ongkir ke kurir', num: true, value: (c) => c.paid, render: (c) => rp(c.paid) },
            { key: 'a', label: 'Rata-rata', num: true, value: (c) => c.paid / (c.orders || 1), render: (c) => rp(c.paid / (c.orders || 1)) },
            { key: 's', label: 'Disubsidi Shopee', num: true, value: (c) => c.subsidy / (c.paid || 1), render: (c) => pct(c.subsidy / (c.paid || 1), 0) },
          ]} />
        </Panel>
      </div>
      <Panel title="Selisih ongkir" sub="Ongkir ke jasa kirim lebih tinggi dari estimasi (sheet Shipping Fee Discrepancy)">
        <DataTable rows={disc} pageSize={10} csvName="selisih-ongkir" empty="Tidak ada selisih ongkir pada laporan periode ini." cols={[
          { key: 'o', label: 'No. Pesanan', value: (d) => d.orderNo, render: (d) => <span className="mono">{d.orderNo}</span> },
          { key: 'e', label: 'Estimasi', num: true, value: (d) => d.estimated, render: (d) => rp(d.estimated) },
          { key: 'a', label: 'Dibayar', num: true, value: (d) => d.actual, render: (d) => rp(d.actual) },
          { key: 'f', label: 'Selisih', num: true, value: (d) => d.actual - d.estimated, render: (d) => rp(d.actual - d.estimated), total: (rs) => rp(rs.reduce((t, d) => t + d.actual - d.estimated, 0)) },
          { key: 'r', label: 'Alasan', value: (d) => d.reason, className: 'wrap' },
        ]} />
      </Panel>
    </>
  );
}

function AdjustmentsPanel({ s }: { s: SettlementSummary }) {
  const { ix, filter } = useData();
  const adj = ix.ds.adjustments.filter((a) => inRange(day(a.date), filter));
  return (
    <div className="g21">
      <Panel title="Daftar penyesuaian">
        <DataTable rows={adj} pageSize={15} csvName={`penyesuaian-${filter.from}-${filter.to}`} initialSort={{ key: 'd', dir: -1 }} empty="Tidak ada penyesuaian pada periode ini." cols={[
          { key: 'd', label: 'Tanggal', value: (a) => a.date, render: (a) => dt(a.date) },
          { key: 't', label: 'Jenis', value: (a) => a.type, className: 'wrap', render: (a) => <>{a.type}{a.reason && <div className="sub">{a.reason}</div>}</> },
          { key: 'o', label: 'No. Pesanan', value: (a) => a.orderNo, render: (a) => <span className="mono">{a.orderNo}</span> },
          { key: 'a', label: 'Nominal', num: true, value: (a) => a.amount, render: (a) => <span className={a.amount < 0 ? 'neg' : ''}>{rp(a.amount)}</span>, total: (rs) => rp(rs.reduce((t, a) => t + a.amount, 0)) },
        ]} />
      </Panel>
      <Panel title="Per jenis">
        {s.adjustmentsByType.length ? <table className="t"><tbody>{s.adjustmentsByType.map((a) => <tr key={a.type}><td>{a.type}<div className="sub">{a.count} transaksi</div></td><td className={`num ${a.total < 0 ? 'neg' : ''}`}>{rp(a.total)}</td></tr>)}</tbody></table> : <div className="empty">Tidak ada penyesuaian.</div>}
      </Panel>
    </div>
  );
}

function TrendPanel() {
  const { ix, filter } = useData();
  const rows = useMemo(() => {
    const out: { m: string; s: SettlementSummary }[] = [];
    for (let m = filter.from.slice(0, 7); m <= filter.to.slice(0, 7);) {
      const r = monthRange(m);
      const s = settlementSummary(ix, { basis: 'released', from: r.from < filter.from ? filter.from : r.from, to: r.to > filter.to ? filter.to : r.to });
      if (s.records || s.adjustments) out.push({ m, s });
      const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1));
      m = d.toISOString().slice(0, 7);
    }
    return out;
  }, [ix, filter]);
  const ship = (s: SettlementSummary) => s.groups.find((g) => g.key === 'shipping')!.total;
  return (
    <DataTable rows={rows} pageSize={36} csvName={`biaya-bulanan-${filter.from}-${filter.to}`} empty="Tidak ada dana dilepas pada rentang ini." cols={[
      { key: 'm', label: 'Bulan', value: (r) => r.m, render: (r) => <b>{monthLabel(r.m)}</b> },
      { key: 'h', label: 'Harga produk', num: true, value: (r) => r.s.productPrice, render: (r) => rp(r.s.productPrice), total: (rs) => rp(rs.reduce((t, r) => t + r.s.productPrice, 0)) },
      { key: 'f', label: 'Potongan Shopee', num: true, value: (r) => r.s.marketplaceFees, render: (r) => <span className="neg">{rp(r.s.marketplaceFees)}</span>, total: (rs) => rp(rs.reduce((t, r) => t + r.s.marketplaceFees, 0)) },
      { key: 'p', label: '% potongan', num: true, value: (r) => r.s.feeRate, render: (r) => pct(r.s.feeRate, 2) },
      { key: 'l', label: 'Logistik bersih', num: true, value: (r) => ship(r.s), render: (r) => rp(ship(r.s)), total: (rs) => rp(rs.reduce((t, r) => t + ship(r.s), 0)) },
      { key: 'a', label: 'Penyesuaian', num: true, value: (r) => r.s.adjustments, render: (r) => rp(r.s.adjustments), total: (rs) => rp(rs.reduce((t, r) => t + r.s.adjustments, 0)) },
      { key: 'd', label: 'Dana diterima', num: true, value: (r) => r.s.totalIncome, render: (r) => <b>{rp(r.s.totalIncome)}</b>, total: (rs) => rp(rs.reduce((t, r) => t + r.s.totalIncome, 0)) },
    ]} />
  );
}
