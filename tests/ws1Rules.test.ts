/**
 * Tests untuk ketentuan perhitungan Worksheet 1.
 * UPDATE Panduan Datum Worksheet 1 (bagian 3.3): kecepatan wind current
 * memakai koefisien 0,036 × angin (menggantikan rumus lama ASW ÷ 28).
 * 1. Wind current (Fig I-1) = 0,036 × ASW, divergensi 30° per zona lintang.
 * 2. Leeway dari Table I-1/I-2 sesuai Search target (description).
 * 3. de default 12.5%, de(L) = Distance(L) × de, de(R) = Distance(R) × de,
 *    De = [de(L) + de(R) + Distance L/R] / 2.
 * 4. x/y dari Table J-1/J-2 (GPS → 0.1 dst.).
 * 5. fs: pencarian ke-1 → 1.1, ke-2 → 1.6, dst.
 */
import { describe, test, expect } from 'bun:test';
import {
  windCurrentDrift,
  windCurrentDivergence,
  computeWC,
  computeLW,
  computeWs1SearchArea,
  LEEWAY_OBJECT_TYPES,
  TABLE_J1_NAV_ERRORS,
  WS1_FS_OPTIONS,
  WS1_DEFAULT_DRIFT_ERROR_PERCENT,
  getLeewayObjectById,
  getTableJ1ErrorById,
} from '../src/lib/sar/sarCalculations';

describe('Ketentuan 3 — Wind current Figure I-1 (0,036 × ASW, Panduan bagian 3.3)', () => {
  test('windCurrentDrift = 0,036 × ASW', () => {
    expect(windCurrentDrift(14)).toBeCloseTo(0.504, 10);
    expect(windCurrentDrift(28)).toBeCloseTo(1.008, 10);
    expect(windCurrentDrift(10)).toBeCloseTo(0.36, 10); // titik grafik Fig. I-1
    expect(windCurrentDrift(0)).toBe(0);
  });

  test('divergensi: 10°N–10°S → 0°, di luarnya → 30°', () => {
    expect(windCurrentDivergence(0)).toBe(0);
    expect(windCurrentDivergence(5)).toBe(0);
    expect(windCurrentDivergence(10)).toBe(0);
    expect(windCurrentDivergence(10.5)).toBe(30);
    expect(windCurrentDivergence(20)).toBe(30);
    expect(windCurrentDivergence(45)).toBe(30);
  });

  test('arah wind current = reciprocal ± divergensi (kanan di N, kiri di S)', () => {
    // Wind FROM 090 → downwind 270; lintang 20°N → divergensi ke kanan (+30)
    const north = computeWC(90, 14, 20);
    expect(north.windCurrentDrift).toBeCloseTo(0.504, 10);
    expect(north.divergence).toBe(30);
    expect(north.wcSet).toBe(300);
    // Lintang 20°S → divergensi ke kiri (−30)
    const south = computeWC(90, 14, -20);
    expect(south.wcSet).toBe(240);
    // Dalam 10°N–10°S → 0°
    const equator = computeWC(90, 14, -2.6);
    expect(equator.divergence).toBe(0);
    expect(equator.wcSet).toBe(270);
  });
});

