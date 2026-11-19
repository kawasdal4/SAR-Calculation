/**
 * EVAL AI — GOLDEN SET (Fase 6 AI Copilot)
 *
 * Menjalankan ekstraksi `parse_case` pada soal PK-TAL (PDF golden) lalu
 * membandingkan hasilnya dengan fixture `tests/golden/pk-tal.case.json`
 * per field (akurasi per bagian — khusus tabel angin per ketinggian & data
 * SRU dicocokkan per kunci). Rencana Fase 0 §5 Fase 6 + keputusan no. 8.
 *
 * PENTING (keputusan no. 8):
 *  - Fixture golden = INPUT soal (bukan kunci jawaban). Kunci jawaban resmi
 *    (hasil perhitungan) diisi instruktur — sampai itu ada, TIDAK ada angka
 *    expected yang dikarang; eval ini mengukur KETEPATAN EKSTRAKSI soal.
 *
 * Pakai:
 *   GEMINI_API_KEY=... bun run eval:ai                      # PK-TAL, laporan ke console + JSON
 *   bun run eval:ai -- --fixture <path> --source <pdf>      # golden set lain
 *   bun run eval:ai -- --strict                             # exit 1 bila akurasi < min
 *   bun run eval:ai -- --min-accuracy 90
 *
 * Tanpa GEMINI_API_KEY → SKIP (exit 0, atau exit 1 bila --strict).
 * Laporan JSON ditulis ke tests/golden/eval-report.json (di-gitignore).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CASE_EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_INSTRUCTION,
  extractJsonCandidate,
  buildCaseExtractionResult,
} from '../src/lib/ai/parseCase';
import { callGeminiInteraction } from '../src/lib/ai/geminiClient';
import {
  compareGoldenCases,
  formatGoldenEvalReport,
  type GoldenEvalReport,
} from '../src/lib/ai/evalGolden';

const REPO = resolve(import.meta.dir, '..');
const DEFAULT_FIXTURE = resolve(REPO, 'tests/golden/pk-tal.case.json');
const DEFAULT_SOURCE = resolve(REPO, 'upload/Pusat Final Test XL 2026 _1711_1200_rev kapten psw.pdf');
const DEFAULT_OUT = resolve(REPO, 'tests/golden/eval-report.json');

const MAX_VALIDATION_RETRIES = 2;
const MAX_TOTAL_ATTEMPTS = 9;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_TEXT_CHARS = 40_000;

interface Args {
  fixture: string;
  source: string;
  out: string;
  strict: boolean;
  minAccuracy: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { fixture: DEFAULT_FIXTURE, source: DEFAULT_SOURCE, out: DEFAULT_OUT, strict: false, minAccuracy: 80 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--fixture' && next) { args.fixture = resolve(next); i += 1; }
    else if (flag === '--source' && next) { args.source = resolve(next); i += 1; }
    else if (flag === '--out' && next) { args.out = resolve(next); i += 1; }
    else if (flag === '--strict') { args.strict = true; }
    else if (flag === '--min-accuracy' && next) { args.minAccuracy = Number(next); i += 1; }
  }
  return args;
}

function getApiKey(): string | null {
  const raw = process.env.GEMINI_API_KEY;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validationFeedback(detail: string[]): string {
  return [
    'JSON Anda SEBELUMNYA DITOLAK oleh validasi skema. Perbaiki dan kirim ulang HANYA JSON yang sudah diperbaiki (aturan yang sama seperti sebelumnya).',
    'Kesalahan:',
    ...detail.map((issue) => `- ${issue}`),
  ].join('\n');
}

/** Model chain — identik dengan /api/ai/parse-case (config Fase 2). */
function modelChain(primary: string): string[] {
  const sanitize = (value: string | undefined, fallback: string) =>
    typeof value === 'string' && /^[\w.\-]+$/.test(value.trim()) && value.trim().length <= 64 ? value.trim() : fallback;
  const envFallbacks = (process.env.GEMINI_MODEL_FALLBACKS ?? '')
    .split(',').map((s) => s.trim())
    .filter((s) => /^[\w.\-]+$/.test(s) && s.length <= 64 && s !== primary);
  const defaults = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash'].filter((m) => m !== primary);
  return [primary, ...(envFallbacks.length > 0 ? envFallbacks : defaults)];
}

