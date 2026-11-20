/**
 * REGRESI — structured output Gemini Interactions API untuk parse_case.
 *
 * Latar: HTTP 400 `Unknown parameter 'response_format' at 'generation_config'`
 * — `response_format` (structured output) sempat disematkan DI DALAM
 * `generation_config`. Interactions API menuntutnya di TOP-LEVEL request
 * (sejajar model/input/generation_config), format:
 *   response_format: { type: 'text', mime_type: 'application/json', schema }
 * Parameter GenerateContent API (responseMimeType/responseSchema) TIDAK
 * berlaku di Interactions API.
 *
 * Invariant yang dijaga:
 *  - payload request: response_format top-level; generation_config BERSIH dari
 *    response_format/responseMimeType/responseSchema; temperature 0.1 utuh.
 *  - schema yang dikirim mencerminkan CaseSchema (`sarCaseSchema`).
 *  - output model (JSON) → extractJsonCandidate → buildCaseExtractionResult
 *    (Zod) — diloloskan dengan fixture PK-TAL yang nyata.
 *  - PDF PK-TAL melewati pipeline input (processUploadedFile → part document)
 *    tanpa mengubah mekanisme upload/parsing PDF.
 *
 * Jalankan: bun test tests/parseCaseStructuredOutput.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildInteractionRequest } from '../src/lib/ai/geminiClient';
import {
  CASE_EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_INSTRUCTION,
  buildCaseExtractionResult,
  extractJsonCandidate,
} from '../src/lib/ai/parseCase';
import { sarCaseSchema } from '../src/lib/sar/caseSchema';
import { processUploadedFile } from '../src/lib/sar/fileExtractor';
import pkTalCase from './golden/pk-tal.case.json';

const PDF_PK_TAL = 'upload/Pusat Final Test XL 2026 _1711_1200_rev kapten psw.pdf';

/** Bentuk response_format persis seperti yang dipakai route parse-case. */
const responseFormat = {
  type: 'text',
  mime_type: 'application/json',
  schema: CASE_EXTRACTION_JSON_SCHEMA,
};

/** Args mirip pemanggilan parse-case/route.ts (tanpa jaringan). */
function buildParseCasePayload(generationConfigOverride?: Record<string, unknown>): Record<string, unknown> {
  return buildInteractionRequest({
    model: 'gemini-3.8-flash',
    input: [{ type: 'text', text: 'soal kasus SAR' }],
    systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
    responseFormat,
    generationConfig: generationConfigOverride ?? {
      temperature: 0.1,
      max_output_tokens: 32768,
      thinking_level: 'low',
    },
    store: false,
    timeoutMs: 120_000,
  });
}

describe('payload Interactions API — response_format top-level (regresi HTTP 400)', () => {
  it('response_format berada di TOP-LEVEL request, sejajar model/input/generation_config', () => {
    const payload = buildParseCasePayload();
    expect(payload['model']).toBe('gemini-3.8-flash');
    expect(payload['input']).toBeDefined();
    expect(payload['generation_config']).toBeDefined();
    expect(payload['response_format']).toEqual({
      type: 'text',
      mime_type: 'application/json',
      schema: CASE_EXTRACTION_JSON_SCHEMA,
    });
  });

  it('generation_config TIDAK mengandung response_format / responseMimeType / responseSchema', () => {
    const generationConfig = buildParseCasePayload()['generation_config'] as Record<string, unknown>;
    expect(generationConfig).toBeDefined();
    expect(generationConfig['response_format']).toBeUndefined();
    expect(generationConfig['responseMimeType']).toBeUndefined();
    expect(generationConfig['responseSchema']).toBeUndefined();
  });

  it('temperature 0.1 untuk ekstraksi kasus dipertahankan di generation_config', () => {
    const generationConfig = buildParseCasePayload()['generation_config'] as Record<string, unknown>;
    expect(generationConfig['temperature']).toBe(0.1);
    expect(generationConfig['max_output_tokens']).toBe(32768);
  });

  it('pengaman: response_format yang tertanam di generationConfig dibersihkan builder', () => {
    // Caller lama yang masih menyematkan di generation_config TIDAK boleh
    // menghasilkan payload 400 — builder melepas parameter terlarang.
    const payload = buildParseCasePayload({
      temperature: 0.1,
      response_format: { type: 'text' },
      responseMimeType: 'application/json',
      responseSchema: { type: 'object' },
    });
    const generationConfig = payload['generation_config'] as Record<string, unknown>;
    expect(generationConfig['response_format']).toBeUndefined();
    expect(generationConfig['responseMimeType']).toBeUndefined();
    expect(generationConfig['responseSchema']).toBeUndefined();
    expect(generationConfig['temperature']).toBe(0.1);
    // Pemanggil tanpa arg responseFormat resmi → top-level tidak menyematkan apa pun.
    const payloadTanpaResponseFormat = buildInteractionRequest({
      model: 'gemini-3.8-flash',
      input: 'soal',
      timeoutMs: 1000,
    });
    expect(payloadTanpaResponseFormat['response_format']).toBeUndefined();
  });
});

