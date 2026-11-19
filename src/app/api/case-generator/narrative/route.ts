import { NextRequest, NextResponse } from 'next/server';
import { sarCaseSchema } from '@/lib/sar/caseSchema';
import { renderCaseNaskah, checkNaskahCoverage, type NaskahRenderOptions } from '@/lib/sar/caseNaskah';
import {
  buildCaseNarrative,
  parseBackNarrativeValues,
  allowedNarrativeNumberTokens,
  NARRATIVE_STYLES,
  type NarrativeStyle,
} from '@/lib/sar/caseNarrative';
import { callGeminiInteraction, type InteractionCallResult } from '@/lib/ai/geminiClient';
import { getExtractionModel, getModelFallbacks, getThinkingLevel } from '@/lib/ai/config';

export const runtime = 'nodejs';

const REQUEST_TIMEOUT_MS = 60_000;

const SYSTEM_INSTRUCTION = `Anda adalah penyusun NARASI soal latihan SAR. Tugas Anda SATU: menulis ulang paragraf narasi yang diberikan dengan gaya bahasa yang diminta, TANPA mengubah satu pun nilai data.

ATURAN MUTLAK:
1. Setiap angka, tanggal, waktu, zona, koordinat, callsign, nama kantor, dan istilah teknis pada narasi asli HARUS tetap ada dan TIDAK BOLEH berubah nilainya (mis. "13.50 WIB" tetap "13.50 WIB"; "FL150" tetap "FL150").
2. DILARANG menambah angka, waktu, koordinat, atau fakta baru apa pun (tidak boleh menambah data cuaca, jarak, kapasitas, dsb.).
3. DILARANG menghapus informasi: kalimat asli boleh ditata ulang/disatukan, tetapi semua nilai tetap tercantum.
4. Gunakan Bahasa Indonesia. Keluarkan HANYA paragraf narasi hasil — tanpa judul, tanpa penjelasan, tanpa penanda.`;

const STYLE_GUIDE: Record<Exclude<NarrativeStyle, 'otomatis'>, string> = {
  'formal-ujian': 'Gaya: formal ujian kedinasan — kalimat lengkap, nada birokratis, menyebut tanggal lengkap ("pada tanggal ... pukul ...").',
  'narasi-operasional': 'Gaya: narasi operasional — kalimat pendek dan padat seperti catatan jaga/laporan operasi; boleh memakai istilah ringkas yang sudah ada.',
  'skenario-simulasi': 'Gaya: skenario simulasi latihan — sapa peserta sebagai "Anda" (perencana SAR), sebut kartu latihan/injekan instruktur.',
};

/** Token angka & nilai kunci yang boleh muncul di narasi LLM. */
function numericTokensOf(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)?/g) ?? [];
}

function normalizeNumberToken(t: string): string {
  return t.replace('.', ',');
}

/** POST /api/case-generator/narrative — variasi narasi LLM (Fase 5b).
 *  Guardrail: LLM HANYA menulis ulang paragraf narasi; seluruh nilai harus
 *  tetap sesuai CaseSchema. Pemeriksaan setelah respons:
 *  1. coverage check naskah penuh (semua field wajib tetap tercantum),
 *  2. parse-back nilai kunci,
 *  3. daftar putih angka (tidak boleh ada angka di luar nilai kasus).
 *  Bila salah satu gagal → HTTP 422 + alasan; UI memakai narasi deterministik. */
