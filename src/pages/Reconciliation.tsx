import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, FileQuestion, Link2, Search } from 'lucide-react';
import { useData } from '../data';
import { CheckTag, DataTable, Kpi, PageHead, Panel, Tabs, checkVal, dt, num, pct, rp, rpShort } from '../components/ui';
import { EXCEPTION_INFO, reconcile, type ExceptionType, type ReconException } from '../lib/metrics/reconcile';
import { RETURN_STATE_LABEL, returnState } from '../lib/metrics/analytics';
import type { StoredCheck } from '../lib/db';

export default function Reconciliation() {
  const { ix } = useData();
  const [params, setParams] = useSearchParams();
  const r = useMemo(() => reconcile(ix), [ix]);
  const tab = (params.get('tab') as ExceptionType) || 'UNSETTLED';
  const [q, setQ] = useState('');
  const [orderNo, setOrderNo] = useState<string | null>(null);

  const settled = r.rows.filter((x) => x.status === 'SETTLED');
  const gmvSettled = settled.reduce((t, x) => t + x.gmv, 0);
  const netSettled = settled.reduce((t, x) => t + (x.settled ?? 0), 0);
  const byScope = useMemo(() => {
    const m = new Map<string, StoredCheck[]>();
    for (const c of ix.ds.checks) (m.get(c.scope) ?? m.set(c.scope, []).get(c.scope)!).push(c);
    return [...m.entries()];
  }, [ix]);
  const ex = r.exceptions.filter((e) => e.type === tab);

  return (
    <>
      <PageHead eyebrow="Keuangan" title="Rekonsiliasi Penjualan ↔ Penghasilan" actions={
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) setOrderNo(q.trim().toUpperCase()); }}>
          <input className="in" placeholder="Telusuri No. Pesanan" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <button className="btn"><Search className="ic" />Cari</button>
        </form>
      } />
      <div className="kpis">
        <Kpi dark icon={<CheckCircle2 className="ic" />} label="Pesanan selesai sudah dilepas" value={num(settled.length)} sub={`${pct(settled.length / (ix.ds.orders.length || 1))} dari ${num(ix.ds.orders.length)} pesanan selesai`} formula="Dicocokkan via No. Pesanan ke baris Order laporan Penghasilan mana pun yang diimport (lintas periode)." />
        <Kpi icon={<Clock className="ic" />} label="Belum dilepas" value={num(r.counts.UNSETTLED)} sub={r.latestReportEnd ? `Laporan penghasilan terakhir s/d ${dt(r.latestReportEnd)}` : 'Belum ada laporan Penghasilan'} />
        <Kpi icon={<FileQuestion className="ic" />} label="Penghasilan tanpa data pesanan" value={num(r.counts.NO_ORDER)} sub="Pesanan periode lain belum diimport" />
        <Kpi icon={<Link2 className="ic" />} label="Dana ÷ GMV (sudah dilepas)" value={pct(netSettled / (gmvSettled || 1))} sub={`${rpShort(netSettled)} dari ${rpShort(gmvSettled)}`} formula="Σ Total Penghasilan ÷ Σ GMV item, hanya pesanan yang ada di kedua laporan." small />
      </div>

      <Panel title="Laporan Shopee vs data ternormalisasi" sub="Setiap total di laporan asli dihitung ulang dari baris detail saat import">
        {byScope.length === 0 && <div className="empty">Belum ada import.</div>}
        {byScope.map(([scope, cs]) => {
          const bad = cs.filter((c) => c.ok === false).length;
          return (
            <details key={scope} open={bad > 0} style={{ marginBottom: 10 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, padding: '6px 0' }}>
                {scope} — {bad ? <span className="tag err">{bad} selisih</span> : <span className="tag ok">{cs.filter((c) => c.ok).length} cocok</span>}{' '}
                {cs.some((c) => c.ok === null) && <span className="tag">{cs.filter((c) => c.ok === null).length} tak terverifikasi</span>}
              </summary>
              <div className="tablewrap flat">
                <table className="t">
                  <thead><tr><th>Pemeriksaan</th><th className="num">Laporan Shopee</th><th className="num">Hitung ulang</th><th className="num">Selisih</th><th>Status</th></tr></thead>
                  <tbody>{cs.map((c) => <tr key={c.id}><td>{c.label}</td><td className="num">{checkVal(c.label, c.reported)}</td><td className="num">{checkVal(c.label, c.computed)}</td><td className="num">{c.diff ? checkVal(c.label, c.diff) : '–'}</td><td><CheckTag ok={c.ok} /></td></tr>)}</tbody>
                </table>
              </div>
            </details>
          );
        })}
      </Panel>

      <div className="sect">Laporan pengecualian</div>
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} items={(Object.keys(EXCEPTION_INFO) as ExceptionType[]).map((t) => ({ key: t, label: <>{EXCEPTION_INFO[t].label} <span className={`tag ${r.counts[t] && EXCEPTION_INFO[t].level !== 'info' ? EXCEPTION_INFO[t].level : ''}`}>{num(r.counts[t])}</span></> }))} />
      <div className={`${EXCEPTION_INFO[tab].level === 'err' ? 'err-box' : EXCEPTION_INFO[tab].level === 'warn' ? 'warn-box' : 'info-box'}`} style={{ marginBottom: 12 }}>{EXCEPTION_INFO[tab].desc}</div>
      <DataTable<ReconException> rows={ex} csvName={`pengecualian-${tab.toLowerCase()}`} onRowClick={(e) => setOrderNo(e.orderNo)} initialSort={{ key: 'd', dir: -1 }} cols={[
        { key: 'o', label: 'No. Pesanan', value: (e) => e.orderNo, render: (e) => <span className="mono">{e.orderNo}</span> },
        { key: 'd', label: 'Tanggal', value: (e) => e.date, render: (e) => dt(e.date) },
        { key: 'e', label: 'Diharapkan', num: true, value: (e) => e.expected, render: (e) => rp(e.expected) },
        { key: 'a', label: 'Aktual', num: true, value: (e) => e.actual, render: (e) => rp(e.actual) },
        { key: 'f', label: 'Selisih', num: true, value: (e) => e.diff, render: (e) => (e.diff === null ? '–' : <span className={e.diff < 0 ? 'neg' : 'pos'}>{rp(e.diff)}</span>), total: (rs) => rp(rs.reduce((t, e) => t + (e.diff ?? 0), 0)) },
        { key: 'n', label: 'Keterangan', value: (e) => e.note, className: 'wrap' },
      ]} />

      {orderNo && <OrderTrail orderNo={orderNo} onClose={() => setOrderNo(null)} />}
    </>
  );
}

