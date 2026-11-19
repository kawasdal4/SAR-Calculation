/**
 * /api/ai/parse-case (Fase 3 AI Copilot) — alur "Ekstrak → Konfirmasi →
 * Terapkan → Hitung → Review" untuk soal kasus SAR.
 *
 * DESAIN (rencana Fase 0 §5 Fase 3 + keputusan implementasi):
 * - SATU panggilan LLM TANPA tools; keluaran dipaksa JSON via `response_format`
 *   TOP-LEVEL request Interactions API (sejajar model/input/generation_config —
 *   BUKAN di dalam generation_config, dan BUKAN responseMimeType/responseSchema
 *   gaya GenerateContent) + schema dari `sarCaseSchema` (temperature 0.1).
 * - Revalidasi ZOD (`sarCaseSchema.safeParse`) SETIAP respons; bila tidak
 *   valid → kirim ulang PESAN ERROR VALIDASI ke model (maks 2 retry per
 *   model) sehingga model memperbaiki JSON-nya sendiri, bukan diubah diam-diam.
 * - API key server-only (keputusan no.1); model dari
 *   GEMINI_MODEL_EXTRACTION → GEMINI_MODEL → default gemini-3.8-flash
 *   (keputusan no.2) + fallback chain (getModelFallbacks).
 * - PDF/gambar: inline part (soal umumnya kecil; Files API untuk >20MB
 *   tidak perlu — client sudah membatasi 20MB).
 * - store:false (stateless) — privasi soal ujian (catatan Fase 0 §6.4).
 * - Audit: AiSessionLog best-effort (keputusan no.4 & 9) — metadata saja,
 *   tanpa isi prompt dan tanpa secret.
 * - TIDAK mengubah state worksheet apa pun di sini: hasil = kasus tervalidasi
 *   + apply plan deterministik (buildApplyPlan) yang penerapannya lewat
 *   handler apply halaman yang SAMA (keputusan no.5) setelah persetujuan
 *   pengguna di panel pratinjau per-field.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGeminiApiKey, missingApiKeyMessage, getExtractionModel, getModelFallbacks, getThinkingLevel } from '@/lib/ai/config';
import { callGeminiInteraction } from '@/lib/ai/geminiClient';
import { processUploadedFile } from '@/lib/sar/fileExtractor';
import {
  CASE_EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_INSTRUCTION,
  extractJsonCandidate,
  buildCaseExtractionResult,
  type CaseExtractionResult,
} from '@/lib/ai/parseCase';

export const maxDuration = 300;

/** Retry validasi per model (1 panggilan + 2 koreksi dengan pesan error). */
const MAX_VALIDATION_RETRIES = 2;
/** Timeout per percobaan — ekstraksi tanpa tools jauh lebih ringan dari agent loop. */
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_TEXT_CHARS = 40_000;
const MAX_TOTAL_ATTEMPTS = 9; // pengaman anggaran: 3 model × 3 percobaan

interface ParseCaseFile {
  name?: string;
  type?: string;
  base64?: string;
}

/** Teks error validasi untuk feedback retry (ringkas, maks 20 issue). */
function validationFeedback(detail: string[]): string {
  return [
    'JSON Anda SEBELUMNYA DITOLAK oleh validasi skema. Perbaiki dan kirim ulang HANYA JSON yang sudah diperbaiki (aturan yang sama seperti sebelumnya).',
    'Kesalahan:',
    ...detail.map((issue) => `- ${issue}`),
  ].join('\n');
}

