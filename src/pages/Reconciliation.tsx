import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, FileQuestion, Link2, Search } from 'lucide-react';
import { useData } from '../data';
import { CheckTag, DataTable, Kpi, PageHead, Panel, Tabs, checkVal, dt, num, pct, rp, rpShort } from '../components/ui';
import { EXCEPTION_INFO, reconcile, type ExceptionType, type ReconException } from '../lib/metrics/reconcile';
import { RETURN_STATE_LABEL, returnState } from '../lib/metrics/analytics';
import type { StoredCheck } from '../lib/db';

const TAB_ORDER: ExceptionType[] = ['PRICE_DIFF', 'REFUND_DIFF', 'PAID_DIFF', 'FEE_SHEET_DIFF', 'UNSETTLED', 'NO_ORDER', 'ADJUSTMENT', 'SHIPPING_DISCREPANCY'];

export default function Reconciliation() {
  const { ix } = useData();
  const [params, setParams] = useSearchParams();
  const r = useMemo(() => reconcile(ix), [ix]);
  const firstWithData = TAB_ORDER.find((t) => r.counts[t] && EXCEPTION_INFO[t].level !== 'info') ?? 'UNSETTLED';
  const tab = (params.get('tab') as ExceptionType) || firstWithData;
  const [q, setQ] = useState('');
  const [orderNo, setOrderNo] = useState<string | null>(null);

  const settled = r.rows.filter((x) => x.status === 'SETTLED');
  const gmvSettled = settled.reduce((t, x) => t + x.gmv, 0);
  const netSettled = settled.reduce((t, x) => t + (x.settled ?? 0), 0);
  const bad = ix.ds.checks.filter((c) => c.ok === false);
  const toCheck = r.counts.PRICE_DIFF + r.counts.REFUND_DIFF + r.counts.PAID_DIFF + r.counts.FEE_SHEET_DIFF;
  const byScope = useMemo(() => {
    const m = new Map<string, StoredCheck[]>();
    for (const c of ix.ds.checks) (m.get(c.scope) ?? m.set(c.scope, []).get(c.scope)!).push(c);
    return [...m.entries()];
  }, [ix]);
  const ex = r.exceptions.filter((e) => e.type === tab);
  const lastReport = r.latestReportEnd ? `laporan Penghasilan terakhir s/d ${dt(r.latestReportEnd)}` : 'belum ada laporan Penghasilan';

  return (
    <>
      <PageHead eyebrow="Konfigurasi" title="Rekonsiliasi" actions={
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) setOrderNo(q.trim().toUpperCase()); }}>
          <input className="in" placeholder="Cari No. Pesanan" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <button className="btn"><Search className="ic" />Cari</button>
        </form>
      } />

      {bad.length > 0 ? (
        <div className="err-box" style={{ display: 'block', marginBottom: 14, marginTop: 0 }}>
          <b>{bad.length} total di laporan Shopee tidak cocok dengan data detailnya:</b>
          <div className="tablewrap flat" style={{ marginTop: 8 }}>
            <table className="t">
              <thead><tr><th>Laporan</th><th>Pemeriksaan</th><th className="num">Shopee</th><th className="num">Hitung ulang</th><th className="num">Selisih</th></tr></thead>
              <tbody>{bad.map((c) => <tr key={c.id}><td>{c.scope}</td><td>{c.label}</td><td className="num">{checkVal(c.label, c.reported)}</td><td className="num">{checkVal(c.label, c.computed)}</td><td className="num">{checkVal(c.label, c.diff)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      ) : ix.ds.checks.length > 0 && (
        <div className="ok-box" style={{ marginBottom: 14, marginTop: 0 }}><CheckCircle2 className="ic" />Semua {num(ix.ds.checks.filter((c) => c.ok).length)} total di laporan Shopee cocok dengan data detailnya.</div>
      )}

      <div className="kpis">
        <Kpi dark icon={<CheckCircle2 className="ic" />} label="Sudah dilepas" value={num(settled.length)} sub={<div className="hint">{pct(settled.length / (ix.ds.orders.length || 1))} pesanan selesai sudah ada di laporan Penghasilan</div>} formula="Dicocokkan via No. Pesanan ke laporan Penghasilan mana pun yang diimport (lintas periode)." />
        <Kpi icon={<Clock className="ic" />} label="Belum dilepas" value={num(r.counts.UNSETTLED)} sub={<div className="hint">{lastReport}</div>} />
        <Kpi icon={<FileQuestion className="ic" />} label="Perlu dicek" value={num(toCheck)} sub={<div className="hint">selisih harga, refund, pembayaran, atau biaya</div>} alert={toCheck > 0} />
        <Kpi icon={<Link2 className="ic" />} label="Dana ÷ omzet" value={pct(netSettled / (gmvSettled || 1))} sub={<div className="hint">{rpShort(netSettled)} dari {rpShort(gmvSettled)}</div>} formula="Σ dana dilepas ÷ Σ omzet item, hanya pesanan yang ada di kedua laporan." small />
      </div>

      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} items={TAB_ORDER.map((t) => ({ key: t, label: <>{EXCEPTION_INFO[t].label} <span className={`tag ${r.counts[t] && EXCEPTION_INFO[t].level !== 'info' ? EXCEPTION_INFO[t].level : ''}`}>{num(r.counts[t])}</span></> }))} />
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{EXCEPTION_INFO[tab].desc} Klik baris untuk melihat jejak pesanan.</div>
      <DataTable<ReconException> rows={ex} pageSize={25} csvName={`pengecualian-${tab.toLowerCase()}`} onRowClick={(e) => setOrderNo(e.orderNo)} initialSort={{ key: 'd', dir: -1 }} empty="Tidak ada — semuanya sesuai." cols={[
        { key: 'o', label: 'No. Pesanan', value: (e) => e.orderNo, render: (e) => <span className="mono">{e.orderNo}</span> },
        { key: 'd', label: 'Tanggal', value: (e) => e.date, render: (e) => dt(e.date) },
        { key: 'e', label: 'Seharusnya', num: true, value: (e) => e.expected, render: (e) => rp(e.expected) },
        { key: 'a', label: 'Tercatat', num: true, value: (e) => e.actual, render: (e) => rp(e.actual) },
        { key: 'f', label: 'Selisih', num: true, value: (e) => e.diff, render: (e) => (e.diff === null ? '–' : <span className={e.diff < 0 ? 'neg' : 'pos'}>{rp(e.diff)}</span>), total: (rs) => rp(rs.reduce((t, e) => t + (e.diff ?? 0), 0)) },
        { key: 'n', label: 'Keterangan', value: (e) => e.note, className: 'wrap' },
      ]} />

      <details style={{ marginTop: 18 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, padding: '6px 0' }}>Rincian pemeriksaan total per laporan ({num(ix.ds.checks.length)})</summary>
        <Panel title="Laporan Shopee vs data hasil import" sub="Setiap total di laporan asli dihitung ulang dari baris detail saat import">
          {byScope.map(([scope, cs]) => (
            <div key={scope} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, margin: '6px 0' }}>{scope}</div>
              <div className="tablewrap flat">
                <table className="t">
                  <thead><tr><th>Pemeriksaan</th><th className="num">Shopee</th><th className="num">Hitung ulang</th><th>Status</th></tr></thead>
                  <tbody>{cs.map((c) => <tr key={c.id}><td>{c.label}</td><td className="num">{checkVal(c.label, c.reported)}</td><td className="num">{checkVal(c.label, c.computed)}</td><td><CheckTag ok={c.ok} /></td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ))}
        </Panel>
      </details>

      {orderNo && <OrderTrail orderNo={orderNo} onClose={() => setOrderNo(null)} />}
    </>
  );
}

