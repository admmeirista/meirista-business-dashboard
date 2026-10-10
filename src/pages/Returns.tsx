import { useMemo, useState } from 'react';
import { Undo2, Wallet, Percent, Layers } from 'lucide-react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { BarList, Composition } from '../components/charts';
import { Chips, DataTable, Kpi, PageHead, Panel, maskName, num, pct, rp, rpShort, dt, type Col } from '../components/ui';
import { RETURN_BASIS_LABEL, RETURN_STATE_LABEL, returnState, returnsAnalysis, type ReturnBasis } from '../lib/metrics/analytics';
import type { ReturnRequest } from '../lib/types';

export default function Returns() {
  const { ix, filter, mask } = useData();
  const [basis, setBasis] = useState<ReturnBasis>('requested');
  const [open, setOpen] = useState<string | null>(null);
  const a = useMemo(() => returnsAnalysis(ix, filter, basis), [ix, filter, basis]);

  const cols: Col<ReturnRequest>[] = [
    { key: 'no', label: 'No. Pengembalian', value: (r) => r.returnNo, render: (r) => <span className="mono">{r.returnNo}</span> },
    { key: 'o', label: 'No. Pesanan', value: (r) => r.orderNo, render: (r) => <><span className="mono">{r.orderNo}</span>{(ix.returnsByOrder.get(r.orderNo)?.length ?? 0) > 1 && <div className="sub">{ix.returnsByOrder.get(r.orderNo)!.length} pengajuan pada pesanan ini</div>}</> },
    { key: 'd', label: 'Diajukan', value: (r) => r.requestedAt, render: (r) => dt(r.requestedAt) },
    { key: 's', label: 'Status', value: (r) => r.status, render: (r) => <><span className={`tag ${returnState(r) === 'REFUNDED' ? 'err' : returnState(r) === 'VOID' ? '' : 'warn'}`}>{RETURN_STATE_LABEL[returnState(r)]}</span><div className="sub">{r.status}</div></> },
    { key: 't', label: 'Tipe', value: (r) => r.returnType, render: (r) => <>{r.returnType}<div className="sub">{r.solution}</div></> },
    { key: 'r', label: 'Alasan', value: (r) => r.reason, className: 'wrap' },
    { key: 'q', label: 'Qty', num: true, value: (r) => r.qtyTotal, render: (r) => `${num(r.qtyTotal)} · ${r.lineCount} baris` },
    { key: 'f', label: 'Total refund', num: true, value: (r) => r.refundTotal, render: (r) => rp(r.refundTotal) },
    { key: 'c', label: 'Kompensasi', num: true, value: (r) => r.compensation, render: (r) => (r.compensation ? rp(r.compensation) : <span className="muted">–</span>) },
  ];
  const sel = open ? ix.ds.returns.find((r) => r.returnNo === open) : null;

  return (
    <>
      <PageHead eyebrow="Analitik" title="Pengembalian & Refund" />
      <FilterBar hideBasis />
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="eyebrow">Tanggal pengembalian</span>
        <Chips value={basis} onChange={setBasis} items={(Object.keys(RETURN_BASIS_LABEL) as ReturnBasis[]).map((k) => ({ key: k, label: RETURN_BASIS_LABEL[k] }))} />
      </div>
      <div className="kpis">
        <Kpi dark icon={<Undo2 className="ic" />} label="Pengajuan" value={num(a.requests)} sub={`${num(a.orders)} pesanan · ${num(a.multiRequestOrders)} pesanan > 1 pengajuan`} formula="Dihitung per No. Pengembalian. Satu pesanan bisa memiliki beberapa pengajuan, dan satu pengajuan bisa memiliki beberapa baris produk." />
        <Kpi icon={<Wallet className="ic" />} label="Refund selesai" value={rpShort(a.refundTotal)} sub={`${num(a.refundedCount)} pengajuan · proses ${rpShort(a.inProgressTotal)}`} formula="Σ Total Pengembalian Dana untuk status bukan Dibatalkan/Ditolak dan Waktu Pengembalian Dana Selesai terisi." />
        <Kpi icon={<Percent className="ic" />} label="Tingkat pengembalian" value={pct(a.returnRate, 2)} sub={`${num(a.cohortReturned)} dari ${num(a.cohortOrders)} pesanan dibuat di rentang`} formula="Kohort: pesanan Pesanan Selesai yang DIBUAT di rentang, yang memiliki pengajuan bukan batal/ditolak (kapan pun diajukan) ÷ jumlah pesanan tersebut." />
        <Kpi icon={<Layers className="ic" />} label="Kompensasi" value={rpShort(a.compensation)} sub="Jumlah Kompensasi" />
      </div>
      <div className="g3">
        <Panel title="Status">
          <Composition rows={a.byState} label={(r) => RETURN_STATE_LABEL[r.key]} value={(r) => r.n} format={num} />
          <div className="sect">Status detail</div>
          <BarList rows={a.byStatus} label={(r) => r.key} value={(r) => r.n} format={num} />
        </Panel>
        <Panel title="Alasan pengembalian" sub="Pengajuan bukan batal/ditolak">
          <BarList rows={a.byReason} max={8} label={(r) => r.key} value={(r) => r.n} format={num} sub={(r) => rpShort(r.refund)} />
        </Panel>
        <Panel title="Produk paling sering dikembalikan" sub="Qty per baris pengembalian">
          <BarList rows={a.byProduct} max={8} label={(r) => r.label} value={(r) => r.qty} format={num} sub={(r) => `${r.requests} pengajuan${r.sub ? ' · ' + r.sub : ''}`} />
        </Panel>
      </div>
      <DataTable rows={a.list} cols={cols} onRowClick={(r) => setOpen(r.returnNo)} csvName={`pengembalian-${filter.from}-${filter.to}`} />
      {sel && (
        <div className="modal-bg" onClick={() => setOpen(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>Pengembalian {sel.returnNo}</h3>
            <div className="kv">
              <div>No. Pesanan</div><div className="mono">{sel.orderNo}</div>
              <div>Pembeli</div><div>{maskName(sel.buyerMasked, mask)}</div>
              <div>Status</div><div>{sel.status}</div>
              <div>Diajukan / dana selesai</div><div>{dt(sel.requestedAt)} / {dt(sel.refundCompletedAt)}</div>
              <div>Alasan</div><div>{sel.reason}</div>
              <div>Total refund / kompensasi</div><div>{rp(sel.refundTotal)} / {rp(sel.compensation)}</div>
              <div>Total pesanan / pelepasan dana</div><div>{rp(sel.orderTotal)} / {rp(sel.releasedAmount)}</div>
              <div>Pengembalian barang</div><div>{[sel.returnCourier, sel.returnShipStatus].filter(Boolean).join(' · ') || '–'}</div>
              {sel.rejectReason && <><div>Alasan penolakan</div><div>{sel.rejectReason}</div></>}
            </div>
            <div className="sect">Baris produk</div>
            <DataTable rows={ix.linesByReturn.get(sel.returnNo) ?? []} cols={[
              { key: 'p', label: 'Produk', value: (l) => l.productName, className: 'wrap', render: (l) => <>{l.productName}{l.variation && <div className="sub">{l.variation}</div>}</> },
              { key: 'u', label: 'Harga satuan', num: true, value: (l) => l.unitPrice, render: (l) => rp(l.unitPrice) },
              { key: 'q', label: 'Qty', num: true, value: (l) => l.qty, render: (l) => num(l.qty) },
            ]} />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn" onClick={() => setOpen(null)}>Tutup</button></div>
          </div>
        </div>
      )}
    </>
  );
}
