import { useMemo, useState } from 'react';
import { Undo2, Wallet, Percent } from 'lucide-react';
import { useData } from '../data';
import { FilterBar, periodLabel } from '../components/FilterBar';
import { AiButton } from '../components/Ai';
import { AI_TASK, aiPayload } from '../lib/metrics/summary';
import { BarList } from '../components/charts';
import { DataTable, Kpi, PageHead, Panel, maskName, num, pct, rp, rpShort, dt, type Col } from '../components/ui';
import { RETURN_STATE_LABEL, returnState, returnsAnalysis } from '../lib/metrics/analytics';
import type { ReturnRequest } from '../lib/types';

export default function Returns() {
  const { ix, filter, prev, mask } = useData();
  const [open, setOpen] = useState<string | null>(null);
  const a = useMemo(() => returnsAnalysis(ix, filter, 'requested'), [ix, filter]);
  const sel = open ? ix.ds.returns.find((r) => r.returnNo === open) : null;

  const cols: Col<ReturnRequest>[] = [
    { key: 'd', label: 'Diajukan', value: (r) => r.requestedAt, render: (r) => dt(r.requestedAt) },
    { key: 'o', label: 'No. Pesanan', value: (r) => r.orderNo, render: (r) => <span className="mono">{r.orderNo}</span> },
    { key: 'p', label: 'Produk', value: (r) => ix.linesByReturn.get(r.returnNo)?.[0]?.productName ?? '', className: 'wrap', render: (r) => { const l = ix.linesByReturn.get(r.returnNo) ?? []; return <>{l[0]?.productName}{l.length > 1 && <div className="sub">+{l.length - 1} produk lain</div>}</>; } },
    { key: 'r', label: 'Alasan', value: (r) => r.reason, className: 'wrap' },
    { key: 's', label: 'Status', value: (r) => returnState(r), render: (r) => <span className={`tag ${returnState(r) === 'REFUNDED' ? 'err' : returnState(r) === 'VOID' ? '' : 'warn'}`}>{RETURN_STATE_LABEL[returnState(r)]}</span> },
    { key: 'f', label: 'Refund', num: true, value: (r) => r.refundTotal, render: (r) => rp(r.refundTotal) },
  ];

  return (
    <>
      <PageHead eyebrow="Retur" title="Apa yang dikembalikan & kenapa?" actions={
        <AiButton cacheKey={`returns|${filter.from}|${filter.to}`} title={`Analisis AI retur — ${periodLabel(filter)}`} task={AI_TASK.returns}
          build={() => aiPayload(ix, filter, prev, periodLabel(filter), periodLabel(prev), 'returns')} />
      } />
      <FilterBar note="Menurut tanggal pengajuan pengembalian" />
      {!ix.ds.returns.length && <div className="info-box" style={{ marginBottom: 14 }}>Belum ada laporan Pengembalian yang diimport.</div>}
      <div className="kpis">
        <Kpi dark icon={<Undo2 className="ic" />} label="Pengajuan" value={num(a.requests)} sub={<div className="hint">{num(a.valid)} diproses · {num(a.requests - a.valid)} batal/ditolak</div>} formula="Per No. Pengembalian. Satu pesanan bisa punya beberapa pengajuan." />
        <Kpi icon={<Wallet className="ic" />} label="Uang dikembalikan" value={rpShort(a.refundTotal)} sub={<div className="hint">{num(a.refundedCount)} pengajuan selesai{a.inProgressTotal ? ` · ${rpShort(a.inProgressTotal)} masih proses` : ''}</div>} formula="Total Pengembalian Dana untuk pengajuan yang tidak batal/ditolak dan dananya sudah selesai dikembalikan." />
        <Kpi icon={<Percent className="ic" />} label="Tingkat retur" value={pct(a.returnRate, 2)} sub={<div className="hint">{num(a.cohortReturned)} dari {num(a.cohortOrders)} pesanan</div>} formula="Pesanan selesai pada periode yang punya pengajuan pengembalian (tidak batal/ditolak) ÷ pesanan selesai pada periode." />
      </div>
      {a.valid > 0 && (
        <div className="g2">
          <Panel title="Alasan terbanyak"><BarList rows={a.byReason} max={6} label={(r) => r.key} value={(r) => r.n} format={(v) => `${num(v)}×`} /></Panel>
          <Panel title="Produk paling sering dikembalikan"><BarList rows={a.byProduct} max={6} label={(r) => r.label} value={(r) => r.qty} format={(v) => `${num(v)} pcs`} /></Panel>
        </div>
      )}
      <DataTable rows={a.list} cols={cols} pageSize={25} onRowClick={(r) => setOpen(r.returnNo)} csvName={`pengembalian-${filter.from}-${filter.to}`} empty="Tidak ada pengajuan pada periode ini." />
      {sel && (
        <div className="modal-bg" onClick={() => setOpen(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>Pengembalian {sel.returnNo}</h3>
            <div className="kv">
              <div>No. Pesanan</div><div className="mono">{sel.orderNo}{(ix.returnsByOrder.get(sel.orderNo)?.length ?? 0) > 1 && ` · ${ix.returnsByOrder.get(sel.orderNo)!.length} pengajuan untuk pesanan ini`}</div>
              <div>Pembeli</div><div>{maskName(sel.buyerMasked, mask)}</div>
              <div>Status</div><div>{sel.status}</div>
              <div>Tipe</div><div>{sel.returnType} · {sel.solution}</div>
              <div>Diajukan / dana selesai</div><div>{dt(sel.requestedAt)} / {dt(sel.refundCompletedAt)}</div>
              <div>Alasan</div><div>{sel.reason}</div>
              <div>Refund / kompensasi</div><div>{rp(sel.refundTotal)} / {rp(sel.compensation)}</div>
              {sel.rejectReason && <><div>Alasan penolakan</div><div>{sel.rejectReason}</div></>}
            </div>
            <div className="sect">Produk</div>
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
