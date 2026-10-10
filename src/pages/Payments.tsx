import { useMemo } from 'react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { BarList, Composition } from '../components/charts';
import { DataTable, PageHead, Panel, num, pct, rp, rpShort, type Col } from '../components/ui';
import { returnState, salesBy } from '../lib/metrics/analytics';
import { day, ordersIn } from '../lib/metrics/dataset';

interface PayRow { key: string; gmv: number; share: number; orders: number; aov: number | null; buyers: number; returned: number; rate: number | null }

export default function Payments() {
  const { ix, filter } = useData();
  const rows = useMemo<PayRow[]>(() => {
    const base = salesBy(ix, filter, 'payment');
    // Tingkat pengembalian per metode: pesanan (dalam rentang) yang memiliki pengajuan bukan batal/ditolak.
    const ret = new Map<string, number>();
    for (const o of ordersIn(ix, filter)) if ((ix.returnsByOrder.get(o.orderNo) ?? []).some((r) => returnState(r) !== 'VOID')) ret.set(o.paymentMethod, (ret.get(o.paymentMethod) ?? 0) + 1);
    return base.map((r) => ({ key: r.key, gmv: r.gmv, share: r.share, orders: r.orders, aov: r.aov, buyers: r.buyers, returned: ret.get(r.key) ?? 0, rate: r.orders ? (ret.get(r.key) ?? 0) / r.orders : null }));
  }, [ix, filter]);
  const ship = useMemo(() => salesBy(ix, filter, 'shipping'), [ix, filter]);
  const hasReturns = ix.ds.returns.length > 0;
  // Hari dalam seminggu × metode (porsi COD).
  const dow = useMemo(() => {
    const names = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const m = names.map((n) => ({ key: n, cod: 0, all: 0 }));
    for (const o of ordersIn(ix, filter)) { const d = day(o.createdAt); if (!d) continue; const e = m[new Date(d + 'T00:00:00').getDay()]; e.all++; if (/COD/i.test(o.paymentMethod)) e.cod++; }
    return m;
  }, [ix, filter]);
  const cols: Col<PayRow>[] = [
    { key: 'k', label: 'Metode pembayaran', value: (r) => r.key, render: (r) => <b>{r.key}</b> },
    { key: 'g', label: 'GMV', num: true, value: (r) => r.gmv, render: (r) => rp(r.gmv), total: (rs) => rp(rs.reduce((t, r) => t + r.gmv, 0)) },
    { key: 's', label: 'Porsi', num: true, value: (r) => r.share, render: (r) => pct(r.share) },
    { key: 'o', label: 'Pesanan', num: true, value: (r) => r.orders, render: (r) => num(r.orders), total: (rs) => num(rs.reduce((t, r) => t + r.orders, 0)) },
    { key: 'a', label: 'GMV/pesanan', num: true, value: (r) => r.aov, render: (r) => rp(r.aov) },
    { key: 'b', label: 'Pembeli', num: true, value: (r) => r.buyers, render: (r) => num(r.buyers) },
    { key: 'r', label: 'Pesanan dg pengembalian', num: true, value: (r) => r.returned, render: (r) => (hasReturns ? num(r.returned) : <span className="na">–</span>) },
    { key: 'rr', label: 'Tingkat pengembalian', num: true, value: (r) => r.rate, render: (r) => (hasReturns ? pct(r.rate, 2) : <span className="na">–</span>) },
  ];
  return (
    <>
      <PageHead eyebrow="Analitik" title="Analisis Metode Pembayaran" />
      <FilterBar />
      <div className="g2">
        <Panel title="Komposisi GMV per metode">
          <Composition rows={rows} label={(r) => r.key} value={(r) => r.gmv} format={rpShort} />
          <div className="sect">Jumlah pesanan</div>
          <BarList rows={[...rows].sort((a, b) => b.orders - a.orders)} label={(r) => r.key} value={(r) => r.orders} format={num} />
        </Panel>
        <Panel title="Porsi COD per hari" sub="Menurut hari pesanan dibuat">
          <BarList rows={dow} max={7} label={(r) => r.key} value={(r) => (r.all ? r.cod / r.all : 0)} format={(v) => pct(v)} sub={(r) => `${num(r.all)} pesanan`} />
          <div className="sect">Jasa kirim</div>
          <BarList rows={ship} max={6} label={(r) => r.label} value={(r) => r.orders} format={num} />
        </Panel>
      </div>
      {!hasReturns && <div className="info-box" style={{ marginBottom: 14 }}>Import laporan Pengembalian untuk melihat tingkat pengembalian per metode pembayaran.</div>}
      <DataTable rows={rows} cols={cols} initialSort={{ key: 'g', dir: -1 }} csvName={`pembayaran-${filter.from}-${filter.to}`} />
    </>
  );
}
