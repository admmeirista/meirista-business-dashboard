// Backup ke Google Drive langsung dari browser (Google Identity Services + Drive API v3).
// Scope drive.file: aplikasi hanya bisa melihat/mengubah file yang dibuatnya sendiri — bukan seluruh isi Drive.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Meirista BI Backup';
const LS = { clientId: 'bi.drive.clientId', auto: 'bi.drive.auto', last: 'bi.drive.last', folder: 'bi.drive.folder' };

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* tidak tersedia */ } },
};

interface TokenClient { requestAccessToken(o?: { prompt?: string }): void; callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void }
declare global { interface Window { google?: { accounts: { oauth2: { initTokenClient(c: { client_id: string; scope: string; callback: TokenClient['callback'] }): TokenClient; revoke(t: string, cb?: () => void): void } } } } }

let token: { value: string; exp: number } | null = null;
let client: TokenClient | null = null;
let gisLoading: Promise<void> | null = null;

export const driveSettings = {
  clientId: () => ls.get(LS.clientId) ?? (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '',
  setClientId: (v: string) => { ls.set(LS.clientId, v.trim() || null); client = null; },
  auto: () => ls.get(LS.auto) !== '0',
  setAuto: (v: boolean) => ls.set(LS.auto, v ? '1' : '0'),
  last: (): { at: string; name: string; size: number } | null => { try { return JSON.parse(ls.get(LS.last) ?? 'null'); } catch { return null; } },
};

export const isConfigured = () => !!driveSettings.clientId();
export const hasToken = () => !!token && token.exp > Date.now() + 60_000;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return (gisLoading ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => { gisLoading = null; rej(new Error('Gagal memuat Google Sign-In (cek koneksi internet).')); };
    document.head.appendChild(s);
  }));
}

/** Pra-muat skrip Google agar permintaan izin bisa dibuka langsung saat tombol diklik (tidak diblokir popup blocker). */
export function preloadDrive() { if (isConfigured()) void loadGis().catch(() => {}); }

/**
 * Minta access token. Harus dipanggil langsung dari klik pengguna (sinkron di awal handler)
 * supaya jendela izin Google tidak diblokir browser.
 */
export function requestToken(interactive = true): Promise<string> {
  if (hasToken()) return Promise.resolve(token!.value);
  const cid = driveSettings.clientId();
  if (!cid) return Promise.reject(new Error('Google Drive belum dikonfigurasi (Client ID kosong).'));
  if (!window.google?.accounts?.oauth2) return loadGis().then(() => requestToken(interactive));
  return new Promise((resolve, reject) => {
    client ??= window.google!.accounts.oauth2.initTokenClient({ client_id: cid, scope: SCOPE, callback: () => {} });
    client.callback = (r) => {
      if (r.error || !r.access_token) return reject(new Error(r.error === 'access_denied' ? 'Izin Google Drive ditolak.' : `Login Google gagal: ${r.error ?? 'tanpa token'}`));
      token = { value: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 };
      resolve(r.access_token);
    };
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

export function disconnect() {
  if (token && window.google) window.google.accounts.oauth2.revoke(token.value);
  token = null;
  ls.set(LS.folder, null);
}

async function api(path: string, init: RequestInit = {}, base = 'https://www.googleapis.com/drive/v3') {
  const t = await requestToken(false);
  const r = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  if (r.status === 401) { token = null; throw new Error('Sesi Google Drive kedaluwarsa — klik Hubungkan lagi.'); }
  if (!r.ok) throw new Error(`Google Drive error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

async function folderId(): Promise<string> {
  const cached = ls.get(LS.folder);
  if (cached) {
    const r = await api(`/files/${cached}?fields=id,trashed`).then((x) => x.json()).catch(() => null);
    if (r && !r.trashed) return cached;
  }
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await api(`/files?q=${q}&fields=files(id)&spaces=drive`).then((x) => x.json());
  let id: string = found.files?.[0]?.id;
  if (!id) {
    id = (await api('/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) }).then((x) => x.json())).id;
  }
  ls.set(LS.folder, id);
  return id;
}

export interface DriveFile { id: string; name: string; size: number; createdTime: string }

export async function uploadBackup(name: string, blob: Blob, description: string): Promise<DriveFile> {
  const parent = await folderId();
  const meta = { name, parents: [parent], description, mimeType: 'application/gzip' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', blob);
  const f: DriveFile = await api('/files?uploadType=multipart&fields=id,name,size,createdTime', { method: 'POST', body: form }, 'https://www.googleapis.com/upload/drive/v3').then((x) => x.json());
  ls.set(LS.last, JSON.stringify({ at: new Date().toISOString(), name: f.name, size: Number(f.size) }));
  return { ...f, size: Number(f.size) };
}

export async function listBackups(): Promise<DriveFile[]> {
  const parent = await folderId();
  const q = encodeURIComponent(`'${parent}' in parents and trashed=false`);
  const r = await api(`/files?q=${q}&orderBy=createdTime desc&pageSize=50&fields=files(id,name,size,createdTime)`).then((x) => x.json());
  return (r.files ?? []).map((f: DriveFile) => ({ ...f, size: Number(f.size) }));
}

export async function downloadBackup(id: string): Promise<Blob> {
  return (await api(`/files/${id}?alt=media`)).blob();
}