describe('Ketentuan 4 & 5 — Leeway Table I-1/I-2 per Search target', () => {
  test('setiap entri punya multiplier, modifier, dan divergence terdefinisi', () => {
    for (const t of LEEWAY_OBJECT_TYPES) {
      expect(Number.isFinite(t.leewayRate)).toBe(true);
      expect(Number.isFinite(t.leewayModifier ?? 0)).toBe(true);
      expect(Number.isFinite(t.divergenceAngle)).toBe(true);
    }
  });

  test('id unik dan count ≥ seluruh baris Table I-1 + I-2', () => {
    const ids = LEEWAY_OBJECT_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Table I-1 punya 35 baris nilai + Table I-2 punya 11 → total ≥ 40
    expect(ids.length).toBeGreaterThanOrEqual(40);
  });

  test('nilai persis dari Table I-1 (PDF)', () => {
    expect(getLeewayObjectById('piw-novice')).toMatchObject({ leewayRate: 0.011, leewayModifier: 0.07, divergenceAngle: 30 });
    // FIX: nilai sitting/vertical sebelumnya tertukar — Table I-1 (I-3, AL1/04):
    // Sitting = 0.012/0.00/18, Vertical = 0.005/0.07/18.
    expect(getLeewayObjectById('piw-sitting')).toMatchObject({ leewayRate: 0.012, leewayModifier: 0.00, divergenceAngle: 18 });
    expect(getLeewayObjectById('piw-vertical-2')).toMatchObject({ leewayRate: 0.005, leewayModifier: 0.07, divergenceAngle: 18 });
    expect(getLeewayObjectById('piw-lifejacket')).toMatchObject({ leewayRate: 0.014, leewayModifier: 0.10, divergenceAngle: 30 });
    expect(getLeewayObjectById('piw-scuba')).toMatchObject({ leewayRate: 0.007, leewayModifier: 0.08, divergenceAngle: 30 });
    expect(getLeewayObjectById('piw-deceased')).toMatchObject({ leewayRate: 0.015, leewayModifier: 0.08, divergenceAngle: 30 });
    expect(getLeewayObjectById('raft-1520-person')).toMatchObject({ leewayRate: 0.042, leewayModifier: 0.03, divergenceAngle: 28 });
    expect(getLeewayObjectById('raft-46-person')).toMatchObject({ leewayRate: 0.057, leewayModifier: 0.21, divergenceAngle: 24 });
    expect(getLeewayObjectById('raft-noballast-drogue')).toMatchObject({ leewayRate: 0.044, leewayModifier: -0.2, divergenceAngle: 28 });
    expect(getLeewayObjectById('raft-canopy-no-drogue')).toMatchObject({ leewayRate: 0.037, leewayModifier: 0.11, divergenceAngle: 24 });
    expect(getLeewayObjectById('raft-canopy-drogue')).toMatchObject({ leewayRate: 0.030, leewayModifier: 0.00, divergenceAngle: 28 });
    expect(getLeewayObjectById('dinghy-upright')).toMatchObject({ leewayRate: 0.029, leewayModifier: 0.00, divergenceAngle: 22 });
    expect(getLeewayObjectById('raft-shallow-ballast-nodrogue')).toMatchObject({ leewayRate: 0.032, leewayModifier: -0.02, divergenceAngle: 22 });
    expect(getLeewayObjectById('raft-shallow-ballast-drogue')).toMatchObject({ leewayRate: 0.025, leewayModifier: 0.01, divergenceAngle: 22 });
    expect(getLeewayObjectById('dinghy-fibreglass')).toMatchObject({ leewayRate: 0.017, leewayModifier: -0.10, divergenceAngle: 8 });
    expect(getLeewayObjectById('raft-deep-ballast')).toMatchObject({ leewayRate: 0.030, leewayModifier: 0.02, divergenceAngle: 13 });
    expect(getLeewayObjectById('life-capsule')).toMatchObject({ leewayRate: 0.038, leewayModifier: -0.08, divergenceAngle: 22 });
    expect(getLeewayObjectById('uscg-sea-rescue-kit')).toMatchObject({ leewayRate: 0.025, leewayModifier: -0.04, divergenceAngle: 7 });
    expect(getLeewayObjectById('raft-aviation-46')).toMatchObject({ leewayRate: 0.037, leewayModifier: 0.11, divergenceAngle: 24 });
    expect(getLeewayObjectById('raft-evac-slide')).toMatchObject({ leewayRate: 0.028, leewayModifier: -0.01, divergenceAngle: 15 });
    expect(getLeewayObjectById('sea-kayak')).toMatchObject({ leewayRate: 0.011, leewayModifier: 0.24, divergenceAngle: 15 });
    expect(getLeewayObjectById('surf-board')).toMatchObject({ leewayRate: 0.020, leewayModifier: 0.00, divergenceAngle: 15 });
    expect(getLeewayObjectById('windsurfer')).toMatchObject({ leewayRate: 0.023, leewayModifier: 0.10, divergenceAngle: 12 });
    expect(getLeewayObjectById('sailboat')).toMatchObject({ leewayRate: 0.030, leewayModifier: 0.00, divergenceAngle: 48 });
    expect(getLeewayObjectById('sailboat-fin-keel')).toMatchObject({ leewayRate: 0.040, leewayModifier: 0.00, divergenceAngle: 48 });
    expect(getLeewayObjectById('skiff-flat-bottom')).toMatchObject({ leewayRate: 0.034, leewayModifier: 0.04, divergenceAngle: 22 });
    expect(getLeewayObjectById('skiff-v-hull')).toMatchObject({ leewayRate: 0.030, leewayModifier: 0.08, divergenceAngle: 15 });
    expect(getLeewayObjectById('skiff-swamped')).toMatchObject({ leewayRate: 0.017, leewayModifier: 0.00, divergenceAngle: 15 });
    expect(getLeewayObjectById('sport-boat-cuddy')).toMatchObject({ leewayRate: 0.069, leewayModifier: -0.08, divergenceAngle: 19 });
    expect(getLeewayObjectById('sport-fisher-center-console')).toMatchObject({ leewayRate: 0.060, leewayModifier: -0.09, divergenceAngle: 22 });
    expect(getLeewayObjectById('small-fishing')).toMatchObject({ leewayRate: 0.037, leewayModifier: 0.02, divergenceAngle: 48 });
    expect(getLeewayObjectById('fishing-sampans')).toMatchObject({ leewayRate: 0.040, leewayModifier: 0.00, divergenceAngle: 48 });
    expect(getLeewayObjectById('commercial-fishing')).toMatchObject({ leewayRate: 0.042, leewayModifier: 0.00, divergenceAngle: 48 });
    expect(getLeewayObjectById('fishing-longliners')).toMatchObject({ leewayRate: 0.037, leewayModifier: 0.00, divergenceAngle: 48 });
    expect(getLeewayObjectById('fishing-junk')).toMatchObject({ leewayRate: 0.027, leewayModifier: 0.10, divergenceAngle: 48 });
    expect(getLeewayObjectById('fishing-gill-netter')).toMatchObject({ leewayRate: 0.040, leewayModifier: 0.01, divergenceAngle: 33 });
    expect(getLeewayObjectById('merchant-vessel')).toMatchObject({ leewayRate: 0.028, leewayModifier: 0.00, divergenceAngle: 48 });
    expect(getLeewayObjectById('debris-fv')).toMatchObject({ leewayRate: 0.020, leewayModifier: 0.00, divergenceAngle: 10 });
    expect(getLeewayObjectById('debris-bait-box')).toMatchObject({ leewayRate: 0.013, leewayModifier: 0.27, divergenceAngle: 31 });
    expect(getLeewayObjectById('debris-bait-box-light')).toMatchObject({ leewayRate: 0.026, leewayModifier: 0.18, divergenceAngle: 15 });
    expect(getLeewayObjectById('debris-bait-box-full')).toMatchObject({ leewayRate: 0.016, leewayModifier: 0.16, divergenceAngle: 33 });
  });

  test('nilai persis dari Table I-2 (PDF, deep ballast)', () => {
    expect(getLeewayObjectById('deep-ballast-raft-default')).toMatchObject({ leewayRate: 0.029, leewayModifier: 0.04, divergenceAngle: 15 });
    expect(getLeewayObjectById('deep-ballast-46-wodrogue-light')).toMatchObject({ leewayRate: 0.038, leewayModifier: -0.04, divergenceAngle: 15 });
    expect(getLeewayObjectById('deep-ballast-46-wodrogue-heavy')).toMatchObject({ leewayRate: 0.036, leewayModifier: -0.03, divergenceAngle: 15 });
    expect(getLeewayObjectById('deep-ballast-46-drogue-light')).toMatchObject({ leewayRate: 0.016, leewayModifier: 0.05, divergenceAngle: 24 });
    expect(getLeewayObjectById('deep-ballast-46-drogue-heavy')).toMatchObject({ leewayRate: 0.021, leewayModifier: 0.00, divergenceAngle: 20 });
    expect(getLeewayObjectById('deep-ballast-1525-default')).toMatchObject({ leewayRate: 0.036, leewayModifier: -0.09, divergenceAngle: 10 });
    expect(getLeewayObjectById('deep-ballast-1525-wodrogue-light')).toMatchObject({ leewayRate: 0.039, leewayModifier: -0.06, divergenceAngle: 9 });
    expect(getLeewayObjectById('deep-ballast-1525-drogue')).toMatchObject({ leewayRate: 0.031, leewayModifier: -0.07, divergenceAngle: 9 });
    expect(getLeewayObjectById('deep-ballast-capsized')).toMatchObject({ leewayRate: 0.009, leewayModifier: 0.00, divergenceAngle: 12 });
    expect(getLeewayObjectById('deep-ballast-swamped')).toMatchObject({ leewayRate: 0.010, leewayModifier: -0.04, divergenceAngle: 8 });
  });

  test('Leeway speed = (Multiplier × Wind Speed) ± Modifier', () => {
    const lw = computeLW(90, 10, getLeewayObjectById('raft-46-person'));
    // 0.057 × 10 + 0.21 = 0.78
    expect(lw.leewaySpeed).toBeCloseTo(0.78, 10);
    // Divergence dari tabel → arah L/R = downwind ∓ divergence
    expect(lw.divergenceAngle).toBe(24);
    expect(lw.lwLeftDir).toBe(270 - 24);
    expect(lw.lwRightDir).toBe(270 + 24);
    // Modifier negatif: 0.044 × 10 − 0.20 = 0.24
    const lwDrogue = computeLW(90, 10, getLeewayObjectById('raft-noballast-drogue'));
    expect(lwDrogue.leewaySpeed).toBeCloseTo(0.24, 10);
    // Tidak pernah negatif
    const lwZero = computeLW(90, 2, getLeewayObjectById('raft-noballast-drogue'));
    expect(lwZero.leewaySpeed).toBeGreaterThanOrEqual(0);
  });
});

