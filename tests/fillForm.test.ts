/**
 * TEST FILL FORM + DE-BRIEF ANALYSIS (Fase 4 AI Copilot) — semua bagian
 * deterministik, TANPA memanggil LLM:
 *
 * 1. buildDocumentSnapshot — snapshot bersama Workbench & tool fill_form.
 * 2. buildFillFormPlan atas dokumen ASLI buildDocument (BRIEFING, DEBRIEFING,
 *    RENOPS_I): hanya field READY dipetakan; PENDING/ACTUAL_REQUIRED dilewati
 *    dengan alasan; payload kompatibel set_fields (keputusan no.5).
 * 3. analyzeDebrief — coverage = luas disapu / Ao; POD TEPAT dari
 *    computePOD (kurva resmi Figure I-12); kumulatif; sisa area; error input.
 * 4. executeServerTool('fill_form'/'analyze_debrief') — eksekusi server.
 */

import { describe, test, expect } from 'bun:test';
import {
  buildDocumentSnapshot,
  buildFillFormPlan,
  fillFormPlanToSetFields,
} from '../src/lib/sar/fillForm';
import { buildDocument, type DataBankField, type DocumentSnapshot } from '../src/lib/sar/dataBank';
import { analyzeDebrief } from '../src/lib/sar/debriefAnalysis';
import { computePOD } from '../src/lib/sar/wscPodTables';
import { executeServerTool } from '../src/lib/ai/tools/serverTools';

// ── Fixture ──────────────────────────────────────────────────────────────────

const SNAPSHOT: DocumentSnapshot = buildDocumentSnapshot({
  lkp: { lat: -6.879, lng: 105.261 },
  isLkpSet: true,
  datumResults: {
    datumLeft: { lat: -6.85, lng: 105.2 },
    datumRight: { lat: -6.9, lng: 105.35 },
    driftDistance: 18.2,
    E: 4.1,
  },
  searchResults: {
    searchAreaCenter: { lat: -6.88, lng: 105.28 },
    searchAreaLength: 16.4,
    searchAreaWidth: 16.4,
    orientationDeg: 205,
    Ao: 268.96,
    trackSpacing: 3,
    fs: 1.1,
    POD: 0.87,
  },
  asw: { aswDirFrom: 100, aswSpeed: 9.2 },
  awa: { aswDirFrom: 85, aswSpeed: 12.4, isValid: true },
  ws2TrackSpacingNm: 3,
  ws3TrackSpacingNm: null,
  ws8TrackSpacingNm: 2.5,
  pattern: { type: 'PS', orientation: '205', environment: 'water', worksheetSource: 'ws2' },
  worksheet1Fs: 1.1,
  assets: [{
    id: 'sru-1',
    name: 'HR-3604',
    type: 'helicopter',
    homeBaseName: 'Basis Cijulang',
    transitSpeedKts: 150,
    searchSpeedKts: 90,
    enduranceHours: 2.75,
    sweepWidthNm: 3,
  }],
});

const mkBank = (entries: Array<[key: string, label: string, value: string | null]>): DataBankField[] =>
  entries.map(([key, label, value]) => ({
    key,
    label,
    value,
    sourceType: value ? 'case' as const : 'unknown' as const,
    status: value ? 'READY' as const : 'PENDING' as const,
  }));

