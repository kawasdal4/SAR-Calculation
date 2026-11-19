/**
 * UJI AKTUAL — upload PDF PK-TAL ke Gemini Interactions API dengan struktur
 * request yang sudah diperbaiki (response_format TOP-LEVEL).
 *
 * Jalankan: bun run scripts/test_parse_case_pdf.ts
 * Butuh env server-side: GEMINI_API_KEY (bila kosong → mode dry-run: payload
 * tersanitasi tetap dicetak, tanpa panggilan API).
 *
 * Alur persis seperti /api/ai/parse-case:
 *   PDF → processUploadedFile (inline document part) → buildInteractionRequest
 *   (response_format top-level, generation_config bersih) → callGeminiInteraction
 *   → interaction.output_text → extractJsonCandidate → buildCaseExtractionResult
 *   (validasi Zod `sarCaseSchema`).
 */

import { readFileSync } from 'node:fs';
import { buildInteractionRequest } from '../src/lib/ai/geminiClient';
import { getExtractionModel, getGeminiApiKey, getThinkingLevel } from '../src/lib/ai/config';
import {
  CASE_EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_INSTRUCTION,
  buildCaseExtractionResult,
  extractJsonCandidate,
} from '../src/lib/ai/parseCase';
import { processUploadedFile } from '../src/lib/sar/fileExtractor';

const PDF_PATH = 'upload/Pusat Final Test XL 2026 _1711_1200_rev kapten psw.pdf';

/** Sanitasi payload untuk dicetak: base64/filename dipotong, tanpa secret. */
function sanitizePayload(payload: Record<string, unknown>): string {
  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const input = clone['input'] as Array<Record<string, unknown>>;
  clone['input'] = input.map((part) => {
    const summary: Record<string, unknown> = { type: part['type'] };
    if (typeof part['data'] === 'string') {
      summary['data'] = `<${part['mime_type'] as string}> base64 ${part['data'].length} chars — dipotong: ${part['data'].slice(0, 24)}…`;
      summary['mime_type'] = part['mime_type'];
    }
    if (typeof part['text'] === 'string') {
      summary['text'] = `${part['text'].length} chars: ${part['text'].slice(0, 80)}…`;
    }
    return summary;
  });
  return JSON.stringify(clone, null, 2);
}

async function main(): Promise<void> {
  console.log('=== PERSIAPAN PDF ===');
  const bytes = readFileSync(PDF_PATH);
  console.log(`PDF: ${PDF_PATH} (${(bytes.byteLength / 1024).toFixed(1)} KB)`);
  const processed = await processUploadedFile({
    name: PDF_PATH.split('/').pop() ?? 'pk-tal.pdf',
    type: 'application/pdf',
    base64: bytes.toString('base64'),
  });
  if (processed.type !== 'inlineData' || !processed.inlineData) {
    console.error('PDF gagal diproses menjadi inline document part:', processed);
    process.exit(1);
  }
  console.log(`processUploadedFile → inlineData ${processed.inlineData.mimeType}, base64 ${processed.inlineData.data.length} chars`);

  const model = getExtractionModel();
  const responseFormat = {
    type: 'text',
    mime_type: 'application/json',
    schema: CASE_EXTRACTION_JSON_SCHEMA,
  };
  const payload = buildInteractionRequest({
    model,
    input: [
      { type: 'document', data: processed.inlineData.data, mime_type: processed.inlineData.mimeType },
    ],
    systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
    responseFormat,
    generationConfig: {
      temperature: 0.1,
      max_output_tokens: 32768,
      ...(getThinkingLevel(model) ? { thinking_level: getThinkingLevel(model) } : {}),
    },
    store: false,
    timeoutMs: 120_000,
  });

  console.log('\n=== REQUEST PAYLOAD (TERSANITASI) ===');
  console.log(sanitizePayload(payload));
  const generationConfig = payload['generation_config'] as Record<string, unknown>;
  console.log('\nINVARIANT: response_format top-level =', payload['response_format'] !== undefined);
  console.log('INVARIANT: generation_config tanpa response_format =', generationConfig['response_format'] === undefined);
  console.log('INVARIANT: generation_config tanpa responseMimeType/responseSchema =', generationConfig['responseMimeType'] === undefined && generationConfig['responseSchema'] === undefined);

  if (!getGeminiApiKey()) {
    console.log('\n=== PANGGILAN AKTUAL DILEWATI ===');
    console.log('GEMINI_API_KEY tidak ada di env sandbox ini (secret hanya di lingkungan runtime Anda).');
    console.log('Jalankan ulang di env Anda: GEMINI_API_KEY=... bun run scripts/test_parse_case_pdf.ts');
    process.exit(0);
  }

  console.log('\n=== PANGGILAN AKTUAL Interactions API ===');
  const { callGeminiInteraction } = await import('../src/lib/ai/geminiClient');
  const startedAt = Date.now();
  const result = await callGeminiInteraction({
    model,
    input: payload['input'] as never,
    systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
    responseFormat,
    generationConfig: generationConfig as never,
    store: false,
    timeoutMs: 120_000,
  });
  console.log(`ok=${result.ok} status=${result.status} model=${result.model ?? '-'} durasi=${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  if (!result.ok) {
    console.error('GAGAL:', result.errorMessage?.slice(0, 300));
    process.exit(1);
  }
  console.log(`usage: ${JSON.stringify(result.usage ?? {})}`);
  console.log(`output_text (${result.text.length} chars): ${result.text.slice(0, 200).replace(/\s+/g, ' ')}…`);

  console.log('\n=== VALIDASI ZOD (CaseSchema) ===');
  const candidate = extractJsonCandidate(result.text);
  if (!candidate.ok) {
    console.error('JSON tidak terbaca:', candidate.error);
    process.exit(1);
  }
  const extraction = buildCaseExtractionResult(candidate.data, {}, { model: result.model ?? model, attempts: 1 });
  if (!extraction.ok) {
    console.error('Validasi Zod GAGAL:');
    for (const issue of extraction.detail ?? [extraction.error]) console.error(' -', issue);
    process.exit(1);
  }
  console.log('ok=true — kasus tervalidasi `sarCaseSchema`');
  console.log(`caseTitle: ${extraction.case.caseTitle ?? '-'}`);
  console.log(`incident.type: ${extraction.case.incident?.type}`);
  console.log(`LKP: ${extraction.case.lkp?.coord ? `${extraction.case.lkp.coord.lat}, ${extraction.case.lkp.coord.lng}` : '-'}`);
  console.log(`jumlah SRU: ${extraction.case.sru?.length ?? 0}`);
  console.log(`kecamatan pendukung: ${extraction.case.supportingDistricts?.length ?? 0} entri`);
  console.log(`fieldRows: ${extraction.fieldRows.length} | assumptions: ${extraction.assumptions.length}`);
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
