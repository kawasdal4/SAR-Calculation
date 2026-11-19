/**
 * SAR WORKFLOW MEMORY & CONTEXT MANAGER — acceptance tests (TEST 1-10).
 * Semua relasi diambil dari dependency registry aktual (bukan tebakan).
 * Jalankan: bun test tests/phase6_workspaceContext.test.ts
 */
import { test, expect } from 'bun:test';
import {
  buildWorkspaceSnapshot,
  buildConversationEntry,
  invalidateDependents,
  selectiveWorkspaceContext,
  lookupWorkspaceResult,
  nextWorkflowSteps,
  workflowPlanText,
  validateContextSlots,
  hashInputs,
  stableStringify,
  scrubSensitive,
  entryToRow,
  rowToEntry,
  buildChildEdges,
  buildParentEdges,
  CONTEXT_SLOTS,
  type ContextEntry,
} from '../src/lib/sar/workspaceContext';

const WS = 'case_test_ws';
const WS_LAIN = 'case_other_ws';

/** State awal skenario (payload buildState). */
function stateAwal() {
  return {
    scenario: { caseTitle: 'Latihan SAR 001', incidentType: 'ACCIDENT' },
    awa: { observations: [], distressAltFt: 0, caseTitle: 'Latihan SAR 001' },
    asw: { observations: [], aswErr: 0 },
    lkp: { lat: -6.2, lng: 106.8 },
  };
}

function stateDenganHasil() {
  return {
    scenario: { caseTitle: 'Latihan SAR 001', incidentType: 'ACCIDENT' },
    awa: { observations: [{ altObs: '5000ft', windDirFrom: 90, windSpeed: 15 }], distressAltFt: 5000 },
    asw: { observations: [{ windDirFrom: 90, windSpeed: 15 }], aswErr: 0.5 },
    datum: { driftInterval: 3, lkp: { lat: -6.2, lng: 106.8 } },
    search: { sweep: 3, datumType: 'DATUM-POINT', facilities: [{ name: 'KN Pudu' }] },
    lkp: { lat: -6.2, lng: 106.8 },
  };
}

test('pra-syarat: semua slot menunjuk capability yang ADA di registry (jangan tebakan)', () => {
  const { ok, missing } = validateContextSlots();
  expect(missing).toEqual([]);
  expect(ok).toBe(true);
  expect(CONTEXT_SLOTS.length).toBeGreaterThanOrEqual(20);
});

test('graph edge hanya dari registry: parent search-area → child pattern, parent asw → child datum', () => {
  const edges = buildChildEdges();
  expect(edges.get('calc:asw')).toContain('calc:datum');          // ws1-datum deps [env-asw]
  expect(edges.get('calc:awa') ?? []).not.toContain('calc:asw');  // env-asw deps [] — bukan tebakan nama
  expect(edges.get('calc:search-area')).toContain('calc:pattern'); // pattern deps [ws1-search-area, …]
  // parent edges: arah untuk entry.dependencies
  const parents = buildParentEdges();
  expect(parents.get('calc:datum')).toContain('calc:asw');
  expect(parents.get('calc:pattern')).toContain('calc:search-area');
  expect(parents.get('calc:asw') ?? []).not.toContain('calc:awa');
});

// TEST 1 — workspace baru + data awal
test('TEST 1: workspace baru → snapshot menghasilkan entry scenario + LKP, tanpa hasil kalkulasi', () => {
  const { entries, history } = buildWorkspaceSnapshot(WS, stateAwal());
  expect(history).toHaveLength(0);
  const scenario = entries.find((e) => e.entryKey === 'scenario:info');
  expect(scenario?.status).toBe('CURRENT');
  expect(scenario?.summary).toContain('Informasi skenario');
  const lkp = entries.find((e) => e.entryKey === 'map:lkp');
  expect(lkp?.status).toBe('CURRENT');
  expect(lkp?.data).toEqual({ lat: -6.2, lng: 106.8 });
  expect(entries.find((e) => e.entryKey === 'calc:pattern')).toBeUndefined(); // belum dikerjakan
  // Entry punya traceability lengkap (source/capability/version/timestamp)
  for (const e of entries) {
    expect(e.id).toBeTruthy();
    expect(e.caseId).toBe(WS);
    expect(e.capabilityId).toBeTruthy();
    expect(e.version).toBe(1);
    expect(e.createdAt).toBeTruthy();
  }
});

// TEST 2 — AWA dikerjakan & disimpan
test('TEST 2: AWA terisi → entry calc:awa CURRENT dengan hash input', () => {
  const { entries } = buildWorkspaceSnapshot(WS, stateDenganHasil());
  const awa = entries.find((e) => e.entryKey === 'calc:awa')!;
  expect(awa.status).toBe('CURRENT');
  expect(awa.capabilityId).toBe('env-awa');
  expect(awa.inputsHash).toBeTruthy();
  // Hash deterministik untuk input sama
  expect(hashInputs(awa.data)).toBe(awa.inputsHash);
});

