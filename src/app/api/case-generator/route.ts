import { NextRequest, NextResponse } from 'next/server';
import {
  generateCase,
  describeGeneratorCapabilities,
  GENERATOR_INCIDENT_TYPES,
  type GenerateCaseParams,
  type GeneratorTrap,
  type GeneratorDifficulty,
} from '@/lib/sar/caseGenerator';
import { renderCaseNaskah, checkNaskahCoverage, type NaskahRenderOptions } from '@/lib/sar/caseNaskah';
import { buildCaseNarrative, NARRATIVE_STYLES, NARRATIVE_STYLE_LABELS, type NarrativeStyle } from '@/lib/sar/caseNarrative';
import { buildCaseAnswerKey } from '@/lib/sar/caseAnswerKey';
import { buildApplyPlan } from '@/lib/ai/parseCase';
import { validatePlanSnapshot } from '@/lib/sar/validatePlan';
import { sarCaseSchema } from '@/lib/sar/caseSchema';

/** GET /api/case-generator — kapabilitas generator (jenis kejadian 5, gaya
 *  bahasa, kesulitan + knob, jebakan, wilayah, katalog bank) untuk form UI. */
export async function GET() {
  try {
    return NextResponse.json({
      ...describeGeneratorCapabilities(),
      narrativeStyles: NARRATIVE_STYLES.map((s) => ({ id: s, label: NARRATIVE_STYLE_LABELS[s] })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function knobNumber(value: unknown, min: number, max: number, label: string, errors: string[]): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`${label} harus angka.`);
    return undefined;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** POST /api/case-generator — generate soal deterministik ber-seed (Fase 5b):
 *  5 jenis kejadian × 3 kesulitan (knob eksplisit) × 4 gaya bahasa narasi;
 *  keluaran: kasus + naskah bergaya + kelengkapan + coverage + rencana
 *  penerapan + validasi plan + kunci jawaban (opsional). Tanpa LLM —
 *  variasi narasi LLM lewat POST /api/case-generator/narrative. */
export async function POST(req: NextRequest) {
  const errors: string[] = [];
  try {
    const body = await req.json() as Partial<GenerateCaseParams> & {
      explicitSearchNumber?: boolean;
      includeReferenceNote?: boolean;
      includeAnswerKey?: boolean;
      style?: string;
      stagesBefore?: number;
      envDataPoints?: number;
      districtDataCount?: number;
      trapCount?: number;
    };

    if (!body.seed || typeof body.seed !== 'string') {
      return NextResponse.json({ error: 'seed wajib diisi (string apa pun).' }, { status: 400 });
    }
    if (!GENERATOR_INCIDENT_TYPES.includes(body.incidentType as (typeof GENERATOR_INCIDENT_TYPES)[number])) {
      return NextResponse.json({ error: `incidentType harus salah satu dari: ${GENERATOR_INCIDENT_TYPES.join(', ')}.` }, { status: 400 });
    }
    const difficulty = (body.difficulty ?? 'sedang') as GeneratorDifficulty;
    if (!['mudah', 'sedang', 'sulit'].includes(difficulty)) {
      return NextResponse.json({ error: 'difficulty harus mudah/sedang/sulit.' }, { status: 400 });
    }
    const styleInput = (body.style ?? 'otomatis') as NarrativeStyle;
    if (!NARRATIVE_STYLES.includes(styleInput)) {
      return NextResponse.json({ error: `style harus salah satu dari: ${NARRATIVE_STYLES.join(', ')}.` }, { status: 400 });
    }

    const sruCount = knobNumber(body.sruCount, 2, 4, 'sruCount', errors);
    const stagesBefore = knobNumber(body.stagesBefore, 0, 4, 'stagesBefore', errors);
    const envDataPoints = knobNumber(body.envDataPoints, 4, 12, 'envDataPoints', errors);
    const districtDataCount = knobNumber(body.districtDataCount, 0, 5, 'districtDataCount', errors);
    const trapCount = knobNumber(body.trapCount, 0, 6, 'trapCount', errors);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
    }

    const params: GenerateCaseParams = {
      seed: body.seed,
      incidentType: body.incidentType as GenerateCaseParams['incidentType'],
      regionId: body.regionId ?? 'selat-sunda',
      difficulty,
      ...(Array.isArray(body.traps) ? { traps: body.traps as GeneratorTrap[] } : {}),
      ...(sruCount !== undefined ? { sruCount } : {}),
      ...(stagesBefore !== undefined ? { stagesBefore } : {}),
      ...(envDataPoints !== undefined ? { envDataPoints } : {}),
      ...(districtDataCount !== undefined ? { districtDataCount } : {}),
      ...(trapCount !== undefined ? { trapCount } : {}),
      ...(body.incidentDateISO ? { incidentDateISO: String(body.incidentDateISO) } : {}),
      ...(body.examHeader ? { examHeader: body.examHeader } : {}),
      ...(body.targetAssetId ? { targetAssetId: body.targetAssetId } : {}),
      ...(Array.isArray(body.sruAssetIds) ? { sruAssetIds: body.sruAssetIds } : {}),
    };

    const result = generateCase(params);
    const naskahOptions: NaskahRenderOptions = {
      explicitSearchNumber: body.explicitSearchNumber ?? !result.appliedTraps.includes('search-number-inference'),
      includeReferenceNote: body.includeReferenceNote ?? true,
    };

    // Narasi gaya pilihan (deterministik, tanpa LLM); tanpa style = template 5a.
    const narrative = body.style
      ? buildCaseNarrative(result.case, styleInput, { explicitSearchNumber: naskahOptions.explicitSearchNumber })
      : null;
    const naskah = renderCaseNaskah(result.case, {
      ...naskahOptions,
      ...(narrative ? { narrativeText: narrative.text } : {}),
    });
    const coverage = checkNaskahCoverage(result.case, naskah, naskahOptions);
    const applyPlan = buildApplyPlan(result.case, {
      leewayObjectId: result.case.target?.leewayObjectId,
      xNm: 0,
      yNm: 0,
    });

    // validate_plan (Fase 2) pada snapshot minimal dari kasus — pemeriksaan
    // koordinat/waktu/rentang sebelum worksheet diisi.
    const planValidation = validatePlanSnapshot({
      lkp: result.case.lkp?.coord ? { lat: result.case.lkp.coord.lat, lng: result.case.lkp.coord.lng } : undefined,
      asw: {
        distressTime: result.case.incident.lastContactTime ?? '',
        datumTime: result.case.search?.datumTime ?? '',
        intervalMode: '6h',
        windData: (result.case.sea?.surfaceWindSeries ?? []).map((e) => ({
          obsTime: e.obsTime, windDirFrom: e.windDirFrom, windSpeed: e.windSpeedKts,
        })),
      },
    });

    // Sanity: kasus yang dikirim selalu valid sesuai schema (defense-in-depth).
    const parsed = sarCaseSchema.safeParse(result.case);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Kasus hasil generator gagal validasi schema.' }, { status: 500 });
    }

    const answerKey = body.includeAnswerKey
      ? buildCaseAnswerKey(result.case, {
          leewayObjectId: result.case.target?.leewayObjectId,
          xNm: 0,
          yNm: 0,
        })
      : null;

    return NextResponse.json({
      case: result.case,
      naskah,
      ...(narrative ? { narrative: { style: narrative.style, text: narrative.text, requestedStyle: styleInput } } : {}),
      coverage,
      completeness: result.completeness,
      applyPlan,
      planValidation,
      appliedTraps: result.appliedTraps,
      skippedTraps: result.skippedTraps,
      resolvedKnobs: result.resolvedKnobs,
      warnings: result.warnings,
      params: result.params,
      ...(answerKey ? { answerKey } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
