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
  /** Structured output TOP-LEVEL (Interactions API, bukan GenerateContent):
   *  {type:'text', mime_type:'application/json', schema}. WAJIB di tingkat
   *  request, sejajar model/input/generation_config — menyematkannya di
   *  dalam generation_config → HTTP 400 "Unknown parameter 'response_format'
   *  at 'generation_config'". buildInteractionRequest menStrip response_format/
   *  responseMimeType/responseSchema dari generation_config sebagai pengaman.
   */
  responseFormat?: Record<string, unknown>;
  /** Interaction ID sebelumnya (keputusan no. 4: riwayat dikelola server-side). */
  previousInteractionId?: string;
  /** Simpan interaction di sisi Google? Diperlukan true agar bisa di-chain.
   *  Default false (stateless, privasi soal). */
  store?: boolean;
  /** Timeout percobaan ini (ms). */
  timeoutMs: number;
}

/** Parameter GenerateContent API yang TIDAK berlaku di Interactions API —
 *  dibereskan dari generation_config agar tidak memicu HTTP 400 struktur. */
const FORBIDDEN_IN_GENERATION_CONFIG = ['response_format', 'responseMimeType', 'responseSchema'] as const;

/** API version yang dipakai semua proses Gemini aplikasi ini (ekstraksi,
 *  structured output, function calling, multi-turn). Interactions API butuh
 *  v1beta: tipe input 'document' (PDF inline) dan response_format top-level
 *  hanya valid di v1beta — default SDK (v1) menolaknya dengan 400. */
export const GEMINI_API_VERSION = 'v1beta';

/** Endpoint aktual yang dipakai SDK (untuk logging/audit, tanpa secret). */
export const GEMINI_INTERACTIONS_ENDPOINT = `/${GEMINI_API_VERSION}/interactions`;

/** Tipe JSON Schema valid untuk parameter function tool Interactions API
 *  (lowercase). Enum SchemaType gaya GenerateContent (UPPERCASE) dinormalkan. */
const VALID_SCHEMA_TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array']);

/** Tipe tool BUILTIN Interactions API yang dilewatkan apa adanya (bukan
 *  deklarasi function custom aplikasi). */
const BUILTIN_TOOL_TYPES = new Set(['google_search', 'code_execution', 'url_context', 'mcp_server', 'google_maps', 'file_search', 'computer_use']);

export interface ToolValidationIssue {
  index: number;
  toolName: string;
  issue: string;
}

/** Normalisasi rekursif skema parameter ke JSON Schema lowercase (Interactions
 *  API): enum SchemaType gaya GenerateContent ('OBJECT'/'STRING'/...) →
 *  'object'/'string'/.... Idempoten — schema yang sudah lowercase tetap sama. */
export function normalizeJsonSchemaTypes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchemaTypes);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    key === 'type' && typeof child === 'string' ? child.toLowerCase() : normalizeJsonSchemaTypes(child),
  ]));
}

/** Validasi deklarasi function tools SEBELUM dikirim ke Google — menangkap
 *  kesalahan bentuk (mis. `type` hilang → HTTP 400 "The 'type' parameter is
 *  required at 'tools[15]'") dengan pesan yang menyebut tool bermasalah.
 *  Murni: tanpa efek samping, dipakai route dan test regresi. */
