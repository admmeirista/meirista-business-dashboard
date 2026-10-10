import { useEffect, useState } from 'react';
import { Trash2, Eye } from 'lucide-react';
import { useData } from '../data';
import { db, type StoredRejected } from '../lib/db';
import { deleteBatch, kindLabel } from '../lib/importer';
import type { ImportBatch, RawRow } from '../lib/types';
import { DataTable, num, toast } from '../components/ui';

export function ImportHistoryPanel() {
  const { ix, reload } = useData();
  const [open, setOpen] = useState<ImportBatch | null>(null);
  const del = async (b: ImportBatch) => {
    if (!confirm(`Hapus batch #${b.id} (${kindLabel(b.kind)}, ${b.fileNames.join(', ')})?\n\nRecord yang terakhir ditulis oleh batch ini akan dihapus. Tidak bisa dibatalkan — buat backup dulu bila perlu.`)) return;
    await deleteBatch(db(), b.id!);
    await reload();
    toast('Batch dihapus', 'ok');
  };
  return (
    <>
      <DataTable rows={ix.ds.batches} empty="Belum ada import." cols={[
        { key: 'id', label: '#', value: (b) => b.id ?? 0, num: true },
        { key: 'w', label: 'Waktu', value: (b) => b.importedAt, render: (b) => new Date(b.importedAt).toLocaleString('id-ID') },
        { key: 'k', label: 'Jenis', value: (b) => kindLabel(b.kind) },
        { key: 'f', label: 'File', value: (b) => b.fileNames.join(', '), className: 'wrap', render: (b) => b.fileNames.map((f) => <div key={f} className="mono" style={{ fontSize: 11.5 }}>{f}</div>) },
        { key: 'p', label: 'Periode', value: (b) => b.periodFrom, render: (b) => (b.periodFrom ? `${b.periodFrom} s/d ${b.periodTo}` : '–') },
        { key: 'r', label: 'Baris', num: true, value: (b) => b.rowsRead, render: (b) => num(b.rowsRead) },
        { key: 'n', label: 'Baru / ubah / duplikat / tolak', value: (b) => b.inserted, render: (b) => `${num(b.inserted)} / ${num(b.updated)} / ${num(b.duplicates)} / ${num(b.rejected)}` },
        { key: 's', label: 'Status', value: (b) => b.status, render: (b) => <span className={`tag ${b.status === 'OK' ? 'ok' : b.status === 'WARNING' ? 'warn' : 'err'}`}>{b.status}</span> },
        { key: 'a', label: '', render: (b) => <div className="row" style={{ flexWrap: 'nowrap' }}><button className="btn sm" onClick={() => setOpen(b)}><Eye className="ic" />Detail</button><button className="btn sm ghost" onClick={() => del(b)} aria-label="Hapus"><Trash2 className="ic" /></button></div> },
      ]} />
      {open && <BatchDetail b={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function BatchDetail({ b, onClose }: { b: ImportBatch; onClose: () => void }) {
  const [raw, setRaw] = useState<RawRow[]>([]);
  const [rej, setRej] = useState<StoredRejected[]>([]);
  const [rawCount, setRawCount] = useState(0);
  useEffect(() => {
    void (async () => {
      setRawCount(await db().raw.where('batchId').equals(b.id!).count());
      setRaw(await db().raw.where('batchId').equals(b.id!).limit(200).toArray());
      setRej(await db().rejected.where('batchId').equals(b.id!).toArray());
    })();
  }, [b.id]);
  const keys = raw[0] ? Object.keys(raw[0].data).slice(0, 12) : [];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Batch #{b.id} — {kindLabel(b.kind)}</h3>
        {b.errors.map((e) => <div key={e} className="err-box">{e}</div>)}
        {b.warnings.length > 0 && <><div className="sect">Catatan ({b.warnings.length})</div><div className="tablewrap flat" style={{ maxHeight: 220 }}><table className="t"><tbody>{b.warnings.map((w, i) => <tr key={i}><td>{w}</td></tr>)}</tbody></table></div></>}
        <div className="sect">Baris ditolak ({rej.length})</div>
        <DataTable rows={rej} pageSize={20} empty="Tidak ada baris ditolak." cols={[
          { key: 'f', label: 'File', value: (r) => r.file }, { key: 's', label: 'Sheet', value: (r) => r.sheet },
          { key: 'r', label: 'Baris', num: true, value: (r) => r.rowNo }, { key: 'x', label: 'Alasan', value: (r) => r.reason },
        ]} />
        <div className="sect">Baris asli (audit) — {num(rawCount)} baris, 200 pertama, 12 kolom pertama</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Kolom alamat/telepon/nama penerima tersimpan sebagai “[disembunyikan]”.</div>
        <DataTable rows={raw} pageSize={20} cols={[
          { key: '_f', label: 'Sheet/baris', value: (r) => `${r.sheet}#${r.rowNo}` },
          ...keys.map((k) => ({ key: k, label: k, value: (r: RawRow) => (r.data[k] === null || r.data[k] === undefined ? '' : String(r.data[k])) })),
        ]} />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}><button className="btn" onClick={onClose}>Tutup</button></div>
      </div>
    </div>
  );
}