/** Jejak satu No. Pesanan di seluruh laporan. */
function OrderTrail({ orderNo, onClose }: { orderNo: string; onClose: () => void }) {
  const { ix } = useData();
  const o = ix.orderByNo.get(orderNo);
  const items = ix.itemsByOrder.get(orderNo) ?? [];
  const inc = ix.incomeByOrder.get(orderNo) ?? [];
  const rets = ix.returnsByOrder.get(orderNo) ?? [];
  const adj = ix.adjByOrder.get(orderNo) ?? [];
  const found = o || inc.length || rets.length || adj.length;
  const a = (k: string) => inc.reduce((t, r) => t + (r.amounts as Record<string, number>)[k], 0);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Jejak pesanan <span className="mono">{orderNo}</span></h3>
        {!found && <div className="warn-box">No. Pesanan tidak ditemukan di data yang diimport.</div>}
        {o && (
          <>
            <div className="sect">Pesanan</div>
            <div className="kv">
              <div>Dibuat / dikirim / selesai</div><div>{dt(o.createdAt)} / {dt(o.shippedAt)} / {dt(o.completedAt)}</div>
              <div>Pembayaran</div><div>{o.paymentMethod} · {rp(o.totalPayment)}</div>
              <div>Tujuan</div><div>{o.city}, {o.province}</div>
            </div>
            <DataTable rows={items} cols={[
              { key: 'p', label: 'Produk', value: (i) => i.productName, className: 'wrap', render: (i) => <>{i.productName}{i.variation && <div className="sub">{i.variation}</div>}</> },
              { key: 'q', label: 'Qty', num: true, value: (i) => i.qty, render: (i) => num(i.qty) },
              { key: 's', label: 'Subtotal', num: true, value: (i) => i.subtotal, render: (i) => rp(i.subtotal), total: (rs) => rp(rs.reduce((t, i) => t + i.subtotal, 0)) },
            ]} />
          </>
        )}
        {inc.length > 0 && (
          <>
            <div className="sect">Dana dari Shopee · dilepas {dt(inc[0].releaseDate)}</div>
            <div className="kv">
              <div>Harga produk</div><div>{rp(a('Harga Produk'))}</div>
              <div>Refund ke pembeli</div><div>{rp(a('Jumlah Pengembalian Dana ke Pembeli'))}</div>
              <div>Biaya administrasi + proses</div><div>{rp(a('Biaya Administrasi') + a('Biaya Proses Pesanan'))}</div>
              <div>Program XTRA</div><div>{rp(a('Biaya Gratis Ongkir XTRA - Ukuran Khusus (Kategori D)') + a('Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)') + a('Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori E)') + a('Biaya Layanan Promo XTRA'))}</div>
              <div><b>Dana diterima</b></div><div><b>{rp(a('Total Penghasilan'))}</b></div>
            </div>
          </>
        )}
        {rets.length > 0 && (
          <>
            <div className="sect">Pengembalian ({rets.length} pengajuan)</div>
            <DataTable rows={rets} cols={[
              { key: 'n', label: 'No. Pengembalian', value: (x) => x.returnNo, render: (x) => <span className="mono">{x.returnNo}</span> },
              { key: 's', label: 'Status', value: (x) => x.status, render: (x) => <>{RETURN_STATE_LABEL[returnState(x)]}<div className="sub">{x.status}</div></> },
              { key: 'f', label: 'Refund', num: true, value: (x) => x.refundTotal, render: (x) => rp(x.refundTotal) },
            ]} />
          </>
        )}
        {adj.length > 0 && (
          <>
            <div className="sect">Penyesuaian</div>
            <DataTable rows={adj} cols={[
              { key: 'd', label: 'Tanggal', value: (x) => x.date, render: (x) => dt(x.date) },
              { key: 't', label: 'Jenis', value: (x) => x.type },
              { key: 'a', label: 'Nominal', num: true, value: (x) => x.amount, render: (x) => rp(x.amount) },
            ]} />
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn" onClick={onClose}>Tutup</button></div>
      </div>
    </div>
  );
}
