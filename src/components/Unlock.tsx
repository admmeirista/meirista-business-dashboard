import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { useData } from '../data';
import { WrongPasswordError } from '../lib/bundle';

const when = (s: string) => new Date(s).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Jendela password untuk membuka paket data terenkripsi yang baru dipublikasikan. */
export function UnlockDialog() {
  const { pendingBundle, unlock, skipBundle, ix } = useData();
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!pendingBundle) return null;
  const hasLocal = ix.ds.orders.length > 0 || ix.ds.income.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true); setErr(null);
    try { await unlock(pw, remember); }
    catch (x) { setErr(x instanceof WrongPasswordError ? 'Password salah. Coba lagi.' : `Gagal membuka data: ${(x as Error).message}`); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div className="modal-bg unlock-bg">
      <form className="modal unlock" onSubmit={submit}>
        <div className="unlock-ic"><Lock className="ic" /></div>
        <h3>Data terenkripsi</h3>
        <p className="muted" style={{ marginTop: 0 }}>Data penjualan terbaru per <b>{when(pendingBundle.header.createdAt)}</b> tersedia. Masukkan password untuk membukanya di perangkat ini.</p>
        <label className="f">Password</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="in full" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" />
          <button type="button" className="btn" onClick={() => setShow(!show)} aria-label="Tampilkan">{show ? <EyeOff className="ic" /> : <Eye className="ic" />}</button>
        </div>
        <label className="row" style={{ marginTop: 12, fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Ingat di perangkat ini (data berikutnya terbuka otomatis)
        </label>
        {err && <div className="err-box">{err}</div>}
        <button className={`btn pri full${busy ? ' busy' : ''}`} style={{ marginTop: 16, width: '100%', height: 44 }} disabled={!pw || busy}>Buka data</button>
        <button type="button" className="link-btn" style={{ marginTop: 12, display: 'block', marginInline: 'auto' }} onClick={skipBundle}>
          {hasLocal ? 'Nanti saja — pakai data yang sudah ada di perangkat ini' : 'Lewati'}
        </button>
      </form>
    </div>,
    document.body,
  );
}

/** Status data di kaki sidebar. */
export function DataStatus() {
  const { bundleAt, checkBundle } = useData();
  return (
    <div className="me">
      <div className="avatar"><Lock className="ic" style={{ width: 16, height: 16 }} /></div>
      <div>
        <div className="n">{bundleAt ? 'Data terenkripsi' : 'Data lokal'}</div>
        <div className="r">{bundleAt ? `per ${new Date(bundleAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Tersimpan di browser ini saja'}</div>
      </div>
      {bundleAt && <button onClick={() => void checkBundle()} title="Periksa data terbaru" aria-label="Periksa data terbaru">↻</button>}
    </div>
  );
}
