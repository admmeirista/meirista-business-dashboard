import { useData, monthRange } from '../data';
import { BASIS_LABEL, type DateBasis } from '../lib/metrics/dataset';
import { Info } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Filter global: basis tanggal + rentang. Satu baris di atas semua grafik. */
export function FilterBar({ basisLocked, hideBasis, note }: { basisLocked?: DateBasis; hideBasis?: boolean; note?: string }) {
  const { filter, setFilter, months } = useData();
  const basis = basisLocked ?? filter.basis;
  const activeMonth = months.find((m) => { const r = monthRange(m); return r.from === filter.from && r.to === filter.to; });
  return (
    <div className="fbar">
      {!hideBasis && <>
      <span className="lbl">Basis tanggal</span>
      <select className="in" value={basis} disabled={!!basisLocked} onChange={(e) => setFilter({ ...filter, basis: e.target.value as DateBasis })}>
        {(Object.keys(BASIS_LABEL) as DateBasis[]).map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
      </select>
      <Info>
        Menentukan tanggal yang dipakai untuk memasukkan data ke rentang: <b>Pesanan dibuat</b>, <b>Pembayaran</b>, <b>Pesanan selesai</b> (laporan Pesanan Selesai) atau <b>Dana dilepas</b> (Tanggal Dana Dilepaskan di laporan Penghasilan).
        Bulan dibuat, bulan selesai, dan bulan dana dilepas bisa berbeda, jadi total per bulan berbeda antar basis.{note ? ` ${note}` : ''}
      </Info>
      <span className="sep" />
      </>}
      <div className="chips">
        {months.slice(0, 6).map((m) => <button key={m} className={activeMonth === m ? 'on' : ''} onClick={() => setFilter({ ...filter, ...monthRange(m) })}>{monthLabel(m)}</button>)}
      </div>
      <span className="sep" />
      <input className="in" type="date" value={filter.from} max={filter.to} onChange={(e) => e.target.value && setFilter({ ...filter, from: e.target.value })} aria-label="Dari tanggal" />
      <span className="muted">s/d</span>
      <input className="in" type="date" value={filter.to} min={filter.from} onChange={(e) => e.target.value && setFilter({ ...filter, to: e.target.value })} aria-label="Sampai tanggal" />
    </div>
  );
}
