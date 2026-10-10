import { useData } from '../data';
import { Link } from 'react-router-dom';
import { PageHead, Panel, num } from '../components/ui';

const METRICS: { area: string; items: { name: string; formula: string; source: string; note?: string }[] }[] = [
  { area: 'Penjualan', items: [
    { name: 'Penjualan (GMV)', formula: 'Σ item.Subtotal Pesanan\n= Σ (Harga Setelah Diskon × Jumlah)', source: 'Pesanan Selesai — level item', note: 'Nilai level pesanan (Total Pembayaran, voucher, ongkir) TIDAK ikut dijumlahkan per item.' },
    { name: 'Jumlah pesanan', formula: 'COUNT DISTINCT No. Pesanan', source: 'Pesanan Selesai' },
    { name: 'Unit terjual', formula: 'Σ item.Jumlah', source: 'Pesanan Selesai — level item' },
    { name: 'AOV', formula: 'GMV ÷ jumlah pesanan', source: 'Turunan' },
    { name: 'Dibayar pembeli', formula: 'Σ pesanan.Total Pembayaran (sekali per pesanan)', source: 'Pesanan Selesai — level pesanan' },
  ] },
  { area: 'Penghasilan & biaya', items: [
    { name: 'Dana dilepas', formula: 'Σ Total Penghasilan WHERE Lihat berdasarkan = "Order"', source: 'Penghasilan - 1 + Penghasilan - 2', note: 'Baris "Sku" adalah alokasi per produk dari baris Order yang sama — tidak dijumlahkan ke total.' },
    { name: 'Biaya marketplace', formula: 'Σ (Biaya Administrasi + Biaya Proses Pesanan\n + Biaya Gratis Ongkir XTRA (3 kolom) + Biaya Layanan Promo XTRA\n + AMS Service Fee + Biaya Kampanye + Biaya Komisi AMS + Biaya Isi Saldo Otomatis\n + Premi + Biaya Transaksi + FBS Fee + PPh 22)', source: 'Penghasilan — baris Order', note: 'Tanda asli Shopee dipertahankan (biaya negatif).' },
    { name: 'Fee rate', formula: '−Biaya marketplace ÷ Σ Harga Produk', source: 'Penghasilan — baris Order' },
    { name: 'Penyesuaian', formula: 'Σ Biaya Penyesuaian (sheet Adjustment)', source: 'Adjustment', note: 'Terpisah dari transaksi reguler; tidak termasuk dalam "Total yang Dilepas" di Summary.' },
  ] },
  { area: 'Pengembalian', items: [
    { name: 'Refund selesai', formula: 'Σ Total Pengembalian Dana\nWHERE status ∉ {Dibatalkan, Ditolak} AND Waktu Pengembalian Dana Selesai terisi', source: 'Pengembalian — level pengajuan (No. Pengembalian)' },
    { name: 'Tingkat pengembalian', formula: 'pesanan dibuat di rentang yang punya pengajuan valid ÷ pesanan dibuat di rentang', source: 'Pesanan Selesai × Pengembalian', note: 'Kohort berdasarkan tanggal pesanan dibuat, karena pengajuan bisa terjadi bulan berikutnya.' },
  ] },
  { area: 'Profitabilitas', items: [
    { name: 'Alokasi dana per item', formula: 'Total Penghasilan pesanan × (item.Subtotal ÷ Σ Subtotal pesanan)', source: 'Pesanan Selesai × Penghasilan' },
    { name: 'HPP item', formula: 'HPP per unit (berlaku per tanggal pesanan dibuat) × Isi per Paket × Jumlah', source: 'Master Produk & HPP', note: 'HPP kosong = n/a, TIDAK dianggap 0. Laba hanya dari item ber-HPP; cakupan selalu ditampilkan.' },
    { name: 'Laba kotor & margin', formula: 'Laba = Σ (alokasi − HPP)\nMargin = Laba ÷ Σ alokasi (item ber-HPP)', source: 'Turunan' },
  ] },
  { area: 'Pelanggan', items: [
    { name: 'RFM', formula: 'R = hari dari pesanan terakhir ke akhir rentang\nF = jumlah pesanan · M = Σ GMV\nSkor 1–5 per kuintil', source: 'Pesanan Selesai (Username Pembeli)' },
    { name: 'Pembeli baru', formula: 'bulan pesanan = bulan pesanan pertama pembeli di seluruh data yang diimport', source: 'Pesanan Selesai', note: 'Riwayat sebelum data pertama yang diimport tidak diketahui.' },
  ] },
];

