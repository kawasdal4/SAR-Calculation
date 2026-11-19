/**
 * TEST PARSE CASE (Fase 3 AI Copilot) — alur "Ekstrak → Konfirmasi → Terapkan
 * → Hitung → Review" TANPA memanggil LLM (semua bagian deterministik):
 *
 * 1. Skema JSON ekstraksi (tipe lowercase, field kunci ada).
 * 2. extractJsonCandidate — JSON murni / fenced / terbenam / rusak.
 * 3. buildCaseExtractionResult — revalidasi Zod + baris pratinjau + apply plan
 *    dari fixture golden PK-TAL (satu sumber fixture yang sama dengan regresi).
 * 4. buildApplyPlan — urutan langkah rantai worksheet, payload handler,
 *    driftInterval Datum = total hours ASW dari FUNGSI RESMI (bukan karangan).
 * 5. mergeUserFieldValue — angka format Indonesia, koordinat DMS, path SRU
 *    per-callsign, lkp.source otomatis explicit.
 * 6. Status baris pratinjau: OK / DIASUMSIKAN / HILANG (keputusan no.6).
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CASE_EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_INSTRUCTION,
  extractJsonCandidate,
  deriveExtractionFieldRows,
  buildApplyPlan,
  buildCaseExtractionResult,
  mergeUserFieldValue,
  type CaseApplyStep,
} from '../src/lib/ai/parseCase';
import { sarCaseSchema, type SarCaseSchema } from '../src/lib/sar/caseSchema';
import { buildAswObservationsFromCase } from '../src/lib/sar/aswTime';
import { computeASW } from '../src/lib/sar/sarCalculations';

const GOLDEN: SarCaseSchema = JSON.parse(
  readFileSync(join(import.meta.dir, 'golden', 'pk-tal.case.json'), 'utf8'),
);

// ── 1. Skema JSON ekstraksi ──────────────────────────────────────────────────

describe('CASE_EXTRACTION_JSON_SCHEMA', () => {
  test('semua tipe lowercase (konvensi Interactions API)', () => {
    const types: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (typeof record['type'] === 'string') types.push(record['type']);
      for (const value of Object.values(record)) walk(value);
    };
    walk(CASE_EXTRACTION_JSON_SCHEMA);
    expect(types.length).toBeGreaterThan(30);
    for (const type of types) {
      expect(['object', 'array', 'string', 'number', 'integer', 'boolean']).toContain(type);
    }
  });

  test('incident wajib; meta.fieldSources + missingFields + assumptions ada', () => {
    expect(CASE_EXTRACTION_JSON_SCHEMA['required']).toEqual(['incident']);
    const properties = CASE_EXTRACTION_JSON_SCHEMA['properties'] as Record<string, { properties: Record<string, unknown> }>;
    const meta = properties['meta'].properties;
    expect(meta['fieldSources']).toBeDefined();
    expect(meta['missingFields']).toBeDefined();
    expect(meta['assumptions']).toBeDefined();
    // Enum status hanya VERIFIED/UNVERIFIED — MISSING/SIMULATION bukan urusan model.
    const fieldSourcesItems = meta['fieldSources'] as { items: { properties: Record<string, unknown> } };
    const statusEnum = (fieldSourcesItems.items.properties['status'] as { enum: string[] }).enum;
    expect(statusEnum).toEqual(['VERIFIED', 'UNVERIFIED']);
  });

  test('instruksi sistem memuat konvensi arah & larangan mengarang', () => {
    expect(EXTRACTION_SYSTEM_INSTRUCTION).toContain('DARI');
    expect(EXTRACTION_SYSTEM_INSTRUCTION).toContain('DILARANG MENGARANG');
    expect(EXTRACTION_SYSTEM_INSTRUCTION).toContain('VERIFIED');
    expect(EXTRACTION_SYSTEM_INSTRUCTION).toContain('UNVERIFIED');
    expect(EXTRACTION_SYSTEM_INSTRUCTION).toContain('flightLevelFt 200');
  });
});

// ── 2. extractJsonCandidate ──────────────────────────────────────────────────

describe('extractJsonCandidate', () => {
  test('JSON murni', () => {
    const result = extractJsonCandidate('{"a":1}');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ a: 1 });
  });

  test('JSON dalam code fence ```json', () => {
    const result = extractJsonCandidate('```json\n{"a": {"b": 2}}\n```');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ a: { b: 2 } });
  });

  test('JSON terbenam di antara teks (kurung dalam string diabaikan)', () => {
    const result = extractJsonCandidate('Hasil: {"note":"kurung } di dalam string","ok":true} selesai.');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ note: 'kurung } di dalam string', ok: true });
  });

  test('JSON tidak tertutup → gagal dengan pesan', () => {
    const result = extractJsonCandidate('{"a": 1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('tidak tertutup');
  });

  test('teks tanpa JSON → gagal', () => {
    expect(extractJsonCandidate('Saya tidak bisa mengekstrak.').ok).toBe(false);
    expect(extractJsonCandidate('').ok).toBe(false);
  });
});

// ── 3. buildCaseExtractionResult (fixture PK-TAL) ────────────────────────────

describe('buildCaseExtractionResult — fixture PK-TAL', () => {
  const result = buildCaseExtractionResult(GOLDEN, {}, { model: 'test-model', attempts: 1 });

  test('kasus golden valid terhadap skema Zod', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.case.incident.callsign).toBe('PK-TAL');
    expect(result.model).toBe('test-model');
  });

  test('fieldRows mencakup nilai soal + status benar', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byField = new Map(result.fieldRows.map((row) => [row.field, row]));
    const pob = byField.get('incident.pob');
    expect(pob?.status).toBe('OK');
    expect(pob?.value).toBe('5');
    const windLayers = byField.get('aeroDrift.windLayers');
    expect(windLayers?.value).toBe('7 baris');
    const datumTime = byField.get('search.datumTime');
    expect(datumTime?.value).toBe('19 November 2026 07.00 WIB');
    // SRU per-callsign (bukan per-indeks) agar mergeable pengguna.
    expect(byField.get('sru[HR-3604].tasSearchKts')?.value).toBe('90');
  });

  test('regresi PK-TAL: TIDAK ada baris HILANG — panel "Data hilang" kosong, apply tidak terkunci', () => {
    // Klaim model di fixture meta.missingFields (glideRatio/waveHeightM/leeway/
    // x-y nav aid) adalah nilai worksheet hilir — tidak boleh jadi HILANG.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hilang = result.fieldRows.filter((row) => row.status === 'HILANG');
    expect(hilang).toEqual([]);
    // Laporan kelengkapan juga bersih (serverTools/AI agent tidak mengklaim hilang).
    expect(result.completeness.missingCount).toBe(0);
    expect(result.completeness.complete).toBe(true);
  });

  test('field UNVERIFIED → DIASUMSIKAN (tidak dianggap resmi)', () => {
    const withUnverified: SarCaseSchema = {
      ...GOLDEN,
      // Model mengisi nilai hasil TAFSIRAN (bukan teks soal) + menandai UNVERIFIED.
      sea: { ...GOLDEN.sea, waveHeightM: 1.5 },
      meta: {
        ...GOLDEN.meta,
        fieldSources: [{ field: 'sea.waveHeightM', source: 'perkiraan model dari angin', status: 'UNVERIFIED' }],
      },
    };
    const rows = deriveExtractionFieldRows(withUnverified, {});
    const row = rows.find((entry) => entry.field === 'sea.waveHeightM');
    expect(row?.status).toBe('DIASUMSIKAN');
    expect(row?.value).toBe('1.5');
    expect(row?.source).toContain('perkiraan');
  });

  test('kasus tidak valid → ok:false dengan detail issue (tidak melempar)', () => {
    const bad = { ...GOLDEN, incident: { ...GOLDEN.incident, pob: 'lima' } };
    const badResult = buildCaseExtractionResult(bad);
    expect(badResult.ok).toBe(false);
    if (badResult.ok) return;
    expect(badResult.detail?.some((issue) => issue.includes('incident.pob'))).toBe(true);
  });
});

// ── 4. buildApplyPlan (PK-TAL) ───────────────────────────────────────────────

describe('buildApplyPlan — PK-TAL (2 heli + 1 kapal)', () => {
  const plan = buildApplyPlan(GOLDEN, {});
  const byId = new Map(plan.steps.map((step) => [step.id, step]));

  test('urutan langkah = rantai worksheet (ASW → AWA → ADW → Datum → lembar → aset)', () => {
    expect(plan.steps.map((step) => step.id)).toEqual([
      'asw', 'awa', 'aero', 'datum', 'ws2:HR-3604', 'ws2:PK-ELS', 'ws8:KN SAR Drupada', 'assets:HR-3604', 'assets:PK-ELS', 'assets:KN SAR Drupada',
    ]);
  });

  test('driftInterval Datum dihitung FUNGSI RESMI = total hours ASW (bukan karangan)', () => {
    const aswSeed = GOLDEN.sea?.surfaceWindSeries ?? [];
    // Reproduksi jalur handler: konversi Basarnas → observasi → computeASW.
    const observations = buildAswObservationsFromCase(
      GOLDEN.incident.lastContactTime ?? '',
      GOLDEN.search?.datumTime ?? '',
      '6h',
      aswSeed.map((entry) => ({ obsTime: entry.obsTime, windDirFrom: entry.windDirFrom, windSpeed: entry.windSpeedKts })),
    );
    const expected = computeASW(observations).totalHours;
    expect(expected).toBeGreaterThan(0);
    const datum = byId.get('datum');
    expect(datum).toBeDefined();
    const payload = datum!.payload as Record<string, unknown>;
    expect(payload['driftInterval']).toBe(Math.round(expected * 100) / 100);
    // PK-TAL: distress 13.50 WIB → datum 07.00 WIB besoknya = 17.1667 jam (00.00,06.00,...,06.00 → jendela 6 jam × 3 → 17.17).
    expect(payload['driftInterval']).toBeGreaterThan(16);
    // Leeway & arus ikut dari kasus.
    expect(typeof payload['seaCurrentDir']).toBe('number');
    expect(payload['leewayObjectId']).toBeUndefined(); // pilihan planner, bukan dari soal → hanya ada bila planner mengirim
  });

  test('payload lembat WS 2 bawa sruName + platform (bentuk handler)', () => {
    const ws2 = byId.get('ws2:HR-3604')!;
    expect(ws2.payload['sruName']).toBe('HR-3604');
    expect(ws2.payload['searchPlatform']).toBe('helicopter');
    expect(ws2.payload['searchTas']).toBe(90);
    const ws8 = byId.get('ws8:KN SAR Drupada')!;
    expect(ws8.payload['eyeHeight']).toBeDefined();
    expect(ws8.payload['vesselSpeedKts']).toBeGreaterThan(0);
  });

  test('payload aset dikonversi ke bentuk AssetAllocationCaseInput (lat/lng terpisah)', () => {
    const asset = byId.get('assets:HR-3604')!;
    expect(asset.payload['sruName']).toBe('HR-3604');
    expect(asset.payload['homeBaseLat']).toBeCloseTo(-6.841667, 5);
    expect(asset.payload['homeBaseLng']).toBeCloseTo(105.491667, 5);
    expect(asset.payload['enduranceHours']).toBeCloseTo(2.75, 5);
  });

  test('search pattern tidak pernah dibuat (orientasi dihitung aplikasi setelah Datum)', () => {
    const patternSteps = plan.steps.filter((step) => step.worksheet === ('pattern' as CaseApplyStep['worksheet']));
    expect(patternSteps.length).toBe(0);
    expect(plan.skipped.some((entry) => entry.worksheet === 'pattern')).toBe(true);
  });

  test('kasus tanpa LKP → langkah ADW tidak dibuat (tidak setengah jadi)', () => {
    const noLkp: SarCaseSchema = { ...GOLDEN, lkp: undefined };
    const planNoLkp = buildApplyPlan(noLkp, {});
    expect(planNoLkp.steps.some((step) => step.id === 'aero')).toBe(false);
    // Datum dari arus tetap mungkin? Tanpa LKP, seeds.datum tetap dibuat bila
    // current ada — drift interval tetap terhitung dari ASW. Yang penting
    // TIDAK ADA langkah yang menulis posisi bohongan.
    expect(planNoLkp.steps.every((step) => step.id !== 'aero')).toBe(true);
  });

  test('kasus tanpa arus & tanpa planner → Datum dilewati dengan alasan', () => {
    const noCurrent: SarCaseSchema = JSON.parse(JSON.stringify(GOLDEN));
    noCurrent.sea = { ...noCurrent.sea, current: undefined };
    const planNoCurrent = buildApplyPlan(noCurrent, {});
    expect(planNoCurrent.steps.some((step) => step.id === 'datum')).toBe(false);
    expect(planNoCurrent.skipped.some((entry) => entry.worksheet === 'datum')).toBe(true);
  });
});

// ── 5. mergeUserFieldValue ───────────────────────────────────────────────────

describe('mergeUserFieldValue', () => {
  test('angka format Indonesia: "1.000" → 1000; "1,5" → 1.5', () => {
    const sarCase = sarCaseSchema.parse({ incident: { type: 'vessel-sinking' } });
    const r1 = mergeUserFieldValue(sarCase, 'incident.pob', '1.000');
    expect(r1.ok).toBe(true);
    expect(sarCase.incident.pob).toBe(1000);
    const r2 = mergeUserFieldValue(sarCase, 'sea.waveHeightM', '1,5');
    expect(r2.ok).toBe(true);
    expect((sarCase.sea?.waveHeightM as number)).toBe(1.5);
  });

  test('koordinat DMS → desimal bertanda (S negatif, W negatif)', () => {
    const sarCase = sarCaseSchema.parse({ incident: { type: 'aircraft-ditching' } });
    const lat = mergeUserFieldValue(sarCase, 'lkp.coord.lat', "06°52'46\"S");
    expect(lat.ok).toBe(true);
    expect(sarCase.lkp?.coord?.lat).toBeCloseTo(-6.879444, 4);
    const lng = mergeUserFieldValue(sarCase, 'lkp.coord.lng', '105°15\'41"E');
    expect(lng.ok).toBe(true);
    expect(sarCase.lkp?.coord?.lng).toBeCloseTo(105.261389, 4);
    // lkp otomatis explicit setelah koordinat diisi.
    expect(sarCase.lkp?.source).toBe('explicit');
  });

  test('koordinat tidak sah → ditolak dengan pesan (tidak mengarang)', () => {
    const sarCase = sarCaseSchema.parse({ incident: { type: 'vessel-sinking' } });
    const result = mergeUserFieldValue(sarCase, 'lkp.coord.lat', 'bukan koordinat');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('tidak terbaca');
  });

  test('path sru per-callsign: sru[BASAL 142].visibilityKm → entri yang benar', () => {
    const sarCase = sarCaseSchema.parse({
      incident: { type: 'vessel-sinking' },
      sru: [
        { callsign: 'BASAL 142', kind: 'vessel' },
        { callsign: 'KN TEGAL', kind: 'vessel' },
      ],
    });
    const result = mergeUserFieldValue(sarCase, 'sru[BASAL 142].visibilityKm', '15 kM');
    expect(result.ok).toBe(true);
    expect(sarCase.sru?.[0].visibilityKm).toBe(15);
    expect(sarCase.sru?.[1].visibilityKm).toBeUndefined();
    // Asumsi tercatat (keputusan no.6).
    expect(result.assumption?.reason).toContain('pengguna');
  });

  test('SRU tidak dikenal → error jelas', () => {
    const sarCase = sarCaseSchema.parse({ incident: { type: 'vessel-sinking' } });
    const result = mergeUserFieldValue(sarCase, 'sru[TIDAK ADA].visibilityKm', '10');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('TIDAK ADA');
  });

  test('teks bebas (waktu/nama) tersimpan apa adanya sebagai string', () => {
    const sarCase = sarCaseSchema.parse({ incident: { type: 'vessel-sinking' } });
    const result = mergeUserFieldValue(sarCase, 'search.datumTime', '19 November 2026 07.00 WIB');
    expect(result.ok).toBe(true);
    expect(sarCase.search?.datumTime).toBe('19 November 2026 07.00 WIB');
  });
});

// ── 6. Gate HILANG pada pratinjau ────────────────────────────────────────────

describe('deriveExtractionFieldRows — status HILANG', () => {
  test('meta.missingFields muncul sebagai HILANG + alasan dari soal', () => {
    const withMissing: SarCaseSchema = {
      ...GOLDEN,
      incident: { ...GOLDEN.incident, pob: undefined },
      meta: {
        ...GOLDEN.meta,
        missingFields: [{ field: 'incident.pob', reason: 'Jumlah POB tidak disebut di soal.' }],
      },
    };
    const rows = deriveExtractionFieldRows(withMissing, {});
    const row = rows.find((entry) => entry.field === 'incident.pob');
    expect(row?.status).toBe('HILANG');
    expect(row?.source).toContain('tidak disebut');
  });

  test('field hilir (glideRatio/waveHeightM/leeway) tidak menjadi HILANG walau diklaim model', () => {
    // Regresi PK-TAL: ketiga field ini dihasilkan/dipilih di worksheet hilir
    // (ADW / Fw Table I-7 dari angin / picker Datum WS 1). Klaim "missing"
    // dari model tidak boleh mengunci penerapan.
    const withDownstream: SarCaseSchema = {
      ...GOLDEN,
      meta: {
        ...GOLDEN.meta,
        missingFields: [
          { field: 'aeroDrift.glideRatio', reason: 'Glide ratio tidak ada di soal.' },
          { field: 'sea.waveHeightM', reason: 'Tinggi gelombang tidak disebut di soal.' },
          { field: 'datum.leewayObjectId', reason: 'Kategori leeway belum dipilih.' },
        ],
      },
    };
    const rows = deriveExtractionFieldRows(withDownstream, {});
    expect(rows.some((entry) => entry.status === 'HILANG' && entry.field === 'aeroDrift.glideRatio')).toBe(false);
    expect(rows.some((entry) => entry.status === 'HILANG' && entry.field === 'sea.waveHeightM')).toBe(false);
    expect(rows.some((entry) => entry.status === 'HILANG' && entry.field === 'datum.leewayObjectId')).toBe(false);
  });

  test('kelengkapan worksheet (completeness) ikut menjadi baris HILANG', () => {
    const noDatumTime: SarCaseSchema = JSON.parse(JSON.stringify(GOLDEN));
    noDatumTime.search = { ...noDatumTime.search, datumTime: undefined };
    const rows = deriveExtractionFieldRows(noDatumTime, {});
    const row = rows.find((entry) => entry.field === 'search.datumTime');
    expect(row?.status).toBe('HILANG');
  });
});