const BANK = mkBank([
  ['office', 'Kantor SAR', 'Kantor SAR Banten'],
  ['incidentLabel', 'Jenis kejadian', 'Kapal tenggelam'],
  ['eventTime', 'Waktu kejadian', '18 November 2026 13.50 WIB'],
  ['lkpCoord', 'LKP', '06°52\'S 105°15\'E'],
  ['targetName', 'Nama objek', 'KM Sinar Jaya'],
  ['callSign', 'Call sign', 'YD-2026'],
  ['route', 'Rute', 'Merak – Bakauheni'],
  ['cause', 'Penyebab', null], // PENDING — tidak boleh disimpulkan
  ['searchObject', 'Objek dicari', 'Life raft 6 orang'],
  ['crewCount', 'Crew', '4'],
  ['passengerCount', 'Penumpang', '20'],
  ['pobTotal', 'POB', '24'],
  ['pilotName', 'Nakhoda/Pilot', 'Nakhoda A. Rahman'],
  ['weather', 'Cuaca', 'Angin 100°/10 kts, gelombang 1 m'],
  ['cspCoord', 'CSP', '06°52.8\'S 105°16.5\'E'],
  ['commsPlan', 'Komunikasi', 'CH 16 / 2182 kHz'],
  ['smcName', 'SMC', 'SMC Banten'],
  ['oscName', 'OSC', 'OSC KM Patroli 1'],
  ['previousEfforts', 'Upaya sebelumnya', 'Stage 1-2 nihil'],
]);

// ── 1. buildDocumentSnapshot ─────────────────────────────────────────────────

describe('buildDocumentSnapshot', () => {
  test('bentuk sama dengan snapshot DocumentWorkbench (datum/searchArea/asw/awa/pattern/assets)', () => {
    const snap = SNAPSHOT;
    expect(snap.lkp).toEqual({ lat: -6.879, lng: 105.261 });
    expect(snap.datum?.datumLeft).toEqual({ lat: -6.85, lng: 105.2 });
    expect(snap.datum?.driftDistanceNm).toBe(18.2);
    expect(snap.datum?.totalDriftErrorNm).toBe(4.1);
    expect(snap.searchArea?.areaSqNm).toBe(268.96);
    expect(snap.searchArea?.podPercent).toBe(0.87);
    expect(snap.asw).toEqual({ dirFrom: 100, speedKts: 9.2 });
    expect(snap.awa).toEqual({ dirFrom: 85, speedKts: 12.4 });
    expect(snap.trackSpacing).toEqual({ ws2Nm: 3, ws3Nm: null, ws8Nm: 2.5 });
    expect(snap.pattern?.type).toBe('PS');
    expect(snap.assets?.[0]?.name).toBe('HR-3604');
    // LKP tidak diset → snapshot tidak mengarang posisi.
    const noLkp = buildDocumentSnapshot({ ...({} as never), ...(SNAPSHOT as object), lkp: { lat: 0, lng: 0 }, isLkpSet: false } as never);
    expect(noLkp.lkp).toBeNull();
  });
});

// ── 2. buildFillFormPlan atas dokumen asli ──────────────────────────────────

describe('buildFillFormPlan — BRIEFING', () => {
  const doc = buildDocument('BRIEFING', SNAPSHOT, BANK, 'sru-1');
  const plan = buildFillFormPlan(doc);

  test('worksheet briefing; field READY dipetakan ke key BriefingForm', () => {
    expect(plan.ok).toBe(true);
    expect(plan.worksheet).toBe('briefing');
    expect(plan.values['date']).toContain('November'); // tanggal hari ini (id-ID)
    expect(plan.values['sruName']).toContain('HR-3604');
    expect(plan.values['captainPilot']).toBe('Nakhoda A. Rahman');
    expect(plan.values['commsFreqs']).toBe('CH 16 / 2182 kHz');
    expect(plan.values['weatherData']).toContain('ASW 100°T/9.2 kts'); // dari snapshot worksheet
  });

  test('field PENDING TIDAK dipetakan (dengan alasan) — tidak mengarang', () => {
    const skippedKeys = plan.skipped.map((entry) => entry.docKey);
    // pobBrief: bank punya pobTotal READY → ikut; cek yang benar-benar PENDING:
    // freqBrief (distressFreq tidak ada di BANK).
    expect(plan.values['targetFrequencies']).toBeUndefined();
    expect(skippedKeys).toContain('freqBrief');
  });

  test('payload kompatibel SetFieldsApplied (keputusan no.5)', () => {
    const applied = fillFormPlanToSetFields(plan);
    expect(applied).not.toBeNull();
    expect(applied!.worksheet).toBe('briefing');
    expect(typeof applied!.values).toBe('object');
  });
});

