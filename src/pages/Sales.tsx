import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Crown, Layers, MapPin, Map as MapIcon, Building2, Globe2, Banknote, CreditCard, Wallet, Undo2, Boxes, PieChart } from 'lucide-react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { DataTable, Delta, Kpi, MiniBar, PageHead, Tabs, num, pct, rp, rpShort, type Col } from '../components/ui';
import { returnState, salesBy, UNMAPPED, type Dim, type DimRow } from '../lib/metrics/analytics';
import { ordersIn } from '../lib/metrics/dataset';
import { CustomersPanel } from './Customers';
import { ProfitPanel } from './Profitability';
import { CancellationsPanel } from './Cancellations';

type Tab = 'product' | 'location' | 'payment' | 'customer' | 'cancel' | 'profit';
type ProdDim = 'product' | 'brand' | 'category';
const TABS: { key: Tab; label: string }[] = [
  { key: 'product', label: 'Produk' },
  { key: 'location', label: 'Lokasi' },
  { key: 'payment', label: 'Pembayaran' },
  { key: 'cancel', label: 'Pembatalan' },
  { key: 'customer', label: 'Pelanggan' },
  { key: 'profit', label: 'Laba' },
];
const DIM_LABEL: Record<ProdDim, string> = { product: 'Produk', brand: 'Brand', category: 'Kategori' };

export default function Sales() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  // Tautan lama ?tab=brand / ?tab=category membuka tab Produk dengan tampilan yang sesuai.
  const legacy = raw === 'brand' || raw === 'category' ? raw : null;
  const tab = (legacy ? 'product' : TABS.find((t) => t.key === raw)?.key ?? 'product') as Tab;
  const by = (legacy ?? (['product', 'brand', 'category'].includes(params.get('by') ?? '') ? params.get('by') : 'product')) as ProdDim;
  return (
    <>
      <PageHead eyebrow="Performa toko" title="Penjualan" actions={<FilterBar />} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} items={TABS} />
      {tab === 'cancel' ? <CancellationsPanel /> : tab === 'customer' ? <CustomersPanel /> : tab === 'profit' ? <ProfitPanel />
        : tab === 'location' ? <LocationPanel /> : tab === 'payment' ? <PaymentPanel />
        : <ProductPanel by={by} setBy={(b) => setParams({ tab: 'product', by: b })} />}
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

