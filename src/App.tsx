import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LayoutDashboard, ShoppingBag, Undo2, Receipt, Scale, Upload, Boxes, Settings as SettingsIcon, Menu, Lock } from 'lucide-react';
import { useData } from './data';
import { AiButton } from './components/Ai';
import { periodLabel } from './components/FilterBar';
import { AI_TASK, aiPayload, type AiTopic } from './lib/metrics/summary';
import Overview from './pages/Overview';
import Sales from './pages/Sales';
import Returns from './pages/Returns';
import Fees from './pages/Fees';
import Reconciliation from './pages/Reconciliation';
import Import from './pages/Import';
import Master from './pages/Master';
import Settings from './pages/Settings';

const NAV = [
  { sec: 'PERFORMA TOKO', items: [
    { to: '/', label: 'Ringkasan', icon: LayoutDashboard },
    { to: '/sales', label: 'Penjualan', icon: ShoppingBag },
    { to: '/returns', label: 'Retur', icon: Undo2 },
    { to: '/costs', label: 'Biaya', icon: Receipt },
  ] },
  { sec: 'KONFIGURASI', items: [
    { to: '/import', label: 'Import & Backup', icon: Upload },
    { to: '/master', label: 'Produk & HPP', icon: Boxes },
    { to: '/recon', label: 'Rekonsiliasi', icon: Scale },
    { to: '/settings', label: 'Pengaturan', icon: SettingsIcon },
  ] },
];

const DATA_FREE = ['/import', '/settings', '/master'];

function Brand() {
  return (
    <div className="brand sm">
      <div className="mark">M</div>
      <div><div className="word">Meirista</div><div className="tag">Business Intelligence</div></div>
    </div>
  );
}

export default function App() {
  const { ix, ready, filter, prev } = useData();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const badChecks = ix.ds.checks.filter((c) => c.ok === false).length;
  const empty = ready && !ix.ds.orders.length && !ix.ds.income.length && !ix.ds.returns.length;

  return (
    <div className={`adm${open ? ' open' : ''}`}>
      <div className="mtop"><button onClick={() => setOpen(true)} aria-label="Menu"><Menu className="ic" /></button><Brand /></div>
      <aside className="side">
        <Brand />
        <SideAi topic={TOPIC[loc.pathname] ?? 'overview'} ix={ix} filter={filter} prev={prev} />
        {NAV.map((s) => (
          <div key={s.sec}>
            <div className="sec">{s.sec}</div>
            {s.items.map((n) => (
              <NavLink key={n.to} to={n.to} end className={({ isActive }) => `nv${isActive ? ' on' : ''}`}>
                <n.icon className="ic" />{n.label}{n.to === '/recon' && badChecks > 0 && <span className="dotn">{badChecks}</span>}
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
              <Route path="/returns" element={<Returns />} />
              <Route path="/costs" element={<Fees />} />
              <Route path="/recon" element={<Reconciliation />} />
              <Route path="/import" element={<Import />} />
              <Route path="/master" element={<Master />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/customers" element={<Navigate to="/sales?tab=customer" replace />} />
              <Route path="/profit" element={<Navigate to="/sales?tab=profit" replace />} />
              <Route path="/finance" element={<Navigate to="/costs" replace />} />
              <Route path="/fees" element={<Navigate to="/costs" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
      </main>
    </div>
  );
}

const TOPIC: Record<string, AiTopic> = { '/': 'overview', '/sales': 'sales', '/returns': 'returns', '/costs': 'costs' };
const TOPIC_LABEL: Record<AiTopic, string> = { overview: 'ringkasan', sales: 'penjualan', returns: 'retur', costs: 'biaya' };

/** Tombol AI di sidebar: menganalisis halaman laporan yang sedang dibuka (default: ringkasan). */
function SideAi({ topic, ix, filter, prev }: { topic: AiTopic } & Pick<ReturnType<typeof useData>, 'ix' | 'filter' | 'prev'>) {
  return (
    <div className="side-ai">
      <AiButton className="btn side-ai-btn" label="Analisis dengan AI" cacheKey={`${topic}|${filter.from}|${filter.to}|${prev.from}`}
        title={`Analisis AI ${TOPIC_LABEL[topic]} — ${periodLabel(filter)}`} task={AI_TASK[topic]}
        build={() => aiPayload(ix, filter, prev, periodLabel(filter), periodLabel(prev), topic)} />
      <div className="side-ai-sub">{TOPIC_LABEL[topic]} · {periodLabel(filter)}</div>
    </div>
  );
}