describe('buildFillFormPlan — DEBRIEFING (data aktual)', () => {
  const doc = buildDocument('DEBRIEFING', SNAPSHOT, BANK, 'sru-1');
  const plan = buildFillFormPlan(doc);

  test('worksheet briefing (section de-briefing); nilai aktual tetap diisi manual', () => {
    expect(plan.worksheet).toBe('briefing');
    // Seluruh field debriefing ACTUAL_REQUIRED (tidak ada di bank) → TIDAK ADA
    // yang dipetakan dari rencana — agent tidak menyalin rencana sebagai fakta.
    expect(plan.values['pointOfDeparture']).toBeUndefined();
    expect(plan.values['depTime']).toBeUndefined();
    expect(plan.skipped.length).toBeGreaterThan(10);
    expect(plan.skipped.some((entry) => entry.reason.includes('AKTUAL'))).toBe(true);
  });

  test('field aktual yang sudah dilaporkan manual ikut (status READY)', () => {
    const bankWithActual: DataBankField[] = [
      ...BANK,
      { key: 'actualDeparturePoint', label: 'Titik keberangkatan aktual', value: 'Basis Cijulang', sourceType: 'actual_report', status: 'READY', plannedActual: 'actual' },
    ];
    const doc2 = buildDocument('DEBRIEFING', SNAPSHOT, bankWithActual, 'sru-1');
    const plan2 = buildFillFormPlan(doc2);
    expect(plan2.values['pointOfDeparture']).toBe('Basis Cijulang');
  });
});

describe('buildFillFormPlan — RENOPS_I', () => {
  const doc = buildDocument('RENOPS_I', SNAPSHOT, BANK);
  const plan = buildFillFormPlan(doc);

  test('worksheet renops; baris SITUASI fmt1_* dipetakan lewat LABEL', () => {
    expect(plan.worksheet).toBe('renops');
    expect(plan.values['targetName']).toBe('KM Sinar Jaya');
    expect(plan.values['callSign']).toBe('YD-2026');
    expect(plan.values['route']).toBe('Merak – Bakauheni');
    expect(plan.values['accidentTime']).toContain('13.50 WIB');
    expect(plan.values['pobCrew']).toBe('4');
    expect(plan.values['pobPassengers']).toBe('20');
    // Penyebab kecelakaan PENDING → tidak disimpulkan (aturan builder).
    expect(plan.values['cause']).toBeUndefined();
  });

  test('narasi B. TUGAS → taskMission; SRU dari alokasi aset; SMC/komunikasi', () => {
    expect(typeof plan.values['taskMission']).toBe('string');
    expect(plan.values['taskMission']).toContain('pencarian dan pertolongan');
    expect(plan.values['sruAir'] ?? plan.values['sruSea']).toContain('HR-3604');
    expect(plan.values['smcName']).toBe('SMC Banten');
    expect(plan.values['commsFreqs']).toBe('CH 16 / 2182 kHz');
  });

  test('koordinat area dari worksheet (bukan Bank Data) ikut terisi', () => {
    expect(plan.values['datumPos']).toContain('Datum Kiri');
    expect(plan.values['searchAreaSize']).toContain('NM²');
  });
});

// ── 3. analyzeDebrief ────────────────────────────────────────────────────────

