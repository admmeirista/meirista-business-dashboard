import { useMemo, useState } from 'react';
import { Users, Repeat, UserPlus } from 'lucide-react';
import { useData } from '../data';
import { CohortTable } from '../components/charts';
import { DataTable, Delta, Kpi, Panel, maskName, num, pct, rp, rpShort, type Col } from '../components/ui';
import { retention, rfm, SEGMENTS, type RfmRow } from '../lib/metrics/analytics';
import { orderDate } from '../lib/metrics/dataset';

const SEG: Record<string, { desc: string; action: string }> = {
  Champions: { desc: 'Baru beli, sering, belanja besar', action: 'Pertahankan — beri prioritas & bonus' },
  Loyal: { desc: 'Rutin membeli', action: 'Tawarkan paket / bundling' },
  Potensial: { desc: 'Baru beli lagi', action: 'Dorong pembelian berikutnya' },
  Baru: { desc: 'Pembelian pertama baru-baru ini', action: 'Pastikan pengalaman pertama baik' },
  'Perlu perhatian': { desc: 'Aktivitas mulai turun', action: 'Kirim voucher pengingat' },
  Berisiko: { desc: 'Dulu sering, kini lama tidak beli', action: 'Ajak kembali dengan promo' },
  Hibernasi: { desc: 'Sekali beli, sudah lama', action: 'Prioritas rendah' },
};

export function CustomersPanel() {
  const { ix, filter, prev, mask } = useData();
  const [seg, setSeg] = useState<string | null>(null);
  const rows = useMemo(() => rfm(ix, filter), [ix, filter]);
  const ret = useMemo(() => retention(ix, filter), [ix, filter]);
  const retPrev = useMemo(() => retention(ix, prev), [ix, prev]);
  const allMonths = useMemo(() => new Set(ix.ds.orders.map((o) => orderDate(ix, o, filter.basis)?.slice(0, 7)).filter(Boolean)).size, [ix, filter.basis]);
  const segs = SEGMENTS.map((s) => { const r = rows.filter((x) => x.segment === s); return { s, n: r.length, m: r.reduce((t, x) => t + x.monetary, 0) }; });
  const view = seg ? rows.filter((r) => r.segment === seg) : rows;
  const newB = ret.monthly.reduce((t, m) => t + m.newBuyers, 0);

  const cols: Col<RfmRow>[] = [
    { key: 'b', label: 'Pembeli', value: (r) => maskName(r.buyer, mask), render: (r) => <span className="mono">{maskName(r.buyer, mask)}</span> },
    { key: 's', label: 'Segmen', value: (r) => r.segment, render: (r) => <span className={`tag ${r.segment === 'Champions' || r.segment === 'Loyal' ? 'ok' : r.segment === 'Berisiko' ? 'warn' : ''}`}>{r.segment}</span> },
    { key: 'f', label: 'Pesanan', num: true, value: (r) => r.frequency, render: (r) => num(r.frequency) },
    { key: 'm', label: 'Total belanja', num: true, value: (r) => r.monetary, render: (r) => rp(r.monetary) },
    { key: 'l', label: 'Terakhir beli', value: (r) => r.last, render: (r) => `${r.last} (${r.recencyDays} hari lalu)` },
  ];

  return (
    <>
      <div className="kpis">
        <Kpi dark icon={<Users className="ic" />} label="Pembeli" value={num(ret.buyers)} sub={<Delta dark now={ret.buyers} before={retPrev.buyers || null} />} />
        <Kpi icon={<Repeat className="ic" />} label="Membeli lagi" value={pct(ret.repeatRate)} sub={<div className="hint">{num(ret.repeatBuyers)} pembeli beli ≥ 2× di periode ini</div>} formula="Pembeli dengan ≥ 2 pesanan pada periode ÷ jumlah pembeli." />
        <Kpi icon={<UserPlus className="ic" />} label="Pembeli baru" value={num(newB)} sub={<div className="hint">{pct(newB / (ret.buyers || 1))} dari pembeli periode ini</div>} formula="Pembeli yang pesanan pertamanya (di seluruh data yang diimport) jatuh di periode ini. Riwayat sebelum data pertama tidak diketahui." />
      </div>
      <div className="sect" style={{ marginTop: 6 }}>Kelompok pembeli <span className="muted" style={{ fontWeight: 600, fontSize: 12.5 }}>— klik untuk melihat daftarnya</span></div>
      <div className="seg-grid">
        {segs.filter((x) => x.n).map((x) => (
          <button key={x.s} className={`seg${seg === x.s ? ' on' : ''}`} onClick={() => setSeg(seg === x.s ? null : x.s)}>
            <div className="l">{x.s}</div><div className="n">{num(x.n)}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{SEG[x.s].desc} · {rpShort(x.m)}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--acc-ink)', marginTop: 4 }}>{SEG[x.s].action}</div>
          </button>
        ))}
      </div>
      <DataTable rows={view} cols={cols} pageSize={25} initialSort={{ key: 'm', dir: -1 }} csvName={`pelanggan-${filter.from}-${filter.to}`} />
      {allMonths >= 3 && (
        <>
          <div style={{ height: 14 }} />
          <Panel title="Retensi per bulan pertama beli" sub="% pembeli yang kembali membeli n bulan kemudian">
            <CohortTable rows={ret.cohortRows} />
          </Panel>
        </>
      )}
    </>
  );
}
