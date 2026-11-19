/**
 * Test CaseGenerator (Fase 5a) — determinisme, kesulitan, jebakan terkontrol,
 * kelengkapan, dan solvability pipeline.
 * Jalankan: bun test tests/caseGenerator.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  generateCase,
  createRng,
  mulberry32,
  hashSeedToNumber,
  seasonOfMonth,
  trapAllowedForDifficulty,
  checkGeneratedCaseCompleteness,
  SCENARIO_REGIONS,
  GENERATOR_DIFFICULTIES,
  GENERATOR_TRAPS,
} from '../src/lib/sar/caseGenerator';
import { parseSarCase } from '../src/lib/sar/caseSchema';
import { runCasePipeline } from '../src/lib/sar/casePipeline';
import { renderCaseNaskah, checkNaskahCoverage } from '../src/lib/sar/caseNaskah';

describe('PRNG deterministik', () => {
  it('mulberry32 dengan seed sama menghasilkan deretan sama', () => {
    const a = mulberry32(hashSeedToNumber('soal-x'));
    const b = mulberry32(hashSeedToNumber('soal-x'));
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('seed berbeda menghasilkan deretan beda', () => {
    const a = mulberry32(hashSeedToNumber('soal-x'));
    const b = mulberry32(hashSeedToNumber('soal-y'));
    const da = Array.from({ length: 10 }, () => a());
    const db = Array.from({ length: 10 }, () => b());
    expect(da.join()).not.toBe(db.join());
  });

  it('rng.int inklusif dan dalam rentang', () => {
    const rng = createRng('rentang');
    for (let i = 0; i < 200; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });

  it('rng.angle membungkus 0-360', () => {
    const rng = createRng('sudut');
    for (let i = 0; i < 200; i++) {
      const v = rng.angle(350, 60);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(360);
    }
  });

  it('seasonOfMonth mengikuti model monsun sederhana', () => {
    expect(seasonOfMonth(1)).toBe('barat');
    expect(seasonOfMonth(12)).toBe('barat');
    expect(seasonOfMonth(3)).toBe('transisi-barat-timur');
    expect(seasonOfMonth(6)).toBe('timur');
    expect(seasonOfMonth(10)).toBe('transisi-timur-barat');
  });
});

describe('generateCase — determinisme & validitas', () => {
  const base = { incidentType: 'aircraft-ditching' as const, regionId: 'selat-sunda', difficulty: 'sedang' as const };

  it('seed + parameter sama → kasus identik (JSON deep-equal)', () => {
    const a = generateCase({ ...base, seed: 's-1', incidentDateISO: '2026-11-18' });
    const b = generateCase({ ...base, seed: 's-1', incidentDateISO: '2026-11-18' });
    expect(JSON.stringify(a.case)).toBe(JSON.stringify(b.case));
    expect(a.appliedTraps).toEqual(b.appliedTraps);
  });

  it('seed beda → kasus beda', () => {
    const a = generateCase({ ...base, seed: 's-1', incidentDateISO: '2026-11-18' });
    const b = generateCase({ ...base, seed: 's-2', incidentDateISO: '2026-11-18' });
    expect(JSON.stringify(a.case)).not.toBe(JSON.stringify(b.case));
  });

  it('output valid menurut sarCaseSchema untuk semua kesulitan & jenis insiden', () => {
    for (const difficulty of GENERATOR_DIFFICULTIES) {
      for (const incidentType of ['aircraft-ditching', 'vessel-sinking'] as const) {
        const r = generateCase({ seed: 'valid-1', incidentType, regionId: 'selat-sunda', difficulty, incidentDateISO: '2026-11-18' });
        const parsed = parseSarCase(r.case);
        expect(parsed.ok).toBe(true);
      }
    }
  });

  it('meta menandai sumber generator + SIMULATION + approval DRAFT', () => {
    const r = generateCase({ ...base, seed: 'meta-1' });
    expect(r.case.meta?.source).toBe('generator');
    expect(r.case.meta?.seed).toBe('meta-1');
    expect(r.case.meta?.approval).toBe('DRAFT');
    const sources = (r.case.meta?.fieldSources ?? []).map((f) => f.status);
    expect(sources).toContain('SIMULATION');
  });

  it('kasus lengkap (tanpa field MISSING) untuk semua kombinasi wilayah × kesulitan × jenis', () => {
    for (const region of SCENARIO_REGIONS) {
      for (const difficulty of GENERATOR_DIFFICULTIES) {
        for (const incidentType of ['aircraft-ditching', 'vessel-sinking'] as const) {
          const r = generateCase({ seed: 'lengkap', incidentType, regionId: region.id, difficulty, incidentDateISO: '2026-11-18' });
          const planner = { leewayObjectId: r.case.target?.leewayObjectId, xNm: 0, yNm: 0 };
          const completeness = checkGeneratedCaseCompleteness(r.case, planner);
          expect(completeness.complete).toBe(true);
        }
      }
    }
  });
});

describe('generateCase — struktur data worksheet', () => {
  it('kasus pesawat: 7 layer angin termasuk Surface, FL ≤ 200', () => {
    for (let i = 0; i < 30; i++) {
      const r = generateCase({ seed: `fl-${i}`, incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sulit' });
      const layers = r.case.aeroDrift?.windLayers ?? [];
      expect(layers.length).toBe(7);
      expect(layers[0].altitudeFt).toBe(0);
      expect(layers[0].altitudeLabel).toBe('Surface');
      expect(r.case.incident.flightLevelFt ?? 0).toBeLessThanOrEqual(200);
    }
  });

  it('deret angin mencakup pengamatan s.d. hari datum (ASW punya data)', () => {
    const r = generateCase({ seed: 'seri-1', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sedang', incidentDateISO: '2026-11-18' });
    const series = r.case.sea?.surfaceWindSeries ?? [];
    expect(series.length).toBeGreaterThanOrEqual(6);
    const last = series[series.length - 1];
    expect(last.obsTime).toContain('19 November 2026');
  });

  it('kasus kapal: tanpa aeroDrift, tasks tanpa aeronautical-drift', () => {
    const r = generateCase({ seed: 'kapal-1', incidentType: 'vessel-sinking', regionId: 'selat-makassar', difficulty: 'sedang' });
    expect(r.case.aeroDrift).toBeUndefined();
    expect(r.case.tasksRequested).not.toContain('aeronautical-drift');
    expect(r.case.incident.type).toBe('vessel-sinking');
    expect(r.case.target?.category).toBe('vessel');
  });

  it('POB tidak melebihi kapasitas life raft (tidak ada data bertentangan)', () => {
    for (let i = 0; i < 20; i++) {
      const r = generateCase({ seed: `pob-${i}`, incidentType: 'aircraft-ditching', regionId: 'selat-bali', difficulty: 'mudah' });
      const pob = r.case.incident.pob ?? 0;
      const cap = (r.case.incident.lifeRaftCount ?? 0) * (r.case.incident.lifeRaftCapacityPerRaft ?? 0);
      expect(pob).toBeLessThanOrEqual(cap);
    }
  });
});

describe('generateCase — jebakan terkontrol', () => {
  it('mudah tanpa jebakan & heading true', () => {
    const r = generateCase({ seed: 'mudah-1', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'mudah' });
    expect(r.appliedTraps).toEqual([]);
    expect(r.case.incident.headingReference).toBe('true');
  });

  it('sedang/sulit menerapkan jebakan default', () => {
    for (let i = 0; i < 10; i++) {
      const sedang = generateCase({ seed: `trap-s-${i}`, incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sedang' });
      expect(sedang.appliedTraps.length).toBe(2);
      const sulit = generateCase({ seed: `trap-h-${i}`, incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sulit' });
      expect(sulit.appliedTraps.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('trap heading-magnetic → headingReference magnetic', () => {
    const r = generateCase({
      seed: 'mag-1', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sulit',
      traps: ['heading-magnetic'],
    });
    expect(r.appliedTraps).toContain('heading-magnetic');
    expect(r.case.incident.headingReference).toBe('magnetic');
  });

  it('trap variation-west butuh heading-magnetic; W pada variation', () => {
    const skipped = generateCase({
      seed: 'w-1', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sulit',
      traps: ['variation-west'],
    });
    expect(skipped.skippedTraps.length).toBe(1);
    const ok = generateCase({
      seed: 'w-2', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sulit',
      traps: ['heading-magnetic', 'variation-west'],
    });
    expect(ok.case.aeroDrift?.variationDirection).toBe('W');
  });

  it('trap zona-waktu ditolak di wilayah WIB', () => {
    const r = generateCase({
      seed: 'tz-1', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sulit',
      traps: ['zona-waktu-wita'],
    });
    expect(r.skippedTraps[0].trap).toBe('zona-waktu-wita');
    expect(r.skippedTraps[0].reason).toContain('WIB');
  });

  it('trap zona-waktu aktif di wilayah WITA (Selat Makassar)', () => {
    const r = generateCase({
      seed: 'tz-2', incidentType: 'aircraft-ditching', regionId: 'selat-makassar', difficulty: 'sedang',
      traps: ['zona-waktu-wita', 'heading-magnetic'],
    });
    expect(r.appliedTraps).toContain('zona-waktu-wita');
    expect(r.case.incident.reportTime).toContain('WITA');
  });

  it('trap wind-series-3h hanya untuk sulit; deret interval 3 jam', () => {
    const r = generateCase({
      seed: '3h-1', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'mudah',
      traps: ['wind-series-3h'],
    });
    expect(r.skippedTraps[0].trap).toBe('wind-series-3h');

    const ok = generateCase({
      seed: '3h-2', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sulit',
      traps: ['wind-series-3h'],
    });
    const series = ok.case.sea?.surfaceWindSeries ?? [];
    expect(series.length).toBe(11);
    expect(series[1].obsTime).toContain('03.00');
  });

  it('trap light-surface-wind: angin permukaan lemah (≤ 5 kts)', () => {
    const r = generateCase({
      seed: 'light-1', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sulit',
      traps: ['light-surface-wind'],
    });
    const surface = (r.case.aeroDrift?.windLayers ?? []).find((l) => l.altitudeFt === 0);
    expect(surface?.windSpeedKts).toBeLessThanOrEqual(5);
  });

  it('daftar trap resmi lengkap & aturan kesulitan konsisten', () => {
    expect(GENERATOR_TRAPS.length).toBe(9);
    expect(trapAllowedForDifficulty('heading-magnetic', 'sedang')).toBe(true);
    expect(trapAllowedForDifficulty('heading-magnetic', 'mudah')).toBe(false);
    expect(trapAllowedForDifficulty('wind-series-3h', 'sulit')).toBe(true);
    expect(trapAllowedForDifficulty('wind-series-3h', 'sedang')).toBe(false);
  });
});

describe('generateCase — solvability pipeline (syarat kapabilitas B)', () => {
  it('pipeline berjalan tanpa langkah error untuk 8 wilayah × 3 kesulitan × 2 jenis', () => {
    let fail = 0;
    const failures: string[] = [];
    for (const region of SCENARIO_REGIONS) {
      for (const difficulty of GENERATOR_DIFFICULTIES) {
        for (const incidentType of ['aircraft-ditching', 'vessel-sinking'] as const) {
          const r = generateCase({ seed: 'solve', incidentType, regionId: region.id, difficulty, incidentDateISO: '2026-11-18' });
          const out = runCasePipeline(r.case, {
            xNm: 0,
            yNm: 0,
            leewayObjectId: r.case.target?.leewayObjectId,
          });
          if (!out.ok) {
            fail += 1;
            failures.push(`${region.id}/${difficulty}/${incidentType}: ${out.steps.filter((s) => s.status === 'error').map((s) => s.detail).join('; ')}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(fail).toBe(0);
  });

  it('kasus kapal: langkah AWA/ADW skipped (bukan error) dan datum berbasis LKP', () => {
    const r = generateCase({ seed: 'kapal-2', incidentType: 'vessel-sinking', regionId: 'selat-sunda', difficulty: 'sedang' });
    const out = runCasePipeline(r.case, { xNm: 0, yNm: 0, leewayObjectId: r.case.target?.leewayObjectId });
    const awa = out.steps.find((s) => s.step === 'awa');
    const aero = out.steps.find((s) => s.step === 'aero-drift');
    expect(awa?.status).toBe('skipped');
    expect(aero?.status).toBe('skipped');
    expect(out.datum).toBeDefined();
  });

  it('kasus pesawat: hasil datum + Ao tersedia (rantai ditching utuh)', () => {
    const r = generateCase({ seed: 'pesawat-2', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'mudah' });
    const out = runCasePipeline(r.case, { xNm: 0, yNm: 0, leewayObjectId: r.case.target?.leewayObjectId });
    expect(out.datum?.areaSquareNM2 ?? 0).toBeGreaterThan(0);
    expect(out.aero?.positionValid).toBe(true);
  });
});

describe('generateCase + naskah — coverage (case_completeness_check)', () => {
  it('naskah mencakup semua field wajib untuk kombinasi representatif', () => {
    const combos = [
      { incidentType: 'aircraft-ditching' as const, regionId: 'selat-sunda', difficulty: 'mudah' as const, explicit: true },
      { incidentType: 'aircraft-ditching' as const, regionId: 'selat-makassar', difficulty: 'sulit' as const, explicit: false },
      { incidentType: 'vessel-sinking' as const, regionId: 'selat-bali', difficulty: 'sedang' as const, explicit: false },
    ];
    for (const c of combos) {
      const r = generateCase({ seed: 'cov-1', incidentType: c.incidentType, regionId: c.regionId, difficulty: c.difficulty, incidentDateISO: '2026-11-18' });
      const naskah = renderCaseNaskah(r.case, { explicitSearchNumber: c.explicit });
      const cov = checkNaskahCoverage(r.case, naskah, { explicitSearchNumber: c.explicit });
      if (!cov.covered) console.error(cov.issues);
      expect(cov.covered).toBe(true);
    }
  });
});