const BASES = [
  ['Pesanan dibuat', 'Waktu Pesanan Dibuat (Pesanan Selesai) / Waktu Pesanan Dibuat (Penghasilan)'],
  ['Pembayaran', 'Waktu Pembayaran Dilakukan — record penghasilan dicocokkan via No. Pesanan'],
  ['Pesanan selesai', 'Waktu Pesanan Selesai — record penghasilan dicocokkan via No. Pesanan'],
  ['Dana dilepas', 'Tanggal Dana Dilepaskan (Penghasilan); untuk pesanan = tanggal pelepasan pertamanya; penyesuaian = Tanggal Penyesuaian Dibuat'],
];

export default function Formulas() {
  const { ix } = useData();
  const ok = ix.ds.checks.filter((c) => c.ok === true).length;
  const bad = ix.ds.checks.filter((c) => c.ok === false).length;
  return (
    <>
      <PageHead eyebrow="Data" title="Rumus Perhitungan & Validasi" />
      <div className={bad ? 'err-box' : ix.ds.checks.length ? 'ok-box' : 'info-box'} style={{ marginBottom: 16 }}>
        {ix.ds.checks.length ? <>Validasi import: <b>{num(ok)}</b> total cocok dengan laporan Shopee, <b>{num(bad)}</b> selisih. <Link to="/recon">Lihat rincian</Link></> : 'Belum ada import untuk divalidasi.'}
      </div>
      <Panel title="Basis tanggal pelaporan" sub="Dipilih di bar filter setiap halaman">
        <div className="tablewrap flat"><table className="t"><tbody>{BASES.map(([b, d]) => <tr key={b}><td style={{ fontWeight: 800, width: 180 }}>{b}</td><td>{d}</td></tr>)}</tbody></table></div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Sistem tidak mengasumsikan bulan dibuat = bulan selesai = bulan dana dilepas = bulan refund. Semua laporan dihubungkan dengan <b>No. Pesanan</b>, lintas periode.</p>
      </Panel>
      {METRICS.map((g) => (
        <div key={g.area}>
          <div className="sect">{g.area}</div>
          <div className="tablewrap flat">
            <table className="t">
              <thead><tr><th style={{ width: 200 }}>Metrik</th><th>Rumus</th><th style={{ width: 240 }}>Sumber</th></tr></thead>
              <tbody>{g.items.map((m) => <tr key={m.name}><td style={{ fontWeight: 700 }}>{m.name}</td><td><div className="formula">{m.formula}</div>{m.note && <div className="sub muted" style={{ marginTop: 6 }}>{m.note}</div>}</td><td>{m.source}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="sect">Kontrol import</div>
      <Panel title="Aturan yang diterapkan saat import">
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9, fontSize: 13.5 }}>
          <li>File identik (hash SHA-256 sama) tidak diimport dua kali; laporan multi-part digabung sebelum dikelompokkan per pesanan.</li>
          <li>Header pesanan disimpan terpisah dari item; nilai level pesanan dicek konsisten antar baris item.</li>
          <li>Pesanan: kunci No. Pesanan — isi sama → duplikat, isi berubah → diperbarui (item diganti). Pengembalian: kunci No. Pengembalian, baris produk dipertahankan.</li>
          <li>Penghasilan: Order dan Sku disimpan terpisah; record keuangan yang sudah ada tidak ditimpa. Penyesuaian dikunci berdasarkan isinya agar laporan bertumpuk tidak menggandakan.</li>
          <li>Judul kolom berulang (mis. "Provinsi") diberi akhiran " (2)". Angka "90.000", "RP -22.000" diparse sesuai format Indonesia.</li>
          <li>Setiap total di Summary & Adjustment dihitung ulang dari baris detail dan disimpan sebagai hasil validasi.</li>
          <li>Baris asli disimpan untuk audit; kolom alamat, telepon, dan nama penerima tidak disimpan.</li>
        </ul>
      </Panel>
    </>
  );
}
