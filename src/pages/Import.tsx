import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, UploadCloud, X, ShieldCheck, CheckCircle2, AlertTriangle, Info as InfoIcon } from 'lucide-react';
import { db } from '../lib/db';
import { commitUpload, kindLabel, parseInWorker } from '../lib/importer';
import type { ImportBatch, ReportKind } from '../lib/types';
import type { ParsedUpload } from '../lib/pipeline';
import type { TotalCheck } from '../lib/parse/common';
import { driveSettings, isConfigured, preloadDrive, requestToken } from '../lib/drive';
import type { Index } from '../lib/metrics/dataset';
import { useData } from '../data';
import { CheckTag, PageHead, Tabs, checkVal, num, toast } from '../components/ui';
import { DriveBackupCard, backupToDrive } from '../components/DriveBackup';
import { ImportHistoryPanel } from './ImportHistory';

const guessKind = (n: string): ReportKind | null =>
  /^Order\.completed\./i.test(n) ? 'completed' : /^Order\.return_refund\./i.test(n) ? 'returns' : /^Income\.sudah dilepas\./i.test(n) ? 'income' : null;

interface Result { batches: ImportBatch[]; parsed: ParsedUpload; skipped: string[]; backup: { ok: boolean; text: string } | null }

export default function Import() {
  const [tab, setTab] = useState<'import' | 'history'>('import');
  return (
    <>
      <PageHead eyebrow="Data" title="Import & Backup Data" />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'import', label: 'Import laporan' }, { key: 'history', label: 'Riwayat import' }]} />
      {tab === 'import' ? <ImportPanel /> : <ImportHistoryPanel />}
    </>
  );
}

