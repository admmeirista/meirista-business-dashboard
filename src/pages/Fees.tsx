import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Receipt, Wallet, Scale } from 'lucide-react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { DataTable, Delta, Kpi, PageHead, Panel, num, pct, rp, rpShort, dt } from '../components/ui';
import { settlementSummary } from '../lib/metrics/analytics';
import { day, inRange } from '../lib/metrics/dataset';

export default function Fees() {
  const { ix, filter, prev } = useData();
  const f = { ...filter, basis: 'released' as const };
  const s = useMemo(() => settlementSummary(ix, { ...filter, basis: 'released' }), [ix, filter]);
  const sp = useMemo(() => settlementSummary(ix, { ...prev, basis: 'released' }), [ix, prev]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const adj = ix.ds.adjustments.filter((a) => inRange(day(a.date), f));
  const base = s.productPrice || 1;
  const groups = s.groups.filter((g) => g.total !== 0);

  return (
    <>
      <PageHead eyebrow="Keuangan" title="Berapa yang masuk & dipotong Shopee?" />
      <FilterBar note="Menurut tanggal dana dilepas Shopee (laporan Penghasilan)" />
      {!ix.ds.reports.length && <div className="warn-box" style={{ marginBottom: 14 }}>Belum ada laporan Penghasilan. Import file Income.sudah dilepas.*.xlsx.</div>}
      <div className="kpis">
        <Kpi dark icon={<Wallet className="ic" />} label="Dana diterima" value={rpShort(s.totalIncome)} sub={<><div className="hint">{num(s.records)} pesanan dilepas</div><Delta dark now={s.totalIncome} before={sp.records ? sp.totalIncome : null} /></>}
          formula="Σ Total Penghasilan per pesanan (baris Order) — sama dengan '3. Total yang Dilepas' di laporan Shopee." />
        <Kpi icon={<Receipt className="ic" />} label="Biaya Shopee" value={rpShort(-s.marketplaceFees)} sub={<><div className="hint">{pct(s.feeRate)} dari harga produk</div><Delta now={-s.marketplaceFees} before={sp.records ? -sp.marketplaceFees : null} invert /></>}
          formula="Biaya administrasi, proses pesanan, program Gratis Ongkir XTRA, Promo XTRA, promosi, lainnya, pajak. Persentase = biaya ÷ harga produk." />
        <Kpi icon={<Scale className="ic" />} label="Penyesuaian & kompensasi" value={rpShort(s.adjustments)} sub={<div className="hint">{num(adj.length)} transaksi · total {rpShort(s.netWithAdjustments)}</div>}
          formula="Sheet Adjustment (kompensasi, pengembalian setelah dana dilepas, dll.) menurut tanggal penyesuaian. Terpisah dari Dana diterima." />
      </div>

      <div className="g21">
        <Panel title="Rincian penghasilan" sub="Klik baris untuk melihat rinciannya · % terhadap harga produk">
          <table className="t">
            <tbody>
              {groups.map((g) => {
                const isOpen = open.has(g.key);
                const fields = g.fields.filter((x) => x.total !== 0);
                return (
                  <Fragment key={g.key}>
                    <tr className="click" onClick={() => { const n = new Set(open); if (isOpen) n.delete(g.key); else n.add(g.key); setOpen(n); }}>
                      <td style={{ fontWeight: 800 }}>{fields.length > 1 && (isOpen ? <ChevronDown className="ic" style={{ width: 14 }} /> : <ChevronRight className="ic" style={{ width: 14 }} />)} {g.label.replace(' (Opsional)', '')}</td>
                      <td className={`num ${g.total < 0 ? 'neg' : ''}`} style={{ fontWeight: 800 }}>{rp(g.total)}</td>
                      <td className="num muted" style={{ width: 70 }}>{pct(g.total / base)}</td>
                    </tr>
                    {isOpen && fields.length > 1 && fields.map((x) => <tr key={x.label}><td style={{ paddingLeft: 34, color: '#4e5751' }}>{x.label}</td><td className="num">{rp(x.total)}</td><td className="num muted">{pct(x.total / base)}</td></tr>)}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot><tr><td>Dana diterima</td><td className="num">{rp(s.totalIncome)}</td><td className="num">{pct(s.totalIncome / base)}</td></tr></tfoot>
          </table>
        </Panel>
        <Panel title="Penyesuaian per jenis">
          {s.adjustmentsByType.length ? (
            <table className="t"><tbody>{s.adjustmentsByType.map((a) => <tr key={a.type}><td>{a.type}<div className="sub">{a.count} transaksi</div></td><td className={`num ${a.total < 0 ? 'neg' : ''}`}>{rp(a.total)}</td></tr>)}</tbody></table>
          ) : <div className="empty">Tidak ada penyesuaian.</div>}
        </Panel>
      </div>
      <Panel title="Daftar penyesuaian">
        <DataTable rows={adj} pageSize={15} csvName={`penyesuaian-${filter.from}-${filter.to}`} initialSort={{ key: 'd', dir: -1 }} empty="Tidak ada penyesuaian pada periode ini." cols={[
          { key: 'd', label: 'Tanggal', value: (a) => a.date, render: (a) => dt(a.date) },
          { key: 't', label: 'Jenis', value: (a) => a.type, className: 'wrap', render: (a) => <>{a.type}{a.reason && <div className="sub">{a.reason}</div>}</> },
          { key: 'o', label: 'No. Pesanan', value: (a) => a.orderNo, render: (a) => <span className="mono">{a.orderNo}</span> },
          { key: 'a', label: 'Nominal', num: true, value: (a) => a.amount, render: (a) => <span className={a.amount < 0 ? 'neg' : ''}>{rp(a.amount)}</span>, total: (rs) => rp(rs.reduce((t, a) => t + a.amount, 0)) },
        ]} />
      </Panel>
    </>
  );
}
