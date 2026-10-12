import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Upload, Trash2, EyeOff, ExternalLink, Sparkles, Eye } from 'lucide-react';
import { aiSettings, testConnection, type GeminiModel } from '../lib/ai';
import { useData } from '../data';
import { db } from '../lib/db';
import { backupFileName, createBackup, restoreBackup } from '../lib/backup';
import { driveSettings, disconnect } from '../lib/drive';
import { BASIS_LABEL, type DateBasis } from '../lib/metrics/dataset';
import { DriveBackupCard } from '../components/DriveBackup';
import { PageHead, Panel, Tabs, downloadBlob, num, toast } from '../components/ui';
import { FormulasPanel } from './Formulas';

type Tab = 'general' | 'backup' | 'ai' | 'formulas';

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'general';
  return (
    <>
      <PageHead eyebrow="Konfigurasi" title="Pengaturan" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} items={[{ key: 'general', label: 'Umum' }, { key: 'backup', label: 'Backup & Google Drive' }, { key: 'ai', label: 'AI' }, { key: 'formulas', label: 'Cara perhitungan' }]} />
      {tab === 'general' && <General />}
      {tab === 'backup' && <Backup />}
      {tab === 'ai' && <AiSettings />}
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

function AiSettings() {
  const [key, setKey] = useState(aiSettings.apiKey());
  const [model, setModel] = useState(aiSettings.model());
  const [models, setModels] = useState<GeminiModel[]>(aiSettings.models());
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const save = () => { aiSettings.setApiKey(key); aiSettings.setModel(model); toast('Pengaturan AI disimpan', 'ok'); };
  const test = async () => {
    aiSettings.setApiKey(key); aiSettings.setModel(model);
    setBusy(true); setStatus(null);
    try {
      const r = await testConnection();
      setModels(r.models); setModel(aiSettings.model());
      setStatus({ ok: true, text: `Terhubung — ${r.models.length} model Gemini tersedia. Model aktif: ${r.model}.` });
    } catch (e) { setStatus({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <div className="g2" style={{ alignItems: 'start' }}>
      <Panel title="Koneksi AI (Google Gemini)" sub="Dipakai tombol “Analisis dengan AI” di sidebar dan di setiap halaman laporan">
        <label className="f">Gemini API key</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="in full mono" type={show ? 'text' : 'password'} placeholder="AIza…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
          <button className="btn" onClick={() => setShow(!show)} aria-label="Tampilkan">{show ? <EyeOff className="ic" /> : <Eye className="ic" />}</button>
        </div>
        <label className="f">Model</label>
        {models.length ? (
          <select className="in full" value={model} onChange={(e) => setModel(e.target.value)}>
            {!models.some((m) => m.id === model) && <option value={model}>{model}</option>}
            {models.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.id})</option>)}
          </select>
        ) : (
          <input className="in full mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gemini-2.5-flash" />
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{models.length ? 'Daftar diambil langsung dari API key Anda.' : 'Klik “Tes koneksi” untuk memuat daftar model yang tersedia.'} Model “Flash” cepat & hemat; “Pro” lebih mendalam.</div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn pri" onClick={save}>Simpan</button>
          <button className={`btn${busy ? ' busy' : ''}`} onClick={test} disabled={!key}><Sparkles className="ic" />Tes koneksi & muat model</button>
          {aiSettings.apiKey() && <button className="btn ghost" onClick={() => { aiSettings.setApiKey(''); setKey(''); setStatus(null); toast('API key dihapus', 'ok'); }}>Hapus key</button>}
        </div>
        {status && <div className={status.ok ? 'ok-box' : 'err-box'}>{status.text}</div>}
      </Panel>
      <Panel title="Cara mendapatkan Gemini API key">
        <ol style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13, lineHeight: 1.8, color: '#4e5751' }}>
          <li>Buka <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio <ExternalLink className="ic" style={{ width: 12 }} /></a> dengan akun Google Anda.</li>
          <li>Klik <b>Create API key</b> (pilih/buat project Google Cloud), lalu salin key (biasanya diawali <span className="mono">AIza</span>).</li>
          <li>Tempel di kolom sebelah, klik <b>Tes koneksi & muat model</b>, pilih model, lalu <b>Simpan</b>.</li>
        </ol>
        <div className="info-box" style={{ display: 'block' }}>
          <b>Privasi & keamanan</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontWeight: 500 }}>
            <li>API key hanya disimpan di browser ini dan dikirim langsung ke Google — tidak ke GitHub atau server lain.</li>
            <li>Yang dikirim ke AI hanya ringkasan angka (omzet, produk, biaya, retur). Username, alamat, dan No. Pesanan tidak dikirim — isinya bisa dilihat lewat “Lihat data yang dikirim”.</li>
            <li>Pada paket <b>gratis</b> Gemini API, Google dapat memakai isi permintaan untuk meningkatkan produknya. Aktifkan billing (paket berbayar) bila tidak ingin data penjualan dipakai Google.</li>
            <li>Siapa pun yang memakai browser ini bisa memakai key tersebut. Batasi key di Google Cloud Console (API restrictions → Generative Language API; Website restrictions → domain dashboard ini).</li>
          </ul>
        </div>
      </Panel>
    </div>
  );
}
