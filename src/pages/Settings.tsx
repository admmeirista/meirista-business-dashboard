import { useEffect, useRef, useState } from 'react';
import { Download, Upload, Trash2, HardDrive, EyeOff } from 'lucide-react';
import { useData } from '../data';
import { db, AUDIT_TABLES, DATA_TABLES, MASTER_TABLES } from '../lib/db';
import { PageHead, Panel, downloadBlob, num, toast } from '../components/ui';

const ALL_TABLES = [...DATA_TABLES, ...MASTER_TABLES, ...AUDIT_TABLES];
type TableName = (typeof ALL_TABLES)[number];

export default function Settings() {
  const { mask, setMask, reload, ix } = useData();
  const [usage, setUsage] = useState<string>('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [withRaw, setWithRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const e = await navigator.storage?.estimate?.();
        if (e?.usage !== undefined) setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB dipakai dari kuota ±${((e.quota ?? 0) / 1024 / 1024 / 1024).toFixed(1)} GB`);
        setPersisted((await navigator.storage?.persisted?.()) ?? null);
      } catch { /* tidak didukung */ }
    })();
  }, [ix]);

  const backup = async () => {
    setBusy(true);
    try {
      const out: Record<string, unknown[]> = {};
      for (const t of ALL_TABLES) if (withRaw || t !== 'raw') out[t] = await (db() as unknown as Record<TableName, { toArray(): Promise<unknown[]> }>)[t].toArray();
      const blob = new Blob([JSON.stringify({ app: 'meirista-bi', version: 1, exportedAt: new Date().toISOString(), tables: out })], { type: 'application/json' });
      downloadBlob(`backup-meirista-bi-${new Date().toISOString().slice(0, 10)}.json`, blob);
    } finally { setBusy(false); }
  };

  const restore = async (f: File) => {
    if (!confirm('Pulihkan backup? Seluruh data di browser ini akan DIGANTI dengan isi file backup.')) return;
    setBusy(true);
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'meirista-bi' || !j.tables) throw new Error('Bukan file backup Meirista BI.');
      const d = db();
      await d.transaction('rw', d.tables, async () => {
        for (const t of ALL_TABLES) {
          const tbl = (d as unknown as Record<TableName, { clear(): Promise<void>; bulkPut(r: unknown[]): Promise<unknown> }>)[t];
          await tbl.clear();
          if (Array.isArray(j.tables[t])) await tbl.bulkPut(j.tables[t]);
        }
      });
      await reload();
      toast('Backup dipulihkan', 'ok');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };

  const reset = async () => {
    const v = prompt('Ketik HAPUS untuk menghapus SEMUA data laporan, master produk, HPP, dan riwayat import di browser ini.');
    if (v !== 'HAPUS') return;
    const d = db();
    await d.transaction('rw', d.tables, async () => { for (const t of d.tables) await t.clear(); });
    await reload();
    toast('Semua data dihapus', 'ok');
  };

  return (
    <>
      <PageHead eyebrow="Data" title="Pengaturan & Backup" />
      <div className="g2">
        <Panel title="Privasi tampilan">
          <label className="row" style={{ fontWeight: 600 }}><input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} /><EyeOff className="ic" />Samarkan username pembeli di layar & export CSV</label>
          <p className="muted" style={{ fontSize: 13 }}>Alamat, nomor telepon, dan nama penerima tidak pernah disimpan. Username tetap disimpan karena dibutuhkan untuk analisis retensi & RFM.</p>
        </Panel>
        <Panel title="Penyimpanan lokal" sub={usage || 'Ukuran tidak tersedia'}>
          <div className="kv">
            <div>Pesanan / item</div><div>{num(ix.ds.orders.length)} / {num(ix.ds.items.length)}</div>
            <div>Record penghasilan</div><div>{num(ix.ds.income.length)}</div>
            <div>Pengembalian</div><div>{num(ix.ds.returns.length)}</div>
            <div>Penyimpanan permanen</div><div>{persisted === null ? '–' : persisted ? 'Ya' : <button className="link-btn" onClick={async () => setPersisted(await navigator.storage.persist())}>Minta izin agar browser tidak menghapus data</button>}</div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}><HardDrive className="ic" style={{ width: 14 }} /> Data hanya ada di browser & perangkat ini. Membersihkan data situs akan menghapusnya — buat backup secara berkala.</p>
        </Panel>
      </div>
      <Panel title="Backup & pemulihan" sub="Pindahkan data ke komputer lain atau simpan cadangan">
        <div className="row">
          <button className={`btn pri${busy ? ' busy' : ''}`} onClick={backup}><Download className="ic" />Unduh backup (.json)</button>
          <label className="row" style={{ fontSize: 13, fontWeight: 600 }}><input type="checkbox" checked={withRaw} onChange={(e) => setWithRaw(e.target.checked)} />Sertakan baris audit asli (file lebih besar)</label>
          <span className="grow" />
          <button className="btn" onClick={() => input.current?.click()}><Upload className="ic" />Pulihkan dari backup</button>
          <input ref={input} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f); }} />
        </div>
        <div className="warn-box">File backup berisi data transaksi & username pembeli. Simpan di tempat aman dan jangan diunggah ke repositori GitHub.</div>
      </Panel>
      <div style={{ height: 14 }} />
      <Panel title="Zona berbahaya">
        <button className="btn err" onClick={reset}><Trash2 className="ic" />Hapus semua data</button>
      </Panel>
    </>
  );
}
