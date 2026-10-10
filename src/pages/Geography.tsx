import { useMemo, useState } from 'react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { BarList } from '../components/charts';
import { Chips, DataTable, MiniBar, PageHead, Panel, num, pct, rp, rpShort, type Col } from '../components/ui';
import { salesBy, type DimRow } from '../lib/metrics/analytics';

export default function Geography() {
  const { ix, filter } = useData();
  const [lvl, setLvl] = useState<'province' | 'city'>('province');
  const prov = useMemo(() => salesBy(ix, filter, 'province'), [ix, filter]);
  const rows = useMemo(() => (lvl === 'province' ? prov : salesBy(ix, filter, 'city')), [ix, filter, lvl, prov]);
  const cols: Col<DimRow>[] = [
    { key: 'l', label: lvl === 'province' ? 'Provinsi' : 'Kota/Kabupaten', value: (r) => r.label, render: (r) => <><b>{r.label}</b>{r.sub && <div className="sub">{r.sub}</div>}</> },
    { key: 'g', label: 'GMV', num: true, value: (r) => r.gmv, render: (r) => rp(r.gmv), total: (rs) => rp(rs.reduce((t, r) => t + r.gmv, 0)) },
    { key: 's', label: 'Porsi', num: true, value: (r) => r.share, render: (r) => <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}><MiniBar v={r.share / (rows[0]?.share || 1)} />{pct(r.share)}</div> },
    { key: 'o', label: 'Pesanan', num: true, value: (r) => r.orders, render: (r) => num(r.orders), total: (rs) => num(rs.reduce((t, r) => t + r.orders, 0)) },
    { key: 'b', label: 'Pembeli', num: true, value: (r) => r.buyers, render: (r) => num(r.buyers) },
    { key: 'a', label: 'GMV/pesanan', num: true, value: (r) => r.aov, render: (r) => rp(r.aov) },
    { key: 'u', label: 'Unit', num: true, value: (r) => r.units, render: (r) => num(r.units) },
  ];
  const top3 = prov.slice(0, 3).reduce((t, r) => t + r.share, 0);
  return (
    <>
      <PageHead eyebrow="Analitik" title="Distribusi Geografis" />
      <FilterBar />
      <div className="g2">
        <Panel title="GMV per provinsi" sub={`${num(prov.length)} provinsi · 3 teratas = ${pct(top3)} GMV`}>
          <BarList rows={prov} max={12} label={(r) => r.label} value={(r) => r.gmv} format={rpShort} sub={(r) => `${num(r.orders)} pesanan`} />
        </Panel>
        <Panel title="Rata-rata nilai pesanan per provinsi" sub="Provinsi dengan ≥ 20 pesanan">
          <BarList rows={prov.filter((r) => r.orders >= 20).sort((a, b) => (b.aov ?? 0) - (a.aov ?? 0))} max={12} label={(r) => r.label} value={(r) => r.aov ?? 0} format={rp} sub={(r) => `${num(r.orders)} pesanan`} />
        </Panel>
      </div>
      <Chips value={lvl} onChange={setLvl} items={[{ key: 'province', label: 'Provinsi' }, { key: 'city', label: 'Kota/Kabupaten' }]} />
      <div style={{ height: 10 }} />
      <DataTable rows={rows} cols={cols} initialSort={{ key: 'g', dir: -1 }} csvName={`geografi-${lvl}-${filter.from}-${filter.to}`} />
    </>
  );
}
