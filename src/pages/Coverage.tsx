import { useMemo } from 'react';
import { CheckCircle2, AlertTriangle, Circle } from 'lucide-react';
import { useData } from '../data';
import { monthLabel } from '../components/FilterBar';
import { monthlyCoverage, type CovStatus } from '../lib/coverage';
import { num, rpShort } from '../components/ui';

function Cell({ status, label, sub }: { status: CovStatus; label: string; sub?: string }) {
  const I = status === 'full' ? CheckCircle2 : status === 'partial' ? AlertTriangle : Circle;
  return (
    <div className={`cov cov-${status}`}>
      <I className="ic" />
      <div><div className="cov-l">{label}</div>{sub && <div className="cov-s">{sub}</div>}</div>
    </div>
  );
}

/** Checklist per bulan: sudah ada data Pesanan, Retur, dan Penghasilan atau belum. */
export function CoveragePanel() {
  const { ix } = useData();
  const rows = useMemo(() => monthlyCoverage(ix), [ix]);
  const done = rows.filter((r) => r.orders.status === 'full' && r.orders.source === 'all' && r.returns.status === 'full' && r.income.status === 'full').length;
  if (!rows.length) return <div className="info-box" style={{ marginTop: 0 }}>Belum ada data. Isi folder data-inbox lalu push data, atau import file di tab Import manual.</div>;

  return (
    <>
      <div className="lbl-kpi">
        <span className="pill2 acc">Bulan lengkap <b>{num(done)}</b> / {num(rows.length)}</span>
        <span className="pill2"><CheckCircle2 className="ic" style={{ width: 14, color: 'var(--ok)', verticalAlign: '-2px' }} /> sudah ada</span>
        <span className="pill2"><AlertTriangle className="ic" style={{ width: 14, color: 'var(--warn)', verticalAlign: '-2px' }} /> perlu dilengkapi</span>
        <span className="pill2"><Circle className="ic" style={{ width: 14, color: '#c9c4b6', verticalAlign: '-2px' }} /> belum ada</span>
      </div>
      <div className="tablewrap tall">
        <table className="t cov-t">
          <thead><tr><th>Bulan</th><th>Pesanan <span className="muted">(folder order)</span></th><th>Retur <span className="muted">(folder retur)</span></th><th>Penghasilan <span className="muted">(folder income)</span></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const o = r.orders;
              const orderStatus: CovStatus = o.status === 'full' && o.source === 'all' ? 'full' : o.status === 'none' ? 'none' : 'partial';
              const orderLabel = o.status === 'none' ? 'Belum ada' : o.missingParts ? 'Part belum lengkap' : o.source === 'all' ? 'Semua Pesanan' : 'Hanya Pesanan Selesai';
              const orderSub = o.status === 'none' ? undefined : o.source === 'completed' && !o.missingParts ? `${num(o.count)} pesanan · tanpa pesanan batal — export Semua Pesanan` : `${num(o.count)} pesanan${o.cancelled ? ` · ${num(o.cancelled)} batal` : ''}`;
              return (
                <tr key={r.month}>
                  <td style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{monthLabel(r.month)}</td>
                  <td><Cell status={orderStatus} label={orderLabel} sub={orderSub} /></td>
                  <td><Cell status={r.returns.status} label={r.returns.status === 'none' ? 'Belum ada' : 'Ada'} sub={r.returns.status === 'none' ? undefined : `${num(r.returns.count)} pengajuan`} /></td>
                  <td><Cell status={r.income.status} label={r.income.status === 'none' ? 'Belum ada' : 'Ada'} sub={r.income.status === 'none' ? undefined : `${num(r.income.count)} pesanan dilepas · ${rpShort(r.income.value)}`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Status dibaca dari periode di nama file yang sudah diimport (mis. <span className="mono">Order.all.20260801_20260831</span>). Bulan dianggap ada bila file mencakup minimal separuh bulan; laporan multi-part harus lengkap semua part-nya.
      </div>
    </>
  );
}
