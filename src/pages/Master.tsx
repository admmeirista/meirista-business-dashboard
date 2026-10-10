import { useMemo, useRef, useState } from 'react';
import { Download, Upload, Plus, Trash2, Save } from 'lucide-react';
import { useData } from '../data';
import { db } from '../lib/db';
import { exportMasterWorkbook, importMasterWorkbook, listings, type Listing } from '../lib/master';
import { unitCostAt } from '../lib/metrics/dataset';
import { guessPackSize } from '../lib/parse/util';
import type { CostEntry, Product } from '../lib/types';
import { DataTable, PageHead, Tabs, downloadBlob, num, rp, rpShort, toast } from '../components/ui';

type Tab = 'mapping' | 'products' | 'costs';

export default function Master() {
  const { ix } = useData();
  const [tab, setTab] = useState<Tab>('mapping');
  const lst = useMemo(() => listings(ix), [ix]);
  const mapped = lst.filter((l) => ix.mapping.has(l.key)).length;
  const today = new Date().toISOString().slice(0, 10);
  const withCost = ix.ds.products.filter((p) => unitCostAt(ix, p.id!, today) !== null).length;
  return (
    <>
      <PageHead eyebrow="Data" title="Master Produk, Brand, Kategori & HPP" actions={<MasterExcel />} />
      <div className="lbl-kpi">
        <span className="pill2 acc">Listing terpetakan <b>{num(mapped)}</b> / {num(lst.length)}</span>
        <span className="pill2">Produk <b>{num(ix.ds.products.length)}</b></span>
        <span className="pill2">Produk ber-HPP <b>{num(withCost)}</b></span>
        <span className="pill2">Entri HPP <b>{num(ix.ds.costs.length)}</b></span>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ key: 'mapping', label: 'Pemetaan listing' }, { key: 'products', label: 'Produk' }, { key: 'costs', label: 'HPP' }]} />
      {tab === 'mapping' && <Mapping rows={lst} />}
      {tab === 'products' && <Products />}
      {tab === 'costs' && <Costs />}
    </>
  );
}

function MasterExcel() {
  const { ix, reload } = useData();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => downloadBlob(`master-produk-${new Date().toISOString().slice(0, 10)}.xlsx`, exportMasterWorkbook(ix))}><Download className="ic" />Template Excel</button>
      <button className={`btn pri${busy ? ' busy' : ''}`} onClick={() => input.current?.click()}><Upload className="ic" />Import master</button>
      <input ref={input} type="file" accept=".xlsx" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        setBusy(true);
        try {
          const r = await importMasterWorkbook(db(), await f.arrayBuffer());
          await reload();
          toast(`${r.mappings} pemetaan, ${r.products} produk, ${r.costs} HPP baru${r.errors.length ? ` · ${r.errors.length} baris bermasalah` : ''}`, r.errors.length ? 'warn' : 'ok');
          if (r.errors.length) alert(r.errors.slice(0, 30).join('\n'));
        } catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
      }} />
    </>
  );
}