export function validateInteractionTools(tools: Array<Record<string, unknown>>): ToolValidationIssue[] {
  const issues: ToolValidationIssue[] = [];
  const seenNames = new Set<string>();
  const inspectSchema = (path: string, schema: unknown, toolName: string, index: number): void => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      if (schema !== undefined) issues.push({ index, toolName, issue: `${path}: schema bukan objek.` });
      return;
    }
    const record = schema as Record<string, unknown>;
    const type = typeof record['type'] === 'string' ? record['type'].toLowerCase() : undefined;
    if (type !== undefined && !VALID_SCHEMA_TYPES.has(type)) {
      issues.push({ index, toolName, issue: `${path}: tipe "${String(record['type'])}" bukan JSON Schema valid (${[...VALID_SCHEMA_TYPES].join('/')}).` });
    }
    if (type === 'object') {
      if (record['properties'] !== undefined && (typeof record['properties'] !== 'object' || Array.isArray(record['properties']) || record['properties'] === null)) {
        issues.push({ index, toolName, issue: `${path}.properties: harus objek.` });
      } else if (record['properties']) {
        for (const [childKey, child] of Object.entries(record['properties'] as Record<string, unknown>)) {
          inspectSchema(`${path}.properties.${childKey}`, child, toolName, index);
        }
        const required = record['required'];
        if (required !== undefined) {
          if (!Array.isArray(required) || required.some((entry) => typeof entry !== 'string')) {
            issues.push({ index, toolName, issue: `${path}.required: harus array string.` });
          } else {
            for (const reqKey of required as string[]) {
              if (!(reqKey in (record['properties'] as Record<string, unknown>))) {
                issues.push({ index, toolName, issue: `${path}.required: "${reqKey}" tidak ada di properties.` });
              }
            }
          }
        }
      }
    } else if (type === 'array') {
      if (record['items'] !== undefined) inspectSchema(`${path}.items`, record['items'], toolName, index);
    } else if (type === 'string' && record['enum'] !== undefined) {
      const enumValues = record['enum'];
      if (!Array.isArray(enumValues) || enumValues.length === 0 || enumValues.some((entry) => typeof entry !== 'string' && typeof entry !== 'number')) {
        issues.push({ index, toolName, issue: `${path}.enum: harus array string/number tidak kosong.` });
      }
    }
  };

  tools.forEach((tool, index) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
      issues.push({ index, toolName: '(bukan objek)', issue: 'Deklarasi tool bukan objek.' });
      return;
    }
    const rawType = typeof tool['type'] === 'string' ? tool['type'].toLowerCase() : undefined;
    if (rawType !== undefined && BUILTIN_TOOL_TYPES.has(rawType)) return; // tool builtin: bentuknya milik API
    if (rawType !== undefined && rawType !== 'function') {
      issues.push({ index, toolName: String(tool['name'] ?? '?'), issue: `type "${rawType}" tidak dikenal (harus "function" atau builtin).` });
      return;
    }
    const name = tool['name'];
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(name)) {
      issues.push({ index, toolName: String(name ?? '?'), issue: `Nama tool "${String(name ?? '')}" tidak valid (huruf/angka/underscore, 2-64).` });
    } else if (seenNames.has(name)) {
      issues.push({ index, toolName: name, issue: 'Nama tool duplikat.' });
    }
    seenNames.add(typeof name === 'string' ? name : '?');
    const description = tool['description'];
    if (typeof description !== 'string' || description.trim() === '') {
      issues.push({ index, toolName: String(name ?? '?'), issue: 'Description wajib non-kosong.' });
    }
    if (tool['parameters'] !== undefined) inspectSchema('parameters', tool['parameters'], String(name ?? '?'), index);
  });
  return issues;
}

/** Bentuk payload `client.interactions.create(...)` (argumen pertama) —
 *  diekspor murni agar bisa diregresi tanpa jaringan: response_format
 *  top-level (sejajar model/input/generation_config), TIDAK di dalam
 *  generation_config; responseMimeType/responseSchema (gaya GenerateContent)
 *  juga dilarang di generation_config. Setiap function tool DIKIRIM DENGAN
 *  `type: 'function'` di tingkat terluar (wajib Interactions API — SDK
 *  `FunctionT` menyatakan `type: "function"` REQUIRED); bila pemanggil tidak
 *  menyertakan `type`, builder menambahkan otomatis. Schema parameter
 *  dinormalkan ke JSON Schema lowercase, dan seluruh deklarasi divalidasi
 *  dulu — lempar Error jelas bila bentuk tidak valid (tolak dini, bukan
 *  HTTP 400 dari Google). */
