import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useData, monthRange, quarterRange, yearRange, periodKind, stepPeriod, type Period, type CompareMode } from '../data';
import { BASIS_LABEL } from '../lib/metrics/dataset';

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const short = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const pad = (n: number) => String(n).padStart(2, '0');

/** Label periode yang mudah dibaca: "Juni 2026", "Kuartal 2 2026", "Tahun 2025", "1 Jan – 15 Mar 2026". */
export function periodLabel(p: Period) {
  const k = periodKind(p);
  if (k.kind === 'month') return monthLabel(p.from.slice(0, 7));
  if (k.kind === 'quarter') return `Kuartal ${k.q} ${k.y} (${MON[k.q * 3 - 3]}–${MON[k.q * 3 - 1]})`;
  if (k.kind === 'year') return `Tahun ${k.y}`;
  return `${short(p.from)} – ${short(p.to)}`;
}

type Mode = 'month' | 'quarter' | 'year' | 'range';

/** Pemilih periode untuk data multi-tahun: bulan / kuartal / tahun / rentang + preset + pembanding. */
export function FilterBar({ note }: { note?: string }) {
  const { filter, prev, setPeriod, monthCounts, months, compare, setCompare } = useData();
  const [open, setOpen] = useState(false);
  const k = periodKind(filter);
  const [mode, setMode] = useState<Mode>(k.kind === 'custom' ? 'range' : k.kind);
  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))].sort();
  const [year, setYear] = useState<number>(Number(filter.from.slice(0, 4)));
  const [range, setRange] = useState<Period>({ from: filter.from, to: filter.to });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  useEffect(() => { setYear(Number(filter.from.slice(0, 4))); setRange({ from: filter.from, to: filter.to }); }, [filter.from, filter.to]);

  const pick = (p: Period) => { setPeriod(p); setOpen(false); };
  const count = (from: string, to: string) => [...monthCounts.entries()].filter(([m]) => m >= from.slice(0, 7) && m <= to.slice(0, 7)).reduce((s, [, n]) => s + n, 0);
  const latest = months[0];
  const minY = years[0] ?? year, maxY = years[years.length - 1] ?? year;
  const presets: { label: string; p: Period | null }[] = latest ? [
    { label: 'Bulan terakhir', p: monthRange(latest) },
    { label: '3 bulan terakhir', p: { from: `${stepMonth(latest, -2)}-01`, to: monthRange(latest).to } },
    { label: '12 bulan terakhir', p: { from: `${stepMonth(latest, -11)}-01`, to: monthRange(latest).to } },
    { label: `Tahun ${latest.slice(0, 4)} s/d kini`, p: { from: `${latest.slice(0, 4)}-01-01`, to: monthRange(latest).to } },
    { label: 'Semua data', p: { from: monthRange(months[months.length - 1]).from, to: monthRange(latest).to } },
  ] : [];

  return (
    <div className="pbar" ref={ref}>
      <div className="pp">
        <button className="btn sm ghost" onClick={() => setPeriod(stepPeriod(filter, -1))} aria-label="Periode sebelumnya"><ChevronLeft className="ic" /></button>
        <button className="pp-btn" onClick={() => setOpen(!open)} title={typeof note === 'string' ? note : `Omzet per tanggal ${BASIS_LABEL[filter.basis].toLowerCase()} · pembanding ${periodLabel(prev)}`}><CalendarDays className="ic" /><span>{periodLabel(filter)}</span><ChevronDown className="ic" /></button>
        <button className="btn sm ghost" onClick={() => setPeriod(stepPeriod(filter, 1))} aria-label="Periode berikutnya"><ChevronRight className="ic" /></button>
      </div>

      {open && (
        <div className="pp-pop">
          <div className="pp-side">
            <div className="eyebrow" style={{ marginBottom: 6 }}>Cepat</div>
            {presets.map((x) => x.p && <button key={x.label} className="pp-preset" onClick={() => pick(x.p!)}>{x.label}</button>)}
          </div>
          <div className="pp-main">
            <div className="tabs" style={{ marginBottom: 12 }}>
              {(['month', 'quarter', 'year', 'range'] as Mode[]).map((m) => <a key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{{ month: 'Bulan', quarter: 'Kuartal', year: 'Tahun', range: 'Rentang' }[m]}</a>)}
            </div>
            {(mode === 'month' || mode === 'quarter') && (
              <div className="pp-year">
                <button className="btn sm ghost" disabled={year <= minY} onClick={() => setYear(year - 1)}><ChevronLeft className="ic" /></button>
                <b>{year}</b>
                <button className="btn sm ghost" disabled={year >= maxY} onClick={() => setYear(year + 1)}><ChevronRight className="ic" /></button>
              </div>
            )}
            {mode === 'month' && (
              <div className="pp-grid m">
                {MON.map((lbl, i) => {
                  const key = `${year}-${pad(i + 1)}`, n = monthCounts.get(key) ?? 0;
                  const on = k.kind === 'month' && filter.from.startsWith(key);
                  return <button key={key} className={`pp-cell${on ? ' on' : ''}`} disabled={!n} onClick={() => pick(monthRange(key))}>{lbl}<small>{n ? n.toLocaleString('id-ID') : '–'}</small></button>;
                })}
              </div>
            )}
            {mode === 'quarter' && (
              <div className="pp-grid q">
                {[1, 2, 3, 4].map((q) => {
                  const r = quarterRange(year, q), n = count(r.from, r.to);
                  const on = k.kind === 'quarter' && k.y === year && k.q === q;
                  return <button key={q} className={`pp-cell${on ? ' on' : ''}`} disabled={!n} onClick={() => pick(r)}>Q{q}<small>{MON[q * 3 - 3]}–{MON[q * 3 - 1]} · {n ? n.toLocaleString('id-ID') : '–'}</small></button>;
                })}
              </div>
            )}
            {mode === 'year' && (
              <div className="pp-grid q">
                {years.map((y) => {
                  const r = yearRange(y), n = count(r.from, r.to);
                  return <button key={y} className={`pp-cell${k.kind === 'year' && k.y === y ? ' on' : ''}`} onClick={() => pick(r)}>{y}<small>{n.toLocaleString('id-ID')} pesanan</small></button>;
                })}
              </div>
            )}
            {mode === 'range' && (
              <div>
                <div className="row">
                  <input className="in" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="Dari" />
                  <span className="muted">s/d</span>
                  <input className="in" type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="Sampai" />
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn pri sm" disabled={!range.from || !range.to || range.to < range.from} onClick={() => pick(range)}>Terapkan</button>
                </div>
              </div>
            )}
            <div className="pp-foot">
              <label>Bandingkan dengan
                <select className="in" value={compare} onChange={(e) => setCompare(e.target.value as CompareMode)}>
                  <option value="prev">Periode sebelumnya</option>
                  <option value="yoy">Periode sama tahun lalu</option>
                </select>
              </label>
              <div className="muted">Pembanding: {periodLabel(prev)} · {note ?? `omzet per tanggal ${BASIS_LABEL[filter.basis].toLowerCase()}`} · angka kecil = jumlah pesanan.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function stepMonth(m: string, n: number) {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
