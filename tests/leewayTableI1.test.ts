/**
 * Leeway Worksheet 1 — Table I-1/I-2 (Appendix I AL1/04) satu sumber kebenaran.
 * Nilai authoritative diketik ulang dari halaman I-3/I-4 APPENDIX.pdf (file
 * yang sama dengan Appendix_I_al1.pdf di dialog "Manual SAR AUS" web app).
 *
 * Diperbaiki:
 * 1. PIW terbalik nilai — 'piw-sitting' memuat angka baris Vertical (0.005)
 *    dan 'piw-vertical-2' memuat angka baris Sitting (0.012); label
 *    'piw-novice' tidak cocok dengan baris Table I-1.
 * 2. Label rakit menyesatkan ('15-20 person', '4-6 person' pada baris umum).
 * 3. resolveLeewayObjectFromDescription() — pemilihan baris Table I-1/I-2
 *    dari keterangan 'Search target (description)' Worksheet 1.
 * Jalankan: bun test tests/leewayTableI1.test.ts
 */
import { test, expect } from 'bun:test';
import {
  LEEWAY_OBJECT_TYPES,
  getLeewayObjectById,
  resolveLeewayObjectFromDescription,
  computeLW,
} from '../src/lib/sar/sarCalculations';

// ============================================================================
// Nilai authoritative Table I-1 & I-2 (halaman I-3/I-4, Appendix I AL1/04):
// id → [Multiplier, Modifier (kts), Divergence (deg)]
// ============================================================================
const TABLE_I1_I2: Record<string, [number, number, number]> = {
  // PIW
  'piw-novice': [0.011, 0.07, 30],        // PIW (general, baris tanpa descriptor)
  'piw-vertical-2': [0.005, 0.07, 18],    // PIW – Vertical
  'piw-sitting': [0.012, 0.00, 18],       // PIW – Sitting
  'piw-lifejacket': [0.014, 0.10, 30],    // PIW – Horizontal, Survival Suit
  'piw-scuba': [0.007, 0.08, 30],         // PIW – Horizontal, Scuba Suit
  'piw-deceased': [0.015, 0.08, 30],      // PIW – Horizontal, Deceased
  // Survival Craft — Maritime Life Rafts
  'raft-1520-person': [0.042, 0.03, 28],  // Maritime life rafts (general)
  'raft-46-person': [0.057, 0.21, 24],    // No ballast: no canopy, no drogue
  'raft-noballast-drogue': [0.044, -0.20, 28], // No ballast: no canopy, w/ drogue
  'raft-canopy-no-drogue': [0.037, 0.11, 24],  // No ballast: canopy, no drogue
  'raft-canopy-drogue': [0.030, 0.00, 28],     // No ballast: canopy, w/ drogue
  'dinghy-upright': [0.029, 0.00, 22],    // Shallow ballast systems and canopy (general)
  'raft-shallow-ballast-nodrogue': [0.032, -0.02, 22], // Shallow: no drogue
  'raft-shallow-ballast-drogue': [0.025, 0.01, 22],    // Shallow: with drogue
  'dinghy-fibreglass': [0.017, -0.10, 8], // Shallow: Capsized
  'raft-deep-ballast': [0.030, 0.02, 13], // Deep ballast (I-1 general; I-2 utk Level 4-6)
  // Table I-2 (deep ballast systems & canopies)
  'deep-ballast-raft-default': [0.029, 0.04, 15],
  'deep-ballast-46-wodrogue-light': [0.038, -0.04, 15],
  'deep-ballast-46-wodrogue-heavy': [0.036, -0.03, 15],
  'deep-ballast-46-drogue-light': [0.016, 0.05, 24],
  'deep-ballast-46-drogue-heavy': [0.021, 0.00, 20],
  'deep-ballast-1525-default': [0.036, -0.09, 10],
  'deep-ballast-1525-wodrogue-light': [0.039, -0.06, 9],
  'deep-ballast-1525-drogue': [0.031, -0.07, 9],
  'deep-ballast-capsized': [0.009, 0.00, 12],
  'deep-ballast-swamped': [0.010, -0.04, 8],
  // Other maritime survival craft
  'life-capsule': [0.038, -0.08, 22],
  'uscg-sea-rescue-kit': [0.025, -0.04, 7],
  // Aviation life rafts
  'raft-aviation-46': [0.037, 0.11, 24],  // no ballast, w/canopy — 4-6 person, w/o drogue
  'raft-evac-slide': [0.028, -0.01, 15],  // Evac/Slide — 46-person
  // Person-powered craft
  'sea-kayak': [0.011, 0.24, 15],
  'surf-board': [0.020, 0.00, 15],
  'windsurfer': [0.023, 0.10, 12],
  // Sailing vessels
  'sailboat': [0.030, 0.00, 48],          // Mono-hull, full keel (deep draft)
  'sailboat-fin-keel': [0.040, 0.00, 48], // Mono-hull, fin keel (shoal draft)
  // Power vessels
  'skiff-flat-bottom': [0.034, 0.04, 22], // Flat bottom — Boston whaler
  'skiff-v-hull': [0.030, 0.08, 15],      // V-hull — std. configuration
  'skiff-swamped': [0.017, 0.00, 15],     // V-hull — swamped
  'sport-boat-cuddy': [0.069, -0.08, 19], // Cuddy cabin — modified V-hull
  'sport-fisher-center-console': [0.060, -0.09, 22], // Center console — open cockpit
  'small-fishing': [0.037, 0.02, 48],     // Commercial fishing vessels (general)
  'fishing-sampans': [0.040, 0.00, 48],
  'commercial-fishing': [0.042, 0.00, 48], // Side-stern trawler
  'fishing-longliners': [0.037, 0.00, 48],
  'fishing-junk': [0.027, 0.10, 48],
  'fishing-gill-netter': [0.040, 0.01, 33], // w/ rear reel
  'merchant-vessel': [0.028, 0.00, 48],   // Coastal freighter
  // Boating debris
  'debris-fv': [0.020, 0.00, 10],         // F/V debris
  'debris-bait-box': [0.013, 0.27, 31],   // Bait/wharf box (general)
  'debris-bait-box-light': [0.026, 0.18, 15], // lightly loaded
  'debris-bait-box-full': [0.016, 0.16, 33],  // fully loaded
};

