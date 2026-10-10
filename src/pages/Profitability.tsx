import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Wallet, Boxes } from 'lucide-react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { DataTable, Kpi, PageHead, Tabs, num, pct, rp, rpShort, type Col } from '../components/ui';
import { profitability, type ProfitRow } from '../lib/metrics/analytics';

type By = 'product' | 'brand' | 'category';

export default function Profitability() {
  const { ix, filter } = useData();
  const [by, setBy] = useState<By>('product');
  const p = useMemo(() => profitability(ix, filter, by), [ix, filter, by]);
  const t = p.totals;
  const na = <span className="na" title="HPP belum diisi — tidak dianggap 0">–</span>;
  const cols: Col<ProfitRow>[] = [
    { key: 'l', label: { product: 'Produk', brand: 'Brand', category: 'Kategori' }[by], value: (r) => r.label, className: 'wrap', render: (r) => <><b>{r.label}</b>{r.sub && <div className="sub">{r.sub}</div>}</> },
    { key: 'n', label: 'Dana diterima', num: true, value: (r) => r.netSettled, render: (r) => (r.settledUnits ? rp(r.netSettled) : <span className="muted">belum dilepas</span>) },
    { key: 'c', label: 'HPP', num: true, value: (r) => r.cogs, render: (r) => (r.cogs === null ? na : rp(r.cogs)) },
    { key: 'p', label: 'Laba kotor', num: true, value: (r) => r.profit, render: (r) => (r.profit === null ? na : <b className={r.profit < 0 ? 'neg' : 'pos'}>{rp(r.profit)}</b>) },
    { key: 'm', label: 'Margin', num: true, value: (r) => r.margin, render: (r) => (r.margin === null ? na : pct(r.margin)) },
    { key: 'u', label: 'Unit', num: true, value: (r) => r.units, render: (r) => num(r.units) },
  ];
  return (
    <>
      <PageHead eyebrow="Keuangan" title="Produk mana yang paling untung?" actions={<Link className="btn" to="/master"><Boxes className="ic" />Isi HPP</Link>} />
      <FilterBar />
      {t.coverage !== null && t.coverage < 1 && (
        <div className="info-box" style={{ marginBottom: 14, marginTop: 0 }}>
          {t.coverage ? `HPP baru tersedia untuk ${pct(t.coverage, 0)} item terjual.` : 'Belum ada HPP produk.'} Laba hanya dihitung untuk produk yang sudah punya HPP. <Link to="/master">Lengkapi HPP</Link>
        </div>
      )}
      <div className="kpis">
        <Kpi dark icon={<TrendingUp className="ic" />} label="Laba kotor" value={t.coverage ? rpShort(t.profit) : <span className="na">–</span>} sub={<div className="hint">{t.coverage ? `margin ${pct(t.margin)}` : 'menunggu HPP'}</div>} formula="Dana diterima per item − HPP, hanya item yang sudah dilepas Shopee dan punya HPP." />
        <Kpi icon={<Wallet className="ic" />} label="Dana diterima" value={rpShort(t.net)} sub={<div className="hint">{num(t.settledOrders)} pesanan sudah dilepas · {num(t.unsettledOrders)} belum</div>} formula="Dana per pesanan dibagi ke item sesuai porsi subtotal item." />
        <Kpi icon={<Boxes className="ic" />} label="Total HPP" value={t.coverage ? rpShort(t.cogs) : <span className="na">–</span>} sub={<div className="hint">HPP unit × isi paket × jumlah</div>} />
      </div>
      <Tabs value={by} onChange={setBy} items={[{ key: 'product', label: 'Produk' }, { key: 'brand', label: 'Brand' }, { key: 'category', label: 'Kategori' }]} />
      <DataTable rows={p.rows} cols={cols} initialSort={{ key: t.coverage ? 'p' : 'n', dir: -1 }} csvName={`laba-${by}-${filter.from}-${filter.to}`} />
    </>
  );
}
