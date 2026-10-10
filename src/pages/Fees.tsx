import { Fragment, useMemo } from 'react';
import { Receipt, Percent, Wallet, Scale } from 'lucide-react';
import { useData } from '../data';
import { FilterBar } from '../components/FilterBar';
import { BarList, Composition, TimeChart } from '../components/charts';
import { DataTable, Kpi, PageHead, Panel, Warnings, num, pct, rp, rpShort, dt } from '../components/ui';
import { settlementSummary } from '../lib/metrics/analytics';
import { MARKETPLACE_FEE_GROUPS } from '../lib/fees';
import { BASIS_LABEL } from '../lib/metrics/dataset';

export default function Fees() {
  const { ix, filter } = useData();
  const s = useMemo(() => settlementSummary(ix, filter), [ix, filter]);
  const feeGroups = s.groups.filter((g) => (MARKETPLACE_FEE_GROUPS as readonly string[]).includes(g.key));
  const fields = feeGroups.flatMap((g) => g.fields.map((f) => ({ ...f, group: g.label }))).filter((f) => f.total !== 0);
  const warn = [
    ...(!ix.ds.reports.length ? [{ level: 'warn' as const, text: 'Belum ada laporan Penghasilan. Import file Income.sudah dilepas.*.xlsx.' }] : []),
    ...(s.missingOrderJoin ? [{ level: 'info' as const, text: `${num(s.missingOrderJoin)} record penghasilan tidak punya data Pesanan Selesai, sehingga tidak masuk basis "${BASIS_LABEL[filter.basis]}". Gunakan basis Dana dilepas untuk total yang sama dengan laporan Shopee.` }] : []),
  ];
  return (
    <>
      <PageHead eyebrow="Keuangan" title="Breakdown Biaya Marketplace" />
      <FilterBar />
      <Warnings items={warn} />
      <div className="kpis">
        <Kpi dark icon={<Wallet className="ic" />} label="Dana dilepas" value={rpShort(s.totalIncome)} sub={`${num(s.records)} pesanan dilepas`} formula="Σ Total Penghasilan baris Order. Sama dengan '3. Total yang Dilepas' di Summary Shopee bila basis = Dana dilepas dan rentang = periode laporan." />
        <Kpi icon={<Receipt className="ic" />} label="Biaya marketplace" value={rpShort(s.marketplaceFees)} sub="Platform, XTRA, layanan, promosi, lainnya, pajak" formula="Tanda asli Shopee dipertahankan (biaya bernilai negatif)." />
        <Kpi icon={<Percent className="ic" />} label="Fee rate" value={pct(s.feeRate, 2)} sub={`dari harga produk ${rpShort(s.productPrice)}`} formula="−Biaya marketplace ÷ Σ Harga Produk (baris Order)." />
        <Kpi icon={<Scale className="ic" />} label="Penyesuaian" value={rpShort(s.adjustments)} sub={`Dana + penyesuaian ${rpShort(s.netWithAdjustments)}`} formula="Sheet Adjustment, diimport terpisah dari transaksi reguler. Basis Dana dilepas → Tanggal Penyesuaian Dibuat; basis lain → tanggal pesanan terhubung." />
      </div>
      <div className="g21">
        <Panel title="Komposisi biaya marketplace" sub="Per grup biaya Shopee">
          <Composition rows={feeGroups} label={(g) => g.label.replace(' (Opsional)', '')} value={(g) => -g.total} format={rpShort} />
          <div className="sect">Per jenis biaya</div>
          <BarList rows={fields.sort((a, b) => a.total - b.total)} label={(f) => f.label} sub={(f) => f.group} value={(f) => f.total} format={rpShort} max={14} />
        </Panel>
        <Panel title="Rincian penghasilan" sub="Struktur sama dengan Ringkasan Penghasilan Shopee">
          <div className="tablewrap flat">
            <table className="t">
              <tbody>
                {s.groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr><td style={{ fontWeight: 800 }}>{g.label}</td><td className="num" style={{ fontWeight: 800 }}>{rp(g.total)}</td></tr>
                    {g.fields.map((f) => <tr key={g.key + f.label}><td style={{ paddingLeft: 26, color: '#4e5751' }}>{f.label}</td><td className={`num ${f.total < 0 ? 'neg' : ''}`}>{rp(f.total)}</td></tr>)}
                  </Fragment>
                ))}
              </tbody>
              <tfoot><tr><td>Total yang dilepas</td><td className="num">{rp(s.totalIncome)}</td></tr></tfoot>
            </table>
          </div>
        </Panel>
      </div>
      <div className="g2">
        <Panel title="Biaya marketplace per hari" sub="Menurut Tanggal Dana Dilepaskan">
          <TimeChart data={s.daily} value={(d) => -d.fees} format={rp} label="Biaya" height={190} />
        </Panel>
        <Panel title="Penyesuaian per tipe">
          <BarList rows={s.adjustmentsByType} label={(a) => a.type} sub={(a) => `${a.count} transaksi`} value={(a) => a.total} format={rpShort} />
        </Panel>
      </div>
      <Panel title="Transaksi penyesuaian" sub="Sheet Adjustment — terhubung ke No. Pesanan, bisa dari periode lain">
        <DataTable rows={ix.ds.adjustments} csvName="penyesuaian" pageSize={20} initialSort={{ key: 'd', dir: -1 }} cols={[
          { key: 'd', label: 'Tanggal', value: (a) => a.date, render: (a) => dt(a.date) },
          { key: 't', label: 'Tipe', value: (a) => a.type, render: (a) => <>{a.type}{a.reason && <div className="sub">{a.reason}</div>}</>, className: 'wrap' },
          { key: 'o', label: 'No. Pesanan', value: (a) => a.orderNo, render: (a) => <span className="mono">{a.orderNo}</span> },
          { key: 'p', label: 'Pesanan diimport?', value: (a) => (ix.orderByNo.has(a.orderNo) ? 'Ya' : 'Tidak'), render: (a) => (ix.orderByNo.has(a.orderNo) ? <span className="tag ok">Ya</span> : <span className="tag">Tidak</span>) },
          { key: 'a', label: 'Nominal', num: true, value: (a) => a.amount, render: (a) => <span className={a.amount < 0 ? 'neg' : ''}>{rp(a.amount)}</span>, total: (rs) => rp(rs.reduce((t, a) => t + a.amount, 0)) },
        ]} />
      </Panel>
    </>
  );
}
