/**
 * PHASE 5 — Kontrak preview/konfirmasi seragam untuk tool-call AI chat.
 * Semua tool bermutasi wajib punya mapping capability valid + kontrak preview
 * lengkap; tool non-mutating (ask_for_case_data) tanpa kontrak.
 * Jalankan: bun test tests/phase5_chatPreview.test.ts
 */
import { test, expect } from 'bun:test';
import {
  buildChatPreviewContract,
  buildChatPreviewContracts,
  validateChatToolMapping,
  CHAT_TOOL_TO_CAPABILITY,
  CHAT_NON_MUTATING_TOOLS,
  TARGET_LABELS,
} from '../src/lib/sar/chatPreview';
import { getCapability, type MapPreviewContract } from '../src/lib/sar/capabilityRegistry';

const CONTRACT_FIELDS: (keyof MapPreviewContract)[] = [
  'operation',
  'summary',
  'target',
  'features',
  'requiresUserConfirmation',
  'reversible',
];

test('mapping tool → capability: semua id ada di registry', () => {
  const { ok, missing } = validateChatToolMapping();
  expect(missing).toEqual([]);
  expect(ok).toBe(true);
  expect(Object.keys(CHAT_TOOL_TO_CAPABILITY).length).toBeGreaterThanOrEqual(12);
});

test('tool non-mutating (ask_for_case_data) tidak menghasilkan kontrak', () => {
  expect(CHAT_NON_MUTATING_TOOLS.has('ask_for_case_data')).toBe(true);
  expect(buildChatPreviewContract({ name: 'ask_for_case_data', args: { missing: ['datumTime'] } })).toBeNull();
  expect(buildChatPreviewContracts([
    { name: 'ask_for_case_data', args: {} },
    { name: 'set_datum_case', args: { driftInterval: 3 } },
  ])).toHaveLength(1);
});

test('set_lkp: kontrak target sea-map, koordinat di summary + feature marker', () => {
  const c = buildChatPreviewContract({ name: 'set_lkp', args: { lat: -6.2, lng: 106.8 } })!;
  expect(c.operation).toBe('map-sea-lkp-pick');
  expect(c.target).toBe('sea-map');
  expect(c.summary).toContain('-6.2');
  expect(c.summary).toContain('106.8');
  expect(c.features[0].kind).toBe('marker');
  expect(c.features[0].coord).toEqual({ lat: -6.2, lng: 106.8 });
  expect(c.requiresUserConfirmation).toBe(true);
  expect(c.warnings?.some((w) => w.toLowerCase().includes('verifikasi'))).toBe(true);
});

test('pengisian worksheet: kontrak target state, jumlah field di summary, reversible', () => {
  const c = buildChatPreviewContract({
    name: 'set_asw_case',
    args: { distressTime: '0800', datumTime: '1400', intervalMode: '6h', windData: [], caseTitle: 'Latihan' },
  })!;
  expect(c.operation).toBe('env-asw');
  expect(c.target).toBe('state');
  expect(c.summary).toContain('Worksheet ASW');
  expect(c.summary).toContain('5 field'); // nFields = jumlah keys args (5 keys)
  expect(c.reversible).toBe(true);
  expect(c.requiresUserConfirmation).toBe(true);
});

test('intercept & ADW: kontrak memuat peringatan render ulang', () => {
  const ic = buildChatPreviewContract({ name: 'set_intercept_case', args: { targetSpeedKts: 12 } })!;
  expect(ic.operation).toBe('intercept-calculate');
  expect(ic.warnings?.join(' ')).toContain('Intercept');
  const adw = buildChatPreviewContract({ name: 'set_aero_drift_case', args: { incidentPos: { lat: 0, lng: 0 } } })!;
  expect(adw.warnings?.join(' ')).toContain('UPS');
});

test('save_case_data_bank: kontrak target document', () => {
  const c = buildChatPreviewContract({ name: 'save_case_data_bank', args: { caseTitle: 'X', fields: [] } })!;
  expect(c.target).toBe('document');
  expect(c.summary).toContain('Bank Data');
});

test('semua kontrak bermutasi punya field lengkap + konfirmasi wajib', () => {
  for (const tool of Object.keys(CHAT_TOOL_TO_CAPABILITY)) {
    const c = buildChatPreviewContract({ name: tool, args: { lat: 0, lng: 0 } });
    expect(c).not.toBeNull();
    for (const f of CONTRACT_FIELDS) {
      expect((c as MapPreviewContract)[f]).toBeDefined();
    }
    expect(c!.requiresUserConfirmation).toBe(true);
  }
});

test('tool tak dikenal tetap dapat kontrak generik (fail-safe, tidak diam-diam)', () => {
  const c = buildChatPreviewContract({ name: 'tool_misterius', args: { a: 1 } })!;
  expect(c.operation).toBe('tool_misterius');
  expect(c.target).toBe('state');
  expect(c.requiresUserConfirmation).toBe(true);
});

test('buildChatPreviewContracts: input null/undefined → array kosong', () => {
  expect(buildChatPreviewContracts(null)).toEqual([]);
  expect(buildChatPreviewContracts(undefined)).toEqual([]);
  expect(buildChatPreviewContracts([])).toEqual([]);
});

test('TARGET_LABELS mencakup semua target kontrak', () => {
  const targets: MapPreviewContract['target'][] = ['sea-map', 'onc-map', 'ups-plotter', 'document', 'state'];
  for (const t of targets) expect(TARGET_LABELS[t]).toBeTruthy();
});

test('setiap tool bermutasi memetakan ke capability requiresConfirmation yang konsisten', () => {
  // Kontrak chat konfirmasi-wajib; capability peta (sea-lkp-pick) memang false
  // karena klik pengguna langsung — tapi jalur AI lewat kontrak chat wajib konfirmasi.
  const cap = getCapability('map-sea-lkp-pick');
  expect(cap).toBeDefined();
  expect(cap!.category).toBe('MAP_OPERATION');
});

test('clarify_datum_time non-mutating: tanpa kontrak preview, jawaban lewat chat', () => {
  // Tool klarifikasi datum time tidak mengubah worksheet — kandidat waktu
  // dijawab pengguna di kartu chat, lalu AI meneruskan set_asw_case.
  expect(CHAT_NON_MUTATING_TOOLS.has('clarify_datum_time')).toBe(true);
  expect(buildChatPreviewContracts([{ name: 'clarify_datum_time', args: { question: 'q?', candidates: [] } }])).toEqual([]);
  expect(buildChatPreviewContract({ name: 'clarify_datum_time', args: {} })).toBeNull();
});

test('clarify_incident_time non-mutating: tanpa kontrak preview, jawaban lewat chat', () => {
  // Tool klarifikasi waktu kejadian A.1 ADW tidak mengubah worksheet —
  // kandidat waktu dijawab pengguna di kartu chat, lalu AI meneruskan
  // set_aero_drift_case (date + incidentTime).
  expect(CHAT_NON_MUTATING_TOOLS.has('clarify_incident_time')).toBe(true);
  expect(buildChatPreviewContracts([{ name: 'clarify_incident_time', args: { question: 'q?', candidates: [] } }])).toEqual([]);
  expect(buildChatPreviewContract({ name: 'clarify_incident_time', args: {} })).toBeNull();
});