test('seluruh baris Table I-1/I-2 tercakup di LEEWAY_OBJECT_TYPES', () => {
  const appIds = new Set(LEEWAY_OBJECT_TYPES.map((t) => t.id));
  const tableIds = Object.keys(TABLE_I1_I2);
  for (const id of tableIds) {
    expect(appIds.has(id)).toBe(true);
  }
  expect(appIds.size).toBe(tableIds.length);
});

test('multiplier/modifier/divergence tiap id = nilai Table I-1/I-2 (Appendix I)', () => {
  for (const [id, [mult, mod, div]] of Object.entries(TABLE_I1_I2)) {
    const entry = LEEWAY_OBJECT_TYPES.find((t) => t.id === id);
    expect(entry).toBeDefined();
    expect(entry!.leewayRate).toBeCloseTo(mult, 10);
    expect(entry!.leewayModifier ?? 0).toBeCloseTo(mod, 10);
    expect(entry!.divergenceAngle).toBe(div);
  }
});

test('perbaikan PIW: sitting/vertical tidak lagi tertukar nilainya', () => {
  // Sebelum perbaikan: piw-sitting memuat 0.005 (baris Vertical) dan
  // piw-vertical-2 memuat 0.012 (baris Sitting).
  expect(getLeewayObjectById('piw-sitting').leewayRate).toBe(0.012);
  expect(getLeewayObjectById('piw-sitting').leewayModifier).toBe(0.00);
  expect(getLeewayObjectById('piw-vertical-2').leewayRate).toBe(0.005);
  expect(getLeewayObjectById('piw-vertical-2').leewayModifier).toBe(0.07);
  expect(getLeewayObjectById('piw-novice').leewayRate).toBe(0.011);
  expect(getLeewayObjectById('piw-novice').label).not.toContain('Vertical');
});

test('Leeway speed = (Multiplier × Wind Speed) ± Modifier (computeLW, clamp 0)', () => {
  // 15 kts, liferaft no ballast canopy w/ drogue: 0.030 × 15 + 0.00
  expect(computeLW(90, 15, getLeewayObjectById('raft-canopy-drogue')).leewaySpeed).toBeCloseTo(0.45, 10);
  // 15 kts, PIW survival suit: 0.014 × 15 + 0.10
  expect(computeLW(90, 15, getLeewayObjectById('piw-lifejacket')).leewaySpeed).toBeCloseTo(0.31, 10);
  // 4 kts, no ballast no canopy w/ drogue: 0.044 × 4 − 0.20 = −0.024 → clamp 0
  expect(computeLW(90, 4, getLeewayObjectById('raft-noballast-drogue')).leewaySpeed).toBe(0);
  // Divergence: downwind = 90 + 180 = 270; L = 270 − 28, R = 270 + 28
  const lw = computeLW(90, 15, getLeewayObjectById('raft-canopy-drogue'));
  expect(lw.downwindDir).toBe(270);
  expect(lw.lwLeftDir).toBe(242);
  expect(lw.lwRightDir).toBe(298);
});

