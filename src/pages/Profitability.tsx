import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Wallet, Boxes, ShieldCheck } from 'lucide-react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { BarList } from '../components/charts';
import { DataTable, Kpi, PageHead, Panel, Tabs, num, pct, rp, rpShort, type Col } from '../components/ui';
import { profitability, type ProfitRow } from '../lib/metrics/analytics';

type By = 'product' | 'brand' | 'category' | 'listing';

export default function Profitability() {
  const { ix, filter } = useData();
  const [by, setBy] = useState<By>(() => (ix.ds.mappings.length ? 'product' : 'listing'));
  const p = useMemo(() => profitability(ix, filter, by), [ix, filter, by]);
  const t = p.totals;
  const withProfit = p.rows.filter((r) => r.profit !== null);
  const na = <span className="na" title="HPP belum diisi — tidak dianggap 0">n/a</span>;
  const cols: Col<ProfitRow>[] = [
    { key: 'l', label: { product: 'Produk', brand: 'Brand', category: 'Kategori', listing: 'Listing' }[by], value: (r) => r.label, className: 'wrap', render: (r) => <><b>{r.label}</b>{r.sub && <div className="sub">{r.sub}</div>}</> },
    { key: 'g', label: 'GMV', num: true, value: (r) => r.gmv, render: (r) => rp(r.gmv) },
    { key: 'n', label: 'Dana dilepas (alokasi)', num: true, value: (r) => r.netSettled, render: (r) => (r.settledUnits ? rp(r.netSettled) : <span className="muted">belum dilepas</span>) },
    { key: 'c', label: 'HPP', num: true, value: (r) => r.cogs, render: (r) => (r.cogs === null ? na : rp(r.cogs)) },
    { key: 'p', label: 'Laba kotor', num: true, value: (r) => r.profit, render: (r) => (r.profit === null ? na : <span className={r.profit < 0 ? 'neg' : 'pos'}>{rp(r.profit)}</span>) },
    { key: 'm', label: 'Margin', num: true, value: (r) => r.margin, render: (r) => (r.margin === null ? na : pct(r.margin)) },
    { key: 'v', label: 'Cakupan HPP', num: true, value: (r) => r.cogsCoverage, render: (r) => (r.settledUnits ? <span className={r.cogsCoverage < 1 ? 'tag warn' : 'tag ok'}>{pct(r.cogsCoverage, 0)}</span> : '–') },
    { key: 'u', label: 'Unit', num: true, value: (r) => r.units, render: (r) => num(r.units) },
  ];
  return (
    <>
      <PageHead eyebrow="Keuangan" title="Profitabilitas Produk & Brand" actions={<Link className="btn" to="/master"><Boxes className="ic" />Kelola HPP</Link>} />
      <FilterBar />
      {t.coverage !== null && t.coverage < 1 && (
        <div className="warn-box" style={{ marginBottom: 14 }}>
          Cakupan HPP {pct(t.coverage)} — {num(t.itemsNoCogs)} baris item yang sudah dilepas belum punya pemetaan/HPP. Laba hanya dihitung dari item ber-HPP; item lain ditampilkan "n/a", <b>tidak</b> dianggap HPP 0.
        </div>
      )}
      <div className="kpis">
        <Kpi dark icon={<TrendingUp className="ic" />} label="Laba kotor" value={t.coverage ? rpShort(t.profit) : <span className="na">n/a</span>} sub={t.coverage ? `Margin ${pct(t.margin)}` : 'HPP belum diisi'} formula="Σ (alokasi Dana Dilepas item − HPP item), hanya item yang sudah dilepas dan punya HPP. Margin = laba ÷ alokasi dana item tersebut." />
        <Kpi icon={<Wallet className="ic" />} label="Dana dilepas teralokasi" value={rpShort(t.net)} sub={`${num(t.settledOrders)} pesanan dilepas · ${num(t.unsettledOrders)} belum`} formula="Alokasi per item = Total Penghasilan pesanan × (subtotal item ÷ Σ subtotal pesanan)." />
        <Kpi icon={<Boxes className="ic" />} label="HPP" value={t.coverage ? rpShort(t.cogs) : <span className="na">n/a</span>} sub="HPP unit × isi paket × qty" formula="HPP unit diambil dari entri dengan tanggal berlaku ≤ tanggal pesanan dibuat." />
        <Kpi icon={<ShieldCheck className="ic" />} label="Cakupan HPP" value={pct(t.coverage)} sub="Baris item dilepas yang ber-HPP" />
      </div>
      <Tabs value={by} onChange={setBy} items={[{ key: 'product', label: 'Produk' }, { key: 'brand', label: 'Brand' }, { key: 'category', label: 'Kategori' }, { key: 'listing', label: 'Listing' }]} />
      {withProfit.length > 0 && (
        <div className="g2">
          <Panel title="Laba kotor tertinggi"><BarList rows={[...withProfit].sort((a, b) => b.profit! - a.profit!)} max={8} label={(r) => r.label} value={(r) => r.profit!} format={rpShort} sub={(r) => `margin ${pct(r.margin)}`} /></Panel>
          <Panel title="Margin terendah" sub="Min. 5 unit dilepas"><BarList rows={withProfit.filter((r) => r.settledUnits >= 5).sort((a, b) => a.margin! - b.margin!)} max={8} label={(r) => r.label} value={(r) => r.margin!} format={(v) => pct(v)} sub={(r) => rpShort(r.profit)} /></Panel>
        </div>
      )}
      <DataTable rows={p.rows} cols={cols} initialSort={{ key: 'g', dir: -1 }} csvName={`profit-${by}-${filter.from}-${filter.to}`} />
    </>
  );
}