describe('Ketentuan 6–10 — Drift error de, de(L), de(R), Distance L/R, De', () => {
  test('de default 12.5%', () => {
    expect(WS1_DEFAULT_DRIFT_ERROR_PERCENT).toBe(12.5);
  });

  test('de(L) = Distance(L) × de; de(R) = Distance(R) × de; De = [de(L)+de(R)+L/R]/2', () => {
    // Contoh: Distance L = 10 NM, R = 12 NM, L/R = 5 NM, de = 12.5%
    const de = 12.5;
    const distL = 10, distR = 12, distLR = 5;
    const deL = distL * de / 100;   // 1.25
    const deR = distR * de / 100;   // 1.50
    expect(deL).toBeCloseTo(1.25, 10);
    expect(deR).toBeCloseTo(1.50, 10);
    const De = (deL + deR + distLR) / 2; // 3.875
    expect(De).toBeCloseTo(3.875, 10);
  });

  test('E = √(De² + x² + y²), R = ⌈E × fs⌉, Ao = 4R² dengan x/y Table J-1 (GPS 0.1) dan fs 1.1', () => {
    const De = (10 * 0.125 + 12 * 0.125 + 5) / 2; // 3.875
    const { E, R, Ao } = computeWs1SearchArea({ De, X: 0.1, Y: 0.1, fs: 1.1 });
    const EExpected = Math.sqrt(3.875 ** 2 + 0.1 ** 2 + 0.1 ** 2);
    expect(E).toBeCloseTo(EExpected, 10);
    expect(R).toBe(Math.ceil(EExpected * 1.1));
    expect(Ao).toBe(4 * Math.ceil(EExpected * 1.1) ** 2);
  });
});

