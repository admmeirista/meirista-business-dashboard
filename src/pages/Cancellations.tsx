import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Store, Truck, ShoppingBag, CheckCircle2 } from 'lucide-react';
import { useData } from '../data';
import { DataTable, Kpi, Panel, num, pct, rp, rpShort } from '../components/ui';
import { BASIS_DESC } from '../lib/metrics/dataset';
import { cancellationAnalysis } from '../lib/metrics/cancellations';

/** Tab Penjualan → Pembatalan: angka versi Seller Centre, jembatan ke omzet dashboard, dan penyebab pembatalan. */
export function CancellationsPanel() {
  const { ix, filter } = useData();
  const a = useMemo(() => cancellationAnalysis(ix, filter), [ix, filter]);

  if (!a.covered) {
    return (
      <div className="info-box" style={{ display: 'block', marginTop: 0 }}>
        Data pembatalan untuk periode ini belum ada. Import export <b>Semua Pesanan</b> (<span className="mono">Order.all.*.xlsx</span> — Seller Centre › Pesanan Saya › Semua › Export) di <Link to="/import">Import & Backup</Link>.
        Setelah itu halaman ini menampilkan angka <b>Penjualan versi Seller Centre</b>, rincian selisihnya dengan omzet dashboard, dan penyebab pembatalan.
      </div>
    );
  }

  return (
    <>
      <div className="kpis k4">
        <Kpi dark icon={<Store className="ic" />} label="Penjualan (Seller Centre)" value={rpShort(a.sellerCentre.value)} sub={<div className="hint">{num(a.sellerCentre.orders)} pesanan dibayar/dikonfirmasi</div>}
          formula="Definisi Seller Centre 2026: harga produk − voucher/diskon penjual dari pesanan yang dibayar (non-COD) atau dikonfirmasi (COD) di periode ini, termasuk yang kemudian dibatalkan." />
        <Kpi icon={<Ban className="ic" />} label="Dibatalkan" value={num(a.cancelled.orders)} alert={(a.cancelRate ?? 0) > 0.1}
          sub={<div className="hint">{pct(a.cancelRate)} pesanan · {rpShort(a.cancelled.value)}</div>}
          formula="Pesanan yang sudah dibayar/dikonfirmasi lalu berstatus Batal. Sama dengan kartu 'Pesanan Dibatalkan' di Seller Centre." />
        <Kpi icon={<Truck className="ic" />} label="Gagal kirim" value={num(a.failed.orders)} sub={<div className="hint">batal setelah dikirim · {rpShort(a.failed.value)}</div>}
          formula="Pesanan dibatalkan padahal sudah punya Waktu Pengiriman — biasanya COD ditolak atau pengiriman gagal. Ongkir & barang kembali menjadi beban penjual." />
        <Kpi icon={<ShoppingBag className="ic" />} label="Omzet bersih" value={rpShort(a.omzet.value)} sub={<div className="hint">{num(a.omzet.orders)} pesanan · {BASIS_DESC[a.netBasis]}</div>} formula="Pesanan yang tidak dibatalkan. Inilah penjualan yang benar-benar menghasilkan uang." />
      </div>

      <Panel title="Dari Penjualan Seller Centre ke omzet bersih" sub="Setiap selisih dijelaskan per kelompok pesanan"
        actions={a.bridgeMatches ? <span className="tag ok"><CheckCircle2 className="ic" />Cocok</span> : <span className="tag warn">Selisih {rp(a.bridgeTotal.value - a.omzet.value)}</span>}>
        <table className="t">
          <thead><tr><th>Komponen</th><th className="num">Pesanan</th><th className="num">Nilai</th><th>Keterangan</th></tr></thead>
          <tbody>
            {a.bridge.map((b, i) => (
              <tr key={b.label} style={i === 0 ? { fontWeight: 800 } : undefined}>
                <td>{i === 0 ? b.label : (b.value < 0 || b.orders < 0 ? '− ' : '+ ') + b.label}</td>
                <td className="num">{num(Math.abs(b.orders))}</td>
                <td className={`num ${i > 0 && b.value < 0 ? 'neg' : ''}`}>{rp(i === 0 ? b.value : Math.abs(b.value))}</td>
                <td className="muted" style={{ fontSize: 12.5 }}>{b.note}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>= Omzet bersih</td><td className="num">{num(a.omzet.orders)}</td><td className="num">{rp(a.omzet.value)}</td><td /></tr></tfoot>
        </table>
        {a.unpaidCancelled.orders > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Tidak termasuk {num(a.unpaidCancelled.orders)} pesanan yang dibatalkan sebelum dibayar ({rpShort(a.unpaidCancelled.value)}) — Seller Centre juga tidak menghitungnya.</div>}
      </Panel>

      <div className="g2" style={{ marginTop: 14 }}>
        <Panel title="Penyebab pembatalan" sub="Siapa yang membatalkan dan alasannya">
          <div className="lbl-kpi">{a.actors.map((x) => <span key={x.actor} className="pill2">{x.actor} <b>{num(x.orders)}</b></span>)}</div>
          <DataTable rows={a.reasons} pageSize={10} csvName={`pembatalan-${filter.from}-${filter.to}`} cols={[
            { key: 'd', label: 'Alasan', value: (r) => r.detail, className: 'wrap', render: (r) => <>{r.detail}<div className="sub">{r.actor}{r.afterShip ? ` · ${num(r.afterShip)} sudah dikirim` : ''}</div></> },
            { key: 'o', label: 'Pesanan', num: true, value: (r) => r.orders, render: (r) => num(r.orders) },
            { key: 'v', label: 'Nilai', num: true, value: (r) => r.value, render: (r) => rpShort(r.value) },
          ]} />
        </Panel>
        <Panel title="Pembatalan per metode pembayaran">
          <DataTable rows={a.payments} pageSize={10} cols={[
            { key: 'm', label: 'Metode', value: (r) => r.method, render: (r) => <b>{r.method}</b> },
            { key: 't', label: 'Pesanan', num: true, value: (r) => r.total, render: (r) => num(r.total) },
            { key: 'c', label: 'Batal', num: true, value: (r) => r.cancelled, render: (r) => num(r.cancelled) },
            { key: 'f', label: 'Gagal kirim', num: true, value: (r) => r.failed, render: (r) => num(r.failed) },
            { key: 'r', label: 'Tingkat batal', num: true, value: (r) => r.rate, render: (r) => <span className={r.rate > 0.12 ? 'neg' : ''}>{pct(r.rate)}</span> },
          ]} />
        </Panel>
      </div>
    </>
  );
}