describe('schema JSON yang dikirim mencerminkan CaseSchema', () => {
  it('setiap key `sarCaseSchema` ada di properties CASE_EXTRACTION_JSON_SCHEMA', () => {
    const properties = CASE_EXTRACTION_JSON_SCHEMA['properties'] as Record<string, unknown>;
    expect(properties).toBeDefined();
    const schemaKeys = Object.keys(sarCaseSchema.shape);
    expect(schemaKeys.length).toBeGreaterThan(0);
    for (const key of schemaKeys) {
      expect(Object.keys(properties)).toContain(key);
    }
  });

  it('schema adalah object type dengan required blok kunci (incident wajib + blok data lain dipaksa hadir)', () => {
    expect(CASE_EXTRACTION_JSON_SCHEMA['type']).toBe('object');
    // Fase C2: blok kunci dipaksa hadir agar structured output tidak
    // "melonggarkan" field yang jelas tertulis di soal (regresi PK-TAL).
    expect(CASE_EXTRACTION_JSON_SCHEMA['required']).toEqual([
      'incident', 'target', 'sarOffice', 'lkp', 'aeroDrift', 'sea', 'search', 'sru', 'meta',
    ]);
  });
});

describe('output model → JSON parse → Zod (CaseSchema)', () => {
  it('JSON PK-TAL (output model tersimulasi) lolos jalur validasi route', () => {
    const outputText = JSON.stringify(pkTalCase);
    const candidate = extractJsonCandidate(outputText);
    expect(candidate.ok).toBe(true);
    const extraction = buildCaseExtractionResult(candidate.data, {}, { model: 'gemini-3.8-flash', attempts: 1 });
    expect(extraction.ok).toBe(true);
    if (extraction.ok) {
      expect(extraction.case.caseTitle).toBeTruthy();
      expect(extraction.attempts).toBe(1);
    }
  });

  it('output JSON di dalam code fence juga lolos (model suka bungkus ```json)', () => {
    const outputText = '```json\n' + JSON.stringify(pkTalCase) + '\n```';
    const candidate = extractJsonCandidate(outputText);
    expect(candidate.ok).toBe(true);
    const extraction = buildCaseExtractionResult(candidate.data);
    expect(extraction.ok).toBe(true);
  });

  it('output tidak valid → detail pesan koreksi tersedia untuk retry (maks 2)', () => {
    const candidate = extractJsonCandidate(JSON.stringify({ incident: { type: 123 } }));
    expect(candidate.ok).toBe(true);
    const extraction = buildCaseExtractionResult(candidate.data);
    expect(extraction.ok).toBe(false);
    expect(Array.isArray((extraction as { detail?: string[] }).detail)).toBe(true);
    expect(((extraction as { detail?: string[] }).detail ?? []).length).toBeGreaterThan(0);
  });
});

describe('PDF PK-TAL melewati pipeline input ekstraksi', () => {
  it('processUploadedFile → part document application/pdf (mekanisme PDF TIDAK berubah)', async () => {
    const bytes = readFileSync(PDF_PK_TAL);
    expect(bytes.byteLength).toBeGreaterThan(0);
    const processed = await processUploadedFile({
      name: PDF_PK_TAL.split('/').pop() ?? 'PK-TAL.pdf',
      type: 'application/pdf',
      base64: bytes.toString('base64'),
    });
    expect(processed.type).toBe('inlineData');
    expect(processed.inlineData?.mimeType).toBe('application/pdf');
    expect(processed.inlineData?.data.length).toBeGreaterThan(0);
  });

  it('part document PK-TAL + response_format top-level dalam satu payload valid', async () => {
    const bytes = readFileSync(PDF_PK_TAL);
    const processed = await processUploadedFile({
      name: 'pk-tal.pdf',
      type: 'application/pdf',
      base64: bytes.toString('base64'),
    });
    const input = [
      { type: 'document', data: processed.inlineData?.data ?? '', mime_type: 'application/pdf' },
      { type: 'text', text: 'Ekstrak soal berikut.' },
    ];
    const payload = buildInteractionRequest({
      model: 'gemini-3.8-flash',
      input,
      systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
      responseFormat,
      generationConfig: { temperature: 0.1, max_output_tokens: 32768 },
      store: false,
      timeoutMs: 120_000,
    });
    // Input part document utuh + structured output tetap top-level.
    const payloadInput = payload['input'] as Array<Record<string, unknown>>;
    expect(payloadInput[0]).toEqual({ type: 'document', data: processed.inlineData?.data ?? '', mime_type: 'application/pdf' });
    const responseFormatSent = payload['response_format'] as Record<string, unknown>;
    expect(responseFormatSent['type']).toBe('text');
    expect(responseFormatSent['mime_type']).toBe('application/json');
    expect(responseFormatSent['schema']).toBe(CASE_EXTRACTION_JSON_SCHEMA);
  });
});
