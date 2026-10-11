import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useData } from '../data';
import { FilterBar, periodLabel } from '../components/FilterBar';
import { AiButton } from '../components/Ai';
import { DataTable, MiniBar, PageHead, Tabs, num, pct, rp, type Col } from '../components/ui';
import { returnState, salesBy, UNMAPPED, type Dim, type DimRow } from '../lib/metrics/analytics';
import { ordersIn } from '../lib/metrics/dataset';
import { AI_TASK, aiPayload } from '../lib/metrics/summary';
import { CustomersPanel } from './Customers';
import { ProfitPanel } from './Profitability';

type Tab = 'product' | 'brand' | 'category' | 'location' | 'payment' | 'customer' | 'profit';
const TABS: { key: Tab; label: string }[] = [
  { key: 'product', label: 'Produk' },
  { key: 'brand', label: 'Brand' },
  { key: 'category', label: 'Kategori' },
  { key: 'location', label: 'Lokasi' },
  { key: 'payment', label: 'Pembayaran' },
  { key: 'customer', label: 'Pelanggan' },
  { key: 'profit', label: 'Laba' },
];

export default function Sales() {
  const { ix, filter, prev } = useData();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'product') as Tab;
  return (
    <>
      <PageHead eyebrow="Penjualan" title="Apa yang laku, di mana, dan oleh siapa?" actions={
        <AiButton cacheKey={`sales|${filter.from}|${filter.to}|${prev.from}`} title={`Analisis AI penjualan — ${periodLabel(filter)}`} task={AI_TASK.sales}
          build={() => aiPayload(ix, filter, prev, periodLabel(filter), periodLabel(prev), 'sales')} />
      } />
      <FilterBar />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} items={TABS} />
      {tab === 'customer' ? <CustomersPanel /> : tab === 'profit' ? <ProfitPanel /> : tab === 'location' ? <LocationPanel /> : <DimPanel dim={tab} />}
    </>
  );
}

type Row = DimRow & { before: number | null; returnRate: number | null };

function useRows(dim: Dim, onlyProvince?: string) {
  const { ix, filter, prev } = useData();
  return useMemo<Row[]>(() => {
    const before = new Map(salesBy(ix, prev, dim).map((r) => [r.key, r.gmv]));
    let ret: Map<string, number> | null = null;
    if (dim === 'payment' && ix.ds.returns.length) {
      ret = new Map();
      for (const o of ordersIn(ix, filter)) if ((ix.returnsByOrder.get(o.orderNo) ?? []).some((r) => returnState(r) !== 'VOID')) ret.set(o.paymentMethod, (ret.get(o.paymentMethod) ?? 0) + 1);
    }
    let rows = salesBy(ix, filter, dim);
    if (onlyProvince) {
      rows = rows.filter((r) => r.sub === onlyProvince);
      const tot = rows.reduce((s, r) => s + r.gmv, 0);
      rows = rows.map((r) => ({ ...r, share: tot ? r.gmv / tot : 0 }));
    }
    return rows.map((r) => ({ ...r, before: before.get(r.key) ?? null, returnRate: ret ? (ret.get(r.key) ?? 0) / (r.orders || 1) : null }));
  }, [ix, filter, prev, dim, onlyProvince]);
}

