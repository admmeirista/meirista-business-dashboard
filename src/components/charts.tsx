import { useRef, useState, type ReactNode } from 'react';
import { dShort, num, pct } from './ui';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

/** Nilai sumbu yang "rapi" (1, 2, 5 × 10^n). */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const axisFmt = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}M`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}jt`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(0)}rb`;
  return String(Math.round(v));
};

/**
 * Grafik deret waktu satu seri (bar atau garis) dengan crosshair + tooltip.
 * Satu sumbu saja — dua ukuran berbeda skala dibuat dua grafik terpisah.
 */
export function TimeChart<T extends { d: string }>({ data, value, format, kind = 'bar', height = 220, label }: {
  data: T[]; value: (r: T) => number; format: (v: number) => string; kind?: 'bar' | 'line'; height?: number; label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <div className="empty">Tidak ada data pada rentang ini.</div>;
  const W = 760, H = height, L = 46, R = 8, T = 10, B = 26;
  const vals = data.map(value);
  const minV = Math.min(0, ...vals);
  const maxV = niceMax(Math.max(...vals, 0));
  const lo = minV < 0 ? -niceMax(-minV) : 0;
  const x = (i: number) => L + ((W - L - R) * (i + 0.5)) / data.length;
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (maxV - lo || 1));
  const bw = Math.max(1, ((W - L - R) / data.length) * 0.72);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + (maxV - lo) * t);
  const step = Math.max(1, Math.ceil(data.length / 8));
  const path = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <div className="chart" ref={ref} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`}>
        <defs><linearGradient id="accfade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#e8693a" stopOpacity=".18" /><stop offset="1" stopColor="#e8693a" stopOpacity="0" /></linearGradient></defs>
        {ticks.map((t, i) => (<g key={i}><line className="gl" x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text className="ax" x={L - 6} y={y(t) + 4} textAnchor="end">{axisFmt(t)}</text></g>))}
        {data.map((r, i) => i % step === 0 && <text key={r.d} className="ax" x={x(i)} y={H - 8} textAnchor="middle">{r.d.length === 10 ? dShort(r.d) : r.d}</text>)}
        {kind === 'bar'
          ? data.map((r, i) => { const v = vals[i]; const y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v)); return <rect key={r.d} className="bar" x={x(i) - bw / 2} y={y0} width={bw} height={Math.max(v ? 1 : 0, y1 - y0)} rx={Math.min(4, bw / 2)} opacity={hover === null || hover === i ? 1 : 0.55} />; })
          : (<><path className="area" d={`${path}L${x(data.length - 1)},${y(lo)}L${x(0)},${y(lo)}Z`} /><path className="line" d={path} /></>)}
        {hover !== null && kind === 'line' && <><line className="xh" x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} /><circle className="dot" cx={x(hover)} cy={y(vals[hover])} r={4.5} /></>}
        {data.map((r, i) => <rect key={'h' + r.d} className="hit" x={L + ((W - L - R) * i) / data.length} y={T} width={(W - L - R) / data.length} height={H - T - B} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />)}
      </svg>
      {hover !== null && (
        <div className="ctip" style={{ opacity: 1, left: `${(x(hover) / W) * 100}%`, top: `${(y(Math.max(vals[hover], 0)) / H) * 100}%` }}>
          <div>{data[hover].d.length === 10 ? new Date(data[hover].d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : data[hover].d}</div>
          <div className="r"><i style={{ background: 'var(--acc)' }} />{label}: {format(vals[hover])}</div>
        </div>
      )}
    </div>
  );
}

/** Daftar batang horizontal (peringkat). Nilai tampil sebagai teks; warna seragam (satu seri). */
export function BarList<T>({ rows, label, value, format, max = 10, sub }: { rows: T[]; label: (r: T) => string; value: (r: T) => number; format: (v: number) => string; max?: number; sub?: (r: T) => ReactNode }) {
  const view = rows.slice(0, max);
  const top = Math.max(...view.map(value).map(Math.abs), 1);
  if (!view.length) return <div className="empty">Tidak ada data.</div>;
  return (
    <div className="sbars">
      {view.map((r, i) => (
        <div className="sbar" key={i} title={`${label(r)} — ${format(value(r))}`}>
          <div className="l">{label(r)}{sub && <div className="muted" style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub(r)}</div>}</div>
          <div className="t"><i style={{ width: `${(Math.abs(value(r)) / top) * 100}%`, background: value(r) < 0 ? 'var(--neg)' : undefined }} /></div>
          <div className="n">{format(value(r))}</div>
        </div>
      ))}
    </div>
  );
}