// TEST 3 — worksheet lain memakai hasil sebelumnya (dependency dari graph)
test('TEST 3: entry WS1 (datum) mencatat dependency aktual calc:asw dari graph registry', () => {
  const { entries } = buildWorkspaceSnapshot(WS, stateDenganHasil());
  const datum = entries.find((e) => e.entryKey === 'calc:datum')!;
  expect(datum.status).toBe('CURRENT');
  expect(datum.dependencies).toContain('calc:asw'); // ws1-datum deps [env-asw]
  expect(datum.dependencies).not.toContain('calc:awa'); // env-asw deps [] — tidak ada di graph
});

// TEST 4 — AI pakai koordinat tersimpan
test('TEST 4: lookup koordinat tersimpan → CURRENT + sumber jelas', () => {
  const { entries } = buildWorkspaceSnapshot(WS, stateDenganHasil());
  const res = lookupWorkspaceResult(entries, WS, 'gunakan koordinat LKP sebelumnya');
  expect(res.available).toBe(true);
  expect(res.matches[0].status).toBe('CURRENT');
  expect(res.message).toContain('CURRENT');
});

// TEST 5 — input berubah → dependen STALE via graph, lainnya tidak tersentuh
test('TEST 5: input ASW berubah → calc:datum STALE, calc:awa tetap CURRENT, histori versi dipertahankan', () => {
  const v1 = buildWorkspaceSnapshot(WS, stateDenganHasil());
  const aswBerubah = {
    ...stateDenganHasil(),
    asw: { observations: [{ windDirFrom: 180, windSpeed: 22 }], aswErr: 1.2 },
  };
  const v2 = buildWorkspaceSnapshot(WS, aswBerubah, v1.entries);
  const aswV2 = v2.entries.find((e) => e.entryKey === 'calc:asw')!;
  expect(aswV2.version).toBe(2); // versi naik
  expect(v2.history.some((h) => h.entryKey === 'calc:asw' && h.version === 1)).toBe(true); // histori tidak dihapus

  const invalidated = invalidateDependents(v2.entries, ['calc:asw']);
  const byKey = (k: string) => invalidated.filter((e) => e.entryKey === k).sort((a, b) => b.version - a.version)[0];
  expect(byKey('calc:datum').status).toBe('STALE');      // dependen langsung (graph)
  expect(byKey('calc:awa').status).toBe('CURRENT');      // bukan dependen — tidak tersentuh
  expect(byKey('calc:search').status).toBe('STALE');     // turunan transitif ws1-search-area? tidak —
  // catatan: calc:search (ws-search-plan) deps [ws1-datum] → ikut STALE transitif
});

// TEST 6 — dua workspace tidak tercampur
test('TEST 6: isolasi workspace — konteks WS_LAIN tidak bocor ke WS', () => {
  const wsA = buildWorkspaceSnapshot(WS, stateDenganHasil()).entries;
  const wsB = buildWorkspaceSnapshot(WS_LAIN, { scenario: { caseTitle: 'Skenario Kapal Hilang' } }).entries;
  const semua = [...wsA, ...wsB];
  const retrievalA = selectiveWorkspaceContext(semua, WS);
  // Isolasi keras: hanya entry dengan caseId workspace aktif yang dipakai.
  expect(retrievalA.used.length).toBeGreaterThan(0);
  expect(retrievalA.used.every((e) => e.caseId === WS)).toBe(true);
  const retrievalB = selectiveWorkspaceContext(semua, WS_LAIN);
  expect(retrievalB.used.every((e) => e.caseId === WS_LAIN)).toBe(true);
  expect(retrievalB.used.some((e) => e.entryKey === 'scenario:info')).toBe(true);
  expect(retrievalB.used.some((e) => e.entryKey === 'calc:datum')).toBe(false); // milik WS
});

// TEST 7 — orchestration: RENOPS dari hasil tersedia
test('TEST 7: RENCANA TAHAPAN — RENOPS BLOCKED sebelum pattern/assets, READY setelah keduanya CURRENT', () => {
  const { entries } = buildWorkspaceSnapshot(WS, stateDenganHasil());
  const plan1 = nextWorkflowSteps(entries, WS);
  const renops1 = plan1.find((s) => s.slotKey === 'doc:renops')!;
  expect(renops1.state).toBe('BLOCKED');
  expect(renops1.missing.length).toBeGreaterThan(0);

  const lengkap = buildWorkspaceSnapshot(WS, {
    ...stateDenganHasil(),
    pattern: { patternType: 'PS', trackSpacingNm: 2 },
    assets: [{ name: 'KN Pudu', speedKts: 15 }],
    searchArea: { csp: { lat: -6.2, lng: 106.8 } },
    ws2: { s: 2.5, pod: 0.9 },
  }, entries).entries;
  const plan2 = nextWorkflowSteps(lengkap, WS);
  const renops2 = plan2.find((s) => s.slotKey === 'doc:renops')!;
  // pattern+assets+search-area+datum CURRENT → tinggal scenario:info (CURRENT) → READY
  expect(renops2.state).toBe('READY');
  expect(renops2.missing).toHaveLength(0);
  expect(workflowPlanText(lengkap, WS)).toContain('RENCANA TAHAPAN');
});