/** Catat turn ekstraksi ke AiSessionLog (best-effort, metadata saja). */
async function logParseCaseTurn(data: {
  sessionId: string | null;
  caseId: string | null;
  model: string | null;
  status: string;
  errorMessage?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  attempts: number;
  ok: boolean;
  durationMs: number;
}): Promise<void> {
  try {
    const { db } = await import('@/lib/db');
    await db.aiSessionLog.create({
      data: {
        sessionId: data.sessionId ?? 'parse-case-unknown',
        caseId: data.caseId,
        model: data.model,
        status: data.status,
        errorMessage: data.errorMessage?.slice(0, 500),
        usageJson: data.usage ? JSON.stringify(data.usage) : null,
        toolCallsJson: JSON.stringify([{ name: 'parse_case', attempts: data.attempts, ok: data.ok }]),
        durationMs: Math.round(data.durationMs),
      },
    });
  } catch (dbErr) {
    console.warn('[parse-case] AiSessionLog tidak tersedia (dilanjutkan tanpa audit):', dbErr instanceof Error ? dbErr.message : dbErr);
  }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      return NextResponse.json({ error: missingApiKeyMessage() }, { status: 503 });
    }

    const body = await req.json().catch(() => null) as {
      text?: unknown;
      files?: unknown;
      userNote?: unknown;
      sessionId?: unknown;
      caseId?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: 'Body request tidak valid.' }, { status: 400 });
    }

    const sessionId = typeof body.sessionId === 'string' && /^[\w\-]{8,64}$/.test(body.sessionId) ? body.sessionId : null;
    const caseId = typeof body.caseId === 'string' && body.caseId.length > 0 && body.caseId.length <= 64 ? body.caseId : null;
    const userText = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT_CHARS) : '';
    const userNote = typeof body.userNote === 'string' ? body.userNote.trim().slice(0, 2000) : '';

    const filesRaw = Array.isArray(body.files) ? (body.files as ParseCaseFile[]) : [];
    if (!userText && filesRaw.length === 0) {
      return NextResponse.json({ error: 'Lampirkan soal kasus (PDF/gambar/Office) atau tempel teks soal.' }, { status: 400 });
    }

    // ── Input parts: file via extractor yang SAMA dengan /api/chat ──────────
    const input: Array<Record<string, string>> = [];
    let fileWarnings: string[] = [];
    for (const file of filesRaw.slice(0, 6)) {
      if (typeof file?.base64 !== 'string' || file.base64.length === 0) continue;
      try {
        const processed = await processUploadedFile({
          name: typeof file.name === 'string' ? file.name : 'lampiran',
          type: typeof file.type === 'string' ? file.type : 'application/octet-stream',
          base64: file.base64,
        });
        if (processed.type === 'inlineData' && processed.inlineData) {
          const mimeType = processed.inlineData.mimeType;
          input.push({
            type: mimeType === 'application/pdf' ? 'document' : 'image',
            data: processed.inlineData.data,
            mime_type: mimeType,
          });
        } else if (processed.text) {
          input.push({ type: 'text', text: `Isi lampiran ${file.name ?? ''}:\n${processed.text}` });
        }
      } catch (fileErr) {
        const message = fileErr instanceof Error ? fileErr.message : 'gagal diproses';
        fileWarnings = [...fileWarnings, `Lampiran ${file.name ?? ''}: ${message}`];
      }
    }
    if (userText) input.push({ type: 'text', text: userText });
    if (userNote) input.push({ type: 'text', text: `Catatan tambahan pengguna: ${userNote}` });
    if (input.length === 0) {
      return NextResponse.json({ error: 'Tidak ada konten soal yang bisa dibaca dari permintaan Anda.', warnings: fileWarnings }, { status: 400 });
    }

    const responseFormat = {
      type: 'text',
      mime_type: 'application/json',
      schema: CASE_EXTRACTION_JSON_SCHEMA,
    };

    const primaryModel = getExtractionModel();
    const modelChain = [primaryModel, ...getModelFallbacks(primaryModel)];

    let lastError = 'Ekstraksi gagal.';
    let lastDetail: string[] | undefined;
    let totalAttempts = 0;
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    let usedModel: string | null = null;

    modelChainLoop: for (const model of modelChain) {
      if (totalAttempts >= MAX_TOTAL_ATTEMPTS) break;
      let feedback = '';
      attemptLoop: for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt += 1) {
        if (totalAttempts >= MAX_TOTAL_ATTEMPTS) break;
        totalAttempts += 1;
        const result = await callGeminiInteraction({
          model,
          input: feedback ? [...input, { type: 'text', text: feedback }] : input,
          systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
          // Structured output TOP-LEVEL Interactions API — sejajar model/input/
          // generation_config. Bukan di dalam generation_config (→ HTTP 400
          // "Unknown parameter 'response_format' at 'generation_config'") dan
          // bukan responseMimeType/responseSchema gaya GenerateContent.
          responseFormat,
          generationConfig: {
            temperature: 0.1,
            max_output_tokens: 32768,
            ...(getThinkingLevel(model) ? { thinking_level: getThinkingLevel(model) } : {}),
          },
          store: false,
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
        if (!result.ok) {
          // Timeout/error API: model ini bermasalah → coba model berikutnya.
          if (result.errorName === 'TimeoutError' || result.errorName === 'AbortError') {
            lastError = `Gemini ${model} tidak merespons dalam ${Math.round(REQUEST_TIMEOUT_MS / 1000)} detik.`;
          } else {
            lastError = result.errorMessage || `Gemini API mengembalikan HTTP ${result.status}`;
          }
          console.warn(`[parse-case] Panggilan gagal (model=${model}, attempt=${attempt + 1}): ${lastError.slice(0, 200)}`);
          // HTTP 400 = struktur request salah (parameter tidak dikenal, schema
          // tidak valid, dsb.). Payload yang sama dikirim ke model lain juga
          // cacat — hentikan seluruh chain agar tidak fallback berulang ke
          // banyak model dengan request yang bermasalah.
          if (result.status === 400) break modelChainLoop;
          break;
        }
        usage = usage ?? result.usage;
        usedModel = result.model ?? model;

        const candidate = extractJsonCandidate(result.text);
        if (!candidate.ok) {
          // JSON rusak → feedback juga (kelas error yang sama: respons model).
          feedback = validationFeedback([candidate.error ?? 'JSON tidak dapat dibaca.']);
          lastError = 'Respons model bukan JSON yang dapat dibaca.';
          lastDetail = [candidate.error ?? ''];
          console.warn(`[parse-case] JSON tidak terbaca (model=${model}, attempt=${attempt + 1}): ${candidate.error}`);
          continue;
        }

        const extraction = buildCaseExtractionResult(candidate.data, {}, {
          model: usedModel ?? model,
          attempts: totalAttempts,
        });
        if (extraction.ok) {
          extraction.model = usedModel ?? model;
          extraction.attempts = totalAttempts;
          await logParseCaseTurn({
            sessionId, caseId, model: usedModel, status: 'ok',
            usage: result.usage, attempts: totalAttempts, ok: true,
            durationMs: Date.now() - startedAt,
          });
          return NextResponse.json({
            ...extraction,
            ...(fileWarnings.length > 0 ? { warnings: fileWarnings } : {}),
          });
        }
        // Validasi Zod gagal → kirim ulang pesan error validasi ke model.
        feedback = validationFeedback(extraction.detail ?? [extraction.error]);
        lastError = extraction.error;
        lastDetail = extraction.detail;
        console.warn(`[parse-case] Validasi skema gagal (model=${model}, attempt=${attempt + 1}): ${(extraction.detail ?? []).slice(0, 3).join(' | ')}`);
      }
    }

    await logParseCaseTurn({
      sessionId, caseId, model: usedModel, status: 'error',
      errorMessage: lastError, attempts: totalAttempts, ok: false,
      durationMs: Date.now() - startedAt,
    });
    const failure: CaseExtractionResult = {
      ok: false,
      error: lastError,
      detail: lastDetail,
      attempts: totalAttempts,
    };
    return NextResponse.json({
      ...failure,
      ...(fileWarnings.length > 0 ? { warnings: fileWarnings } : {}),
    }, { status: 502 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[parse-case] Fatal:', message);
    await logParseCaseTurn({
      sessionId: null, caseId: null, model: null, status: 'error',
      errorMessage: message, attempts: 0, ok: false, durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: `Gagal mengekstrak soal kasus: ${message}` }, { status: 500 });
  }
}
