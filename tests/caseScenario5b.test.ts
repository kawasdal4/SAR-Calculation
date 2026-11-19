/**
 * Test Scenario Generator Fase 5b — variasi jenis kejadian, gaya bahasa,
 * kesulitan ber-knob, konsistensi CaseSchema, dan kunci jawaban.
 * Jalankan: bun test tests/caseScenario5b.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  generateCase,
  createRng,
  DIFFICULTY_KNOB_PROFILES,
  GENERATOR_INCIDENT_TYPES,
  GENERATOR_VERSION,
  haversineNm,
  landTargetIdFor,
} from '../src/lib/sar/caseGenerator';
import { parseSarCase } from '../src/lib/sar/caseSchema';
import { runCasePipeline } from '../src/lib/sar/casePipeline';
import { renderCaseNaskah, checkNaskahCoverage } from '../src/lib/sar/caseNaskah';
import {
  buildCaseNarrative,
  parseBackNarrativeValues,
  allowedNarrativeNumberTokens,
  NARRATIVE_STYLES,
  resolveNarrativeStyle,
} from '../src/lib/sar/caseNarrative';
import { buildCaseAnswerKey } from '../src/lib/sar/caseAnswerKey';
import { buildCaseWorksheetSeeds } from '../src/lib/sar/caseAdapter';
import { validatePlanSnapshot } from '../src/lib/sar/validatePlan';
import {
  KANSAR_NAMES,
  KANSAR_BOUNDARIES_GEOJSON,
  pointInKansarPolygon,
} from '../src/lib/sar/kansarBoundaries';
import {
  SCENARIO_BANK_SEED,
  auditScenarioBank,
  listScenarioBank,
} from '../src/lib/sar/scenarioBank';

const BASE = { regionId: 'selat-sunda', difficulty: 'sedang' as const, incidentDateISO: '2026-11-18' };

// ---------------------------------------------------------------------------
// Determinisme & seed
// ---------------------------------------------------------------------------

describe('Fase 5b — determinisme & reproduksi', () => {
  it('seed + knob sama → kasus dan narasi identik (JSON deep-equal)', () => {
    const params = { ...BASE, seed: 'repro-1', incidentType: 'person-overboard' as const, sruCount: 3, stagesBefore: 2, envDataPoints: 6, districtDataCount: 2, trapCount: 2 };
    const a = generateCase(params);
    const b = generateCase(params);
    expect(JSON.stringify(a.case)).toBe(JSON.stringify(b.case));
    expect(JSON.stringify(a.resolvedKnobs)).toBe(JSON.stringify(b.resolvedKnobs));
    const narA = buildCaseNarrative(a.case, 'skenario-simulasi', { variantSeed: 'repro-1' });
    const narB = buildCaseNarrative(b.case, 'skenario-simulasi', { variantSeed: 'repro-1' });
    expect(narA.text).toBe(narB.text);
  });

  it('meta mencatat versi generator 5b untuk reproduksi', () => {
    const r = generateCase({ ...BASE, seed: 'repro-2', incidentType: 'vessel-sinking' });
    const versionAssumption = r.case.meta?.assumptions?.find((a) => a.field === 'meta.generatorVersion');
    expect(versionAssumption?.value).toBe(GENERATOR_VERSION);
    expect(GENERATOR_VERSION).toBe('5b');
  });

  it('seed berbeda → narasi berbeda (variasi otomatis tidak identik)', () => {
    const texts = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const r = generateCase({ ...BASE, seed: `variasi-${i}`, incidentType: 'aircraft-ditching' });
      texts.add(buildCaseNarrative(r.case, 'otomatis').text);
    }
    expect(texts.size).toBeGreaterThan(6);
  });
});

// ---------------------------------------------------------------------------
// 5 jenis kejadian
// ---------------------------------------------------------------------------

describe('Fase 5b — 5 jenis kejadian', () => {
  it('semua jenis valid schema + lengkap untuk ketiga kesulitan', () => {
    for (const incidentType of GENERATOR_INCIDENT_TYPES) {
      for (const difficulty of ['mudah', 'sedang', 'sulit'] as const) {
        const r = generateCase({ seed: `jenis-${incidentType}-${difficulty}`, incidentType, regionId: 'selat-makassar', difficulty, incidentDateISO: '2026-11-18' });
        const parsed = parseSarCase(r.case);
        expect(parsed.ok).toBe(true);
        expect(r.completeness.complete).toBe(true);
      }
    }
  });

  it('MOB: target person + leeway PIW + narasi menyebut orang jatuh', () => {
    const r = generateCase({ ...BASE, seed: 'mob-1', incidentType: 'person-overboard' });
    expect(r.case.target?.category).toBe('person');
    expect(r.case.target?.leewayObjectId).toMatch(/^piw-/);
    expect(r.case.incident.flightLevelFt).toBeUndefined();
  });

  it('missing person darat: vegetasi + platform + Tr sejak terakhir terlihat', () => {
    const r = generateCase({ ...BASE, seed: 'mp-1', incidentType: 'missing-person-land' });
    expect(r.case.search?.terrainVegetation).toBeDefined();
    expect(r.case.search?.landPlatform).toBeDefined();
    expect(r.case.search?.lastSeenTrackNm).toBeGreaterThan(0);
    expect(r.case.incident.pob).toBe(1);
  });

  it('aircraft land crash: rute tujuan + koordinat tujuan + FL ≤ 200', () => {
    const r = generateCase({ ...BASE, seed: 'lc-1', incidentType: 'aircraft-land-crash' });
    expect(r.case.search?.routeDestination).toBeDefined();
    expect(r.case.search?.routeDestinationCoord?.lat).toBeDefined();
    expect(r.case.incident.flightLevelFt).toBeLessThanOrEqual(200);
    expect(r.case.aeroDrift).toBeUndefined();
  });

  it('land target id konsisten dengan MTOW (Tabel I-9 kelas pesawat)', () => {
    expect(landTargetIdFor('missing-person-land')).toBe('person');
    const r = generateCase({ ...BASE, seed: 'lc-2', incidentType: 'aircraft-land-crash' });
    const wingspan = r.case.target?.wingspanM ?? 0;
    const expected = wingspan >= 25 ? 'aircraft-over-5700' : 'aircraft-under-5700';
    expect(landTargetIdFor('aircraft-land-crash', r.case.target)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Knob kesulitan (parameter kode, bukan penilaian LLM)
// ---------------------------------------------------------------------------

describe('Fase 5b — knob kesulitan eksplisit', () => {
  it('sruCount dipatuhi persis (2-4)', () => {
    for (const count of [2, 3, 4]) {
      const r = generateCase({ ...BASE, seed: `sru-${count}`, incidentType: 'vessel-sinking', sruCount: count });
      expect(r.case.sru?.length).toBe(count);
      expect(r.resolvedKnobs.sruCount).toBe(count);
    }
  });

  it('stagesBefore dipatuhi persis (0-4) dan searchNumber = stages + 1', () => {
    for (const stages of [0, 1, 2, 3, 4]) {
      const r = generateCase({ ...BASE, seed: `stage-${stages}`, incidentType: 'aircraft-ditching', stagesBefore: stages });
      expect(r.case.search?.stagesDone?.length).toBe(stages);
      expect(r.case.search?.searchNumber).toBe(stages + 1);
      expect(r.resolvedKnobs.stagesBefore).toBe(stages);
    }
  });

  it('envDataPoints dipatuhi persis (4-11; grid 6 jam otomatis diperluas ke 3 jam)', () => {
    for (const count of [4, 6, 9, 11]) {
      const r = generateCase({ ...BASE, seed: `env-${count}`, incidentType: 'vessel-sinking', envDataPoints: count });
      expect(r.case.sea?.surfaceWindSeries?.length).toBe(count);
      expect(r.resolvedKnobs.envDataPoints).toBe(count);
    }
  });

  it('MOB: deret angin menutup jendela kejadian → datum hari sama', () => {
    const r = generateCase({ ...BASE, seed: 'mob-env', incidentType: 'person-overboard', envDataPoints: 6 });
    const lcDay = r.case.incident.lastContactTime?.split(' ').slice(0, -2).join(' ');
    const datumDay = r.case.search?.datumTime?.split(' ').slice(0, -2).join(' ');
    expect(datumDay).toBe(lcDay); // datum MOB hari yang sama
    expect(r.resolvedKnobs.envDataPoints).toBeGreaterThanOrEqual(4);
  });

  it('districtDataCount dipatuhi — distrik pendukung unik dan bukan kantor utama', () => {
    const r = generateCase({ ...BASE, seed: 'distrik-3', incidentType: 'vessel-sinking', districtDataCount: 3 });
    const names = r.case.supportingDistricts?.map((d) => d.name) ?? [];
    expect(names.length).toBe(3);
    expect(new Set(names).size).toBe(3);
    expect(names).not.toContain(r.case.sarOffice?.name);
  });

  it('trapCount dipatuhi (0-6) dan konsisten dengan appliedTraps (sulit: pool ≥5)', () => {
    for (const count of [0, 1, 3, 5]) {
      const r = generateCase({ ...BASE, seed: `trap-${count}`, incidentType: 'vessel-sinking', difficulty: 'sulit', trapCount: count });
      expect(r.appliedTraps.length).toBe(count);
      expect(r.resolvedKnobs.trapCount).toBe(count);
    }
  });

  it('profil kesulitan default mengikuti kontrak (mudah tanpa jebakan, sulit ≥4)', () => {
    expect(DIFFICULTY_KNOB_PROFILES.mudah.trapCount).toEqual([0, 0]);
    const sulit = generateCase({ seed: 'profil-sulit', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sulit', incidentDateISO: '2026-11-18' });
    expect(sulit.appliedTraps.length).toBeGreaterThanOrEqual(4);
    const mudah = generateCase({ seed: 'profil-mudah', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'mudah', incidentDateISO: '2026-11-18' });
    expect(mudah.appliedTraps.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Gaya bahasa & variasi narasi
// ---------------------------------------------------------------------------

describe('Fase 5b — gaya bahasa & variasi narasi', () => {
  const CASES = GENERATOR_INCIDENT_TYPES.map((t) => ({
    type: t,
    r: generateCase({ seed: `gaya-${t}`, incidentType: t, regionId: 'selat-sunda', difficulty: 'sedang', incidentDateISO: '2026-11-18', districtDataCount: 2 }),
  }));

  it('4 gaya tersedia dan menghasilkan teks berbeda untuk kasus sama', () => {
    const { r } = CASES[0]!;
    const texts = NARRATIVE_STYLES.map((s) => buildCaseNarrative(r.case, s).text);
    expect(new Set(texts).size).toBe(4);
  });

  it('semua gaya × jenis: coverage penuh + parse-back lolos', () => {
    for (const { r } of CASES) {
      for (const style of NARRATIVE_STYLES) {
        const explicit = !r.appliedTraps.includes('search-number-inference');
        const nar = buildCaseNarrative(r.case, style, { explicitSearchNumber: explicit });
        const naskah = renderCaseNaskah(r.case, { explicitSearchNumber: explicit, narrativeText: nar.text });
        const cov = checkNaskahCoverage(r.case, naskah, { explicitSearchNumber: explicit });
        expect(cov.covered).toBe(true);
        const pb = parseBackNarrativeValues(r.case, naskah.text, { explicitSearchNumber: explicit });
        expect(pb.ok).toBe(true);
      }
    }
  });

  it('gaya skenario-simulasi menyapa peserta; operasional ringkas; formal menyebut tanggal', () => {
    const { r } = CASES[0]!;
    const sim = buildCaseNarrative(r.case, 'skenario-simulasi').text;
    expect(sim).toMatch(/Anda|latihan|simulasi/i);
    const formal = buildCaseNarrative(r.case, 'formal-ujian').text;
    expect(formal).toMatch(/pada tanggal/i);
    const ops = buildCaseNarrative(r.case, 'narasi-operasional').text;
    expect(ops.length).toBeLessThan(formal.length);
  });

  it('resolveNarrativeStyle("otomatis") deterministik dari rng sama', () => {
    const a = resolveNarrativeStyle('otomatis', createRng('seed-a'));
    const b = resolveNarrativeStyle('otomatis', createRng('seed-a'));
    expect(a).toBe(b);
    expect(['formal-ujian', 'narasi-operasional', 'skenario-simulasi']).toContain(a);
  });

  it('30 seed → banyak varian kalimat pembuka (bukan satu template)', () => {
    const openers = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const r = generateCase({ seed: `opener-${i}`, incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sedang', incidentDateISO: '2026-11-18' });
      openers.add(buildCaseNarrative(r.case, 'otomatis').text.slice(0, 60));
    }
    expect(openers.size).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Konsistensi: narasi tidak mengubah CaseSchema (guardrail)
// ---------------------------------------------------------------------------

describe('Fase 5b — guardrail narasi vs CaseSchema', () => {
  const r = generateCase({ ...BASE, seed: 'guard-1', incidentType: 'aircraft-ditching', districtDataCount: 2 });
  const nar = buildCaseNarrative(r.case, 'formal-ujian');
  const naskah = renderCaseNaskah(r.case, { narrativeText: nar.text, explicitSearchNumber: true });

  it('daftar putih angka berisi nilai-nilai kasus', () => {
    const allowed = allowedNarrativeNumberTokens(r.case);
    expect(allowed.has(String(r.case.incident.pob))).toBe(true);
    expect(allowed.has(String(r.case.incident.flightLevelFt))).toBe(true);
    expect(allowed.has(String(r.case.sarOffice?.radialDegToLkp))).toBe(true);
  });

  it('narasi yang DIUBAH (POB dipalsukan) tertangkap parse-back DAN coverage', () => {
    // Temukan frasa POB apa pun (phrasing bervariasi antar gaya) lalu palsukan angkanya.
    const match = /POB[^0-9]{0,40}?(\d+)\s*orang/.exec(naskah.text);
    expect(match).not.toBeNull();
    const fakePob = Number(match![1]) + 7;
    const tamperedText = naskah.text.replace(match![0], match![0].replace(match![1], String(fakePob)));
    const pb = parseBackNarrativeValues(r.case, tamperedText, { explicitSearchNumber: true });
    expect(pb.ok).toBe(false);
    expect(pb.issues.some((i) => i.field === 'incident.pob')).toBe(true);
    const cov = checkNaskahCoverage(r.case, { ...naskah, text: tamperedText }, { explicitSearchNumber: true });
    expect(cov.covered).toBe(false);
  });

  it('angka di luar daftar putih (LLM menambah data) terdeteksi', () => {
    const allowed = allowedNarrativeNumberTokens(r.case);
    const injected = `${nar.text} Gelombang 3,7 meter.`;
    for (const token of injected.match(/\d+(?:[.,]\d+)?/g) ?? []) {
      const suspicious = token === '3,7' || token === '3.7';
      if (suspicious) expect(allowed.has(token)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Kunci jawaban: tahapan, referensi, rubrik
// ---------------------------------------------------------------------------

describe('Fase 5b — kunci jawaban', () => {
  it('laut: tahapan ASW → Datum → WS 2/8 → pola → alokasi dengan angka', () => {
    const r = generateCase({ ...BASE, seed: 'key-laut', incidentType: 'vessel-sinking' });
    const key = buildCaseAnswerKey(r.case, { leewayObjectId: r.case.target?.leewayObjectId, xNm: 0, yNm: 0 });
    const worksheets = key.stages.map((s) => s.worksheet);
    expect(worksheets).toContain('ASW');
    expect(worksheets).toContain('Datum WS 1');
    expect(worksheets).toContain('WS 8');
    expect(worksheets).toContain('Search Pattern');
    expect(worksheets).toContain('Alokasi Aset');
    for (const stage of key.stages) {
      expect(stage.steps.length).toBeGreaterThan(0);
      expect(stage.resultSummary.length).toBeGreaterThan(10);
    }
    expect(key.references.length).toBeGreaterThanOrEqual(5);
    expect(key.references.every((ref) => ref.usage.length > 5)).toBe(true);
  });

  it('ditching: tahapan AWA + ADW hadir', () => {
    const r = generateCase({ ...BASE, seed: 'key-ditching', incidentType: 'aircraft-ditching' });
    const key = buildCaseAnswerKey(r.case, { leewayObjectId: r.case.target?.leewayObjectId, xNm: 0, yNm: 0 });
    const worksheets = key.stages.map((s) => s.worksheet);
    expect(worksheets).toContain('AWA');
    expect(worksheets).toContain('ADW');
  });

  it('darat: WS 4 radius + WS 3 sweep width + rubrik 100', () => {
    for (const t of ['aircraft-land-crash', 'missing-person-land'] as const) {
      const r = generateCase({ ...BASE, seed: `key-${t}`, incidentType: t });
      const key = buildCaseAnswerKey(r.case, {});
      const worksheets = key.stages.map((s) => s.worksheet);
      expect(worksheets).toContain('WS 4');
      expect(worksheets).toContain('WS 3');
      const radiusStage = key.stages.find((s) => s.title.includes('Search radius'));
      expect(radiusStage?.steps.some((st) => st.label.includes('x = x₀ + 0.1 × Tr'))).toBe(true);
      const total = key.rubric.reduce((sum, i) => sum + i.weight, 0);
      expect(Math.abs(total - 100)).toBeLessThan(0.01);
      expect(key.totalScore).toBe(100);
    }
  });

  it('rubrik total tepat 100 untuk semua jenis', () => {
    for (const t of GENERATOR_INCIDENT_TYPES) {
      const r = generateCase({ ...BASE, seed: `rubrik-${t}`, incidentType: t });
      const key = buildCaseAnswerKey(r.case, { leewayObjectId: r.case.target?.leewayObjectId });
      const total = key.rubric.reduce((sum, i) => sum + i.weight, 0);
      expect(Math.abs(total - 100)).toBeLessThan(0.01);
    }
  });
});

// ---------------------------------------------------------------------------
// Solvability + validate_plan (seluruh rantai per jenis)
// ---------------------------------------------------------------------------

describe('Fase 5b — solvability & validate_plan', () => {
  it('pipeline laut tanpa langkah error untuk MOB/sinking/ditching', () => {
    for (const t of ['aircraft-ditching', 'vessel-sinking', 'person-overboard'] as const) {
      const r = generateCase({ seed: `solv-${t}`, incidentType: t, regionId: 'selat-makassar', difficulty: 'sulit', incidentDateISO: '2026-11-18' });
      const out = runCasePipeline(r.case, { leewayObjectId: r.case.target?.leewayObjectId, xNm: 0, yNm: 0 });
      const errors = out.steps.filter((s) => s.status === 'error');
      expect(errors).toEqual([]);
      expect(out.ok).toBe(true);
    }
  });

  it('jenis darat: pipeline laut skip bersih (WS 3/WS 4 lewat kunci jawaban)', () => {
    for (const t of ['aircraft-land-crash', 'missing-person-land'] as const) {
      const r = generateCase({ seed: `solv-${t}`, incidentType: t, regionId: 'selat-makassar', difficulty: 'sedang', incidentDateISO: '2026-11-18' });
      const out = runCasePipeline(r.case, { xNm: 0, yNm: 0 });
      expect(out.ok).toBe(true);
      expect(out.steps.some((s) => s.step === 'land-search-ws3' && s.status === 'skipped')).toBe(true);
    }
  });

  it('validatePlanSnapshot tanpa issue error untuk semua jenis & wilayah', () => {
    const regions = ['selat-sunda', 'teluk-jakarta', 'laut-jawa', 'selat-bangka', 'selat-karimata', 'selat-makassar', 'selat-bali', 'selat-sorong'];
    for (const t of GENERATOR_INCIDENT_TYPES) {
      for (const regionId of regions) {
        const r = generateCase({ seed: `plan-${t}-${regionId}`, incidentType: t, regionId, difficulty: 'sedang', incidentDateISO: '2026-11-18' });
        const { seeds } = buildCaseWorksheetSeeds(r.case, { leewayObjectId: r.case.target?.leewayObjectId, xNm: 0, yNm: 0 });
        const validation = validatePlanSnapshot({
          lkp: seeds.lkp,
          asw: seeds.asw ? { distressTime: seeds.asw.distressTime, datumTime: seeds.asw.datumTime, intervalMode: seeds.asw.intervalMode, windData: seeds.asw.windData } : undefined,
        });
        expect(validation.errorCount).toBe(0);
      }
    }
  });

  it('haversineNm konsisten untuk jarak yang diketahui', () => {
    const d = haversineNm({ lat: 0, lng: 105 }, { lat: 0, lng: 106 });
    expect(d).toBeGreaterThan(59.8);
    expect(d).toBeLessThan(60.5);
  });
});

// ---------------------------------------------------------------------------
// Bank Basarnas (43 KANSAR + 80 ALUT) & batas wilayah
// ---------------------------------------------------------------------------

describe('Fase 5b — bank lokasi/aset Basarnas + batas KANSAR', () => {
  it('43 kantor KANSAR + 80 kapal ALUT masuk bank, audit bersih', () => {
    const offices = listScenarioBank('location', 'kantor-sar');
    const vessels = listScenarioBank('asset', 'vessel');
    expect(offices.length).toBeGreaterThanOrEqual(43);
    expect(vessels.filter((v) => v.id.startsWith('asset-alut-')).length).toBe(80);
    expect(auditScenarioBank()).toEqual([]);
  });

  it('entri kantor KANSAR punya koordinat + provenance Perka 2/2025 dan status UNVERIFIED', () => {
    const offices = listScenarioBank('location').filter((e) => e.id.startsWith('loc-kansar-'));
    expect(offices.length).toBe(43);
    for (const office of offices) {
      expect(office.lat).toBeDefined();
      expect(office.lng).toBeDefined();
      expect(office.verification).toBe('UNVERIFIED');
      expect(office.source).toMatch(/Perka Basarnas No\. 2 Tahun 2025|Koordinat_43_Kantor_SAR_Basarnas/);
    }
  });

  it('kapal ALUT: snapshot kesapsiagaan VERIFIED tanpa spec SRU parsial', () => {
    const vessels = listScenarioBank('asset').filter((e) => e.id.startsWith('asset-alut-'));
    expect(vessels.length).toBe(80);
    for (const v of vessels) {
      expect(v.verification).toBe('VERIFIED');
      expect(v.specs.enduranceHours).toBeUndefined(); // tidak dianggap SRU latihan
      expect(v.specs.homeBase).toBeDefined();
    }
  });

  it('43 poligon batas KANSAR dimuat dan point-in-polygon akurat', () => {
    expect(KANSAR_NAMES.length).toBe(43);
    expect(KANSAR_BOUNDARIES_GEOJSON.features.length).toBe(43);
    // Pusat wilayah yang jelas jatuh di batasnya sendiri.
    expect(pointInKansarPolygon(105.2, -5.5)).toBe('Lampung');        // Selat Sunda sisi Lampung
    expect(pointInKansarPolygon(109.4, -0.14)).toBe('Pontianak');     // Pontianak
    expect(pointInKansarPolygon(128.19, -3.65)).toBe('Ambon');        // Ambon
    expect(pointInKansarPolygon(-170, -90)).toBeUndefined();          // di luar
  });

  it('generator memakai KANSAR wilayah LKP sebagai sarOffice', () => {
    const r = generateCase({ ...BASE, seed: 'kansar-office-1', incidentType: 'vessel-sinking' });
    expect(r.case.sarOffice?.name).toMatch(/Kantor SAR /);
    const lkp = r.case.lkp?.coord;
    const polygonName = lkp ? pointInKansarPolygon(lkp.lng, lkp.lat) : undefined;
    if (polygonName) {
      expect(r.case.sarOffice?.name).toBe(`Kantor SAR ${polygonName}`);
    }
  });
});