function Mapping({ rows }: { rows: Listing[] }) {
  const { ix, reload } = useData();
  const [onlyUnmapped, setOnlyUnmapped] = useState(true);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Record<string, { productId: string; pack: string }>>({});
  const products = [...ix.ds.products].sort((a, b) => a.name.localeCompare(b.name));
  const view = rows.filter((l) => (!onlyUnmapped || !ix.mapping.has(l.key)) && (!q || `${l.name} ${l.variation}`.toLowerCase().includes(q.toLowerCase())));
  const val = (l: Listing) => draft[l.key] ?? { productId: String(ix.mapping.get(l.key)?.productId ?? ''), pack: String(ix.mapping.get(l.key)?.packQty ?? guessPackSize(l.name) ?? 1) };
  const set = (l: Listing, patch: Partial<{ productId: string; pack: string }>) => setDraft({ ...draft, [l.key]: { ...val(l), ...patch } });

  const save = async (l: Listing) => {
    const v = val(l);
    let pid = Number(v.productId);
    if (v.productId === 'new') {
      const name = prompt('Nama produk baru:', l.name.replace(/^\[[^\]]*\]\s*/, '').split('/')[0].trim());
      if (!name) return;
      pid = await db().products.add({ name, brand: '', category: '', active: true });
    }
    const pack = Number(v.pack);
    if (!pid) return toast('Pilih produk', 'warn');
    if (!(pack > 0)) return toast('Isi per paket harus > 0', 'warn');
    await db().mappings.put({ listingKey: l.key, listingName: l.name, variation: l.variation, productId: pid, packQty: pack });
    const d = { ...draft }; delete d[l.key]; setDraft(d);
    await reload();
    toast('Pemetaan disimpan', 'ok');
  };

  return (
    <>
      <div className="filters">
        <input className="in grow" placeholder="Cari nama listing / variasi" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row" style={{ fontWeight: 600, fontSize: 13 }}><input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} />Hanya yang belum dipetakan</label>
      </div>
      <div className="info-box" style={{ marginBottom: 12 }}>SKU Induk / Nomor Referensi SKU kosong di export Shopee, jadi pemetaan memakai <b>nama listing + variasi</b>. Untuk banyak listing sekaligus, pakai Template Excel.</div>
      <DataTable rows={view} pageSize={30} empty="Semua listing sudah dipetakan." cols={[
        { key: 'n', label: 'Listing', value: (l) => l.name, className: 'wrap', render: (l) => <><div style={{ fontWeight: 600 }}>{l.name}</div>{l.variation && <span className="tag acc">{l.variation}</span>}</> },
        { key: 'g', label: 'GMV', num: true, value: (l) => l.gmv, render: (l) => rpShort(l.gmv) },
        { key: 'u', label: 'Unit', num: true, value: (l) => l.units, render: (l) => num(l.units) },
        { key: 'p', label: 'Produk master', render: (l) => (
          <select className="in" style={{ width: 220 }} value={val(l).productId} onChange={(e) => set(l, { productId: e.target.value })}>
            <option value="">— pilih —</option><option value="new">+ Produk baru…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.brand ? ` · ${p.brand}` : ''}</option>)}
          </select>) },
        { key: 'k', label: 'Isi/paket', render: (l) => <input className="in" style={{ width: 70 }} type="number" min={1} value={val(l).pack} onChange={(e) => set(l, { pack: e.target.value })} /> },
        { key: 's', label: '', render: (l) => <button className="btn sm" onClick={() => save(l)}><Save className="ic" />Simpan</button> },
      ]} />
    </>
  );
}