// TEST 8 — briefing dari dokumen & hasil perencanaan
test('TEST 8: Briefing bergantung scenario:info + calc:assets (doc-briefing deps registry)', () => {
  const { entries } = buildWorkspaceSnapshot(WS, stateDenganHasil());
  const plan = nextWorkflowSteps(entries, WS);
  const briefing = plan.find((s) => s.slotKey === 'doc:briefing')!;
  expect(briefing.missing).toContain('calc:assets'); // asset-allocate ada di deps doc-briefing
  expect(briefing.state).toBe('BLOCKED');
});

// TEST 9 — konteks bertahan setelah aplikasi ditutup (serialisasi DB roundtrip)
test('TEST 9: roundtrip entryToRow/rowToEntry — konteks utuh untuk persistensi', () => {
  const { entries } = buildWorkspaceSnapshot(WS, stateDenganHasil());
  const e = entries[0];
  // DB mengisi createdAt/updatedAt — simulasi baris Prisma lengkap.
  const row = { ...entryToRow(e), createdAt: new Date(e.createdAt), updatedAt: new Date(e.updatedAt) };
  const restored = rowToEntry(row);
  expect(restored).toEqual(e);
});

// TEST 10 — hasil yang belum pernah dihitung → AI tidak mengarang
test('TEST 10: query hasil yang tidak ada → available:false + pesan jujur', () => {
  const { entries } = buildWorkspaceSnapshot(WS, stateAwal());
  const res = lookupWorkspaceResult(entries, WS, 'berapa hasil perhitungan transit yang tadi?');
  expect(res.found).toBe(false);
  expect(res.available).toBe(false);
  expect(res.message).toContain('belum pernah dihitung');
});

// --- Aturan memori tambahan (bab 11) ---

test('percakapan TIDAK pernah menjadi sumber nilai kalkulasi (category E terpisah)', () => {
  const conv = buildConversationEntry(WS, 'decision', 'Gunakan datum point B');
  expect(conv.category).toBe('conversation');
  expect(conv.capabilityId).toBeUndefined(); // tanpa capability → bukan hasil engine
  const retrieval = selectiveWorkspaceContext([conv], WS);
  expect(retrieval.block).toContain('KONTEKS PERCAKAPAN');
  expect(retrieval.block).not.toContain('KALKULASI:');
  // Percakapan tidak ikut STALE saat input berubah
  const [flagged] = invalidateDependents([conv], ['calc:asw']);
  expect(flagged.status).toBe('CURRENT');
});

test('STALE tidak pernah dipakai sebagai hasil terbaru — retrieval hanya memberi peringatan', () => {
  const v1 = buildWorkspaceSnapshot(WS, stateDenganHasil()).entries;
  const aswBaru = { ...stateDenganHasil(), asw: { observations: [{ windDirFrom: 45, windSpeed: 10 }], aswErr: 0 } };
  const v2 = buildWorkspaceSnapshot(WS, aswBaru, v1).entries;
  const stale = invalidateDependents(v2, ['calc:asw']);
  const retrieval = selectiveWorkspaceContext(stale, WS);
  expect(retrieval.staleWarnings.length).toBeGreaterThan(0);
  expect(retrieval.block).toContain('JANGAN pakai sebagai hasil terbaru');
});

test('dokumen → NEEDS_REVIEW (bukan STALE) saat input berubah', () => {
  const docs: ContextEntry[] = [{
    id: 'd1', caseId: WS, entryKey: 'doc:renops', category: 'operational', capabilityId: 'doc-renops',
    source: 'document', data: { docId: 'x' }, summary: 'RENOPS draft', status: 'CURRENT', version: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', dependencies: [],
  }];
  const [flagged] = invalidateDependents(docs, ['calc:pattern']);
  expect(flagged.status).toBe('NEEDS_REVIEW');
});

test('hash input: perubahan nilai → hash beda; urutan key tidak berpengaruh', () => {
  expect(hashInputs({ a: 1, b: 2 })).toBe(hashInputs({ b: 2, a: 1 }));
  expect(hashInputs({ a: 1 })).not.toBe(hashInputs({ a: 2 }));
  expect(stableStringify({ b: 1, a: [1, { c: 2 }] })).toBe(stableStringify({ a: [1, { c: 2 }], b: 1 }));
});

test('API key/secret tidak pernah tersimpan ke context memory (bab 10)', () => {
  const clean = scrubSensitive({ apiKey: 'abc123', datumTime: '1400', nested: { token: 'x', sweep: 3 } });
  expect(clean.apiKey).toBe('[REDACTED]');
  expect((clean.nested as Record<string, unknown>).token).toBe('[REDACTED]');
  expect(clean.datumTime).toBe('1400');
  expect((clean.nested as Record<string, unknown>).sweep).toBe(3);
});
