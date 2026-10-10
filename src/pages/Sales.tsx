import { useMemo, useState } from 'react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { BarList } from '../components/charts';
import { DataTable, Info, MiniBar, PageHead, Panel, Tabs, maskName, num, pct, rp, rpShort, type Col } from '../components/ui';
import { salesBy, salesSummary, UNMAPPED, type Dim, type DimRow } from '../lib/metrics/analytics';

const TABS: { key: Dim; label: string }[] = [
  { key: 'product', label: 'Produk' }, { key: 'listing', label: 'Listing & variasi' }, { key: 'brand', label: 'Brand' },
  { key: 'category', label: 'Kategori' }, { key: 'customer', label: 'Pelanggan' },
];

export default function Sales() {
  const { ix, filter, mask } = useData();
  const [dim, setDim] = useState<Dim>('product');
  const rows = useMemo(() => salesBy(ix, filter, dim), [ix, filter, dim]);
  const s = useMemo(() => salesSummary(ix, filter), [ix, filter]);
  const unmapped = rows.find((r) => r.key === UNMAPPED);
  const label = (r: DimRow) => (dim === 'customer' ? maskName(r.label, mask) : r.label);

  const cols: Col<DimRow>[] = [
    { key: 'label', label: TABS.find((t) => t.key === dim)!.label, value: (r) => label(r), className: 'wrap', render: (r) => <><div style={{ fontWeight: 700 }}>{label(r)}</div>{r.sub && <div className="sub">{r.sub}</div>}</> },
    { key: 'gmv', label: 'GMV', num: true, value: (r) => r.gmv, render: (r) => rp(r.gmv), total: (rs) => rp(rs.reduce((t, r) => t + r.gmv, 0)) },
    { key: 'share', label: 'Porsi', num: true, value: (r) => r.share, render: (r) => <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><MiniBar v={r.share / (rows[0]?.share || 1)} />{pct(r.share)}</div> },
    { key: 'units', label: 'Unit', num: true, value: (r) => r.units, render: (r) => num(r.units), total: (rs) => num(rs.reduce((t, r) => t + r.units, 0)) },
    { key: 'orders', label: 'Pesanan', num: true, value: (r) => r.orders, render: (r) => num(r.orders) },
    ...(dim !== 'customer' ? [{ key: 'buyers', label: 'Pembeli', num: true, value: (r: DimRow) => r.buyers, render: (r: DimRow) => num(r.buyers) }] : []),
    { key: 'aov', label: dim === 'customer' ? 'Rata-rata/pesanan' : 'GMV/pesanan', num: true, value: (r) => r.aov, render: (r) => rp(r.aov) },
    { key: 'ret', label: 'Qty dikembalikan', num: true, value: (r) => r.returnedQty, render: (r) => (r.returnedQty ? num(r.returnedQty) : <span className="muted">0</span>) },
  ];

  return (
    <>
      <PageHead eyebrow="Analitik" title="Penjualan" />
      <FilterBar />
      <Tabs value={dim} onChange={setDim} items={TABS} />
      {(dim === 'brand' || dim === 'category') && unmapped && (
        <div className="info-box" style={{ marginBottom: 14 }}>{pct(unmapped.share)} GMV belum dipetakan ke produk master. Lengkapi di menu Master Produk & HPP agar brand/kategori akurat.</div>
      )}
      <div className="g21">
        <Panel title={`Top ${TABS.find((t) => t.key === dim)!.label.toLowerCase()}`} sub={`Total GMV ${rpShort(s.gmv)} · ${num(s.orders)} pesanan`}>
          <BarList rows={rows} max={12} label={label} value={(r) => r.gmv} format={rpShort} sub={(r) => `${num(r.units)} unit`} />
        </Panel>
        <Panel title="Catatan perhitungan" sub="Item vs pesanan">
          <div style={{ fontSize: 13, color: '#4e5751', lineHeight: 1.7 }}>
            <p style={{ marginTop: 0 }}>GMV produk = Σ <b>Subtotal Pesanan</b> per baris item. Pesanan multi-item dipecah per item, sehingga jumlah pesanan antar produk tidak dapat dijumlahkan.</p>
            <p>SKU Induk & Nomor Referensi SKU kosong di export Shopee toko ini, jadi produk dikenali dari <b>nama listing + variasi</b> dan dipetakan ke produk master.</p>
            <p style={{ marginBottom: 0 }}>Username pelanggan {mask ? 'disamarkan' : 'ditampilkan penuh'} <Info>Atur di Pengaturan. Data asli tetap hanya di browser ini.</Info></p>
          </div>
        </Panel>
      </div>
      <DataTable rows={rows} cols={cols} initialSort={{ key: 'gmv', dir: -1 }} csvName={`penjualan-${dim}-${filter.from}-${filter.to}`} tall />
    </>
  );
}
