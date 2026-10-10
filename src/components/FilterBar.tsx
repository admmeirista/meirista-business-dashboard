import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useData, monthRange } from '../data';
import { BASIS_LABEL } from '../lib/metrics/dataset';

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const short = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

/** Pemilih periode sederhana: pilih bulan, atau rentang tanggal sendiri. */
export function FilterBar({ note }: { note?: string }) {
  const { filter, prev, setPeriod, months } = useData();
  const active = months.find((m) => { const r = monthRange(m); return r.from === filter.from && r.to === filter.to; });
  const [custom, setCustom] = useState(!active && months.length > 0);
  return (
    <div className="fbar">
      <CalendarDays className="ic" style={{ color: 'var(--muted)' }} />
      <select className="in" value={custom ? 'custom' : active ?? ''} onChange={(e) => {
        if (e.target.value === 'custom') return setCustom(true);
        setCustom(false);
        setPeriod(monthRange(e.target.value));
      }}>
        {!active && !custom && <option value="">{short(filter.from)} – {short(filter.to)}</option>}
        {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        <option value="custom">Rentang tanggal…</option>
      </select>
      {custom && (
        <>
          <input className="in" type="date" value={filter.from} max={filter.to} onChange={(e) => e.target.value && setPeriod({ from: e.target.value, to: filter.to })} aria-label="Dari tanggal" />
          <span className="muted">s/d</span>
          <input className="in" type="date" value={filter.to} min={filter.from} onChange={(e) => e.target.value && setPeriod({ from: filter.from, to: e.target.value })} aria-label="Sampai tanggal" />
        </>
      )}
      <span className="fnote">{note ?? <>Omzet menurut tanggal <b>{BASIS_LABEL[filter.basis].toLowerCase()}</b> · dibanding {short(prev.from)} – {short(prev.to)}</>}</span>
    </div>
  );
}
