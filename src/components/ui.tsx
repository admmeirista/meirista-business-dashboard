import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Download, Info as InfoIcon, CheckCircle2, XCircle, CircleHelp } from 'lucide-react';

// ───────── format ─────────
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
export const num = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '–' : nf.format(Math.round(v)));
export const rp = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '–' : (v < 0 ? '−Rp ' : 'Rp ') + nf.format(Math.abs(Math.round(v))));
export const rpShort = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '–';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}Rp ${(a / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `${s}Rp ${(a / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (a >= 1e3) return `${s}Rp ${(a / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return `${s}Rp ${a}`;
};
export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d })}%`);
export const dt = (s: string | null | undefined) => (s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s.replace(' ', 'T')).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '–');
export const dShort = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

/** Username disamarkan di layar (data asli tetap di database lokal). */
export const maskName = (s: string, on: boolean) => (!on || s.length <= 3 ? s : s.slice(0, 2) + '•'.repeat(Math.min(6, s.length - 3)) + s.slice(-1));

// ───────── komponen kecil ─────────
export function Info({ children }: { children: ReactNode }) {
  return <span className="qtip" tabIndex={0}><CircleHelp className="ic" /><span className="tip">{children}</span></span>;
}

export function PageHead({ eyebrow, title, actions, children }: { eyebrow: string; title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="ph">
        <div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>
        {actions && <div className="act">{actions}</div>}
      </div>
      {children}
    </>
  );
}

export function Kpi({ icon, label, value, sub, formula, dark, alert, small }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; formula?: ReactNode; dark?: boolean; alert?: boolean; small?: boolean }) {
  return (
    <div className={`kpi${dark ? ' dark' : ''}${alert ? ' alert' : ''}`}>
      <div className="top"><span className="chip">{icon}</span>{label}{formula && <Info>{formula}</Info>}</div>
      <div className={`v${small ? ' sm' : ''}`}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function Panel({ title, sub, actions, children, className }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`panel ${className ?? ''}`}>
      <div className="panel-h"><div><h3>{title}</h3>{sub && <div className="sub">{sub}</div>}</div>{actions && <div className="act">{actions}</div>}</div>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Warnings({ items }: { items: { level: 'warn' | 'info'; text: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="warns">
      {items.map((w, i) => (
        <div key={i} className={w.level === 'warn' ? 'warn-box' : 'info-box'}>
          {w.level === 'warn' ? <AlertTriangle className="ic" /> : <InfoIcon className="ic" />}<span>{w.text}</span>
        </div>
      ))}
    </div>
  );
}

export function CheckTag({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="tag"><CircleHelp className="ic" />Tidak dapat diverifikasi</span>;
  return ok ? <span className="tag ok"><CheckCircle2 className="ic" />Cocok</span> : <span className="tag err"><XCircle className="ic" />Selisih</span>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: ReactNode }[] }) {
  return <div className="tabs">{items.map((t) => <a key={t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>{t.label}</a>)}</div>;
}

export function Chips<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: string }[] }) {
  return <div className="chips">{items.map((t) => <button key={t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>{t.label}</button>)}</div>;
}

// ───────── tabel dengan urut, paging, total, export CSV ─────────
export interface Col<T> {
  key: string;
  label: ReactNode;
  value?: (r: T) => string | number | null; // untuk urut & CSV
  render?: (r: T) => ReactNode;
  num?: boolean;
  total?: (rows: T[]) => ReactNode;
  csv?: boolean;
  className?: string;
}

export function DataTable<T>({ rows, cols, pageSize = 50, initialSort, onRowClick, csvName, empty = 'Tidak ada data.', tall }: {
  rows: T[]; cols: Col<T>[]; pageSize?: number; initialSort?: { key: string; dir: 1 | -1 }; onRowClick?: (r: T) => void; csvName?: string; empty?: ReactNode; tall?: boolean;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = cols.find((x) => x.key === sort.key);
    if (!c?.value) return rows;
    const v = c.value;
    return [...rows].sort((a, b) => {
      const x = v(a), y = v(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * sort.dir;
    });
  }, [rows, cols, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const p = Math.min(page, pages - 1);
  const view = sorted.slice(p * pageSize, (p + 1) * pageSize);
  const hasTotal = cols.some((c) => c.total);
  return (
    <div>
      {csvName && <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}><button className="btn sm" onClick={() => downloadCsv(csvName, sorted, cols)}><Download className="ic" />CSV</button></div>}
      <div className={`tablewrap${tall ? ' tall' : ''}`}>
        <table className="t">
          <thead>
            <tr>{cols.map((c) => (
              <th key={c.key} className={`${c.value ? 's' : ''} ${c.num ? 'num' : ''}`} onClick={() => c.value && setSort((s) => ({ key: c.key, dir: s?.key === c.key ? (-s.dir as 1 | -1) : c.num ? -1 : 1 }))}>
                {c.label}{sort?.key === c.key && (sort.dir === 1 ? <ArrowUp className="ic" style={{ width: 12, height: 12 }} /> : <ArrowDown className="ic" style={{ width: 12, height: 12 }} />)}
              </th>))}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && <tr><td colSpan={cols.length}><Empty>{empty}</Empty></td></tr>}
            {view.map((r, i) => (
              <tr key={i} className={onRowClick ? 'click' : ''} onClick={() => onRowClick?.(r)}>
                {cols.map((c) => <td key={c.key} className={`${c.num ? 'num' : ''} ${c.className ?? ''}`}>{c.render ? c.render(r) : String(c.value?.(r) ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
          {hasTotal && view.length > 0 && <tfoot><tr>{cols.map((c, i) => <td key={c.key} className={c.num ? 'num' : ''}>{c.total ? c.total(sorted) : i === 0 ? `Total (${num(sorted.length)})` : ''}</td>)}</tr></tfoot>}
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          {num(p * pageSize + 1)}–{num(Math.min(sorted.length, (p + 1) * pageSize))} dari {num(sorted.length)}
          <button className="btn sm" disabled={p === 0} onClick={() => setPage(p - 1)}>‹</button>
          <button className="btn sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>›</button>
        </div>
      )}
    </div>
  );
}

export function downloadCsv<T>(name: string, rows: T[], cols: Col<T>[]) {
  const use = cols.filter((c) => c.value && c.csv !== false);
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = use.map((c) => esc(typeof c.label === 'string' ? c.label : c.key)).join(',');
  const body = rows.map((r) => use.map((c) => esc(c.value!(r))).join(',')).join('\n');
  downloadBlob(`${name}.csv`, new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' }));
}

export function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function MiniBar({ v }: { v: number }) {
  return <div className="mini-bar"><i style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /></div>;
}

/** Toast sederhana (pola sama dengan FMS). */
export function toast(msg: string, kind: 'ok' | 'err' | 'warn' | '' = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/** Nilai pemeriksaan: hitungan baris ditampilkan sebagai angka, lainnya sebagai Rupiah. */
export const checkVal = (label: string, v: number | null) => (/baris|jumlah item/i.test(label) ? num(v) : rp(v));

/** Perubahan vs periode sebelumnya. invert = penurunan itu baik (mis. biaya, retur). */
export function Delta({ now, before, invert, dark }: { now: number | null; before: number | null; invert?: boolean; dark?: boolean }) {
  if (now === null || before === null || !before) return null;
  const ch = (now - before) / Math.abs(before);
  const good = invert ? ch < 0 : ch > 0;
  const flat = Math.abs(ch) < 0.005;
  return <span className={`delta ${flat ? '' : good ? 'up' : 'down'}${dark ? ' dk' : ''}`}>{flat ? '≈' : ch > 0 ? '▲' : '▼'} {pct(Math.abs(ch))} <span className="vs">vs periode lalu</span></span>;
}