function ImportPanel() {
  const { reload, ix } = useData();
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const health = useMemo(() => dataHealth(ix), [ix]);
  useEffect(() => preloadDrive(), []);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) if (/\.xlsx?$/i.test(f.name) && !next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    setFiles(next);
    setResult(null);
  };

  const run = async () => {
    if (!files.length) return;
    // Izin Google Drive diminta di awal klik agar jendelanya tidak diblokir browser.
    const tokP = isConfigured() && driveSettings.auto() ? requestToken(true) : null;
    tokP?.catch(() => {});
    try {
      setBusy('Membaca & memvalidasi file…');
      const known = await db().files.toArray();
      const uploads = await Promise.all(files.map(async (f) => ({ name: f.name, buf: await f.arrayBuffer() })));
      const parsed = await parseInWorker(uploads, known.map((k) => k.hash));
      const knownHashes = new Set(known.map((k) => k.hash));
      const skipped = parsed.files.filter((f) => knownHashes.has(f.hash)).map((f) => `${f.name} — sudah pernah diimport ${new Date(known.find((k) => k.hash === f.hash)!.importedAt).toLocaleString('id-ID')}`);
      setBusy('Menyimpan ke database lokal…');
      const batches = await commitUpload(db(), parsed);
      let backup: Result['backup'] = null;
      if (tokP && batches.some((b) => b.status !== 'FAILED' && b.inserted + b.updated > 0)) {
        setBusy('Mencadangkan ke Google Drive…');
        try { const f = await backupToDrive(tokP); backup = { ok: true, text: `Backup otomatis tersimpan di Google Drive (${f.name}).` }; }
        catch (e) { backup = { ok: false, text: `Backup Drive gagal: ${(e as Error).message} — klik “Backup sekarang”.` }; }
      }
      setResult({ batches, parsed, skipped, backup });
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
          <div className="ds">atau <b>klik untuk memilih</b> — boleh banyak file sekaligus</div>
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
        <DriveBackupCard compact />
        <div className="tips">
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Kelengkapan data</h3>
          <div className="health">
            {health.map((h, i) => {
              const I = h.level === 'ok' ? CheckCircle2 : h.level === 'warn' ? AlertTriangle : InfoIcon;
              return <div key={i} className={`hrow ${h.level}`}><I className="ic" /><span>{h.text}{h.link && <> <Link to={h.link.to}>{h.link.label}</Link></>}</span></div>;
            })}
          </div>
        </div>
        <div className="tips">
          <h3 style={{ fontSize: 15 }}>Cara export dari Seller Centre</h3>
          <ol>
            <li><span><b>Pesanan Selesai</b> — Pesanan Saya › Selesai › Export. Unggah semua part.</span></li>
            <li><span><b>Pengembalian</b> — Pesanan Saya › Pengembalian › Export.</span></li>
            <li><span><b>Penghasilan</b> — Keuangan › Penghasilan Saya › Sudah Dilepas › Export.</span></li>
          </ol>
          <div className="row" style={{ gap: 8, alignItems: 'flex-start', marginTop: 8, fontSize: 12.5, color: 'var(--muted)' }}>
            <ShieldCheck className="ic" style={{ color: 'var(--ok)', width: 16 }} />
            <span style={{ flex: 1 }}>File diproses di browser ini. Alamat, telepon & nama penerima tidak disimpan. File yang sama tidak akan masuk dua kali.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportResult({ r }: { r: Result }) {
  const checksFor = (k: ReportKind): TotalCheck[] => (r.parsed[k]?.result?.checks ?? []);
  return (
    <div className="stack">
      {r.backup && <div className={r.backup.ok ? 'ok-box' : 'warn-box'}>{r.backup.text}</div>}
      {r.skipped.length > 0 && <div className="info-box" style={{ display: 'block' }}><b>Dilewati karena sudah pernah diimport:</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.skipped.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      {r.parsed.unknown.map((f) => <div key={f.hash} className="err-box">{f.name}: {f.info.problem}</div>)}
      {r.batches.map((b) => {
        const checks = checksFor(b.kind);
        const bad = checks.filter((c) => c.ok === false);
        return (
          <div className="panel" key={b.id}>
            <div className="panel-h">
              <h3>{kindLabel(b.kind)}</h3>
              <span className={`tag ${b.status === 'OK' ? 'ok' : b.status === 'WARNING' ? 'warn' : 'err'}`}>{b.status === 'OK' ? 'Berhasil' : b.status === 'WARNING' ? 'Berhasil, ada catatan' : 'Gagal'}</span>
            </div>
            <div className="lbl-kpi">
              <span className="pill2 acc">Baru <b>{num(b.inserted)}</b></span>
              {b.updated > 0 && <span className="pill2">Diperbarui <b>{num(b.updated)}</b></span>}
              {b.duplicates > 0 && <span className="pill2">Sudah ada <b>{num(b.duplicates)}</b></span>}
              {b.rejected > 0 && <span className="pill2">Ditolak <b>{num(b.rejected)}</b></span>}
              {checks.length > 0 && <span className={`pill2${bad.length ? ' acc' : ''}`}>{bad.length ? <>Total tidak cocok <b>{bad.length}</b></> : <>Total cocok dg laporan Shopee <b>{checks.filter((c) => c.ok).length}/{checks.length}</b></>}</span>}
            </div>
            {b.errors.map((e) => <div key={e} className="err-box">{e}</div>)}
            {b.warnings.slice(0, 4).map((w) => <div key={w} className="warn-box">{w}</div>)}
            {b.warnings.length > 4 && <div className="muted" style={{ marginTop: 8 }}>+{b.warnings.length - 4} catatan lain di tab Riwayat import.</div>}
            {bad.length > 0 && (
              <div className="tablewrap flat" style={{ marginTop: 10 }}>
                <table className="t">
                  <thead><tr><th>Pemeriksaan</th><th className="num">Shopee</th><th className="num">Hasil import</th><th>Status</th></tr></thead>
                  <tbody>{bad.map((c, i) => <tr key={i}><td>{c.label}</td><td className="num">{checkVal(c.label, c.reported)}</td><td className="num">{checkVal(c.label, c.computed)}</td><td><CheckTag ok={c.ok} /></td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Kelengkapan seluruh data — dipindah dari Ringkasan agar halaman analisis bersih. */
function dataHealth(ix: Index): { level: 'ok' | 'warn' | 'info'; text: string; link?: { to: string; label: string } }[] {
  const ds = ix.ds;
  const span = (a: (string | null)[]) => { const d = a.filter(Boolean).sort() as string[]; return d.length ? `${d[0].slice(0, 10)} s/d ${d[d.length - 1].slice(0, 10)}` : '–'; };
  const out: ReturnType<typeof dataHealth> = [];
  out.push(ds.orders.length ? { level: 'ok', text: `Pesanan Selesai: ${num(ds.orders.length)} pesanan (selesai ${span(ds.orders.map((o) => o.completedAt))}).` } : { level: 'warn', text: 'Pesanan Selesai belum diimport.' });
  out.push(ds.reports.length ? { level: 'ok', text: `Penghasilan: ${ds.reports.map((r) => `${r.from} s/d ${r.to}`).join(', ')}.` } : { level: 'warn', text: 'Laporan Penghasilan belum diimport.' });
  out.push(ds.returns.length ? { level: 'ok', text: `Pengembalian: ${num(ds.returns.length)} pengajuan.` } : { level: 'info', text: 'Laporan Pengembalian belum diimport.' });
  const parts = new Map<string, Set<number | null>>();
  for (const f of ds.files) if (f.partsTotal) { const k = `${f.periodFrom}|${f.periodTo}|${f.partsTotal}`; parts.set(k, (parts.get(k) ?? new Set()).add(f.part)); }
  for (const [k, p] of parts) { const [a, b, t] = k.split('|'); if (p.size < Number(t)) out.push({ level: 'warn', text: `Pesanan Selesai ${a} s/d ${b}: baru ${p.size} dari ${t} part.` }); }
  const unsettled = ds.orders.filter((o) => !ix.incomeByOrder.has(o.orderNo)).length;
  if (ds.reports.length && unsettled) out.push({ level: 'info', text: `${num(unsettled)} pesanan selesai belum ada di laporan Penghasilan (biasanya dilepas di bulan berikutnya).` });
  const unmapped = new Set(ds.items.filter((i) => !ix.mapping.has(i.productKey)).map((i) => i.productKey)).size;
  if (unmapped) out.push({ level: 'info', text: `${num(unmapped)} listing belum dipetakan ke produk & HPP.`, link: { to: '/master', label: 'Petakan' } });
  const bad = ds.checks.filter((c) => c.ok === false).length;
  if (bad) out.push({ level: 'warn', text: `${bad} total laporan Shopee tidak cocok dengan detail.`, link: { to: '/recon', label: 'Lihat' } });
  return out;
}
