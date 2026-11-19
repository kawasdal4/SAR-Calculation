/**
 * GEMINI CLIENT (Fase 2 AI Copilot) — pembungkus SDK resmi `@google/genai`
 * untuk Interactions API. Menggantikan raw `fetch('/v1beta/interactions')`.
 *
 * Prinsip (keputusan implementasi no. 1, 2, 3):
 * - API key hanya dari env server-side (`config.getGeminiApiKey`); tidak pernah
 *   dicatat, dikirim ke client, atau dimasukkan dalam pesan error.
 * - Semua panggilan LLM lama (agent loop, tool calling, structured output,
 *   file/PDF inline) tetap berjalan: bentuk body TIDAK berubah, hanya
 *   transport-nya yang diganti SDK.
 * - `retries: 0` pada RequestOptions: retry/backoff tetap jadi kewenangan
 *   caller (route punya siklus retry model-chain + RetryInfo sendiri).
 */

import { GoogleGenAI } from '@google/genai';
import { getGeminiApiKey, missingApiKeyMessage } from './config';

/** Step hasil Interactions API — bentuk sama dengan parsing route lama. */
export interface InteractionStep {
  type?: string;
  name?: string;
  id?: string;
  arguments?: unknown;
  text?: string;
  content?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface InteractionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface InteractionCallResult {
  /** Emulasi response.ok dari era fetch. */
  ok: boolean;
  /** HTTP status (200 saat ok; kode ApiError SDK saat gagal; 0 saat jaringan). */
  status: number;
  /** Nama error SDK (TimeoutError/AbortError untuk timeout, ApiError, dll.). */
  errorName?: string;
  /** Interaction ID (untuk previous_interaction_id turn berikutnya). */
  interactionId: string | null;
  /** Model yang menjawab (menang bila server mengganti). */
  model?: string;
  /** Langkah interaction: function_call / model_output / thought / dll. */
  steps: InteractionStep[];
  /** Teks output terakhir (output_text SDK atau gabungan part model_output). */
  text: string;
  /** Pesan error ringkas (TANPA secret/API key). */
  errorMessage?: string;
  /** retryDelay (ms) yang disarankan Google bila ada di pesan error. */
  suggestedRetryDelayMs?: number | null;
  /** Pemakaian token bila tersedia. */
  usage?: InteractionUsage;
}

export interface InteractionCallArgs {
  model: string;
  /** Input Interactions API: array part ({type:'text'|'document'|'image', ...})
   *  atau string — persis bentuk yang sebelumnya dikirim via raw fetch. */
  input: Array<Record<string, unknown>> | string;
  systemInstruction?: string;
  /** Tool bentuk lama {type:'function', name, description, parameters}; field
   *  `type` dilepas sesuai tipe Tool (FunctionT) SDK. */
  tools?: Array<Record<string, unknown>>;
  /** {max_output_tokens, thinking_level?, tool_choice?} — snake_case sesuai API. */
  generationConfig?: Record<string, unknown>;
  /** Interaction ID sebelumnya (keputusan no. 4: riwayat dikelola server-side). */
  previousInteractionId?: string;
  /** Simpan interaction di sisi Google? Diperlukan true agar bisa di-chain.
   *  Default false (stateless, privasi soal). */
  store?: boolean;
  /** Timeout percobaan ini (ms). */
  timeoutMs: number;
}

/** Error khusus bila API key tidak tersedia — pesan aman untuk pengguna. */
export class GeminiApiKeyMissingError extends Error {
  constructor() {
    super(missingApiKeyMessage());
    this.name = 'GeminiApiKeyMissingError';
  }
}

let cachedClient: GoogleGenAI | null = null;
let cachedKeyFingerprint: string | null = null;

/** Client SDK ter-memo per fingerprint key (tanpa menyimpan nilai key). */
export function getGeminiClient(): GoogleGenAI {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new GeminiApiKeyMissingError();
  // fingerprint = panjang + 4 char terakhir — cukup untuk deteksi pergantian
  // env tanpa pernah memaparkan key di log.
  const fingerprint = `${apiKey.length}:${apiKey.slice(-4)}`;
  if (!cachedClient || cachedKeyFingerprint !== fingerprint) {
    cachedClient = new GoogleGenAI({ apiKey });
    cachedKeyFingerprint = fingerprint;
  }
  return cachedClient;
}

/** Parse retryDelay dari pesan error Google (fallback bila detail JSON tidak
 *  tersedia melalui SDK; format umum: "Please retry in 32s" / "retryDelay"). */
function parseRetryDelayMsFromMessage(message: string): number | null {
  const match = message.match(/retry(?:\s+(?:in|after))?\s*([\d.]+)\s*s\b/i)
    ?? message.match(/retryDelay["']?\s*[:=]\s*"([\d.]+)s"/i);
  if (!match) return null;
  const seconds = parseFloat(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
}

/** Ekstraksi token usage defensif (nama field bisa berubah antar versi API). */
function extractUsage(usage: unknown): InteractionUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const num = (key: string): number | undefined => {
    const value = u[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };
  const inputTokens = num('total_input_tokens') ?? num('input_tokens') ?? num('prompt_tokens');
  const outputTokens = num('total_output_tokens') ?? num('output_tokens') ?? num('completion_tokens');
  const totalTokens = num('total_tokens') ?? num('total_token_count');
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return { inputTokens, outputTokens, totalTokens };
}

/** Ekstraksi teks output: utamakan `output_text` (ditambahkan SDK), fallback
 *  gabungan part teks dari langkah model_output. */
function extractText(steps: InteractionStep[], outputText: unknown): string {
  if (typeof outputText === 'string' && outputText.trim() !== '') return outputText;
  const chunks: string[] = [];
  for (const step of steps) {
    if (step.type !== 'model_output') continue;
    const content = Array.isArray(step.content) ? step.content : [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const record = part as Record<string, unknown>;
      if (typeof record['text'] === 'string') chunks.push(record['text']);
      else if (Array.isArray(record['parts'])) {
        for (const inner of record['parts'] as Array<Record<string, unknown>>) {
          if (inner && typeof inner['text'] === 'string') chunks.push(inner['text']);
        }
      }
    }
  }
  return chunks.join('');
}

/** Satu panggilan Interactions API via SDK. TIDAK melempar untuk error HTTP —
 *  hasil dikembalikan terstruktur agar siklus retry/backoff caller tetap
 *  berjalan persis seperti sebelumnya. Melempar HANYA GeminiApiKeyMissingError. */
export async function callGeminiInteraction(args: InteractionCallArgs): Promise<InteractionCallResult> {
  const client = getGeminiClient(); // lempar GeminiApiKeyMissingError bila key kosong
  // Lepas field `type` pada tool (FunctionT SDK: name/description/parameters).
  const tools = args.tools?.map((tool) => {
    const { type: _type, ...rest } = tool as Record<string, unknown> & { type?: string };
    void _type;
    return rest;
  });

  try {
    const interaction = await client.interactions.create({
      model: args.model,
      input: args.input as never,
      ...(args.systemInstruction ? { system_instruction: args.systemInstruction } : {}),
      ...(args.generationConfig ? { generation_config: args.generationConfig as never } : {}),
      ...(tools && tools.length > 0 ? { tools: tools as never } : {}),
      store: args.store ?? false,
      ...(args.previousInteractionId ? { previous_interaction_id: args.previousInteractionId } : {}),
    }, {
      signal: AbortSignal.timeout(args.timeoutMs),
      retries: 0,
    } as never);

    const record = interaction as unknown as Record<string, unknown>;
    const steps = (Array.isArray(record['steps']) ? record['steps'] : []) as InteractionStep[];
    const usage = extractUsage(record['usage']);
    const continuationIds = Array.isArray(record['continuation_ids'])
      ? (record['continuation_ids'] as string[])
      : undefined;
    // Interaction ID efektif: hop terakhir bila automatic continuation aktif.
    const interactionId = continuationIds && continuationIds.length > 0
      ? continuationIds[continuationIds.length - 1]
      : typeof record['id'] === 'string' ? record['id'] : null;

    return {
      ok: true,
      status: 200,
      interactionId,
      model: typeof record['model'] === 'string' ? record['model'] : args.model,
      steps,
      text: extractText(steps, record['output_text']),
      usage,
    };
  } catch (error) {
    const err = error as { status?: number; message?: string; name?: string };
    const status = typeof err.status === 'number' ? err.status : 0;
    const message = err instanceof Error ? err.message : 'Panggilan Gemini gagal.';
    return {
      ok: false,
      status,
      errorName: err instanceof Error ? err.name : undefined,
      interactionId: null,
      model: args.model,
      steps: [],
      text: '',
      errorMessage: message,
      suggestedRetryDelayMs: parseRetryDelayMsFromMessage(message),
    };
  }
}

/** True bila error interaction-ID tidak valid/kedaluwarsa — pemicu fallback
 *  rebuild konteks (keputusan no. 4). */
export function isInteractionExpiredError(status: number, message: string): boolean {
  if (status === 404) return true;
  return /interaction.*(not found|expired|invalid)|not found.*interaction/i.test(message ?? '');
}
