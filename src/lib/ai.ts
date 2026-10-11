// Analisis AI dengan Claude (Anthropic API) langsung dari browser.
// API key disimpan hanya di browser ini (localStorage) dan dikirim langsung ke api.anthropic.com.
import Anthropic from '@anthropic-ai/sdk';

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — analisis terbaik (disarankan)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — lebih cepat & hemat' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — paling hemat' },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['id'];

const LS = { key: 'bi.ai.key', model: 'bi.ai.model' };
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* tidak tersedia */ } },
};

export const aiSettings = {
  apiKey: () => ls.get(LS.key) ?? '',
  setApiKey: (v: string) => ls.set(LS.key, v.trim() || null),
  model: (): AiModel => (AI_MODELS.find((m) => m.id === ls.get(LS.model))?.id ?? 'claude-opus-5-5'),
  setModel: (v: AiModel) => ls.set(LS.model, v),
};
export const aiConfigured = () => !!aiSettings.apiKey();

const client = () => new Anthropic({ apiKey: aiSettings.apiKey(), dangerouslyAllowBrowser: true, maxRetries: 2 });

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

/** Jalankan analisis dengan streaming. onText dipanggil setiap potongan teks diterima. */
export async function runAnalysis(task: string, data: unknown, onText: (chunk: string) => void, signal?: AbortSignal): Promise<AiRun> {
  const model = aiSettings.model();
  // Fallback sisi server saat permintaan ditolak oleh pengaman (Opus/Sonnet 5.5 di Claude API).
  const fallback = model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';
  try {
    const stream = client().beta.messages.stream({
      model,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      system: SYSTEM,
      messages: [{ role: 'user', content: `${task}\n\n<data>\n${JSON.stringify(data)}\n</data>` }],
    }, { signal });
    stream.on('text', (t) => onText(t));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('Permintaan ditolak oleh model. Coba lagi atau ganti model di Pengaturan → AI.');
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { text, model: msg.model, stop: msg.stop_reason };
  } catch (e) {
    throw new Error(explain(e));
  }
}

/** Tes koneksi tanpa memakai token: ambil info model. */
export async function testConnection(): Promise<string> {
  try {
    const m = await client().models.retrieve(aiSettings.model());
    return m.display_name;
  } catch (e) {
    throw new Error(explain(e));
  }
}

function explain(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return 'Dibatalkan.';
  if (e instanceof Anthropic.AuthenticationError) return 'API key tidak valid. Periksa di Pengaturan → AI.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'API key tidak punya akses ke model ini.';
  if (e instanceof Anthropic.NotFoundError) return 'Model tidak ditemukan untuk API key ini — pilih model lain di Pengaturan → AI.';
  if (e instanceof Anthropic.RateLimitError) return 'Batas pemakaian API tercapai. Coba lagi beberapa saat lagi.';
  if (e instanceof Anthropic.BadRequestError) return `Permintaan ditolak API: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Tidak bisa terhubung ke API Anthropic (cek koneksi internet).';
  if (e instanceof Anthropic.APIError) return `Error API ${e.status ?? ''}: ${e.message}`;
  return (e as Error)?.message ?? String(e);
}
