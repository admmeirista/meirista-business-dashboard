import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Sparkles, Copy, RotateCcw, Square, SendHorizontal } from 'lucide-react';
import { aiConfigured, aiSettings, runChat, providerLabel, type ChatTurn } from '../lib/ai';
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

// Percakapan per (topik, periode) disimpan di memori agar membuka ulang tidak memakai kuota API lagi.
const cache = new Map<string, ChatTurn[]>();

export function AiButton({ cacheKey, title, task, build, suggestions = [], label = 'Analisis dengan AI', className = 'btn ai' }: {
  cacheKey: string; title: string; task: string; build: () => unknown; suggestions?: string[]; label?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}><Sparkles className="ic" />{label}</button>
      {open && createPortal(<AiModal cacheKey={cacheKey} title={title} task={task} build={build} suggestions={suggestions} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

const FULL = 'Analisis lengkap periode ini';

function AiModal({ cacheKey, title, task, build, suggestions, onClose }: {
  cacheKey: string; title: string; task: string; build: () => unknown; suggestions: string[]; onClose: () => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>(cache.get(cacheKey) ?? []);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const data = useRef<unknown>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const configured = aiConfigured();
  const modelLabel = aiSettings.models().find((m) => m.id === aiSettings.model())?.label ?? aiSettings.model();
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [turns, streaming, err]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    // Data agregat dibekukan pada pesan pertama, agar seluruh percakapan memakai angka yang sama.
    if (!turns.length || data.current === null) data.current = build();
    const before = turns;
    const next: ChatTurn[] = [...turns, { role: 'user', text: q }];
    setTurns(next); setDraft(''); setErr(null); setBusy(true); setStreaming('');
    abort.current = new AbortController();
    let acc = '';
    try {
      const r = await runChat(next, data.current, (t) => { acc += t; setStreaming(acc); }, abort.current.signal);
      const done: ChatTurn[] = [...next, { role: 'model', text: r.text }];
      setTurns(done); cache.set(cacheKey, done);
      if (r.stop === 'max_tokens') setErr('Jawaban terpotong karena terlalu panjang.');
    } catch (e) {
      setErr((e as Error).message);
      if (acc) { const partial: ChatTurn[] = [...next, { role: 'model', text: acc }]; setTurns(partial); cache.set(cacheKey, partial); }
      else { setTurns(before); setDraft(q); } // pertanyaan dikembalikan agar bisa dikirim ulang
    } finally {
      setBusy(false); setStreaming('');
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); }
  };
  const reset = () => { abort.current?.abort(); setTurns([]); cache.delete(cacheKey); data.current = null; setErr(null); };
  const close = () => { abort.current?.abort(); onClose(); };
  const lastAnswer = [...turns].reverse().find((t) => t.role === 'model')?.text;

  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal wide ai-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ai-head">
          <Sparkles className="ic" style={{ color: 'var(--acc)' }} />
          <div className="grow">
            <h3 style={{ margin: 0 }}>{title}</h3>
            <div className="muted" style={{ fontSize: 12 }}>{providerLabel}{configured ? ` · ${modelLabel}` : ''}</div>
          </div>
          {turns.length > 0 && <button className="btn sm ghost" onClick={reset} disabled={busy}><RotateCcw className="ic" />Percakapan baru</button>}
          <button className="btn sm ghost" onClick={close} aria-label="Tutup">✕</button>
        </div>
        {!configured ? (
          <div className="info-box" style={{ display: 'block' }}>
            Analisis AI memakai {providerLabel} dan perlu API key. Atur sekali di <Link to="/settings?tab=ai" onClick={onClose}>Konfigurasi → Pengaturan → AI</Link>.
          </div>
        ) : (
          <>
            <div className="ai-thread" ref={scroller}>
              {!turns.length && !busy && (
                <div className="ai-empty">
                  <div className="muted" style={{ fontSize: 13 }}>Tanyakan apa saja tentang data periode ini, atau pilih salah satu:</div>
                  <div className="ai-sugg">
                    <button onClick={() => send(task)}><Sparkles className="ic" />{FULL}</button>
                    {suggestions.map((q) => <button key={q} onClick={() => send(q)}>{q}</button>)}
                  </div>
                </div>
              )}
              {turns.map((t, i) => (t.role === 'user'
                ? <div key={i} className="msg u">{t.text === task ? FULL : t.text}</div>
                : <div key={i} className="msg m"><Markdown text={t.text} /></div>))}
              {busy && (
                <div className="msg m">
                  {streaming ? <><Markdown text={streaming} /><span className="ai-cursor" /></> : <span className="loading" style={{ padding: 0 }}><span className="spinner" />Menganalisis…</span>}
                </div>
              )}
              {err && <div className="err-box">{err}</div>}
            </div>
            <div className="ai-input">
              <textarea ref={input} className="in" rows={2} placeholder="Tulis pertanyaan, mis. Produk apa yang sebaiknya dipromosikan bulan depan?"
                value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} disabled={busy} />
              {busy
                ? <button className="btn" onClick={() => abort.current?.abort()} aria-label="Hentikan"><Square className="ic" /></button>
                : <button className="btn pri" onClick={() => send(draft)} disabled={!draft.trim()} aria-label="Kirim"><SendHorizontal className="ic" /></button>}
            </div>
            <div className="ai-foot">
              <span>Enter untuk kirim · Shift+Enter baris baru</span>
              {lastAnswer && !busy && <button className="link-btn" onClick={() => { void navigator.clipboard?.writeText(lastAnswer).then(() => toast('Jawaban disalin', 'ok')); }}><Copy className="ic" style={{ width: 13 }} />Salin jawaban</button>}
              <button className="link-btn" onClick={() => setShowData(!showData)}>{showData ? 'Sembunyikan' : 'Lihat'} data yang dikirim</button>
            </div>
            {showData && <pre className="json ai-data">{JSON.stringify(data.current ?? build(), null, 2)}</pre>}
            <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Hanya ringkasan angka yang dikirim (tanpa username, alamat, atau No. Pesanan). Hasil AI bisa keliru — cek kembali dengan angka di dashboard.</div>
          </>
        )}
      </div>
    </div>
  );
}
