import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { PageHead, Warnings } from '../components/ui';
import { insights } from '../lib/metrics/insights';
import { reconcile, EXCEPTION_INFO, type ExceptionType } from '../lib/metrics/reconcile';
import { dataWarnings } from '../lib/metrics/analytics';
import { Link } from 'react-router-dom';

const ICON = { ok: CheckCircle2, info: Info, warn: AlertTriangle, err: OctagonAlert };

export default function Insights() {
  const { ix, filter } = useData();
  const list = useMemo(() => insights(ix, filter), [ix, filter]);
  const rec = useMemo(() => reconcile(ix), [ix]);
  const warn = useMemo(() => dataWarnings(ix, filter), [ix, filter]);
  const exTypes: ExceptionType[] = ['PRICE_DIFF', 'REFUND_DIFF', 'PAID_DIFF', 'FEE_SHEET_DIFF', 'UNSETTLED'];
  return (
    <>
      <PageHead eyebrow="Analitik" title="Insight Bisnis & Deteksi Anomali" />
      <FilterBar />
      <Warnings items={warn} />
      <div className="stack">
        {list.map((x, i) => {
          const I = ICON[x.level];
          return (
            <div key={i} className={`ins ${x.level}`}>
              <div className="t"><I className="ic" /></div>
              <div><h4>{x.title}</h4><p>{x.detail}</p>{x.metric && <div className="m">Dasar: {x.metric}</div>}</div>
            </div>
          );
        })}
      </div>
      <div className="sect">Anomali rekonsiliasi (seluruh data)</div>
      <div className="stack">
        {exTypes.filter((t) => rec.counts[t]).map((t) => {
          const I = ICON[EXCEPTION_INFO[t].level === 'err' ? 'err' : EXCEPTION_INFO[t].level === 'warn' ? 'warn' : 'info'];
          return (
            <div key={t} className={`ins ${EXCEPTION_INFO[t].level}`}>
              <div className="t"><I className="ic" /></div>
              <div className="grow"><h4>{rec.counts[t].toLocaleString('id-ID')} × {EXCEPTION_INFO[t].label}</h4><p>{EXCEPTION_INFO[t].desc}</p></div>
              <Link className="btn sm" to={`/recon?tab=${t}`}>Lihat</Link>
            </div>
          );
        })}
        {!exTypes.some((t) => rec.counts[t]) && <div className="ok-box">Tidak ada anomali rekonsiliasi.</div>}
      </div>
    </>
  );
}