describe('analyzeDebrief — kalkulator resmi', () => {
  test('POD tahap ini IDENTIK dengan computePOD(C, searchNumber)', () => {
    const result = analyzeDebrief({ searchNumber: 1, aoTotalNm2: 268.96, sweptAreaNm2: 134.48 });
    expect(result.ok).toBe(true);
    expect(result.cThis).toBe(0.5);
    const expectedPod = Math.round(computePOD(0.5, 1) * 1000) / 10;
    expect(result.podThisPercent).toBe(expectedPod);
    expect(result.remainingAreaNm2).toBe(134.48);
  });

  test('luas disapu dari jam × kecepatan × sweep width (konvensi Alokasi Aset)', () => {
    const result = analyzeDebrief({ searchNumber: 2, aoTotalNm2: 400, hoursSearched: 2, searchSpeedKts: 90, sweepWidthNm: 3 });
    expect(result.ok).toBe(true);
    expect(result.sweptAreaNm2).toBe(540);
    expect(result.cThis).toBe(1.35);
    expect(result.warnings.some((w) => w.includes('jam × kecepatan × sweep width'))).toBe(true);
  });

  test('coverage kumulatif + POD kumulatif dari kurva resmi', () => {
    const result = analyzeDebrief({ searchNumber: 2, aoTotalNm2: 400, sweptAreaNm2: 200, previousCoverageC: 0.5 });
    expect(result.ok).toBe(true);
    expect(result.cCumulative).toBe(1);
    const expectedCum = Math.round(computePOD(1, 2) * 1000) / 10;
    expect(result.podCumulativePercent).toBe(expectedCum);
    expect(result.remainingAreaNm2).toBe(0);
    expect(result.recommendation.some((r) => r.includes('kumulatif'))).toBe(true);
  });

  test('tanpa previousCoverageC → POD kumulatif TIDAK diasumsikan', () => {
    const result = analyzeDebrief({ searchNumber: 3, aoTotalNm2: 400, sweptAreaNm2: 200 });
    expect(result.cCumulative).toBeNull();
    expect(result.podCumulativePercent).toBeNull();
    expect(result.warnings.some((w) => w.includes('tidak dihitung'))).toBe(true);
  });

  test('Ao tidak sah / luas disapu tidak ada → error jelas, tanpa melempar', () => {
    const badAo = analyzeDebrief({ searchNumber: 1, aoTotalNm2: 0, sweptAreaNm2: 10 });
    expect(badAo.ok).toBe(false);
    expect(badAo.error).toContain('Ao');
    const noSwept = analyzeDebrief({ searchNumber: 1, aoTotalNm2: 400, hoursSearched: 2 });
    expect(noSwept.ok).toBe(false);
    expect(noSwept.error).toContain('Luas disapu');
  });
});

// ── 4. executeServerTool — fill_form & analyze_debrief ──────────────────────

describe('executeServerTool — Fase 4', () => {
  test('fill_form BRIEFING → compact JSON + fillPlan (angka dari snapshot)', () => {
    const result = executeServerTool('fill_form', { docType: 'BRIEFING' }, { documentSnapshot: SNAPSHOT, bankFields: BANK });
    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.json) as { docType: string; fillPlan: { worksheet: string; values: Record<string, string> }; note: string };
    expect(payload.docType).toBe('BRIEFING');
    expect(payload.fillPlan.worksheet).toBe('briefing');
    expect(payload.fillPlan.values['sruName']).toContain('HR-3604');
    expect(payload.note).toContain('DRAFT');
  });

  test('fill_form docType tidak dikenal → error, tanpa melempar', () => {
    const result = executeServerTool('fill_form', { docType: 'SURAT_CINTA' }, {});
    expect(result.ok).toBe(false);
  });

  test('analyze_debrief via tool: hasil sama dengan lib langsung', () => {
    const result = executeServerTool('analyze_debrief', { searchNumber: 1, aoTotalNm2: 268.96, sweptAreaNm2: 134.48 }, {});
    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.json) as { cThis: number | null; podThisPercent: number | null };
    expect(payload.cThis).toBe(0.5);
    expect(payload.podThisPercent).toBe(analyzeDebrief({ searchNumber: 1, aoTotalNm2: 268.96, sweptAreaNm2: 134.48 }).podThisPercent);
  });
});