function usePrevRows(dim: Dim) {
  const { ix, prev } = useData();
  return useMemo(() => salesBy(ix, prev, dim), [ix, prev, dim]);
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

const Name = ({ children }: { children: string }) => <span className="kname" title={children}>{children}</span>;
const total = (rows: { gmv: number }[]) => rows.reduce((s, r) => s + r.gmv, 0);

/** Produk, Brand, Kategori dalam satu tab (pilih tampilan seperti di Lokasi). */
function ProductPanel({ by, setBy }: { by: ProdDim; setBy: (b: ProdDim) => void }) {
  const { ix, filter } = useData();
  const products = useRows('product'), brands = useRows('brand'), categories = useRows('category');
  const prevRows = usePrevRows(by);
  const counts = { product: products.length, brand: brands.filter((r) => r.key !== UNMAPPED).length, category: categories.filter((r) => r.key !== UNMAPPED).length };
  const rows = by === 'product' ? products : by === 'brand' ? brands : categories;
  const mapped = rows.filter((r) => r.key !== UNMAPPED);
  const unmapped = rows.find((r) => r.key === UNMAPPED);
  const lead = mapped[0];
  const units = rows.reduce((s, r) => s + r.units, 0), unitsPrev = prevRows.reduce((s, r) => s + r.units, 0);
  const top5 = mapped.slice(0, 5).reduce((s, r) => s + r.share, 0);
  const label = DIM_LABEL[by].toLowerCase();
  return (
    <>
      <div className="kpis">
        <Kpi dark icon={<Crown className="ic" />} label={`${DIM_LABEL[by]} teratas`} value={lead ? <Name>{lead.label}</Name> : <span className="na">–</span>}
          sub={lead && <div className="hint">{rpShort(lead.gmv)} · {pct(lead.share)} omzet</div>} />
        <Kpi icon={<Boxes className="ic" />} label="Unit terjual" value={num(units)} sub={<><div className="hint">rata-rata {num(units / (mapped.length || 1))} unit per {label}</div><Delta now={units} before={unitsPrev || null} /></>} />
        <Kpi icon={<Layers className="ic" />} label={`${DIM_LABEL[by]} terjual`} value={num(mapped.length)}
          sub={<div className="hint">rata-rata {rpShort(total(mapped) / (mapped.length || 1))} per {label}</div>}
          formula={by === 'product' ? 'Jumlah produk (nama listing + variasi, atau produk master bila sudah dipetakan) yang terjual minimal 1 unit.' : `Jumlah ${label} yang terjual; listing yang belum dipetakan tidak dihitung.`} />
        <Kpi icon={<PieChart className="ic" />} label="Porsi 5 teratas" value={pct(top5)} sub={<div className="hint">{top5 > 0.6 ? 'penjualan terpusat' : top5 > 0.35 ? 'cukup terpusat' : 'penjualan tersebar'}</div>}
          formula={`Omzet 5 ${label} teratas ÷ omzet semua ${label}.`} />
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="chips">
          {(['product', 'brand', 'category'] as ProdDim[]).map((d) => <button key={d} className={by === d ? 'on' : ''} onClick={() => setBy(d)}>Per {DIM_LABEL[d].toLowerCase()} ({num(counts[d])})</button>)}
        </div>
        {(unmapped || !ix.ds.mappings.length) && (
          <span className="muted" style={{ fontSize: 12.5 }}>
            {by === 'product' ? 'Listing yang belum dipetakan tampil per nama listing + variasi.' : `${pct(unmapped?.share ?? 1)} omzet belum punya ${label}.`} <Link to="/master">Petakan di Produk & HPP</Link>
          </span>
        )}
      </div>
      <DataTable key={by} rows={rows} cols={columns(rows, DIM_LABEL[by], { units: true })} initialSort={{ key: 'g', dir: -1 }} csvName={`penjualan-${by}-${filter.from}-${filter.to}`} tall />
    </>
  );
}

const JAWA = /jawa|jakarta|yogya|banten/i;

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
  const tp = provinces[0], tc = all[0];
  const outside = provinces.filter((r) => !JAWA.test(r.label));
  const outsideShare = outside.reduce((s, r) => s + r.share, 0);
  return (
    <>
      <div className="kpis">
        <Kpi dark icon={<MapPin className="ic" />} label="Provinsi teratas" value={tp ? <Name>{tp.label}</Name> : <span className="na">–</span>} sub={tp && <div className="hint">{rpShort(tp.gmv)} · {pct(tp.share)} omzet</div>} />
        <Kpi icon={<Building2 className="ic" />} label="Kota teratas" value={tc ? <Name>{tc.label}</Name> : <span className="na">–</span>} sub={tc && <div className="hint">{tc.sub} · {pct(tc.share)} omzet</div>} />
        <Kpi icon={<MapIcon className="ic" />} label="Jangkauan" value={`${num(provinces.length)} provinsi`} sub={<div className="hint">{num(all.length)} kota/kabupaten</div>} />
        <Kpi icon={<Globe2 className="ic" />} label="Luar Pulau Jawa" value={pct(outsideShare)} sub={<div className="hint">{num(outside.reduce((s, r) => s + r.orders, 0))} pesanan dari {num(outside.length)} provinsi</div>}
          formula="Porsi omzet dari provinsi di luar DKI Jakarta, Jawa Barat, Jawa Tengah, DI Yogyakarta, Jawa Timur, dan Banten." />
      </div>
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

const isCod = (s: string) => /cod|bayar di tempat/i.test(s);

function PaymentPanel() {
  const { ix, filter } = useData();
  const rows = useRows('payment');
  const hasRet = ix.ds.returns.length > 0;
  const part = (cod: boolean) => {
    const rs = rows.filter((r) => isCod(r.key) === cod);
    const gmv = total(rs), orders = rs.reduce((s, r) => s + r.orders, 0);
    const returned = rs.reduce((s, r) => s + (r.returnRate ?? 0) * r.orders, 0);
    return { rows: rs, gmv, orders, share: rs.reduce((s, r) => s + r.share, 0), aov: orders ? gmv / orders : null, returnRate: orders ? returned / orders : null };
  };
  const cod = part(true), non = part(false);
  const topNon = non.rows[0];
  return (
    <>
      <div className="kpis">
        <Kpi dark icon={<Banknote className="ic" />} label="COD" value={pct(cod.share)} sub={<div className="hint">{num(cod.orders)} pesanan · {rpShort(cod.aov)} per pesanan</div>} formula="Porsi omzet dari pesanan bayar di tempat (COD)." />
        <Kpi icon={<CreditCard className="ic" />} label="Non-COD" value={pct(non.share)} sub={<div className="hint">{num(non.orders)} pesanan · {rpShort(non.aov)} per pesanan</div>} formula="Porsi omzet dari pesanan yang dibayar di muka (ShopeePay, SPayLater, transfer, kartu, dll.)." />
        <Kpi icon={<Wallet className="ic" />} label="Non-COD teratas" value={topNon ? <Name>{topNon.label}</Name> : <span className="na">–</span>} sub={topNon && <div className="hint">{pct(topNon.share)} omzet · {num(topNon.orders)} pesanan</div>} />
        <Kpi icon={<Undo2 className="ic" />} label="Retur COD" value={hasRet ? pct(cod.returnRate, 2) : <span className="na">–</span>}
          sub={<div className="hint">{hasRet ? <>non-COD {pct(non.returnRate, 2)}</> : 'import laporan Pengembalian'}</div>}
          formula="Pesanan COD periode ini yang punya pengajuan pengembalian ÷ pesanan COD. Dibandingkan dengan pesanan non-COD." />
      </div>
      <DataTable rows={rows} cols={columns(rows, 'Metode pembayaran', { returns: hasRet })} initialSort={{ key: 'g', dir: -1 }} csvName={`penjualan-payment-${filter.from}-${filter.to}`} tall />
    </>
  );
}