function Products() {
  const { ix, reload } = useData();
  const [edit, setEdit] = useState<Product | null>(null);
  const counts = useMemo(() => { const m = new Map<number, number>(); for (const mp of ix.ds.mappings) m.set(mp.productId, (m.get(mp.productId) ?? 0) + 1); return m; }, [ix]);
  const save = async () => {
    if (!edit?.name.trim()) return toast('Nama produk wajib', 'warn');
    if (ix.ds.products.some((p) => p.name.toLowerCase() === edit.name.trim().toLowerCase() && p.id !== edit.id)) return toast('Nama produk sudah ada', 'warn');
    await db().products.put({ ...edit, name: edit.name.trim(), brand: edit.brand.trim(), category: edit.category.trim() });
    setEdit(null); await reload(); toast('Produk disimpan', 'ok');
  };
  const del = async (p: Product) => {
    if (counts.get(p.id!)) return toast('Produk masih dipakai pemetaan listing', 'warn');
    if (!confirm(`Hapus produk "${p.name}" beserta riwayat HPP-nya?`)) return;
    await db().costs.where('productId').equals(p.id!).delete();
    await db().products.delete(p.id!); await reload();
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}><button className="btn pri" onClick={() => setEdit({ name: '', brand: '', category: '', active: true })}><Plus className="ic" />Produk</button></div>
      <DataTable rows={ix.ds.products} empty="Belum ada produk. Tambah manual, dari pemetaan listing, atau via Template Excel." cols={[
        { key: 'n', label: 'Produk', value: (p) => p.name, render: (p) => <b>{p.name}</b> },
        { key: 'b', label: 'Brand', value: (p) => p.brand },
        { key: 'c', label: 'Kategori', value: (p) => p.category },
        { key: 'l', label: 'Listing', num: true, value: (p) => counts.get(p.id!) ?? 0 },
        { key: 'h', label: 'HPP berlaku', num: true, value: (p) => unitCostAt(ix, p.id!, new Date().toISOString().slice(0, 10)), render: (p) => { const c = unitCostAt(ix, p.id!, new Date().toISOString().slice(0, 10)); return c === null ? <span className="tag warn">Belum ada</span> : rp(c); } },
        { key: 'a', label: '', render: (p) => <div className="row" style={{ flexWrap: 'nowrap' }}><button className="btn sm" onClick={() => setEdit(p)}>Ubah</button><button className="btn sm ghost" onClick={() => del(p)} aria-label="Hapus"><Trash2 className="ic" /></button></div> },
      ]} />
      {edit && (
        <div className="modal-bg" onClick={() => setEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{edit.id ? 'Ubah produk' : 'Produk baru'}</h3>
            <label className="f">Nama produk</label><input className="in full" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            <label className="f">Brand</label><input className="in full" list="brands" value={edit.brand} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} />
            <datalist id="brands">{[...new Set(ix.ds.products.map((p) => p.brand).filter(Boolean))].map((b) => <option key={b} value={b} />)}</datalist>
            <label className="f">Kategori</label><input className="in full" list="cats" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
            <datalist id="cats">{[...new Set(ix.ds.products.map((p) => p.category).filter(Boolean))].map((b) => <option key={b} value={b} />)}</datalist>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}><button className="btn" onClick={() => setEdit(null)}>Batal</button><button className="btn pri" onClick={save}>Simpan</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function Costs() {
  const { ix, reload } = useData();
  const [form, setForm] = useState<{ productId: string; unitCost: string; effectiveFrom: string; note: string }>({ productId: '', unitCost: '', effectiveFrom: new Date().toISOString().slice(0, 10), note: '' });
  const products = [...ix.ds.products].sort((a, b) => a.name.localeCompare(b.name));
  const add = async () => {
    const cost = Number(form.unitCost);
    if (!form.productId) return toast('Pilih produk', 'warn');
    if (!(cost >= 0) || form.unitCost === '') return toast('HPP tidak valid', 'warn');
    if (!form.effectiveFrom) return toast('Tanggal berlaku wajib', 'warn');
    await db().costs.add({ productId: Number(form.productId), unitCost: cost, effectiveFrom: form.effectiveFrom, note: form.note });
    setForm({ ...form, unitCost: '', note: '' }); await reload(); toast('HPP ditambahkan', 'ok');
  };
  const del = async (c: CostEntry) => { if (confirm('Hapus entri HPP ini?')) { await db().costs.delete(c.id!); await reload(); } };
  return (
    <>
      <div className="filters">
        <select className="in" style={{ minWidth: 240 }} value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
          <option value="">— produk —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="in" type="number" min={0} placeholder="HPP per unit (Rp)" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} />
        <input className="in" type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} aria-label="Berlaku mulai" />
        <input className="in grow" placeholder="Catatan (supplier, no. faktur…)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button className="btn pri" onClick={add}><Plus className="ic" />Tambah HPP</button>
      </div>
      <div className="info-box" style={{ marginBottom: 12 }}>HPP berlaku sejak tanggalnya sampai ada entri yang lebih baru. Pesanan dihitung dengan HPP yang berlaku pada <b>tanggal pesanan dibuat</b>.</div>
      <DataTable rows={ix.ds.costs} initialSort={{ key: 'd', dir: -1 }} empty="Belum ada HPP." cols={[
        { key: 'p', label: 'Produk', value: (c) => ix.productById.get(c.productId)?.name ?? `#${c.productId}`, render: (c) => <b>{ix.productById.get(c.productId)?.name ?? `#${c.productId}`}</b> },
        { key: 'u', label: 'HPP per unit', num: true, value: (c) => c.unitCost, render: (c) => rp(c.unitCost) },
        { key: 'd', label: 'Berlaku mulai', value: (c) => c.effectiveFrom },
        { key: 'n', label: 'Catatan', value: (c) => c.note },
        { key: 'a', label: '', render: (c) => <button className="btn sm ghost" onClick={() => del(c)} aria-label="Hapus"><Trash2 className="ic" /></button> },
      ]} />
    </>
  );
}
