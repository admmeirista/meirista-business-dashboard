import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cloud, CloudUpload, Download, RotateCcw } from 'lucide-react';
import { db } from '../lib/db';
import { backupFileName, createBackup, restoreBackup } from '../lib/backup';
import { driveSettings, downloadBackup, hasToken, isConfigured, listBackups, preloadDrive, requestToken, uploadBackup, type DriveFile } from '../lib/drive';
import { useData } from '../data';
import { downloadBlob, toast } from './ui';

const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const when = (s: string) => new Date(s).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Backup sekarang ke Drive. Panggil langsung dari klik (token diminta di awal agar popup tidak diblokir). */
export async function backupToDrive(tokenP: Promise<string> = requestToken(true)) {
  await tokenP;
  const { blob, meta } = await createBackup(db());
  return uploadBackup(backupFileName(), blob, `Meirista BI — ${meta.counts.orders ?? 0} pesanan, ${meta.counts.income ?? 0} record penghasilan`);
}

export function DriveBackupCard({ compact }: { compact?: boolean }) {
  const { reload } = useData();
  const [, force] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  useEffect(() => preloadDrive(), []);
  const last = driveSettings.last();
  const configured = isConfigured();

  const connect = async () => {
    setBusy('connect');
    try { await requestToken(true); force((x) => x + 1); toast('Google Drive terhubung', 'ok'); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  };
  const backupNow = async () => {
    const tokP = requestToken(true);
    setBusy('backup');
    try { const f = await backupToDrive(tokP); force((x) => x + 1); toast(`Backup tersimpan di Drive (${kb(f.size)})`, 'ok'); if (files) setFiles(await listBackups()); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  };
  const showList = async () => {
    const tokP = requestToken(true);
    setBusy('list');
    try { await tokP; setFiles(await listBackups()); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  };
  const restore = async (f: DriveFile) => {
    if (!confirm(`Pulihkan backup "${f.name}" (${when(f.createdTime)})?\n\nSeluruh data di browser ini akan DIGANTI dengan isi backup.`)) return;
    setBusy('restore');
    try { const m = await restoreBackup(db(), await downloadBackup(f.id)); await reload(); toast(`Dipulihkan: ${m.counts.orders ?? 0} pesanan dari backup ${when(m.exportedAt)}`, 'ok'); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  };
  const local = async () => {
    setBusy('local');
    try { const { blob } = await createBackup(db()); downloadBlob(backupFileName(), blob); } finally { setBusy(null); }
  };

  return (
    <div className="tips">
      <div className="row" style={{ marginBottom: 6 }}><Cloud className="ic" style={{ color: 'var(--info)' }} /><h3 style={{ fontSize: 15 }}>Backup Google Drive</h3></div>
      {!configured ? (
        <div style={{ fontSize: 13, color: '#4e5751' }}>
          Belum diatur. Hubungkan sekali di <Link to="/settings?tab=backup">Pengaturan → Backup</Link>; setelah itu setiap import otomatis dicadangkan ke Drive.
          <div className="row" style={{ marginTop: 10 }}><button className={`btn sm${busy === 'local' ? ' busy' : ''}`} onClick={local}><Download className="ic" />Unduh backup ke komputer</button></div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: '#4e5751' }}>
          {last ? <>Backup terakhir: <b>{when(last.at)}</b> · {kb(last.size)}</> : 'Belum ada backup di Drive.'}
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Folder “Meirista BI Backup” · {driveSettings.auto() ? 'otomatis setiap import' : 'otomatis nonaktif'}</div>
          <div className="row" style={{ marginTop: 10 }}>
            {!hasToken() && <button className={`btn sm${busy === 'connect' ? ' busy' : ''}`} onClick={connect}>Hubungkan</button>}
            <button className={`btn sm pri${busy === 'backup' ? ' busy' : ''}`} onClick={backupNow}><CloudUpload className="ic" />Backup sekarang</button>
            {!compact && <button className={`btn sm${busy === 'list' ? ' busy' : ''}`} onClick={showList}><RotateCcw className="ic" />Pulihkan…</button>}
          </div>
          {files && (
            <div className="tablewrap flat" style={{ marginTop: 10, maxHeight: 260 }}>
              <table className="t"><tbody>
                {files.length === 0 && <tr><td className="muted">Belum ada file backup di Drive.</td></tr>}
                {files.map((f) => <tr key={f.id}><td>{when(f.createdTime)}<div className="sub">{kb(f.size)}</div></td><td className="num"><button className={`btn sm${busy === 'restore' ? ' busy' : ''}`} onClick={() => restore(f)}>Pulihkan</button></td></tr>)}
              </tbody></table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