async function runExtraction(apiKey: string, input: Array<Record<string, string>>) {
  const primaryModel = sanitizeEnv(process.env.GEMINI_MODEL_EXTRACTION) ?? sanitizeEnv(process.env.GEMINI_MODEL) ?? 'gemini-3.8-flash';
  const chain = modelChain(primaryModel);
  const responseFormat = { type: 'text', mime_type: 'application/json', schema: CASE_EXTRACTION_JSON_SCHEMA };
  let lastError = 'Ekstraksi gagal.';
  let totalAttempts = 0;

  for (const model of chain) {
    if (totalAttempts >= MAX_TOTAL_ATTEMPTS) break;
    let feedback = '';
    for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt += 1) {
      if (totalAttempts >= MAX_TOTAL_ATTEMPTS) break;
      totalAttempts += 1;
      const result = await callGeminiInteraction({
        model,
        input: feedback ? [...input, { type: 'text', text: feedback }] : input,
        systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
        generationConfig: {
          temperature: 0.1,
          max_output_tokens: 32768,
          response_format: responseFormat,
          ...(model === 'gemini-3.8-flash' ? { thinking_level: 'low' } : {}),
        },
        store: false,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      if (!result.ok) {
        lastError = result.errorMessage || `Gemini API HTTP ${result.status}`;
        console.warn(`[eval:ai] Panggilan gagal (model=${model}, attempt=${attempt + 1}): ${lastError.slice(0, 200)}`);
        break;
      }
      const candidate = extractJsonCandidate(result.text);
      if (!candidate.ok) {
        feedback = validationFeedback([candidate.error ?? 'JSON tidak dapat dibaca.']);
        lastError = 'Respons model bukan JSON yang dapat dibaca.';
        continue;
      }
      const extraction = buildCaseExtractionResult(candidate.data, {}, {
        model: result.model ?? model,
        attempts: totalAttempts,
      });
      if (extraction.ok) return { case: extraction.case, model: result.model ?? model, attempts: totalAttempts };
      feedback = validationFeedback(extraction.detail ?? [extraction.error]);
      lastError = extraction.error;
      console.warn(`[eval:ai] Validasi skema gagal (model=${model}, attempt=${attempt + 1}): ${(extraction.detail ?? []).slice(0, 3).join(' | ')}`);
    }
  }
  throw new Error(`${lastError} (setelah ${totalAttempts} percobaan)`);
}

function sanitizeEnv(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[\w.\-]+$/.test(trimmed) && trimmed.length <= 64 ? trimmed : undefined;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log('SKIP: GEMINI_API_KEY belum diset di environment.');
    console.log('Atur dulu:  export GEMINI_API_KEY=...  lalu jalankan ulang  bun run eval:ai');
    return args.strict ? 1 : 0;
  }

  const golden = JSON.parse(await readFile(args.fixture, 'utf8'));
  let input: Array<Record<string, string>>;
  if (args.source.toLowerCase().endsWith('.pdf')) {
    const base64 = (await readFile(args.source)).toString('base64');
    input = [{ type: 'document', data: base64, mime_type: 'application/pdf' }];
  } else {
    const text = (await readFile(args.source, 'utf8')).slice(0, MAX_TEXT_CHARS);
    input = [{ type: 'text', text }];
  }

  console.log(`Fixture : ${args.fixture}`);
  console.log(`Sumber  : ${args.source}`);
  console.log('Menjalankan parse_case (Interactions API, store:false)…');
  const started = Date.now();
  const extraction = await runExtraction(apiKey, input);
  const durationMs = Date.now() - started;
  console.log(`Model   : ${extraction.model} (${extraction.attempts} percobaan, ${durationMs} ms)`);

  const report: GoldenEvalReport = compareGoldenCases(golden, extraction.case);
  console.log('');
  console.log(formatGoldenEvalReport(report));

  const record = {
    generatedAt: new Date().toISOString(),
    fixture: args.fixture,
    source: args.source,
    model: extraction.model,
    attempts: extraction.attempts,
    durationMs,
    summary: report.summary,
    sections: report.sections,
    rows: report.rows,
  };
  await writeFile(args.out, JSON.stringify(record, null, 2) + '\n', 'utf8');
  console.log(`\nLaporan JSON: ${args.out}`);

  if (args.strict && report.summary.accuracyPct < args.minAccuracy) {
    console.error(`GAGAL --strict: akurasi ${report.summary.accuracyPct}% < minimum ${args.minAccuracy}%`);
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`[eval:ai] Gagal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  });
