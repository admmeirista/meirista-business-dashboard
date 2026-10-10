import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { DataTable, MiniBar, PageHead, Tabs, num, pct, rp, type Col } from '../components/ui';
import { returnState, salesBy, UNMAPPED, type Dim, type DimRow } from '../lib/metrics/analytics';
import { ordersIn } from '../lib/metrics/dataset';

type Tab = 'product' | 'brand' | 'category' | 'province' | 'city' | 'payment';
const TABS: { key: Tab; label: string; col: string }[] = [
  { key: 'product', label: 'Produk', col: 'Produk' },
  { key: 'brand', label: 'Brand', col: 'Brand' },
  { key: 'category', label: 'Kategori', col: 'Kategori' },
  { key: 'province', label: 'Provinsi', col: 'Provinsi' },
  { key: 'city', label: 'Kota', col: 'Kota/Kabupaten' },
  { key: 'payment', label: 'Pembayaran', col: 'Metode pembayaran' },
];

type Row = DimRow & { before: number | null; returnRate: number | null };

export default function Sales() {
  const { ix, filter, prev } = useData();
  const [tab, setTab] = useState<Tab>('product');
  const rows = useMemo<Row[]>(() => {
    const before = new Map(salesBy(ix, prev, tab as Dim).map((r) => [r.key, r.gmv]));
    let retByKey: Map<string, number> | null = null;
    if (tab === 'payment' && ix.ds.returns.length) {
      retByKey = new Map();
      for (const o of ordersIn(ix, filter)) if ((ix.returnsByOrder.get(o.orderNo) ?? []).some((r) => returnState(r) !== 'VOID')) retByKey.set(o.paymentMethod, (retByKey.get(o.paymentMethod) ?? 0) + 1);
    }
    return salesBy(ix, filter, tab as Dim).map((r) => ({ ...r, before: before.get(r.key) ?? null, returnRate: retByKey ? (retByKey.get(r.key) ?? 0) / (r.orders || 1) : null }));
  }, [ix, filter, prev, tab]);
  const unmapped = rows.find((r) => r.key === UNMAPPED);
  const top = rows[0]?.share || 1;
  const t = TABS.find((x) => x.key === tab)!;

  const cols: Col<Row>[] = [
    { key: 'l', label: t.col, value: (r) => r.label, className: 'wrap', render: (r) => <><div style={{ fontWeight: 700 }}>{r.label}</div>{r.sub && <div className="sub">{r.sub}</div>}</> },
    { key: 'g', label: 'Omzet', num: true, value: (r) => r.gmv, render: (r) => rp(r.gmv), total: (rs) => rp(rs.reduce((s, r) => s + r.gmv, 0)) },
    { key: 's', label: 'Porsi', num: true, value: (r) => r.share, render: (r) => <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><MiniBar v={r.share / top} />{pct(r.share)}</div> },
    { key: 'd', label: 'vs periode lalu', num: true, value: (r) => (r.before ? (r.gmv - r.before) / r.before : null), render: (r) => (r.before ? <span className={r.gmv >= r.before ? 'pos' : 'neg'}>{r.gmv >= r.before ? '▲' : '▼'} {pct(Math.abs(r.gmv - r.before) / r.before, 0)}</span> : <span className="muted">baru</span>) },
    { key: 'o', label: 'Pesanan', num: true, value: (r) => r.orders, render: (r) => num(r.orders) },
    tab === 'product' || tab === 'brand' || tab === 'category'
      ? { key: 'u', label: 'Unit', num: true, value: (r) => r.units, render: (r) => num(r.units), total: (rs) => num(rs.reduce((s, r) => s + r.units, 0)) }
      : { key: 'a', label: 'Rata-rata/pesanan', num: true, value: (r) => r.aov, render: (r) => rp(r.aov) },
    ...(tab === 'payment' && ix.ds.returns.length ? [{ key: 'r', label: 'Tingkat retur', num: true, value: (r: Row) => r.returnRate, render: (r: Row) => pct(r.returnRate, 2) }] : []),
  ];

  return (
    <>
      <PageHead eyebrow="Penjualan" title="Apa yang laku & di mana?" />
      <FilterBar />
      <Tabs value={tab} onChange={setTab} items={TABS} />
      {(tab === 'brand' || tab === 'category' || tab === 'product') && unmapped && (
        <div className="info-box" style={{ marginBottom: 12, marginTop: 0 }}>
          {pct(unmapped.share)} omzet belum dikelompokkan ke {tab === 'product' ? 'produk' : tab}. <Link to="/master">Petakan di Produk & HPP</Link>.
        </div>
      )}
      {tab === 'product' && !ix.ds.mappings.length && <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Sebelum dipetakan, setiap listing + variasi Shopee tampil sebagai produk tersendiri.</div>}
      <DataTable rows={rows} cols={cols} initialSort={{ key: 'g', dir: -1 }} csvName={`penjualan-${tab}-${filter.from}-${filter.to}`} tall />
    </>
  );
}