// ============================================================================
// resolveLeewayObjectFromDescription — 'Search target (description)' → baris
// ============================================================================
test('deskripsi rakit: kombinasi no ballast/canopy/drogue tepat', () => {
  expect(resolveLeewayObjectFromDescription('life raft 4-6 person no canopy no drogue')?.object.id).toBe('raft-46-person');
  expect(resolveLeewayObjectFromDescription('life raft no canopy, w/ drogue')?.object.id).toBe('raft-noballast-drogue');
  expect(resolveLeewayObjectFromDescription('rakit penyelamat dengan canopy tanpa drogue')?.object.id).toBe('raft-canopy-no-drogue');
  expect(resolveLeewayObjectFromDescription('life raft canopy and drogue')?.object.id).toBe('raft-canopy-drogue');
  expect(resolveLeewayObjectFromDescription('rakit dengan drogue')?.object.id).toBe('raft-noballast-drogue');
  expect(resolveLeewayObjectFromDescription('life raft dengan shallow ballast, with drogue')?.object.id).toBe('raft-shallow-ballast-drogue');
  expect(resolveLeewayObjectFromDescription('life raft capsized / terbalik')?.object.id).toBe('dinghy-fibreglass');
  // Rakit tanpa keterangan → baris umum Table I-1 (0.042)
  expect(resolveLeewayObjectFromDescription('life raft 15 orang')?.object.id).toBe('raft-1520-person');
});

test('deskripsi deep ballast: varian kapasitas/drogue/loading Table I-2', () => {
  expect(resolveLeewayObjectFromDescription('deep ballast life raft 4-6 person without drogue light loading')?.object.id).toBe('deep-ballast-46-wodrogue-light');
  expect(resolveLeewayObjectFromDescription('deep ballast 4-6 person with drogue heavy loading')?.object.id).toBe('deep-ballast-46-drogue-heavy');
  expect(resolveLeewayObjectFromDescription('deep ballast life raft 15-25 person with drogue')?.object.id).toBe('deep-ballast-1525-drogue');
  // Deep ballast tanpa keterangan → baris general Table I-1 (0.030)
  expect(resolveLeewayObjectFromDescription('deep ballast life raft')?.object.id).toBe('raft-deep-ballast');
});

test('deskripsi PIW, kapal, dan debris', () => {
  expect(resolveLeewayObjectFromDescription('person in water (PIW)')?.object.id).toBe('piw-novice');
  expect(resolveLeewayObjectFromDescription('PIW duduk posisi fetal')?.object.id).toBe('piw-sitting');
  expect(resolveLeewayObjectFromDescription('PIW wearing survival suit')?.object.id).toBe('piw-lifejacket');
  expect(resolveLeewayObjectFromDescription('sea kayak with person')?.object.id).toBe('sea-kayak');
  expect(resolveLeewayObjectFromDescription('sailing yacht full keel')?.object.id).toBe('sailboat');
  expect(resolveLeewayObjectFromDescription('v-hull skiff swamped')?.object.id).toBe('skiff-swamped');
  expect(resolveLeewayObjectFromDescription('kapal nelayan side-stern trawler')?.object.id).toBe('commercial-fishing');
  expect(resolveLeewayObjectFromDescription('sampans')?.object.id).toBe('fishing-sampans');
  expect(resolveLeewayObjectFromDescription('junk')?.object.id).toBe('fishing-junk');
  expect(resolveLeewayObjectFromDescription('boston whaler')?.object.id).toBe('skiff-flat-bottom');
  expect(resolveLeewayObjectFromDescription('bait/wharf box lightly loaded')?.object.id).toBe('debris-bait-box-light');
  expect(resolveLeewayObjectFromDescription('fishing vessel debris')?.object.id).toBe('debris-fv');
  expect(resolveLeewayObjectFromDescription('life capsule')?.object.id).toBe('life-capsule');
  expect(resolveLeewayObjectFromDescription('aviation evac slide raft 46 person')?.object.id).toBe('raft-evac-slide');
});

test('deskripsi tak dikenal / kosong → undefined (tidak mengarang baris tabel)', () => {
  expect(resolveLeewayObjectFromDescription('kereta api')).toBeUndefined();
  expect(resolveLeewayObjectFromDescription('')).toBeUndefined();
  expect(resolveLeewayObjectFromDescription(undefined)).toBeUndefined();
  expect(resolveLeewayObjectFromDescription(null)).toBeUndefined();
});

test('getLeewayObjectById id tak dikenal → fallback baris pertama (PIW umum)', () => {
  expect(getLeewayObjectById('tidak-ada').id).toBe('piw-novice');
});
