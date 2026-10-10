import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Upload, Trash2, EyeOff, ExternalLink } from 'lucide-react';
import { useData } from '../data';
import { db } from '../lib/db';
import { backupFileName, createBackup, restoreBackup } from '../lib/backup';
import { driveSettings, disconnect } from '../lib/drive';
import { BASIS_LABEL, type DateBasis } from '../lib/metrics/dataset';
import { DriveBackupCard } from '../components/DriveBackup';
import { PageHead, Panel, Tabs, downloadBlob, num, toast } from '../components/ui';
import { FormulasPanel } from './Formulas';

type Tab = 'general' | 'backup' | 'formulas';

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'general';
  return (
    <>
      <PageHead eyebrow="Data" title="Pengaturan" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} items={[{ key: 'general', label: 'Umum' }, { key: 'backup', label: 'Backup & Google Drive' }, { key: 'formulas', label: 'Cara perhitungan' }]} />
      {tab === 'general' && <General />}
      {tab === 'backup' && <Backup />}
      {tab === 'formulas' && <FormulasPanel />}
    </>
  );
}

function General() {
  const { mask, setMask, basis, setBasis, reload, ix } = useData();
  const [usage, setUsage] = useState('');
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => e.usage !== undefined && setUsage(`${(e.usage / 1048576).toFixed(1)} MB`)).catch(() => {});
  }, [ix]);
  const reset = async () => {
    if (prompt('Ketik HAPUS untuk menghapus SEMUA data di browser ini (laporan, master produk, HPP, riwayat).') !== 'HAPUS') return;
    const d = db();
    await d.transaction('rw', d.tables, async () => { for (const t of d.tables) await t.clear(); });
    await reload();
    toast('Semua data dihapus', 'ok');
  };
  return (
    <div className="stack">
      <Panel title="Tanggal untuk menghitung omzet" sub="Dipakai di Ringkasan, Penjualan, Pelanggan, Pengembalian, dan Laba">
        <div className="chips">
          {(['completed', 'created', 'paid'] as DateBasis[]).map((b) => <button key={b} className={basis === b ? 'on' : ''} onClick={() => setBasis(b)}>{BASIS_LABEL[b]}{b === 'completed' ? ' (disarankan)' : ''}</button>)}
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Dana diterima & biaya Shopee selalu memakai tanggal dana dilepas.</p>
      </Panel>
      <Panel title="Privasi">
        <label className="row" style={{ fontWeight: 600 }}><input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} /><EyeOff className="ic" />Samarkan username pembeli di layar & file CSV</label>
      </Panel>
      <Panel title="Data di browser ini" sub={usage ? `${usage} terpakai` : undefined}>
        <div className="kv" style={{ marginBottom: 14 }}>
          <div>Pesanan</div><div>{num(ix.ds.orders.length)}</div>
          <div>Record penghasilan</div><div>{num(ix.ds.income.length)}</div>
          <div>Pengembalian</div><div>{num(ix.ds.returns.length)}</div>
        </div>
        <button className="btn err" onClick={reset}><Trash2 className="ic" />Hapus semua data</button>
      </Panel>
    </div>
  );
}

function Backup() {
  const { reload } = useData();
  const [cid, setCid] = useState(driveSettings.clientId());
  const [auto, setAuto] = useState(driveSettings.auto());
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const origin = location.origin;

  const local = async () => { setBusy(true); try { downloadBlob(backupFileName(), (await createBackup(db())).blob); } finally { setBusy(false); } };
  const restoreFile = async (f: File) => {
    if (!confirm('Pulihkan dari file ini? Seluruh data di browser ini akan DIGANTI.')) return;
    try { const m = await restoreBackup(db(), f); await reload(); toast(`Dipulihkan: ${m.counts.orders ?? 0} pesanan`, 'ok'); } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <div className="g2" style={{ alignItems: 'start' }}>
      <div className="stack">
        <DriveBackupCard />
        <Panel title="Backup manual (file)">
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Satu file .json.gz berisi seluruh data, master produk, HPP, riwayat, dan baris audit — cukup untuk memulihkan dashboard walau file Excel hilang.</p>
          <div className="row">
            <button className={`btn${busy ? ' busy' : ''}`} onClick={local}><Download className="ic" />Unduh backup</button>
            <button className="btn" onClick={() => input.current?.click()}><Upload className="ic" />Pulihkan dari file</button>
            <input ref={input} type="file" accept=".gz,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restoreFile(f); }} />
          </div>
        </Panel>
      </div>
      <Panel title="Hubungkan Google Drive (sekali saja)" sub="Backup masuk ke folder “Meirista BI Backup” di Drive akun Anda">
        <ol style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13, lineHeight: 1.8, color: '#4e5751' }}>
          <li>Buka <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Google Cloud Console <ExternalLink className="ic" style={{ width: 12 }} /></a> dengan akun pemilik Drive → buat project → <b>Enable</b> Google Drive API.</li>
          <li>OAuth consent screen → External → isi nama aplikasi → tambahkan email Anda sebagai <b>Test user</b>.</li>
          <li>Credentials → Create credentials → <b>OAuth client ID</b> → Web application → Authorized JavaScript origins: <code className="mono">{origin}</code></li>
          <li>Salin <b>Client ID</b> ke kolom di bawah, simpan, lalu klik <b>Hubungkan</b>.</li>
        </ol>
        <label className="f">Google OAuth Client ID</label>
        <input className="in full mono" placeholder="xxxxxxxx.apps.googleusercontent.com" value={cid} onChange={(e) => setCid(e.target.value)} />
        <label className="row" style={{ fontWeight: 600, fontSize: 13, marginTop: 12 }}><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); driveSettings.setAuto(e.target.checked); }} />Backup otomatis setiap selesai import</label>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn pri" onClick={() => { if (cid && !/\.apps\.googleusercontent\.com$/.test(cid.trim())) return toast('Client ID tidak valid', 'warn'); driveSettings.setClientId(cid); toast('Tersimpan', 'ok'); location.reload(); }}>Simpan</button>
          {driveSettings.clientId() && <button className="btn ghost" onClick={() => { disconnect(); toast('Sesi Google Drive diputus', 'ok'); }}>Putuskan sesi</button>}
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Izin yang diminta hanya <span className="mono">drive.file</span>: aplikasi hanya bisa membaca file backup yang dibuatnya sendiri, bukan isi Drive lainnya.</p>
      </Panel>
    </div>
  );
}
