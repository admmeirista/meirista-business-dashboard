import { useMemo, useState } from 'react';
import { Users, Repeat, UserPlus, Crown } from 'lucide-react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { CohortTable } from '../components/charts';
import { DataTable, Kpi, PageHead, Panel, maskName, num, pct, rp, rpShort, type Col } from '../components/ui';
import { retention, rfm, SEGMENTS, type RfmRow } from '../lib/metrics/analytics';

const SEG_DESC: Record<string, string> = {
  Champions: 'Baru membeli, sering, nilai tinggi',
  Loyal: 'Rutin membeli',
  Potensial: 'Baru membeli lagi, frekuensi belum tinggi',
  Baru: 'Pembelian pertama, baru-baru ini',
  'Perlu perhatian': 'Aktivitas menurun',
  Berisiko: 'Dulu sering, lama tidak membeli',
  Hibernasi: 'Sekali beli, sudah lama',
};

export default function Customers() {
  const { ix, filter, mask } = useData();
  const [seg, setSeg] = useState<string | null>(null);
  const rows = useMemo(() => rfm(ix, filter), [ix, filter]);
  const ret = useMemo(() => retention(ix, filter), [ix, filter]);
  const segs = SEGMENTS.map((s) => ({ s, n: rows.filter((r) => r.segment === s).length, m: rows.filter((r) => r.segment === s).reduce((t, r) => t + r.monetary, 0) }));
  const view = seg ? rows.filter((r) => r.segment === seg) : rows;
  const newB = ret.monthly.reduce((t, m) => t + m.newBuyers, 0);

  const cols: Col<RfmRow>[] = [
    { key: 'buyer', label: 'Pembeli', value: (r) => maskName(r.buyer, mask), render: (r) => <span className="mono">{maskName(r.buyer, mask)}</span> },
    { key: 'seg', label: 'Segmen', value: (r) => r.segment, render: (r) => <span className={`tag ${r.segment === 'Champions' || r.segment === 'Loyal' ? 'ok' : r.segment === 'Berisiko' || r.segment === 'Hibernasi' ? 'warn' : 'info'}`}>{r.segment}</span> },
    { key: 'rfm', label: 'R-F-M', value: (r) => r.r * 100 + r.f * 10 + r.m, render: (r) => <span className="mono">{r.r}-{r.f}-{r.m}</span> },
    { key: 'rec', label: 'Hari sejak beli', num: true, value: (r) => r.recencyDays, render: (r) => num(r.recencyDays) },
    { key: 'freq', label: 'Pesanan', num: true, value: (r) => r.frequency, render: (r) => num(r.frequency) },
    { key: 'mon', label: 'GMV', num: true, value: (r) => r.monetary, render: (r) => rp(r.monetary) },
    { key: 'first', label: 'Pertama', value: (r) => r.first },
    { key: 'last', label: 'Terakhir', value: (r) => r.last },
  ];

  return (
    <>
      <PageHead eyebrow="Analitik" title="Pelanggan, Retensi & RFM" />
      <FilterBar />
      <div className="kpis">
        <Kpi dark icon={<Users className="ic" />} label="Pembeli unik" value={num(ret.buyers)} sub="Username pada rentang" />
        <Kpi icon={<Repeat className="ic" />} label="Repeat buyer" value={pct(ret.repeatRate)} sub={`${num(ret.repeatBuyers)} pembeli > 1 pesanan`} formula="Pembeli dengan ≥ 2 pesanan pada rentang ÷ pembeli unik." />
        <Kpi icon={<UserPlus className="ic" />} label="Pembeli baru" value={num(newB)} sub="Pesanan pertama di data yang diimport" formula="Pembeli baru = bulan pesanan pertamanya (di seluruh data yang diimport) sama dengan bulan pesanan. Riwayat sebelum data pertama tidak diketahui." />
        <Kpi icon={<Crown className="ic" />} label="Champions + Loyal" value={num(segs[0].n + segs[1].n)} sub={`${rpShort(segs[0].m + segs[1].m)} GMV`} />
      </div>
      <div className="g2">
        <Panel title="Pembeli baru vs kembali per bulan">
          <DataTable rows={ret.monthly} pageSize={24} cols={[
            { key: 'm', label: 'Bulan', value: (r) => r.month },
            { key: 'n', label: 'Baru', num: true, value: (r) => r.newBuyers, render: (r) => num(r.newBuyers) },
            { key: 'r', label: 'Kembali', num: true, value: (r) => r.returning, render: (r) => num(r.returning) },
            { key: 'p', label: '% kembali', num: true, value: (r) => r.returning / ((r.newBuyers + r.returning) || 1), render: (r) => pct(r.returning / ((r.newBuyers + r.returning) || 1)) },
            { key: 'o', label: 'Pesanan', num: true, value: (r) => r.orders, render: (r) => num(r.orders) },
          ]} />
        </Panel>
        <Panel title="Kohort retensi" sub="% pembeli bulan pertama yang membeli lagi di bulan ke-n">
          <CohortTable rows={ret.cohortRows} />
        </Panel>
      </div>
      <div className="sect">Segmen RFM <span className="muted" style={{ fontWeight: 600, fontSize: 12.5 }}>— skor 1–5 per kuintil; klik untuk memfilter</span></div>
      <div className="seg-grid">
        {segs.map((x) => (
          <button key={x.s} className={`seg${seg === x.s ? ' on' : ''}`} onClick={() => setSeg(seg === x.s ? null : x.s)}>
            <div className="l">{x.s}</div><div className="n">{num(x.n)}</div><div className="muted" style={{ fontSize: 11.5 }}>{SEG_DESC[x.s]}</div>
          </button>
        ))}
      </div>
      <DataTable rows={view} cols={cols} initialSort={{ key: 'mon', dir: -1 }} csvName={`rfm-${filter.from}-${filter.to}`} />
    </>
  );
}