/** Komposisi (porsi) — batang bertumpuk 100% + legenda dengan nilai. Maks. 7 seri + "Lainnya". */
export function Composition<T>({ rows, label, value, format }: { rows: T[]; label: (r: T) => string; value: (r: T) => number; format: (v: number) => string }) {
  const pos = rows.filter((r) => value(r) > 0).sort((a, b) => value(b) - value(a));
  const head = pos.slice(0, 7).map((r) => ({ l: label(r), v: value(r) }));
  const rest = pos.slice(7).reduce((s, r) => s + value(r), 0);
  if (rest > 0) head.push({ l: 'Lainnya', v: rest });
  const total = head.reduce((s, x) => s + x.v, 0);
  if (!total) return <div className="empty">Tidak ada data.</div>;
  return (
    <div>
      <div className="stackbar" role="img" aria-label="Komposisi">
        {head.map((x, i) => <i key={x.l} title={`${x.l}: ${format(x.v)} (${pct(x.v / total)})`} style={{ width: `${(x.v / total) * 100}%`, background: x.l === 'Lainnya' ? '#c9c4b6' : SERIES[i] }} />)}
      </div>
      <div className="lgd">
        {head.map((x, i) => <span key={x.l}><i style={{ background: x.l === 'Lainnya' ? '#c9c4b6' : SERIES[i] }} />{x.l} · <b>{pct(x.v / total)}</b> <span className="muted">({format(x.v)})</span></span>)}
      </div>
    </div>
  );
}

/** Heatmap kohort retensi (satu hue, terang → gelap). */
export function CohortTable({ rows }: { rows: { month: string; size: number; cells: { k: number; n: number; pct: number }[] }[] }) {
  const maxK = Math.max(0, ...rows.map((r) => r.cells.length - 1));
  if (!rows.length) return <div className="empty">Belum cukup data.</div>;
  return (
    <div className="tablewrap flat">
      <table className="t heat">
        <thead><tr><th>Bulan pertama</th><th className="num">Pembeli</th>{Array.from({ length: maxK + 1 }, (_, k) => <th key={k} className="num">{k === 0 ? 'Bln 0' : `+${k}`}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td>{r.month}</td><td className="num">{num(r.size)}</td>
              {Array.from({ length: maxK + 1 }, (_, k) => {
                const c = r.cells[k];
                if (!c) return <td key={k} />;
                const a = k === 0 ? 0 : Math.min(1, c.pct * 4);
                return <td key={k} className="c" title={`${num(c.n)} pembeli`} style={{ background: k === 0 ? '#fbfaf6' : `rgba(42,120,214,${0.08 + a * 0.75})`, color: a > 0.55 ? '#fff' : undefined }}>{k === 0 ? '100%' : pct(c.pct)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BMON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
/**
 * Kelompokkan deret harian agar grafik tetap terbaca untuk periode panjang:
 * ≤ 62 hari → harian, ≤ 190 hari → mingguan (mulai Senin), selebihnya → bulanan.
 */
export function bucketize<T extends { d: string }, V extends Record<string, number>>(daily: T[], pick: (r: T) => V): { unit: string; rows: ({ d: string } & V)[] } {
  if (daily.length <= 62) return { unit: 'harian', rows: daily.map((r) => ({ d: r.d, ...pick(r) })) };
  const weekly = daily.length <= 190;
  const m = new Map<string, V>();
  const order: string[] = [];
  for (const r of daily) {
    let k: string;
    if (weekly) {
      const dt = new Date(r.d + 'T00:00:00Z');
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      k = `${dt.getUTCDate()} ${BMON[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(2)}`;
    } else k = `${BMON[Number(r.d.slice(5, 7)) - 1]} ${r.d.slice(0, 4)}`;
    const v = pick(r);
    const e = m.get(k);
    if (!e) { m.set(k, { ...v }); order.push(k); }
    else for (const key of Object.keys(v) as (keyof V)[]) (e[key] as number) += v[key] as number;
  }
  return { unit: weekly ? 'mingguan' : 'bulanan', rows: order.map((k) => ({ d: k, ...m.get(k)! })) };
}
