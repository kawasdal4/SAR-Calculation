/**
 * Test konfigurasi & client Gemini (Fase 2 AI Copilot).
 * Keputusan yang diuji:
 * - no.1: API key hanya dari env server-side; tidak ada di log/pesan error.
 * - no.2: model default gemini-3.8-flash; gemini-4-hydrogen bukan default;
 *   overridable via env; fallback divalidasi karakter aman.
 * Jalankan: bun test tests/aiConfig.test.ts
 */
import { describe, expect, it, afterEach } from 'bun:test';
import {
  getGeminiApiKey,
  missingApiKeyMessage,
  getAgentModel,
  getExtractionModel,
  getModelFallbacks,
  getThinkingLevel,
  GEMINI_DEFAULT_MODEL,
} from '../src/lib/ai/config';
import {
  GeminiApiKeyMissingError,
  getGeminiClient,
  isInteractionExpiredError,
} from '../src/lib/ai/geminiClient';

const ENV_KEYS = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_MODEL_AGENT', 'GEMINI_MODEL_EXTRACTION', 'GEMINI_MODEL_FALLBACKS'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('Konfigurasi API key (keputusan no.1)', () => {
  it('key kosong/tidak ada → null + pesan jelas menyebut GEMINI_API_KEY', () => {
    delete process.env.GEMINI_API_KEY;
    expect(getGeminiApiKey()).toBeNull();
    expect(missingApiKeyMessage()).toContain('GEMINI_API_KEY');
    process.env.GEMINI_API_KEY = '   ';
    expect(getGeminiApiKey()).toBeNull();
  });

  it('key terisi → dikembalikan apa adanya (trim)', () => {
    process.env.GEMINI_API_KEY = ' test-key-123 ';
    expect(getGeminiApiKey()).toBe('test-key-123');
  });

  it('getGeminiClient tanpa key melempar GeminiApiKeyMissingError (bukan isi key)', () => {
    delete process.env.GEMINI_API_KEY;
    let thrown: unknown = null;
    try {
      getGeminiClient();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GeminiApiKeyMissingError);
    const message = thrown instanceof Error ? thrown.message : '';
    expect(message).toContain('GEMINI_API_KEY');
    // Tidak ada key yang bocor di pesan error.
    expect(message.toLowerCase()).not.toContain('aiza');
  });
});

describe('Konfigurasi model (keputusan no.2)', () => {
  it('default = gemini-3.8-flash untuk agent & ekstraksi', () => {
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL_AGENT;
    delete process.env.GEMINI_MODEL_EXTRACTION;
    expect(GEMINI_DEFAULT_MODEL).toBe('gemini-3.8-flash');
    expect(getAgentModel()).toBe('gemini-3.8-flash');
    expect(getExtractionModel()).toBe('gemini-3.8-flash');
  });

  it('env GEMINI_MODEL mengoverride keduanya', () => {
    process.env.GEMINI_MODEL = 'gemini-3.1-flash-lite';
    expect(getAgentModel()).toBe('gemini-3.1-flash-lite');
    expect(getExtractionModel()).toBe('gemini-3.1-flash-lite');
  });

  it('override spesifik menang di atas GEMINI_MODEL', () => {
    process.env.GEMINI_MODEL = 'gemini-3.8-flash';
    process.env.GEMINI_MODEL_AGENT = 'gemini-3.6-flash';
    process.env.GEMINI_MODEL_EXTRACTION = 'gemini-3.5-flash-lite';
    expect(getAgentModel()).toBe('gemini-3.6-flash');
    expect(getExtractionModel()).toBe('gemini-3.5-flash-lite');
  });

  it('nama model dari env divalidasi (karakter aman, tidak boleh injection)', () => {
    process.env.GEMINI_MODEL = 'gemini-3.8-flash; rm -rf /';
    expect(getAgentModel()).toBe('gemini-3.8-flash'); // fallback ke default
    process.env.GEMINI_MODEL = 'gemini-4-hydrogen';
    expect(getAgentModel()).toBe('gemini-4-hydrogen'); // opsi sah bila diatur eksplisit
  });

  it('fallback default TIDAK memuat gemini-4-* (bukan default)', () => {
    delete process.env.GEMINI_MODEL_FALLBACKS;
    const fallbacks = getModelFallbacks('gemini-3.8-flash');
    expect(fallbacks).not.toContain('gemini-4-hydrogen');
    expect(fallbacks).not.toContain('gemini-3.8-flash');
    expect(fallbacks.every((name) => /^[\w.\-]+$/.test(name))).toBe(true);
  });

  it('fallback dari env tervalidasi & primary tidak duplikat', () => {
    process.env.GEMINI_MODEL_FALLBACKS = 'gemini-4-hydrogen, gemini-3.5-flash-lite, bad name!, gemini-3.8-flash';
    const fallbacks = getModelFallbacks('gemini-3.8-flash');
    expect(fallbacks).toContain('gemini-4-hydrogen'); // opsi user
    expect(fallbacks).toContain('gemini-3.5-flash-lite');
    expect(fallbacks).not.toContain('bad name!');
    expect(fallbacks).not.toContain('gemini-3.8-flash'); // primary tak diulang
  });

  it('thinking level: lite=minimal, 3.8-flash=low, model tak dikenal=undefined', () => {
    expect(getThinkingLevel('gemini-3.5-flash-lite')).toBe('minimal');
    expect(getThinkingLevel('gemini-3.8-flash')).toBe('low');
    expect(getThinkingLevel('gemini-9.9-unknown')).toBeUndefined();
  });
});

describe('Deteksi interaction ID kedaluwarsa (keputusan no.4)', () => {
  it('HTTP 404 → expired; pesan expired/not found → expired', () => {
    expect(isInteractionExpiredError(404, '')).toBe(true);
    expect(isInteractionExpiredError(400, 'Interaction abc123 not found or expired')).toBe(true);
    expect(isInteractionExpiredError(400, 'Interaction expired')).toBe(true);
  });

  it('error lain tidak dianggap expired', () => {
    expect(isInteractionExpiredError(429, 'Resource exhausted, please retry in 30s')).toBe(false);
    expect(isInteractionExpiredError(500, 'Internal error')).toBe(false);
    expect(isInteractionExpiredError(400, 'Model gemini-3.8-flash not found')).toBe(false);
  });
});
