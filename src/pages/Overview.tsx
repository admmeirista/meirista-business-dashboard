import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Package, Wallet, Receipt, Undo2, Users, TrendingUp, Banknote } from 'lucide-react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { BarList, Composition, TimeChart } from '../components/charts';
import { Kpi, PageHead, Panel, Warnings, num, pct, rp, rpShort } from '../components/ui';
import { dataWarnings, profitability, returnsAnalysis, salesBy, salesSummary, settlementSummary } from '../lib/metrics/analytics';
import { BASIS_LABEL } from '../lib/metrics/dataset';

export default function Overview() {
  const { ix, filter } = useData();
  const m = useMemo(() => ({
    s: salesSummary(ix, filter),
    st: settlementSummary(ix, filter),
    ret: returnsAnalysis(ix, filter, 'requested'),
    prof: profitability(ix, filter, 'product'),
    prod: salesBy(ix, filter, 'product'),
    pay: salesBy(ix, filter, 'payment'),
    prov: salesBy(ix, filter, 'province'),
    warn: dataWarnings(ix, filter),
  }), [ix, filter]);
  const { s, st, ret, prof } = m;

  return (
    <>
      <PageHead eyebrow="Analitik" title="Ringkasan Eksekutif" />
      <FilterBar />
      <Warnings items={m.warn} />
      <div className="kpis">
        <Kpi dark icon={<ShoppingBag className="ic" />} label="Penjualan (GMV)" value={rpShort(s.gmv)} sub={`${num(s.orders)} pesanan · ${num(s.units)} unit`}
          formula={<>Σ Subtotal Pesanan per item (Harga Setelah Diskon × Jumlah) dari laporan Pesanan Selesai, basis: {BASIS_LABEL[filter.basis]}.</>} />
        <Kpi icon={<Package className="ic" />} label="Rata-rata per pesanan" value={rp(s.aov)} sub={`${num(s.lines)} baris item`} formula="AOV = GMV ÷ jumlah pesanan unik (No. Pesanan)." small />
        <Kpi icon={<Users className="ic" />} label="Pembeli unik" value={num(s.buyers)} sub="Username (Pembeli)" formula="Jumlah username pembeli unik pada pesanan dalam rentang." />
        <Kpi icon={<Banknote className="ic" />} label="Dibayar pembeli" value={rpShort(s.buyerPaid)} sub="Total Pembayaran" formula="Σ Total Pembayaran level pesanan — dihitung sekali per pesanan, bukan per item." small />
        <Kpi icon={<Wallet className="ic" />} label="Dana dilepas" value={st.records ? rpShort(st.totalIncome) : <span className="na">Belum ada data</span>} sub={st.records ? `${num(st.records)} pesanan · + penyesuaian ${rpShort(st.adjustments)}` : 'Import laporan Penghasilan'}
          formula="Σ Total Penghasilan baris 'Order' laporan Penghasilan (baris 'Sku' tidak dijumlahkan). Penyesuaian ditampilkan terpisah." />
        <Kpi icon={<Receipt className="ic" />} label="Biaya marketplace" value={st.records ? rpShort(st.marketplaceFees) : <span className="na">–</span>} sub={st.records ? `${pct(st.feeRate)} dari harga produk` : ''}
          formula="Σ biaya platform + Gratis Ongkir XTRA + layanan + promosi + lainnya + pajak (tanda asli). Rate = −biaya ÷ Harga Produk." small />
        <Kpi icon={<Undo2 className="ic" />} label="Refund selesai" value={rpShort(ret.refundTotal)} sub={`${num(ret.refundedCount)} pengajuan · ${num(ret.requests)} diajukan`}
          formula="Σ Total Pengembalian Dana pengajuan bukan Dibatalkan/Ditolak dengan Waktu Pengembalian Dana Selesai terisi; rentang menurut tanggal pengajuan." small />
        <Kpi icon={<TrendingUp className="ic" />} label="Laba kotor" value={prof.totals.coverage ? rpShort(prof.totals.profit) : <span className="na">HPP belum diisi</span>}
          sub={prof.totals.coverage ? `Margin ${pct(prof.totals.margin)} · cakupan HPP ${pct(prof.totals.coverage)}` : <Link to="/master">Isi HPP di Master Produk</Link>}
          formula="Alokasi Dana Dilepas per item − HPP, hanya item yang sudah dilepas DAN punya HPP. Item tanpa HPP tidak dianggap 0." small />
      </div>

      <div className="g21">
        <Panel title="Penjualan harian" sub={`GMV per hari · basis ${BASIS_LABEL[filter.basis].toLowerCase()}`}>
          <TimeChart data={s.daily} value={(d) => d.gmv} format={rp} label="GMV" />
        </Panel>
        <Panel title="Metode pembayaran" sub="Porsi GMV">
          <Composition rows={m.pay} label={(r) => r.label} value={(r) => r.gmv} format={rpShort} />
          <div className="sect" style={{ marginTop: 18 }}>Provinsi teratas</div>
          <BarList rows={m.prov} max={5} label={(r) => r.label} value={(r) => r.gmv} format={rpShort} />
        </Panel>
      </div>
      <div className="g2">
        <Panel title="Pesanan harian" sub="Jumlah pesanan unik">
          <TimeChart data={s.daily} value={(d) => d.orders} format={num} label="Pesanan" kind="line" height={180} />
        </Panel>
        <Panel title="Dana dilepas harian" sub="Menurut Tanggal Dana Dilepaskan (record dalam filter)">
          <TimeChart data={st.daily} value={(d) => d.income} format={rp} label="Dana dilepas" height={180} />
        </Panel>
      </div>
      <Panel title="Produk terlaris" sub="Berdasarkan GMV — produk master bila sudah dipetakan, selain itu nama listing" actions={<Link className="btn sm" to="/sales">Detail</Link>}>
        <BarList rows={m.prod} max={10} label={(r) => r.label} sub={(r) => `${num(r.units)} unit · ${num(r.orders)} pesanan${r.sub ? ' · ' + r.sub : ''}`} value={(r) => r.gmv} format={rpShort} />
      </Panel>
    </>
  );
}