function columns(rows: Row[], first: string, opts: { units?: boolean; returns?: boolean; sub?: boolean }): Col<Row>[] {
  const top = rows[0]?.share || 1;
  return [
    { key: 'l', label: first, value: (r) => r.label, className: 'wrap', render: (r) => <><div style={{ fontWeight: 700 }}>{r.label}</div>{opts.sub !== false && r.sub && <div className="sub">{r.sub}</div>}</> },
    { key: 'g', label: 'Omzet', num: true, value: (r) => r.gmv, render: (r) => rp(r.gmv), total: (rs) => rp(rs.reduce((s, r) => s + r.gmv, 0)) },
    { key: 's', label: 'Porsi', num: true, value: (r) => r.share, render: (r) => <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><MiniBar v={r.share / top} />{pct(r.share)}</div> },
    { key: 'd', label: 'vs pembanding', num: true, value: (r) => (r.before ? (r.gmv - r.before) / r.before : null), render: (r) => (r.before ? <span className={r.gmv >= r.before ? 'pos' : 'neg'}>{r.gmv >= r.before ? '▲' : '▼'} {pct(Math.abs(r.gmv - r.before) / r.before, 0)}</span> : <span className="muted">baru</span>) },
    { key: 'o', label: 'Pesanan', num: true, value: (r) => r.orders, render: (r) => num(r.orders), total: (rs) => num(rs.reduce((s, r) => s + r.orders, 0)) },
    opts.units
      ? { key: 'u', label: 'Unit', num: true, value: (r) => r.units, render: (r) => num(r.units), total: (rs) => num(rs.reduce((s, r) => s + r.units, 0)) }
      : { key: 'a', label: 'Rata-rata/pesanan', num: true, value: (r) => r.aov, render: (r) => rp(r.aov) },
    ...(opts.returns ? [{ key: 'r', label: 'Tingkat retur', num: true, value: (r: Row) => r.returnRate, render: (r: Row) => pct(r.returnRate, 2) }] : []),
  ];
}

function DimPanel({ dim }: { dim: 'product' | 'brand' | 'category' | 'payment' }) {
  const { ix, filter } = useData();
  const rows = useRows(dim);
  const unmapped = rows.find((r) => r.key === UNMAPPED);
  const first = { product: 'Produk', brand: 'Brand', category: 'Kategori', payment: 'Metode pembayaran' }[dim];
  return (
    <>
      {dim !== 'payment' && (unmapped || !ix.ds.mappings.length) && (
        <div className="info-box" style={{ marginBottom: 12, marginTop: 0 }}>
          {dim === 'product' ? 'Listing yang belum dipetakan tampil per nama listing + variasi.' : `${pct(unmapped?.share ?? 1)} omzet belum punya ${dim}.`} <Link to="/master">Petakan di Produk & HPP</Link>
        </div>
      )}
      <DataTable rows={rows} cols={columns(rows, first, { units: dim !== 'payment', returns: dim === 'payment' && ix.ds.returns.length > 0 })} initialSort={{ key: 'g', dir: -1 }} csvName={`penjualan-${dim}-${filter.from}-${filter.to}`} tall />
    </>
  );
}

/** Lokasi: provinsi → klik untuk melihat kota/kabupaten di provinsi tersebut. */
function LocationPanel() {
  const { filter } = useData();
  const [prov, setProv] = useState<string | null>(null);
  const provinces = useRows('province');
  const cities = useRows('city', prov ?? undefined);
  const all = useRows('city');
  const [level, setLevel] = useState<'province' | 'city'>('province');
  const showCities = level === 'city' || !!prov;
  const rows = prov ? cities : level === 'city' ? all : provinces;
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        {prov ? (
          <>
            <button className="btn sm" onClick={() => setProv(null)}><ChevronLeft className="ic" />Semua provinsi</button>
            <b>{prov}</b><span className="muted">· {num(cities.length)} kota/kabupaten</span>
          </>
        ) : (
          <div className="chips">
            <button className={level === 'province' ? 'on' : ''} onClick={() => setLevel('province')}>Per provinsi ({num(provinces.length)})</button>
            <button className={level === 'city' ? 'on' : ''} onClick={() => setLevel('city')}>Per kota/kabupaten ({num(all.length)})</button>
          </div>
        )}
        {!showCities && <span className="muted" style={{ fontSize: 12.5 }}>Klik provinsi untuk melihat kotanya.</span>}
      </div>
      <DataTable rows={rows} cols={columns(rows, showCities ? 'Kota/Kabupaten' : 'Provinsi', { sub: !prov })} initialSort={{ key: 'g', dir: -1 }}
        onRowClick={!showCities ? (r) => setProv(r.label) : undefined} csvName={`lokasi-${prov ?? level}-${filter.from}-${filter.to}`} tall />
    </>
  );
}
