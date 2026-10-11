import { Fragment, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Sparkles, Copy, RotateCcw, Square } from 'lucide-react';
import { aiConfigured, aiSettings, runAnalysis, providerLabel } from '../lib/ai';
import { toast } from './ui';

/** Teks inline: **tebal** → <b>. Aman (tanpa innerHTML). */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>))}</>;
}

/** Markdown minimal (judul, daftar, paragraf, tebal) untuk hasil AI. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i}><Inline text={t} /></li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^#{1,4}\s+(.*)/);
    const ul = line.match(/^\s*[-*•]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (h) { flush(); blocks.push(<h4 key={blocks.length}><Inline text={h[1]} /></h4>); }
    else if (ul || ol) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((ul ?? ol)![1]);
    } else if (!line.trim()) flush();
    else { flush(); blocks.push(<p key={blocks.length}><Inline text={line} /></p>); }
  }
  flush();
  return <div className="md">{blocks}</div>;
}

// Hasil terakhir per (topik, periode) disimpan di memori agar membuka ulang tidak memakan biaya API lagi.
const cache = new Map<string, string>();

export function AiButton({ cacheKey, title, task, build, label = 'Analisis dengan AI', className = 'btn ai' }: {
  cacheKey: string; title: string; task: string; build: () => unknown; label?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}><Sparkles className="ic" />{label}</button>
      {open && createPortal(<AiModal cacheKey={cacheKey} title={title} task={task} build={build} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function AiModal({ cacheKey, title, task, build, onClose }: { cacheKey: string; title: string; task: string; build: () => unknown; onClose: () => void }) {
  const [text, setText] = useState(cache.get(cacheKey) ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const configured = aiConfigured();
  const modelLabel = aiSettings.models().find((m) => m.id === aiSettings.model())?.label ?? aiSettings.model();

  const run = async () => {
    setText(''); setErr(null); setBusy(true);
    abort.current = new AbortController();
    let acc = '';
    try {
      const r = await runAnalysis(task, build(), (t) => { acc += t; setText(acc); }, abort.current.signal);
      cache.set(cacheKey, r.text);
      setText(r.text);
      if (r.stop === 'max_tokens') setErr('Jawaban terpotong karena terlalu panjang.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => { abort.current?.abort(); onClose(); };

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 10 }}>
          <Sparkles className="ic" style={{ color: 'var(--acc)' }} />
          <h3 style={{ margin: 0 }}>{title}</h3>
          {configured && <span className="tag" style={{ marginLeft: 'auto' }}>{modelLabel}</span>}
        </div>
        {!configured ? (
          <div className="info-box" style={{ display: 'block' }}>
            Analisis AI memakai {providerLabel} dan perlu API key. Atur sekali di <Link to="/settings?tab=ai" onClick={onClose}>Konfigurasi → Pengaturan → AI</Link>.
          </div>
        ) : (
          <>
            {!text && !busy && !err && (
              <div className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>
                AI akan membaca ringkasan angka periode ini (bukan data pembeli) lalu menulis temuan dan rekomendasi. Pemakaian dihitung sesuai kuota/paket Gemini API Anda.
              </div>
            )}
            <div className="ai-out">
              {text && <Markdown text={text} />}
              {busy && !text && <div className="loading"><span className="spinner" />AI sedang menganalisis…</div>}
              {busy && text && <span className="ai-cursor" />}
            </div>
            {err && <div className="err-box">{err}</div>}
            <div className="row" style={{ marginTop: 14 }}>
              {busy
                ? <button className="btn" onClick={() => abort.current?.abort()}><Square className="ic" />Hentikan</button>
                : <button className="btn pri" onClick={run}>{text ? <><RotateCcw className="ic" />Analisis ulang</> : <><Sparkles className="ic" />Mulai analisis</>}</button>}
              {text && !busy && <button className="btn" onClick={() => { void navigator.clipboard?.writeText(text).then(() => toast('Disalin', 'ok')); }}><Copy className="ic" />Salin</button>}
              <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => setShowData(!showData)}>{showData ? 'Sembunyikan' : 'Lihat'} data yang dikirim</button>
            </div>
            {showData && <pre className="json" style={{ maxWidth: 'none', maxHeight: 260, overflow: 'auto', marginTop: 10, background: 'var(--line-2)', padding: 10, borderRadius: 8 }}>{JSON.stringify(build(), null, 2)}</pre>}
            <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>Hasil AI bisa keliru — cek kembali dengan angka di dashboard sebelum mengambil keputusan.</div>
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" onClick={close}>Tutup</button></div>
      </div>
    </div>
  );
}
