/**
 * KONFIGURASI GEMINI (Fase 2 AI Copilot) — SEMUA dari environment variable
 * server-side. Keputusan implementasi no. 1 & 2:
 * - API key HANYA via env `GEMINI_API_KEY` (server-only). Dilarang menerima
 *   key dari client, menaruhnya di NEXT_PUBLIC_*, log, atau response.
 * - Model default `gemini-3.8-flash` untuk agent & ekstraksi; overridable via
 *   `GEMINI_MODEL` / `GEMINI_MODEL_AGENT` / `GEMINI_MODEL_EXTRACTION`.
 *   `gemini-4-hydrogen` disediakan sebagai OPSI (via env) — bukan default.
 */

/** Model default sesuai keputusan no. 2 (layanan gratis prioritas). */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

/** Kandidat fallback bila env tidak mengatur — TANPA gemini-4-* (bukan default). */
const GEMINI_FALLBACK_DEFAULTS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
] as const;

/** Ambil API key dari env server-side. Tidak pernah dicatat/log.
 *  Mengembalikan null (bukan melempar) agar caller bisa memilih respons. */
export function getGeminiApiKey(): string | null {
  const raw = process.env.GEMINI_API_KEY;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Pesan error ramah untuk pengguna saat key belum dikonfigurasi di server.
 *  Tidak menyingkap nilai/key apa pun. */
export function missingApiKeyMessage(): string {
  return 'API key Gemini belum dikonfigurasi di server. Hubungi admin untuk mengisi environment variable GEMINI_API_KEY (server-side, tidak perlu memasukkan key di aplikasi).';
}

/** Nama model bersih (anti inject karakter aneh dari env). */
function sanitizeModelName(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^[\w.\-]+$/.test(trimmed) && trimmed.length <= 64 ? trimmed : fallback;
}

/** Model untuk AI agent (tool loop /api/chat). Prioritas:
 *  GEMINI_MODEL_AGENT → GEMINI_MODEL → default. */
export function getAgentModel(): string {
  return sanitizeModelName(process.env.GEMINI_MODEL_AGENT, sanitizeModelName(process.env.GEMINI_MODEL, GEMINI_DEFAULT_MODEL));
}

/** Model untuk mode ekstraksi (parse_case/data-bank). Prioritas:
 *  GEMINI_MODEL_EXTRACTION → GEMINI_MODEL → default. */
export function getExtractionModel(): string {
  return sanitizeModelName(process.env.GEMINI_MODEL_EXTRACTION, sanitizeModelName(process.env.GEMINI_MODEL, GEMINI_DEFAULT_MODEL));
}

/** Daftar fallback model dari env GEMINI_MODEL_FALLBACKS (dipisah koma),
 *  divalidasi ^[\w.\-]+$. Tanpa env → daftar default tanpa model utama.
 *  `gemini-4-hydrogen` bisa diaktifkan pengguna lewat env ini setelah
 *  kompatibilitas/biaya diverifikasi (keputusan no. 2). */
export function getModelFallbacks(primaryModel: string): string[] {
  const raw = process.env.GEMINI_MODEL_FALLBACKS;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => /^[\w.\-]+$/.test(entry) && entry.length <= 64 && entry !== primaryModel);
  }
  return GEMINI_FALLBACK_DEFAULTS.filter((entry) => entry !== primaryModel);
}

/** Level thinking per model (dokumentasi ai.google.dev, dicek 20 Nov 2026):
 *  minimal | low | medium | high | xhigh. Alur ekstraksi/pengisian = rendah;
 *  review/validasi boleh lebih tinggi (diatur per tool di fase berikutnya). */
const MODEL_THINKING_LEVEL: Record<string, string> = {
  'gemini-3.5-flash-lite': 'minimal',
  'gemini-3.1-flash-lite': 'minimal',
  'gemini-3.8-flash': 'low',
  'gemini-3.6-flash': 'low',
};

export function getThinkingLevel(model: string): string | undefined {
  return MODEL_THINKING_LEVEL[model];
}
