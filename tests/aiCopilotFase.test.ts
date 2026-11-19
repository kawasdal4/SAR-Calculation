/**
 * REGRESI FASE A–H (AI SAR Copilot):
 * - Fase A: builder interaction request (type:'function' + normalisasi schema
 *   + validator), ekstraksi JSON tahan respons non-JSON.
 * - Fase B: klasifikasi 8 status field (fieldStatus).
 * - Fase C: normalisasi PK-TAL golden (glideRatio "6:1" → 6 + raw, koordinat,
 *   7 lapisan angin, 6 angin permukaan, arus 250°/0.3, 3 SRU per kolom).
 * - Fase D: dependency graph (urutan menghormati capabilityRegistry).
 * - E: pilihan referensi Appendix/Table (leeway) dari registry resmi.
 * Jalankan: bun test tests/aiCopilotFase.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  buildInteractionRequest,
  normalizeJsonSchemaTypes,
  validateInteractionTools,
} from '../src/lib/ai/geminiClient';
import {
  extractJsonCandidate,
  normalizeCaseJson,
  parseGlideRatio,
  buildCaseExtractionResult,
  deriveExtractionFieldRows,
} from '../src/lib/ai/parseCase';
import { classifyFieldStatus, classifyCaseFields, type ReferenceSelection } from '../src/lib/sar/fieldStatus';
import { dependencyRespectingOrder, producerWorksheetOfField, describeDependencyGraph } from '../src/lib/sar/worksheetDependency';
import { buildReferenceChoice, REFERENCE_CHOICE_FIELDS } from '../src/lib/ai/tools/referenceChoice';
import { executeServerTool } from '../src/lib/ai/tools/serverTools';
import { LEEWAY_OBJECT_TYPES } from '../src/lib/sar/sarCalculations';

// ── Fase A: builder + validator + JSON guard ────────────────────────────────

describe('Fase A — buildInteractionRequest (tools)', () => {
  const APP_TOOLS = Array.from({ length: 17 }, (_, index) => ({
    name: index === 15 ? 'set_lkp' : `tool_${index}`,
    description: `Tool uji index ${index}.`,
    parameters: { type: 'OBJECT', properties: { lat: { type: 'NUMBER' } }, required: ['lat'] },
    // TANPA type — builder wajib menambahkan type:'function'.
  }));

  it('tools[15] membawa type:"function" di payload final (akar error tools[15])', () => {
    const payload = buildInteractionRequest({
      model: 'gemini-3.8-flash',
      input: [{ type: 'text', text: 'uji' }],
      tools: APP_TOOLS,
      timeoutMs: 10,
    });
    const tools = payload['tools'] as Array<Record<string, unknown>>;
    expect(tools[15]['name']).toBe('set_lkp');
    expect(tools[15]['type']).toBe('function');
    for (const tool of tools) expect(tool['type']).toBe('function');
  });

  it('schema parameter UPPERCASE (SchemaType) dinormalisasi ke JSON Schema lowercase', () => {
    const normalized = normalizeJsonSchemaTypes({
      type: 'OBJECT',
      properties: { lat: { type: 'NUMBER' }, layers: { type: 'ARRAY', items: { type: 'STRING' } } },
    }) as Record<string, unknown>;
    expect(normalized['type']).toBe('object');
    const props = normalized['properties'] as Record<string, Record<string, unknown>>;
    expect(props['lat']['type']).toBe('number');
    expect((props['layers']['items'] as Record<string, unknown>)['type']).toBe('string');
  });

  it('validator menolak tool tanpa description / nama tak valid / enum kosong dengan pesan bernomor index', () => {
    const issues = validateInteractionTools([
      { name: 'bad name!', description: '', parameters: { type: 'object', properties: { x: { type: 'string', enum: [] } } } },
    ]);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues[0].index).toBe(0);
  });

  it('builder melempar Error jelas (tolak dini) untuk deklarasi cacat', () => {
    expect(() => buildInteractionRequest({
      model: 'm',
      input: 'x',
      tools: [{ name: 'dup', description: 'a', parameters: {} }, { name: 'dup', description: 'b', parameters: {} }],
      timeoutMs: 10,
    })).toThrow(/duplikat|tidak valid/i);
  });

  it('response_format tetap TOP-LEVEL dan tidak masuk generation_config', () => {
    const payload = buildInteractionRequest({
      model: 'm',
      input: 'x',
      responseFormat: { type: 'text', mime_type: 'application/json', schema: { type: 'object' } },
      generationConfig: { temperature: 0.1, response_format: { type: 'text' } } as Record<string, unknown>,
      timeoutMs: 10,
    });
    expect(payload['response_format']).toBeDefined();
    const gc = payload['generation_config'] as Record<string, unknown>;
    expect(gc['response_format']).toBeUndefined();
  });
});

describe('Fase A — ekstraksi JSON tahan respons error', () => {
  it('respons non-JSON (HTML/plaintext "An error occurred…") → error terkategori, TIDAK melempar', () => {
    for (const text of [
      '<!DOCTYPE html><html>An error occurred in the Server Components render…</html>',
      'An error occurred with the current request.',
      '',
    ]) {
      const result = extractJsonCandidate(text);
      expect(result.ok).toBe(false);
      expect(result.error).toBeString();
    }
  });

  it('JSON di dalam fence markdown tetap terbaca', () => {
    const result = extractJsonCandidate('```json\n{"incident":{"type":"aircraft-ditching"}}\n```');
    expect(result.ok).toBe(true);
  });
});

// ── Fase C: normalisasi PK-TAL ──────────────────────────────────────────────

describe('Fase C — normalisasi PK-TAL', () => {
  it('parseGlideRatio: "6:1" → 6; "1.5:1" → 1.5; 6 → 6; "3,5:1" → 3.5', () => {
    expect(parseGlideRatio('6:1')).toBe(6);
    expect(parseGlideRatio('1.5:1')).toBeCloseTo(1.5);
    expect(parseGlideRatio(6)).toBe(6);
    expect(parseGlideRatio('3,5:1')).toBeCloseTo(3.5);
    expect(parseGlideRatio('abc')).toBeNull();
  });

  it('normalizeCaseJson: glideRatio string + koordinat DMS string + Surface tanpa altitudeFt', () => {
    const normalized = normalizeCaseJson({
      aeroDrift: { glideRatio: '6:1', windLayers: [{ altitudeLabel: 'Surface', windDirFrom: 45, windSpeedKts: 5 }] },
      lkp: { coord: { lat: "06°52'46\"S", lng: "105°15'41\"E" } },
    }) as Record<string, any>;
    expect(normalized.aeroDrift.glideRatio).toBe(6);
    expect(normalized.aeroDrift.glideRatioRaw).toBe('6:1');
    expect(normalized.lkp.coord.lat).toBeCloseTo(-6.8794, 3);
    expect(normalized.lkp.coord.lng).toBeCloseTo(105.2614, 3);
    expect(normalized.aeroDrift.windLayers[0].altitudeFt).toBe(0);
  });
});

// ── Golden fixture PK-TAL (mini — data inti sesuai PDF final test) ──────────

const PKTAL_GOLDEN = {
  schemaVersion: 1,
  caseTitle: 'PK-TAL ditching',
  incident: {
    type: 'aircraft-ditching',
    callsign: 'PK-TAL',
    craftType: 'Aero Commander 500',
    pob: 3,
    reportTime: '18 November 2026 14.10 WIB',
    lastContactTime: '18 November 2026 13.50 WIB',
    flightLevelFt: 100,
    headingDeg: 90,
    headingReference: 'magnetic',
  },
  target: { category: 'aircraft', name: 'PK-TAL', wingspanM: 14.25, lengthM: 10.89 },
  lkp: { coord: { lat: -6.879444, lng: 105.261389, dmsLat: "06°52'46\"S", dmsLng: "105°15'41\"E" }, source: 'explicit' },
  aeroDrift: {
    glideSpeedKts: 121,
    glideRatio: '6:1',
    glideRatioRaw: '6:1',
    variationDeg: 1,
    variationDirection: 'E',
    windLayers: [
      { altitudeFt: 0, altitudeLabel: 'Surface', windDirFrom: 45, windSpeedKts: 5 },
      { altitudeFt: 3000, altitudeLabel: '3000 ft', windDirFrom: 55, windSpeedKts: 10 },
      { altitudeFt: 6000, altitudeLabel: '6000 ft', windDirFrom: 65, windSpeedKts: 15 },
      { altitudeFt: 9000, altitudeLabel: '9000 ft', windDirFrom: 75, windSpeedKts: 20 },
      { altitudeFt: 12000, altitudeLabel: '12000 ft', windDirFrom: 85, windSpeedKts: 15 },
      { altitudeFt: 18000, altitudeLabel: '18000 ft', windDirFrom: 95, windSpeedKts: 10 },
      { altitudeFt: 24000, altitudeLabel: '24000 ft', windDirFrom: 105, windSpeedKts: 20 },
    ],
  },
  sea: {
    current: { dirToDeg: 250, speedKts: 0.3 },
    surfaceWindSeries: [
      { obsTime: '18 November 2026 09.00 WIB', windDirFrom: 50, windSpeedKts: 8 },
      { obsTime: '18 November 2026 12.00 WIB', windDirFrom: 55, windSpeedKts: 10 },
      { obsTime: '18 November 2026 15.00 WIB', windDirFrom: 60, windSpeedKts: 12 },
      { obsTime: '18 November 2026 18.00 WIB', windDirFrom: 65, windSpeedKts: 14 },
      { obsTime: '18 November 2026 21.00 WIB', windDirFrom: 70, windSpeedKts: 12 },
      { obsTime: '19 November 2026 00.00 WIB', windDirFrom: 75, windSpeedKts: 10 },
    ],
  },
  search: { datumTime: '19 November 2026 07.00 WIB' },
  sru: [
    { callsign: 'HR-3604', kind: 'helicopter', model: 'Eurocopter AS-365 N3+', coord: { lat: -6.1, lng: 106.6 }, enduranceHours: 2, enduranceMinutes: 45, tasMaxKts: 150, tasSearchKts: 90, visibilityKm: 10, windDirFrom: 55, windSpeedKts: 20, observerCondition: 'fresh', taf: 'Inter', frequencies: ['123.1'], captain: 'Joko', navigation: ['GPS'] },
    { callsign: 'PK-ELS', kind: 'helicopter', model: 'Bell 505 Jet Ranger X', coord: { lat: -6.2, lng: 106.7 }, enduranceHours: 2, enduranceMinutes: 30, tasMaxKts: 120, tasSearchKts: 90, visibilityKm: 10, windDirFrom: 55, windSpeedKts: 20, observerCondition: 'fresh', taf: 'Inter', frequencies: ['123.1'], captain: 'Agus', navigation: ['GPS'] },
    { callsign: 'KN SAR Drupada', kind: 'vessel', model: 'Rescue Boat 40 meter', coord: { lat: -5.9, lng: 106.4 }, enduranceHours: 50, tasMaxKts: 20, tasSearchKts: 15, visibilityKm: 20, windDirFrom: 55, windSpeedKts: 20, observerCondition: 'fresh', frequencies: ['Ch.16', '123.1'], captain: 'Budi', navigation: ['GPS'] },
  ],
  meta: { source: 'pdf', fieldSources: [], assumptions: [], missingFields: [] },
};

describe('Fase C — golden fixture PK-TAL (ekstraksi → klasifikasi)', () => {
  const extraction = buildCaseExtractionResult(PKTAL_GOLDEN);
  const caseData = extraction.ok ? extraction.case : null;
  const rows = extraction.ok ? extraction.fieldRows : [];

  it('ekstraksi valid (Zod) tanpa dikarang', () => {
    expect(extraction.ok).toBe(true);
  });

  it('glideRatio 6 (EXTRACTED dari "6:1") + raw value disimpan', () => {
    expect(caseData?.aeroDrift?.glideRatio).toBe(6);
    expect(caseData?.aeroDrift?.glideRatioRaw).toBe('6:1');
    const row = rows.find((row) => row.field === 'aeroDrift.glideRatio');
    expect(row?.statusClass).toBe('EXTRACTED');
    expect(row?.meta?.rawValue ?? caseData?.aeroDrift?.glideRatioRaw).toContain('6:1');
  });

  it('glideSpeed 121, variation 1°E, 7 lapisan angin, 6 angin permukaan, arus 250°/0.3', () => {
    expect(caseData?.aeroDrift?.glideSpeedKts).toBe(121);
    expect(caseData?.aeroDrift?.variationDeg).toBe(1);
    expect(caseData?.aeroDrift?.variationDirection).toBe('E');
    expect(caseData?.aeroDrift?.windLayers?.length).toBe(7);
    expect(caseData?.sea?.surfaceWindSeries?.length).toBe(6);
    expect(caseData?.sea?.current?.dirToDeg).toBe(250);
    expect(caseData?.sea?.current?.speedKts).toBe(0.3);
  });

  it('3 SRU terekstrak per kolom dengan data inti masing-masing', () => {
    expect(caseData?.sru?.length).toBe(3);
    const byCallsign = new Map((caseData?.sru ?? []).map((sru) => [sru.callsign, sru]));
    const sru1 = byCallsign.get('HR-3604');
    const sru2 = byCallsign.get('PK-ELS');
    const sru3 = byCallsign.get('KN SAR Drupada');
    expect(sru1?.tasMaxKts).toBe(150);
    expect(sru1?.tasSearchKts).toBe(90);
    expect(sru1?.captain).toBe('Joko');
    expect(sru2?.tasMaxKts).toBe(120);
    expect(sru2?.enduranceHours).toBe(2);
    expect(sru2?.enduranceMinutes).toBe(30);
    expect(sru2?.captain).toBe('Agus');
    expect(sru3?.tasMaxKts).toBe(20);
    expect(sru3?.tasSearchKts).toBe(15);
    expect(sru3?.captain).toBe('Budi');
    expect(sru3?.frequencies).toEqual(['Ch.16', '123.1']);
  });

  it('klasifikasi: waveHeightM/leeway TIDAK MISSING; datum.latitude DERIVED; default = DEFAULTED', () => {
    expect(extraction.ok).toBe(true);
    if (!extraction.ok) return;
    const byField = new Map(rows.map((row) => [row.field, row]));
    // Field hilir tidak boleh MISSING (C.6, C.5):
    expect(byField.get('sea.waveHeightM')?.statusClass).not.toBe('MISSING');
    expect(byField.get('datum.leewayObjectId')?.statusClass).not.toBe('MISSING');
    // datum.latitude = |lat| LKP → DERIVED (C.4):
    const datumLat = byField.get('datum.latitude');
    expect(datumLat?.statusClass).toBe('DERIVED');
    // Default aplikasi → DEFAULTED (C.7):
    expect(byField.get('datum.X/Y')?.statusClass).toBe('DEFAULTED');
    expect(byField.get('ws2.selectedHeight')?.statusClass).toBe('DEFAULTED');
    expect(byField.get('ws2/ws8.isFatigue')?.statusClass).toBe('DEFAULTED');
    // Tidak ada field hasil worksheet yang diklaim MISSING (H.2):
    const missingRows = rows.filter((row) => row.statusClass === 'MISSING');
    for (const row of missingRows) {
      expect(['sea.waveHeightM', 'datum.leewayObjectId', 'aeroDrift.glideRatio']).not.toContain(row.field);
    }
  });
});

// ── Fase B: klasifikasi unit ────────────────────────────────────────────────

describe('Fase B — classifyFieldStatus', () => {
  it('PENDING_DEPENDENCY untuk field output worksheet (belum dihitung)', () => {
    const result = classifyFieldStatus('aero.awaGlideDirFrom', false, false);
    expect(result.status).toBe('PENDING_DEPENDENCY');
    expect(result.meta.worksheetProducer).toBe('env-awa');
  });

  it('PLANNER_INPUT → AI_RECOMMENDED_PENDING_CONFIRMATION → REFERENCE untuk leeway', () => {
    const planner = classifyFieldStatus('datum.leewayObjectId', false, false);
    expect(planner.status).toBe('PLANNER_INPUT');
    const recommended = classifyFieldStatus('datum.leewayObjectId', false, false, {
      aiRecommendations: { 'datum.leewayObjectId': { referenceId: 'raft-canopy-drogue', label: 'Rakit 4-6 orang dengan kanopi & drogue', reason: 'cocok' } },
    });
    expect(recommended.status).toBe('AI_RECOMMENDED_PENDING_CONFIRMATION');
    const selection: Record<string, ReferenceSelection> = {
      'datum.leewayObjectId': { referenceId: 'raft-canopy-drogue', sourceTable: 'I-1/I-2', fromAiRecommendation: true, confirmed: true },
    };
    const confirmed = classifyFieldStatus('datum.leewayObjectId', false, false, { referenceSelections: selection });
    expect(confirmed.status).toBe('REFERENCE');
  });

  it('MISSING hanya bila wajib & tanpa nilai', () => {
    expect(classifyFieldStatus('incident.pob', false, true).status).toBe('MISSING');
    expect(classifyFieldStatus('incident.pob', true, true).status).not.toBe('MISSING');
    expect(classifyFieldStatus('incident.pob', false, false).status).not.toBe('MISSING');
  });
});

// ── Fase D: dependency graph ────────────────────────────────────────────────

describe('Fase D — dependency graph', () => {
  it('urutan topologi menghormati dependencies capabilityRegistry', () => {
    const order = dependencyRespectingOrder();
    expect(order.length).toBeGreaterThan(0);
    const indexOf = new Map(order.map((id, position) => [id, position]));
    // env-awa harus sebelum env-adw; env-asw sebelum ws1-datum.
    expect(indexOf.get('env-awa')!).toBeLessThan(indexOf.get('env-adw')!);
    expect(indexOf.get('env-asw')!).toBeLessThan(indexOf.get('ws1-datum')!);
    expect(indexOf.get('ws1-datum')!).toBeLessThan(indexOf.get('ws1-search-area')!);
  });

  it('producerWorksheetOfField memetakan field output ke worksheet penghasil', () => {
    expect(producerWorksheetOfField('aero.awaGlideDirFrom')?.worksheetId).toBe('env-awa');
    expect(producerWorksheetOfField('datum.driftInterval')?.worksheetId).toBe('env-asw');
    expect(producerWorksheetOfField('incident.pob')).toBeNull();
  });

  it('describeDependencyGraph menyebut aturan PENDING_DEPENDENCY (anti permintaan input ganda)', () => {
    const text = describeDependencyGraph();
    expect(text).toContain('PENDING_DEPENDENCY');
    expect(text).toContain('hours of drift = total hours ASW');
  });
});

// ── Fase E: pilihan referensi Appendix/Table ────────────────────────────────

describe('Fase E — reference choice (leeway)', () => {
  it('rekomendasi dari registry resmi + alternatif semua id LEEWAY_OBJECT_TYPES', () => {
    const choice = buildReferenceChoice('datum.leewayObjectId', 'Pesawat Aero Commander ditching; rakit 6 orang dengan kanopi dan drogue mengapung');
    expect(choice).not.toBeNull();
    expect(choice!.fieldPath).toBe('datum.leewayObjectId');
    expect(choice!.status).toBe('AI_RECOMMENDED_AUTO_APPLIED');
    expect(choice!.recommendation).not.toBeNull();
    const validIds = new Set(LEEWAY_OBJECT_TYPES.map((entry) => entry.id));
    expect(validIds.has(choice!.recommendation!.referenceId)).toBe(true);
    expect(choice!.alternatives.length).toBe(LEEWAY_OBJECT_TYPES.length);
    for (const alt of choice!.alternatives) expect(validIds.has(alt.id)).toBe(true);
    expect(choice!.sourceTable.refId).toBe('I-1/I-2');
  });

  it('AI yakin (skor kata kunci kuat) → autoApply true (langsung terapkan ke worksheet)', () => {
    const choice = buildReferenceChoice('datum.leewayObjectId', 'raft 25 person with canopy and drogue');
    expect(choice!.recommendation).not.toBeNull();
    expect(choice!.recommendation!.confident).toBe(true);
    expect(choice!.autoApply).toBe(true);
  });

  it('dasar rekomendasi lemah (satu kata pendek) → konfirmasi planner dulu (autoApply false)', () => {
    const choice = buildReferenceChoice('datum.leewayObjectId', 'objek piw');
    if (choice!.recommendation) {
      // 'piw' pendek → skor < 6 → tidak yakin → menunggu planner.
      expect(choice!.recommendation.confident).toBe(false);
      expect(choice!.autoApply).toBe(false);
      expect(choice!.status).toBe('AI_RECOMMENDED_PENDING_CONFIRMATION');
    } else {
      expect(choice!.needsUserDecision).toBe(true);
    }
  });

  it('konteks kosong → tanpa rekomendasi, planner memutuskan (needsUserDecision)', () => {
    const choice = buildReferenceChoice('datum.leewayObjectId', '');
    expect(choice).not.toBeNull();
    expect(choice!.recommendation).toBeNull();
    expect(choice!.needsUserDecision).toBe(true);
    expect(choice!.status).toBe('PLANNER_INPUT');
    expect(choice!.autoApply).toBe(false);
  });

  it('field tidak terdaftar → null (tidak mengarang pilihan)', () => {
    expect(buildReferenceChoice('datum.foobar', 'apa pun')).toBeNull();
    expect(Object.keys(REFERENCE_CHOICE_FIELDS)).toContain('datum.leewayObjectId');
  });

  it('executeServerTool(request_reference_choice) → json untuk model + payload kartu untuk UI (auto-apply)', () => {
    const result = executeServerTool('request_reference_choice', { fieldPath: 'datum.leewayObjectId', contextDescription: 'raft 25 person canopy drogue' }, {});
    expect(result.ok).toBe(true);
    expect(result.referenceChoice).toBeDefined();
    const parsed = JSON.parse(result.json) as Record<string, unknown>;
    expect(parsed['autoApply']).toBe(true);
    expect(String(parsed['instruction'])).toContain('autoApply true');
  });
});
