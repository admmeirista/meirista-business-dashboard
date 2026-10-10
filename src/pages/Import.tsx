import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, UploadCloud, X, ShieldCheck } from 'lucide-react';
import { db } from '../lib/db';
import { commitUpload, kindLabel, parseInWorker } from '../lib/importer';
import type { ImportBatch, ReportKind } from '../lib/types';
import type { ParsedUpload } from '../lib/pipeline';
import type { TotalCheck } from '../lib/parse/common';
import { useData } from '../data';
import { CheckTag, PageHead, checkVal, num, toast } from '../components/ui';

const guessKind = (n: string): ReportKind | null =>
  /^Order\.completed\./i.test(n) ? 'completed' : /^Order\.return_refund\./i.test(n) ? 'returns' : /^Income\.sudah dilepas\./i.test(n) ? 'income' : null;

interface Result { batches: ImportBatch[]; parsed: ParsedUpload; skipped: string[] }

export default function Import() {
  const { reload } = useData();
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) if (/\.xlsx?$/i.test(f.name) && !next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    setFiles(next);
    setResult(null);
  };

  const run = async () => {
    if (!files.length) return;
    try {
      setBusy('Membaca & memvalidasi file…');
      const known = await db().files.toArray();
      const uploads = await Promise.all(files.map(async (f) => ({ name: f.name, buf: await f.arrayBuffer() })));
      const parsed = await parseInWorker(uploads, known.map((k) => k.hash));
      const knownHashes = new Set(known.map((k) => k.hash));
      const skipped = parsed.files.filter((f) => knownHashes.has(f.hash)).map((f) => `${f.name} — file identik sudah diimport ${new Date(known.find((k) => k.hash === f.hash)!.importedAt).toLocaleString('id-ID')}`);
      setBusy('Menyimpan ke database lokal…');
      const batches = await commitUpload(db(), parsed);
      setResult({ batches, parsed, skipped });
      setFiles([]);
      await reload();
      const failed = batches.filter((b) => b.status === 'FAILED').length;
      toast(failed ? `${failed} jenis laporan gagal diimport` : batches.length ? 'Import selesai' : 'Tidak ada data baru', failed ? 'err' : batches.length ? 'ok' : 'warn');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead eyebrow="Data" title="Import Laporan Shopee" />
      <div className="imp">
        <div className="stack">
          <div
            className={`drop${over ? ' over' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          >
            <div className="di"><UploadCloud className="ic" /></div>
            <div className="dt">Tarik file Excel Shopee ke sini</div>
            <div className="ds">atau <b>klik untuk memilih</b> — boleh banyak file sekaligus, termasuk laporan multi-part</div>
            <div className="fmt"><span>Order.completed.*.xlsx</span><span>Order.return_refund.*.xls</span><span>Income.sudah dilepas.*.xlsx</span></div>
            <input ref={input} type="file" accept=".xlsx,.xls" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          </div>

          {files.map((f) => (
            <div className="file-card" key={f.name + f.size}>
              <div className="fi">{f.name.toLowerCase().endsWith('.xls') ? 'XLS' : 'XLSX'}</div>
              <div className="grow">
                <div className="fn">{f.name}</div>
                <div className="fs">{(f.size / 1024 / 1024).toFixed(2)} MB · {guessKind(f.name) ? kindLabel(guessKind(f.name)!) : 'Jenis dideteksi dari isi file'}</div>
                {busy && <div className="indet" />}
              </div>
              {!busy && <button className="btn ghost sm" onClick={() => setFiles(files.filter((x) => x !== f))} aria-label="Hapus"><X className="ic" /></button>}
            </div>
          ))}
          {files.length > 0 && (
            <div className="row">
              <button className={`btn pri${busy ? ' busy' : ''}`} onClick={run} disabled={!!busy}><FileSpreadsheet className="ic" />Import {files.length} file</button>
              {busy && <span className="muted">{busy}</span>}
            </div>
          )}

          {result && <ImportResult r={result} />}
        </div>

        <div className="stack">
          <div className="tips">
            <h3 style={{ fontSize: 15 }}>Laporan yang didukung</h3>
            <ol>
              <li><span><b>Pesanan Selesai</b> — Seller Centre › Pesanan Saya › Selesai › Export. Unggah semua part (part_1_of_2, part_2_of_2) agar data periode lengkap.</span></li>
              <li><span><b>Pengembalian/Pembatalan</b> — Pesanan Saya › Pengembalian › Export (.xls/.xlsx).</span></li>
              <li><span><b>Penghasilan Saya</b> — Keuangan › Penghasilan Saya › Sudah Dilepas › Export. Keenam sheet dibaca otomatis.</span></li>
              <li><span>File yang sama tidak akan diimport dua kali. Import ulang file periode yang tumpang tindih aman: pesanan dicocokkan via <b>No. Pesanan</b>.</span></li>
            </ol>
          </div>
          <div className="tips">
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <ShieldCheck className="ic" style={{ color: 'var(--ok)', marginTop: 2 }} />
              <div style={{ fontSize: 13, color: '#4e5751' }}>
                <b style={{ color: 'var(--fg)' }}>Data tetap di komputer ini.</b> File diproses di browser dan disimpan di database lokal (IndexedDB) — tidak diunggah ke server/GitHub.
                Kolom alamat, nomor telepon, dan nama penerima <b>tidak disimpan</b> (laporan Pengembalian memuatnya tanpa disamarkan).
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ImportResult({ r }: { r: Result }) {
  const checksFor = (k: ReportKind): TotalCheck[] => (r.parsed[k]?.result?.checks ?? []);
  return (
    <div className="stack">
      {r.skipped.length > 0 && <div className="warn-box" style={{ display: 'block' }}><b>Dilewati (sudah pernah diimport):</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.skipped.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      {r.parsed.unknown.map((f) => <div key={f.hash} className="err-box">{f.name}: {f.info.problem}</div>)}
      {r.batches.map((b) => {
        const checks = checksFor(b.kind);
        return (
          <div className="panel" key={b.id}>
            <div className="panel-h">
              <h3>{kindLabel(b.kind)}</h3>
              <span className={`tag ${b.status === 'OK' ? 'ok' : b.status === 'WARNING' ? 'warn' : 'err'}`}>{b.status === 'OK' ? 'Berhasil' : b.status === 'WARNING' ? 'Berhasil dengan catatan' : 'Gagal'}</span>
              <div className="act"><Link to="/history" className="btn sm">Riwayat</Link></div>
            </div>
            <div className="lbl-kpi">
              <span className="pill2">Baris dibaca <b>{num(b.rowsRead)}</b></span>
              <span className="pill2 acc">Baru <b>{num(b.inserted)}</b></span>
              <span className="pill2">Diperbarui <b>{num(b.updated)}</b></span>
              <span className="pill2">Duplikat <b>{num(b.duplicates)}</b></span>
              <span className="pill2">Ditolak <b>{num(b.rejected)}</b></span>
            </div>
            {b.errors.map((e) => <div key={e} className="err-box">{e}</div>)}
            {b.warnings.slice(0, 8).map((w) => <div key={w} className="warn-box">{w}</div>)}
            {b.warnings.length > 8 && <div className="muted" style={{ marginTop: 8 }}>+{b.warnings.length - 8} catatan lain di Riwayat Import.</div>}
            {checks.length > 0 && (
              <>
                <div className="sect">Validasi total terhadap laporan asli</div>
                <div className="tablewrap flat">
                  <table className="t">
                    <thead><tr><th>Pemeriksaan</th><th className="num">Laporan Shopee</th><th className="num">Hasil import</th><th>Status</th></tr></thead>
                    <tbody>{checks.map((c, i) => <tr key={i}><td>{c.label}<div className="sub muted">{c.scope}</div></td><td className="num">{checkVal(c.label, c.reported)}</td><td className="num">{checkVal(c.label, c.computed)}</td><td><CheckTag ok={c.ok} /></td></tr>)}</tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