/** Jejak satu No. Pesanan di seluruh laporan. */
function OrderTrail({ orderNo, onClose }: { orderNo: string; onClose: () => void }) {
  const { ix } = useData();
  const o = ix.orderByNo.get(orderNo);
  const items = ix.itemsByOrder.get(orderNo) ?? [];
  const inc = ix.ds.income.filter((r) => r.orderNo === orderNo);
  const rets = ix.returnsByOrder.get(orderNo) ?? [];
  const adj = ix.adjByOrder.get(orderNo) ?? [];
  const found = o || inc.length || rets.length || adj.length;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Jejak pesanan <span className="mono">{orderNo}</span></h3>
        {!found && <div className="warn-box">No. Pesanan tidak ditemukan di data yang diimport.</div>}
        {o && (
          <>
            <div className="sect">Pesanan Selesai</div>
            <div className="kv">
              <div>Dibuat / dibayar / selesai</div><div>{dt(o.createdAt)} / {dt(o.paidAt)} / {dt(o.completedAt)}</div>
              <div>Metode bayar</div><div>{o.paymentMethod}</div>
              <div>Tujuan</div><div>{o.city}, {o.province}</div>
              <div>Total pembayaran</div><div>{rp(o.totalPayment)} (voucher penjual {rp(o.voucherSeller)}, voucher Shopee {rp(o.voucherShopee)}, ongkir pembeli {rp(o.shippingPaidByBuyer)})</div>
            </div>
            <DataTable rows={items} cols={[
              { key: 'p', label: 'Produk', value: (i) => i.productName, className: 'wrap', render: (i) => <>{i.productName}{i.variation && <div className="sub">{i.variation}</div>}</> },
              { key: 'h', label: 'Harga', num: true, value: (i) => i.priceAfterDiscount, render: (i) => rp(i.priceAfterDiscount) },
              { key: 'q', label: 'Qty', num: true, value: (i) => i.qty, render: (i) => num(i.qty) },
              { key: 's', label: 'Subtotal', num: true, value: (i) => i.subtotal, render: (i) => rp(i.subtotal), total: (rs) => rp(rs.reduce((t, i) => t + i.subtotal, 0)) },
            ]} />
          </>
        )}
        {inc.length > 0 && (
          <>
            <div className="sect">Penghasilan ({inc.filter((r) => r.recordType === 'Order').length} baris Order, {inc.filter((r) => r.recordType === 'Sku').length} baris Sku)</div>
            <DataTable rows={inc} cols={[
              { key: 't', label: 'Jenis', value: (r) => r.recordType, render: (r) => <span className={`tag ${r.recordType === 'Order' ? 'acc' : ''}`}>{r.recordType}</span> },
              { key: 'd', label: 'Dilepas', value: (r) => r.releaseDate, render: (r) => dt(r.releaseDate) },
              { key: 'p', label: 'Produk', value: (r) => r.productName, className: 'wrap' },
              { key: 'h', label: 'Harga produk', num: true, value: (r) => r.amounts['Harga Produk'], render: (r) => rp(r.amounts['Harga Produk']) },
              { key: 'f', label: 'Refund', num: true, value: (r) => r.amounts['Jumlah Pengembalian Dana ke Pembeli'], render: (r) => rp(r.amounts['Jumlah Pengembalian Dana ke Pembeli']) },
              { key: 'n', label: 'Total penghasilan', num: true, value: (r) => r.amounts['Total Penghasilan'], render: (r) => <b>{rp(r.amounts['Total Penghasilan'])}</b> },
            ]} />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Baris Sku adalah alokasi baris Order per produk — total hanya dihitung dari baris Order.</div>
          </>
        )}
        {rets.length > 0 && (
          <>
            <div className="sect">Pengembalian ({rets.length} pengajuan)</div>
            <DataTable rows={rets} cols={[
              { key: 'n', label: 'No. Pengembalian', value: (r) => r.returnNo, render: (r) => <span className="mono">{r.returnNo}</span> },
              { key: 's', label: 'Status', value: (r) => r.status, render: (r) => <>{RETURN_STATE_LABEL[returnState(r)]}<div className="sub">{r.status}</div></> },
              { key: 'd', label: 'Diajukan', value: (r) => r.requestedAt, render: (r) => dt(r.requestedAt) },
              { key: 'f', label: 'Refund', num: true, value: (r) => r.refundTotal, render: (r) => rp(r.refundTotal) },
            ]} />
          </>
        )}
        {adj.length > 0 && (
          <>
            <div className="sect">Penyesuaian</div>
            <DataTable rows={adj} cols={[
              { key: 'd', label: 'Tanggal', value: (a) => a.date, render: (a) => dt(a.date) },
              { key: 't', label: 'Tipe', value: (a) => a.type },
              { key: 'a', label: 'Nominal', num: true, value: (a) => a.amount, render: (a) => rp(a.amount) },
            ]} />
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn" onClick={onClose}>Tutup</button></div>
      </div>
    </div>
  );
}
