import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, Users, MapPin, CreditCard, Undo2, Lightbulb, Receipt, Scale, TrendingUp,
  Upload, History, Boxes, Sigma, Settings as SettingsIcon, Menu, Lock,
} from 'lucide-react';
import { useData } from './data';
import Overview from './pages/Overview';
import Sales from './pages/Sales';
import Customers from './pages/Customers';
import Geography from './pages/Geography';
import Payments from './pages/Payments';
import Returns from './pages/Returns';
import Insights from './pages/Insights';
import Fees from './pages/Fees';
import Reconciliation from './pages/Reconciliation';
import Profitability from './pages/Profitability';
import Import from './pages/Import';
import ImportHistory from './pages/ImportHistory';
import Master from './pages/Master';
import Formulas from './pages/Formulas';
import Settings from './pages/Settings';

const NAV = [
  { sec: 'ANALITIK', items: [
    { to: '/', label: 'Ringkasan Eksekutif', icon: LayoutDashboard },
    { to: '/sales', label: 'Penjualan', icon: ShoppingBag },
    { to: '/customers', label: 'Pelanggan & RFM', icon: Users },
    { to: '/geo', label: 'Geografi', icon: MapPin },
    { to: '/payments', label: 'Metode Pembayaran', icon: CreditCard },
    { to: '/returns', label: 'Pengembalian', icon: Undo2 },
    { to: '/insights', label: 'Insight & Anomali', icon: Lightbulb },
  ] },
  { sec: 'KEUANGAN', items: [
    { to: '/fees', label: 'Biaya Marketplace', icon: Receipt },
    { to: '/recon', label: 'Rekonsiliasi', icon: Scale },
    { to: '/profit', label: 'Profitabilitas', icon: TrendingUp },
  ] },
  { sec: 'DATA', items: [
    { to: '/import', label: 'Import Laporan', icon: Upload },
    { to: '/history', label: 'Riwayat Import', icon: History },
    { to: '/master', label: 'Master Produk & HPP', icon: Boxes },
    { to: '/formulas', label: 'Rumus & Validasi', icon: Sigma },
    { to: '/settings', label: 'Pengaturan & Backup', icon: SettingsIcon },
  ] },
];

const DATA_FREE = ['/import', '/settings', '/formulas', '/master', '/history'];

function Brand() {
  return (
    <div className="brand sm">
      <div className="mark">M</div>
      <div><div className="word">Meirista</div><div className="tag">Business Intelligence</div></div>
    </div>
  );
}

export default function App() {
  const { ix, ready } = useData();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const empty = ready && !ix.ds.orders.length && !ix.ds.income.length && !ix.ds.returns.length;

  return (
    <div className={`adm${open ? ' open' : ''}`}>
      <div className="mtop"><button onClick={() => setOpen(true)} aria-label="Menu"><Menu className="ic" /></button><Brand /></div>
      <aside className="side">
        <Brand />
        {NAV.map((s) => (
          <div key={s.sec}>
            <div className="sec">{s.sec}</div>
            {s.items.map((n) => (
              <NavLink key={n.to} to={n.to} end className={({ isActive }) => `nv${isActive ? ' on' : ''}`}>
                <n.icon className="ic" />{n.label}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="me">
          <div className="avatar"><Lock className="ic" style={{ width: 16, height: 16 }} /></div>
          <div><div className="n">Data lokal</div><div className="r">Tersimpan di browser ini saja</div></div>
        </div>
      </aside>
      {open && <div style={{ position: 'fixed', inset: 0, zIndex: 150 }} onClick={() => setOpen(false)} />}
      <main className="main">
        {!ready ? <div className="loading"><span className="spinner" />Memuat data…</div>
          : empty && !DATA_FREE.includes(loc.pathname) ? <Navigate to="/import" replace />
          : (
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/geo" element={<Geography />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/returns" element={<Returns />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/fees" element={<Fees />} />
              <Route path="/recon" element={<Reconciliation />} />
              <Route path="/profit" element={<Profitability />} />
              <Route path="/import" element={<Import />} />
              <Route path="/history" element={<ImportHistory />} />
              <Route path="/master" element={<Master />} />
              <Route path="/formulas" element={<Formulas />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
      </main>
    </div>
  );
}