export async function POST(req: NextRequest) {
  let body: {
    case?: unknown;
    style?: string;
    seed?: string;
    explicitSearchNumber?: boolean;
    includeReferenceNote?: boolean;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid.' }, { status: 400 });
  }

  const parsedCase = sarCaseSchema.safeParse(body.case);
  if (!parsedCase.success) {
    return NextResponse.json({ error: 'Case tidak valid menurut sarCaseSchema.' }, { status: 400 });
  }
  const sarCase = parsedCase.data;
  const styleInput = (body.style ?? 'otomatis') as NarrativeStyle;
  if (!NARRATIVE_STYLES.includes(styleInput)) {
    return NextResponse.json({ error: `style harus salah satu dari: ${NARRATIVE_STYLES.join(', ')}.` }, { status: 400 });
  }
  const opts: NaskahRenderOptions = {
    explicitSearchNumber: body.explicitSearchNumber ?? true,
    includeReferenceNote: body.includeReferenceNote ?? true,
  };

  // Baseline deterministik sebagai acuan LLM + fallback.
  const variantSeed = body.seed ?? sarCase.meta?.seed ?? 'naskah';
  const deterministic = buildCaseNarrative(sarCase, styleInput, { explicitSearchNumber: opts.explicitSearchNumber, variantSeed });
  const deterministicNaskah = renderCaseNaskah(sarCase, { ...opts, narrativeText: deterministic.text });
  const allowedNumbers = allowedNarrativeNumberTokens(sarCase, { explicitSearchNumber: opts.explicitSearchNumber, variantSeed });

  // ── Panggil LLM (dengan fallback model) ──
  const primaryModel = getExtractionModel();
  const modelChain = [primaryModel, ...getModelFallbacks(primaryModel)];
  let result: InteractionCallResult | null = null;
  let lastError: string | undefined;
  for (const model of modelChain) {
    const attempt = await callGeminiInteraction({
      model,
      input: [
        {
          type: 'text',
          text: [
            `Gaya bahasa: ${styleInput === 'otomatis' ? 'variasi bebas dari salah satu gaya berikut' : STYLE_GUIDE[styleInput as Exclude<NarrativeStyle, 'otomatis'>] ?? STYLE_GUIDE['formal-ujian']}`,
            '',
            'NARASI ASLI (nilai wajib dipertahankan):',
            deterministic.text,
          ].join('\n'),
        },
      ],
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.4,
        max_output_tokens: 4096,
        ...(getThinkingLevel(model) ? { thinking_level: getThinkingLevel(model) } : {}),
      },
      store: false,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (attempt.ok && attempt.text.trim()) {
      result = attempt;
      break;
    }
    lastError = attempt.errorMessage ?? `HTTP ${attempt.status}`;
  }

  if (!result || !result.text.trim()) {
    return NextResponse.json({
      error: 'Panggilan LLM gagal.',
      detail: lastError ?? 'respons kosong',
      fallback: { narrative: deterministic.text, style: deterministic.style },
    }, { status: 502 });
  }

  const llmText = result.text.trim();

  // ── Guardrail 1: coverage (semua nilai wajib tetap muncul) ──
  const naskah = renderCaseNaskah(sarCase, { ...opts, narrativeText: llmText });
  const coverage = checkNaskahCoverage(sarCase, naskah, opts);

  // ── Guardrail 2: parse-back nilai kunci ──
  const parseBack = parseBackNarrativeValues(sarCase, naskah.text, { explicitSearchNumber: opts.explicitSearchNumber, variantSeed });

  // ── Guardrail 3: daftar putih angka ──
  const numberIssues: string[] = [];
  for (const token of numericTokensOf(llmText)) {
    const normalized = normalizeNumberToken(token);
    if (!allowedNumbers.has(token) && !allowedNumbers.has(normalized) && !allowedNumbers.has(normalized.replace(',0', ''))) {
      numberIssues.push(token);
    }
  }

  const ok = coverage.covered && parseBack.ok && numberIssues.length === 0;
  if (!ok) {
    return NextResponse.json({
      error: 'Narasi LLM ditolak guardrail — nilai berubah atau field hilang.',
      checks: {
        coverage: { ok: coverage.covered, issues: coverage.issues.slice(0, 10) },
        parseBack: { ok: parseBack.ok, issues: parseBack.issues.slice(0, 10) },
        numbers: { ok: numberIssues.length === 0, unexpected: numberIssues.slice(0, 10) },
      },
      fallback: { narrative: deterministic.text, style: deterministic.style },
    }, { status: 422 });
  }

  return NextResponse.json({
    narrative: llmText,
    style: deterministic.style,
    deterministicNarrative: deterministic.text,
    checks: {
      coverage: { ok: true, total: coverage.total, coveredCount: coverage.coveredCount },
      parseBack: { ok: true, checkedFields: parseBack.checkedFields },
      numbers: { ok: true, allowedCount: allowedNumbers.size },
    },
    model: result.model,
    usage: result.usage,
  });
}
