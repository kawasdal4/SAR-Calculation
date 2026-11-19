import { NextRequest, NextResponse } from 'next/server';
import {
  generateCase,
  describeGeneratorCapabilities,
  type GenerateCaseParams,
  type GeneratorTrap,
  type GeneratorDifficulty,
} from '@/lib/sar/caseGenerator';
import { renderCaseNaskah, checkNaskahCoverage, type NaskahRenderOptions } from '@/lib/sar/caseNaskah';
import { buildApplyPlan } from '@/lib/ai/parseCase';
import { sarCaseSchema } from '@/lib/sar/caseSchema';

/** GET /api/case-generator — kapabilitas generator (wilayah, kesulitan,
 *  jebakan, katalog bank) untuk form UI. */
export async function GET() {
  try {
    return NextResponse.json(describeGeneratorCapabilities());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/case-generator — generate soal deterministik ber-seed:
 *  kasus (CaseSchema) + naskah (template PK-TAL) + kelengkapan + rencana
 *  penerapan ke worksheet. Tanpa LLM (narasi LLM = Fase 5b). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<GenerateCaseParams> & {
      explicitSearchNumber?: boolean;
      includeReferenceNote?: boolean;
    };

    if (!body.seed || typeof body.seed !== 'string') {
      return NextResponse.json({ error: 'seed wajib diisi (string apa pun).' }, { status: 400 });
    }
    if (body.incidentType !== 'aircraft-ditching' && body.incidentType !== 'vessel-sinking') {
      return NextResponse.json({ error: "incidentType harus 'aircraft-ditching' atau 'vessel-sinking'." }, { status: 400 });
    }
    const difficulty = (body.difficulty ?? 'sedang') as GeneratorDifficulty;
    if (!['mudah', 'sedang', 'sulit'].includes(difficulty)) {
      return NextResponse.json({ error: 'difficulty harus mudah/sedang/sulit.' }, { status: 400 });
    }

    const params: GenerateCaseParams = {
      seed: body.seed,
      incidentType: body.incidentType,
      regionId: body.regionId ?? 'selat-sunda',
      difficulty,
      ...(Array.isArray(body.traps) ? { traps: body.traps as GeneratorTrap[] } : {}),
      ...(body.sruCount !== undefined ? { sruCount: Number(body.sruCount) } : {}),
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
    const naskah = renderCaseNaskah(result.case, naskahOptions);
    const coverage = checkNaskahCoverage(result.case, naskah, naskahOptions);
    const applyPlan = buildApplyPlan(result.case, {
      leewayObjectId: result.case.target?.leewayObjectId,
      xNm: 0,
      yNm: 0,
    });

    // Sanity: kasus yang dikirim selalu valid sesuai schema (defense-in-depth).
    const parsed = sarCaseSchema.safeParse(result.case);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Kasus hasil generator gagal validasi schema.' }, { status: 500 });
    }

    return NextResponse.json({
      case: result.case,
      naskah,
      coverage,
      completeness: result.completeness,
      applyPlan,
      appliedTraps: result.appliedTraps,
      skippedTraps: result.skippedTraps,
      warnings: result.warnings,
      params: result.params,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
