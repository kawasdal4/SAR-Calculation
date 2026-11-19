/**
 * Test validator `validate_plan` (Fase 2): pemeriksaan konsistensi snapshot —
 * tanpa mengubah angka. Kelas error/warning/info sesuai desain.
 * Jalankan: bun test tests/validatePlan.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { validatePlanSnapshot } from '../src/lib/sar/validatePlan';

describe('validate_plan — snapshot kosong', () => {
  it('tanpa snapshot → info saja, ok', () => {
    const result = validatePlanSnapshot(null);
    expect(result.ok).toBe(true);
    expect(result.infoCount).toBe(1);
    expect(result.issues[0].field).toBe('state');
  });
});

describe('validate_plan — koordinat & sudut', () => {
  it('koordinat di luar rentang → error', () => {
    const result = validatePlanSnapshot({ lkp: { lat: 123, lng: 45 } });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.level === 'error' && issue.field === 'lkp')).toBe(true);
  });

  it('koordinat (0,0) → warning titik nol', () => {
    const result = validatePlanSnapshot({ lkp: { lat: 0, lng: 0 } });
    expect(result.issues.some((issue) => issue.level === 'warning' && issue.field === 'lkp')).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('sudut 450° → error', () => {
    const result = validatePlanSnapshot({
      datum: { seaCurrentDir: 450, seaCurrentSpeed: 0.4 },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'datum.seaCurrentDir')).toBe(true);
  });

  it('arus 9 knot → warning tidak lazim; arus negatif → error', () => {
    const warning = validatePlanSnapshot({ datum: { seaCurrentDir: 100, seaCurrentSpeed: 9 } });
    expect(warning.issues.some((issue) => issue.level === 'warning' && issue.field === 'datum.seaCurrentSpeed')).toBe(true);
    const error = validatePlanSnapshot({ datum: { seaCurrentDir: 100, seaCurrentSpeed: -1 } });
    expect(error.issues.some((issue) => issue.level === 'error' && issue.field === 'datum.seaCurrentSpeed')).toBe(true);
  });
});

describe('validate_plan — kategori leeway & waktu', () => {
  it('leewayObjectId karangan → error', () => {
    const result = validatePlanSnapshot({ datum: { leewayObjectId: 'bukan-kategori' } });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'datum.leewayObjectId')).toBe(true);
  });

  it('leewayObjectId valid → tidak ada issue', () => {
    const result = validatePlanSnapshot({ datum: { leewayObjectId: 'raft-canopy-drogue' } });
    expect(result.issues.some((issue) => issue.field === 'datum.leewayObjectId')).toBe(false);
  });

  it('hanya distress time tanpa datum time → warning berpasangan', () => {
    const result = validatePlanSnapshot({ asw: { distressTime: '17 Nov 2026 15.56 WIT' } });
    expect(result.issues.some((issue) => issue.level === 'warning' && issue.field.includes('distressTime'))).toBe(true);
  });
});

describe('validate_plan — lembar WS 2/WS 8', () => {
  it('WS 2: TAS 999 kts + ketinggian 777 ft + sudut kasus 400° → tiga error', () => {
    const result = validatePlanSnapshot({
      ws2Sheets: [{ key: 's1', data: { sruName: 'SRU-A', searchTas: 999, selectedHeight: 777, caseWindDirFrom: 400 } }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.filter((issue) => issue.level === 'error').length).toBe(3);
  });

  it('WS 2: gelombang 45 m → warning satuan', () => {
    const result = validatePlanSnapshot({
      ws2Sheets: [{ key: 's1', data: { sruName: 'SRU-A', caseWaveHeightM: 45, visibilityIndex: 2 } }],
    });
    expect(result.issues.some((issue) => issue.level === 'warning' && issue.field.endsWith('caseWaveHeightM'))).toBe(true);
  });

  it('WS 8: eyeHeight "12" → error; visibility kosong → info', () => {
    const result = validatePlanSnapshot({
      ws8Sheets: [{ key: 's2', data: { sruName: 'KN-X', eyeHeight: '12' } }],
    });
    expect(result.issues.some((issue) => issue.level === 'error' && issue.field.endsWith('eyeHeight'))).toBe(true);
    expect(result.issues.some((issue) => issue.level === 'info' && issue.field.endsWith('visibilityKm'))).toBe(true);
  });
});

describe('validate_plan — ADW & aset', () => {
  it('Altmin > Altmax → error; glide aktif tanpa glide ratio → error', () => {
    const result = validatePlanSnapshot({
      aero: { useAircraftGlide: true, aircraftAltMaxFt: 12000, aircraftAltMinFt: 15000 },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'aero.altitudeLoss')).toBe(true);
    expect(result.issues.some((issue) => issue.field === 'aero.aircraftGlideRatio')).toBe(true);
  });

  it('variation 400° → error', () => {
    const result = validatePlanSnapshot({ aero: { magneticVariationDeg: 400 } });
    expect(result.issues.some((issue) => issue.field === 'aero.magneticVariationDeg')).toBe(true);
  });

  it('aset tanpa koordinat → info; search speed > transit → warning', () => {
    const result = validatePlanSnapshot({
      assets: [{ name: 'SRU-X', searchSpeedKts: 200, transitSpeedKts: 150 }],
    });
    expect(result.issues.some((issue) => issue.level === 'info' && issue.field.includes('homeBasePos'))).toBe(true);
    expect(result.issues.some((issue) => issue.level === 'warning' && issue.field.endsWith('searchSpeedKts'))).toBe(true);
  });

  it('endurance 100 jam → warning satuan', () => {
    const result = validatePlanSnapshot({
      assets: [{ name: 'SRU-Y', enduranceHours: 100 }],
    });
    expect(result.issues.some((issue) => issue.level === 'warning' && issue.field.endsWith('enduranceHours'))).toBe(true);
  });
});

describe('validate_plan — pola & track spacing', () => {
  it('orientasi pola tidak terbaca → error', () => {
    const result = validatePlanSnapshot({ patternOrientationText: 'arah timur' });
    expect(result.issues.some((issue) => issue.field === 'pattern.orientation')).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('track spacing override 55 NM → warning', () => {
    const result = validatePlanSnapshot({ ws2TrackSpacings: { s1: { spacingNm: 55, selection: 'manual' } } });
    expect(result.issues.some((issue) => issue.level === 'warning' && issue.field.includes('ws2TrackSpacings'))).toBe(true);
  });
});