export function buildInteractionRequest(args: InteractionCallArgs): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = { ...(args.generationConfig ?? {}) };
  for (const key of FORBIDDEN_IN_GENERATION_CONFIG) delete generationConfig[key];
  const sanitizedTools = (args.tools ?? []).map((tool) => {
    const record = { ...tool } as Record<string, unknown>;
    if (typeof record['type'] !== 'string' || record['type'] === '') record['type'] = 'function';
    else record['type'] = record['type'].toLowerCase();
    if (record['type'] === 'function') {
      if (record['parameters'] !== undefined) record['parameters'] = normalizeJsonSchemaTypes(record['parameters']);
    }
    return record;
  });
  const toolIssues = validateInteractionTools(sanitizedTools);
  if (toolIssues.length > 0) {
    const summary = toolIssues.slice(0, 6).map((issue) =>
      `tools[${issue.index}] "${issue.toolName}": ${issue.issue}`).join('; ');
    throw new Error(`Deklarasi tools tidak valid (ditolak sebelum dikirim ke Gemini): ${summary}`);
  }
  return {
    model: args.model,
    input: args.input,
    ...(args.systemInstruction ? { system_instruction: args.systemInstruction } : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generation_config: generationConfig } : {}),
    ...(args.responseFormat ? { response_format: args.responseFormat } : {}),
    ...(sanitizedTools.length > 0 ? { tools: sanitizedTools } : {}),
    store: args.store ?? false,
    ...(args.previousInteractionId ? { previous_interaction_id: args.previousInteractionId } : {}),
  };
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
    // apiVersion GEMINI_API_VERSION ('v1beta') — wajib untuk Interactions API
    // aplikasi ini: tipe input 'document' (PDF inline) dan structured output
    // top-level hanya valid di v1beta; default SDK (v1) menolaknya dengan 400
    // ("The value 'document' is not supported ... in v1, it is available
    // in v1beta"). Raw fetch sebelumnya juga memakai /v1beta/interactions.
    cachedClient = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: GEMINI_API_VERSION } });
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

/** Logging percobaan panggilan yang AMAN: metadata saja (apiVersion, endpoint,
 *  model, jumlah part/tool, status, interaction ID, jenis output) — TANPA API
 *  key, TANPA isi input/PDF, TANPA isi respons. */
function logInteractionSafe(event: string, data: Record<string, unknown>): void {
  const safe = { ...data };
  if (typeof safe['errorMessage'] === 'string') {
    // Sanitasi defensif: buang pola yang mirip API key bila pernah bocor ke
    // pesan error pihak ketiga; potong 300 char.
    safe['errorMessage'] = safe['errorMessage']
      .replace(/AIza[\w-]{10,}/g, '[REDACTED]')
      .slice(0, 300);
  }
  console.info(`[Gemini ${event}]`, safe);
}

/** Satu panggilan Interactions API via SDK. TIDAK melempar untuk error HTTP —
 *  hasil dikembalikan terstruktur agar siklus retry/backoff caller tetap
 *  berjalan persis seperti sebelumnya. Melempar HANYA GeminiApiKeyMissingError
 *  dan Error validasi tools/payload dari buildInteractionRequest (tolak dini). */
export async function callGeminiInteraction(args: InteractionCallArgs): Promise<InteractionCallResult> {
  const client = getGeminiClient(); // lempar GeminiApiKeyMissingError bila key kosong
  // Payload dibangun oleh builder murni: response_format top-level,
  // generation_config dibersihkan dari parameter yang tidak berlaku di
  // Interactions API, tools divalidasi + type:'function' + schema lowercase.
  const payload = buildInteractionRequest(args);
  logInteractionSafe('request', {
    apiVersion: GEMINI_API_VERSION,
    endpoint: GEMINI_INTERACTIONS_ENDPOINT,
    model: args.model,
    inputParts: Array.isArray(args.input) ? args.input.length : 'string',
    tools: payload['tools'] ? (payload['tools'] as unknown[]).length : 0,
    responseFormat: Boolean(args.responseFormat),
    previousInteractionId: Boolean(args.previousInteractionId),
    store: args.store ?? false,
    timeoutMs: args.timeoutMs,
  });

  try {
    const interaction = await client.interactions.create(payload as never, {
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
    // Status interaction: 'completed' diharapkan; selain itu caller menilai.
    const interactionStatus = typeof record['status'] === 'string' ? record['status'] : undefined;
    logInteractionSafe('response', {
      apiVersion: GEMINI_API_VERSION,
      model: typeof record['model'] === 'string' ? record['model'] : args.model,
      status: 200,
      interactionStatus: interactionStatus ?? 'tidak diketahui',
      interactionId,
      steps: steps.length,
      stepTypes: [...new Set(steps.map((step) => step.type ?? '?'))].join(','),
      outputKinds: steps.some((step) => step.type === 'function_call')
        ? 'function_call'
        : typeof record['output_text'] === 'string' && record['output_text'] ? 'text' : '-',
      usage: usage ? { in: usage.inputTokens, out: usage.outputTokens } : null,
    });

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
    logInteractionSafe('error', {
      apiVersion: GEMINI_API_VERSION,
      model: args.model,
      status,
      errorName: err instanceof Error ? err.name : undefined,
      errorMessage: message,
    });
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