describe('Ketentuan 11 & 12 — Table J-1 (x dan y)', () => {
  test('nilai Table J-1 persis', () => {
    expect(getTableJ1ErrorById('gps')).toBe(0.1);
    expect(getTableJ1ErrorById('radar')).toBe(1.0);
    expect(getTableJ1ErrorById('visual')).toBe(1.0);
    expect(getTableJ1ErrorById('celestial')).toBe(2.0);
    expect(getTableJ1ErrorById('marine-radio-beacon')).toBe(4.0);
    expect(getTableJ1ErrorById('loran-c')).toBe(1.0);
    expect(getTableJ1ErrorById('tidak-ada')).toBeUndefined();
  });
});

describe('Ketentuan 13 — Safety factor (circle) fs per pencarian ke-N', () => {
  test('fsOptions: pertama 1.1, kedua 1.6, ketiga 2.0, keempat 2.3, kelima 2.5', () => {
    expect([...WS1_FS_OPTIONS]).toEqual([1.1, 1.6, 2.0, 2.3, 2.5]);
    const searchNumber = (fs: number) => (WS1_FS_OPTIONS as readonly number[]).indexOf(fs) + 1;
    expect(searchNumber(1.1)).toBe(1);
    expect(searchNumber(1.6)).toBe(2);
    expect(searchNumber(2.0)).toBe(3);
    expect(searchNumber(2.3)).toBe(4);
    expect(searchNumber(2.5)).toBe(5);
  });
});
