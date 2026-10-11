// Analisis AI dengan Google Gemini (Gemini API) langsung dari browser.
// API key disimpan hanya di browser ini (localStorage) dan dikirim langsung ke generativelanguage.googleapis.com.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const LS = { key: 'bi.gemini.key', model: 'bi.gemini.model', models: 'bi.gemini.models' };
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* tidak tersedia */ } },
};

export interface GeminiModel { id: string; label: string; outputLimit: number }

export const aiSettings = {
  apiKey: () => ls.get(LS.key) ?? '',
  setApiKey: (v: string) => ls.set(LS.key, v.trim() || null),
  model: () => ls.get(LS.model) ?? DEFAULT_MODEL,
  setModel: (v: string) => ls.set(LS.model, v.trim() || null),
  /** Daftar model terakhir yang dimuat dari API key ini. */
  models: (): GeminiModel[] => { try { return JSON.parse(ls.get(LS.models) ?? '[]'); } catch { return []; } },
};
export const aiConfigured = () => !!aiSettings.apiKey();
export const providerLabel = 'Google Gemini';

const SYSTEM = `Anda adalah analis bisnis e-commerce untuk toko Shopee "meirista_shop" (kosmetik & perawatan, banyak dijual dalam paket isi 3/6/12).
Pembaca Anda adalah pemilik toko, bukan analis data. Tulis dalam Bahasa Indonesia yang lugas.

Aturan:
- Gunakan HANYA angka yang ada di data JSON. Jangan mengarang angka, tren, atau penyebab yang tidak didukung data; bila menduga penyebab, sebut sebagai dugaan.
- Tulis nominal Rupiah ringkas (mis. Rp 12,3 jt, Rp 1,2 M) dan persentase dengan satu desimal.
- Perhatikan catatan data (data_notes): periode yang datanya belum lengkap jangan disimpulkan sebagai penurunan penjualan.
- Format Markdown sederhana persis dengan judul berikut:
## Ringkasan
(2–3 kalimat inti)
## Temuan utama
(maksimal 5 butir, tiap butir menyebut angka)
## Rekomendasi
(3–5 aksi konkret yang bisa dikerjakan minggu ini, urut dari dampak terbesar)
## Catatan data
(keterbatasan data yang memengaruhi kesimpulan; tulis "Tidak ada." bila tidak ada)`;

export interface AiRun { text: string; model: string; stop: string | null }

class AiError extends Error {}

async function request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, { ...init, signal, headers: { 'x-goog-api-key': aiSettings.apiKey(), 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('Dibatalkan.');
    throw new AiError('Tidak bisa terhubung ke Gemini API (cek koneksi internet).');
  }
  if (r.ok) return r;
  let msg = '', reason = '';
  try { const j = await r.json(); msg = j.error?.message ?? ''; reason = j.error?.details?.find((d: { reason?: string }) => d.reason)?.reason ?? j.error?.status ?? ''; } catch { /* bukan JSON */ }
  if (reason === 'API_KEY_INVALID' || /api key not valid/i.test(msg)) throw new AiError('API key Gemini tidak valid. Periksa di Konfigurasi → Pengaturan → AI.');
  if (r.status === 403) throw new AiError(`Akses ditolak: ${msg || 'API key tidak punya izin untuk Gemini API.'}`);
  if (r.status === 404) throw new AiError(`Model "${aiSettings.model()}" tidak ditemukan. Pilih model lain di Pengaturan → AI.`);
  if (r.status === 429) throw new AiError('Batas pemakaian Gemini API tercapai (kuota/rate limit). Coba lagi nanti atau cek kuota di Google AI Studio.');
  throw new AiError(`Gemini API error ${r.status}: ${msg || r.statusText}`);
}

/** Jalankan analisis dengan streaming (SSE). onText dipanggil setiap potongan teks diterima. */
export async function runAnalysis(task: string, data: unknown, onText: (chunk: string) => void, signal?: AbortSignal): Promise<AiRun> {
  const model = aiSettings.model();
  const limit = aiSettings.models().find((m) => m.id === model)?.outputLimit;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: `${task}\n\n<data>\n${JSON.stringify(data)}\n</data>` }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: Math.min(limit ?? 8192, 16384) },
  };
  const r = await request(`/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: 'POST', body: JSON.stringify(body) }, signal);
  const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '', text = '', stop: string | null = null, blocked: string | null = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const chunk = JSON.parse(line.slice(5));
        if (chunk.promptFeedback?.blockReason) blocked = chunk.promptFeedback.blockReason;
        const cand = chunk.candidates?.[0];
        // Bagian "thought" (model berpikir) tidak ditampilkan.
        const t = (cand?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? '').join('');
        if (t) { text += t; onText(t); }
        if (cand?.finishReason) stop = cand.finishReason;
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('Dibatalkan.');
    throw e;
  }
  if (blocked) throw new AiError(`Permintaan diblokir Gemini (${blocked}). Coba lagi atau ganti model.`);
  if (!text && stop && stop !== 'STOP') throw new AiError(`Gemini tidak memberi jawaban (alasan: ${stop}).`);
  return { text, model, stop: stop === 'MAX_TOKENS' ? 'max_tokens' : stop };
}

/** Tes koneksi + muat daftar model Gemini yang bisa dipakai API key ini (tanpa memakai kuota generate). */
export async function testConnection(): Promise<{ model: string; models: GeminiModel[] }> {
  const r = await request('/models?pageSize=200');
  const j = await r.json() as { models?: { name: string; displayName?: string; outputTokenLimit?: number; supportedGenerationMethods?: string[] }[] };
  const models: GeminiModel[] = (j.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/i.test(m.name) && !/embedding|image|tts|audio|live|vision|aqa/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName ?? m.name, outputLimit: m.outputTokenLimit ?? 8192 }))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  ls.set(LS.models, JSON.stringify(models));
  const current = aiSettings.model();
  if (models.length && !models.some((m) => m.id === current)) {
    aiSettings.setModel(models.find((m) => m.id === DEFAULT_MODEL)?.id ?? models.find((m) => /flash/.test(m.id) && !/lite|preview|exp/.test(m.id))?.id ?? models[0].id);
  }
  return { model: models.find((m) => m.id === aiSettings.model())?.label ?? aiSettings.model(), models };
}
