/**
 * TOOL SERVER-SIDE (Fase 2 AI Copilot) — `get_state`, `run_worksheet`,
 * `run_pipeline`, `validate_plan` (baca/hitung) di samping `lookup_table`.
 *
 * PRINSIP (spesifikasi + keputusan no. 5 & 6):
 * - Semua angka keluar dari fungsi resmi aplikasi (casePipeline/reference
 *   tables) — LLM TIDAK PERNAH menghitung angka SAR.
 * - Tool ini HANYA MEMBACA state snapshot yang dikirim client; mengubah state
 *   tetap lewat tool set_*_case/set_fields + kontrak pratinjau/konfirmasi.
 * - Hasil = JSON RINGKAS (angka kunci, tanpa array waypoint besar).
 * - Nilai referensi UNVERIFIED/MISSING selalu disertai statusnya.
 */

import { runCasePipeline, type CasePipelineOutput } from '../../sar/casePipeline';
import { parseSarCase, type SarCaseSchema } from '../../sar/caseSchema';
import { checkCaseCompleteness } from '../../sar/caseAdapter';
import { stateToCase } from '../../sar/stateToCase';
import { validatePlanSnapshot } from '../../sar/validatePlan';
import { executeLookupTable } from './lookupTable';
import { buildDocument, pickRenopsType, type DataBankField, type DocType, type DocumentSnapshot } from '../../sar/dataBank';
import { buildFillFormPlan, compactFillFormResult } from '../../sar/fillForm';
import { analyzeDebrief, type DebriefSortieInput } from '../../sar/debriefAnalysis';
import { buildReferenceChoice, referenceChoiceForModel, REFERENCE_CHOICE_FIELDS, type ReferenceChoicePayload } from './referenceChoice';

export const SERVER_EXECUTABLE_TOOL_NAMES = [
  'get_state',
  'lookup_table',
  'run_worksheet',
  'run_pipeline',
  'validate_plan',
  'fill_form',
  'analyze_debrief',
  'request_reference_choice',
] as const;

/** Ctx eksekusi: snapshot state worksheet dari body POST /api/chat. */
export interface ServerToolContext {
  /** buildState().state dari page.tsx (bila client mengirim). */
  state?: Record<string, unknown>;
  /** Fase 4: snapshot dokumen (bentuk buildDocumentSnapshot) untuk fill_form. */
  documentSnapshot?: DocumentSnapshot;
  /** Fase 4: field Bank Data (opsional) — melengkapi field yang tidak ada di worksheet. */
  bankFields?: DataBankField[];
}

export interface ServerToolResult {
  ok: boolean;
  summary: string;
  json: string;
  /** Fase E: payload kartu pilihan interaktif (bukan untuk model — untuk UI). */
  referenceChoice?: ReferenceChoicePayload;
}

// ── Deklarasi tool (subset OpenAPI; route menormalisasi tipe ke lowercase) ──

export const SERVER_TOOL_DECLARATIONS: Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> = [
  {
    name: 'request_reference_choice',
    description: 'Minta PEMILIHAN INTERAKTIF parameter yang membutuhkan keputusan dari Appendix/Table resmi (mis. kategori objek leeway Tabel I-1/I-2 untuk Datum WS 1). Tool ini MENYUSUN kartu pilihan interaktif di kolom chat: rekomendasi AI (bila karakteristik objek cukup dari konteks) + seluruh alternatif resmi dari registry. Bila AI CUKUP YAKIN (skor kata kunci kuat) kartu LANGSUNG MENERAPKAN rekomendasi ke worksheet (autoApply true — planner tetap bisa mengganti lewat kartu/Undo); bila tidak, kartu menunggu keputusan planner. DILARANG mengarang pilihan di luar hasil tool ini; bila autoApply true JANGAN memanggil set_fields untuk field tersebut.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fieldPath: { type: 'STRING', description: 'Path field tujuan, mis. datum.leewayObjectId (lihat registry — saat ini: datum.leewayObjectId)' },
        contextDescription: { type: 'STRING', description: 'Deskripsi objek/konteks dari soal untuk rekomendasi (mis. jenis objek dicari, kapal, pesawat)' },
      },
      required: ['fieldPath'],
    },
  },
  {
    name: 'get_state',
    description: 'Lihat kondisi TERKINI seluruh worksheet aplikasi saat pesan ini dikirim: field yang sudah terisi per worksheet (ASW, AWA, ADW, Datum, lembar WS 2/WS 8 per SRU, aset, pola), kelengkapan data wajib, dan catatan asumsi. Gunakan SEBELUM menyarankan pengisian untuk mengetahui data apa yang sudah ada dan apa yang masih kurang. Hasil berdasarkan state yang dikonfirmasi pengguna; tool set_* yang belum dikonfirmasi TIDAK ikut di sini.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: [],
    },
  },
  {
    name: 'lookup_table',
    description: 'Cari nilai TABEL REFERENSI resmi yang terdigitisasi: kategori leeway Tabel I-1/I-2, Wu udara I-5/I-6, Wu laut I-3/I-4, koreksi cuaca Fw I-7, koreksi kecepatan Fs I-8, fs pencarian, Wu darat I-9, Fv vegetasi I-10, galat navigasi J-1/J-2/J-3, ROD parasut N-13, drift parasut N-14, kurva POD Figure I-12, arus angin Fig I-1. WAJIB dipakai untuk nilai tabel — DILARANG mengarang nilai appendix. Jawaban menyertakan status VERIFIED/UNVERIFIED/MISSING; nilai UNVERIFIED/MISSING tidak boleh dinyatakan resmi/final. Tanpa argumen table → daftar tabel yang tersedia.',
    parameters: {
      type: 'OBJECT',
      properties: {
        table: { type: 'STRING', description: 'Id tabel: leeway | wu-air | wu-sea | fw-weather | fs-speed | fs-search | land-wu | land-fv | nav-error | n13-parachute | n14-drift | pod-curve | wind-current-fig-i1 | sweep-width-n4-n8' },
        q: { type: 'STRING', description: 'Kata kunci pencarian (leeway/nav-error): mis. "raft canopy drogue", "piw", "gps"' },
        platform: { type: 'STRING', description: 'fixed-wing | helicopter (wu-air/fs-speed)' },
        target: { type: 'STRING', description: 'Id objek pencarian (mis. raft6, piw, ship27, person)' },
        altitudeFt: { type: 'NUMBER', description: 'Ketinggian lembar WS 2: 500|1000|1500|2000 (wu-air/land-wu)' },
        visibilityColumn: { type: 'NUMBER', description: 'Indeks kolom visibility 0..5 (wu-air)' },
        eye: { type: 'STRING', description: '"8"|"14"|"MERSHIP" (wu-sea)' },
        visibility: { type: 'STRING', description: 'Label visibility (wu-sea): 2|5|10|15|20|>25' },
        visibilityKm: { type: 'NUMBER', description: 'Visibility km (land-wu): 5|10|20|30|40' },
        windKts: { type: 'NUMBER', description: 'Kecepatan angin (kts) — fw-weather/wind-current-fig-i1' },
        waveHeightM: { type: 'NUMBER', description: 'Tinggi gelombang (m) — fw-weather' },
        group: { type: 'STRING', description: 'Grup fw I-7: small (PIW/raft/boat <10 m) | other' },
        tas: { type: 'NUMBER', description: 'TAS pencarian (kts) — fs-speed' },
        searchNumber: { type: 'NUMBER', description: 'Nomor pencarian 1..5 (fs-search/pod-curve)' },
        heightFt: { type: 'NUMBER', description: 'Ketinggian darat (land-wu): 500|1000|1500|2000' },
        vegetation: { type: 'STRING', description: 'Vegetasi (land-fv): under-15|15-60|60-85|over-85' },
        table2: { type: 'STRING', description: 'Sub-tabel galat navigasi (nav-error): J-1|J-2|J-3' },
        id: { type: 'STRING', description: 'Id baris (n13-parachute: mis. c9-escape)' },
        openingAltFt: { type: 'NUMBER', description: 'Ketinggian buka parasut (ft) — n13-parachute/n14-drift' },
        coverage: { type: 'NUMBER', description: 'Coverage factor C — pod-curve' },
      },
      required: ['table'],
    },
  },
  {
    name: 'run_worksheet',
    description: 'Jalankan SATU worksheet dengan fungsi perhitungan RESMI aplikasi atas state terkonfirmasi (laut/udara: ASW, AWA, ADW, Datum WS 1 + luas area, WS 2 per lembar SRU udara, WS 8 per lembar SRU laut, search-pattern, assets/alokasi). Gunakan untuk menghitung/verifikasi angka — JANGAN menghitung sendiri di jawaban. Worksheet darat (WS 3/WS 4) dan Intercept belum didukung pipeline — jelaskan bahwa penghitungannya dilakukan worksheet aplikasi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        worksheet: { type: 'STRING', description: 'asw | awa | aero (ADW) | datum (WS 1 + area) | ws2 | ws8 | pattern | assets' },
      },
      required: ['worksheet'],
    },
  },
  {
    name: 'run_pipeline',
    description: 'Jalankan SELURUH rantai perhitungan resmi aplikasi atas state terkonfirmasi: ASW → AWA → Aeronautical Drift → Datum WS 1 (E, R, Ao) → WS 2/WS 8 (W, S, C, POD) → Search Pattern/CSP → Alokasi Aset. Setiap langkah berstatus ok/skipped/error dengan alasan. Gunakan untuk menjawab "hitung semuanya", memeriksa kelangsungan rantai, atau memverifikasi hasil sebelum diterapkan. Angka hasil = engine resmi; sampaikan apa adanya beserta peringatan/asumsi pipeline.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: [],
    },
  },
  {
    name: 'validate_plan',
    description: 'Periksa konsistensi data kasus saat ini SEBELUM menyarankan pengisian/penghitungan: koordinat valid (S/W negatif), sudut 0–360°, konvensi arah (angin DARI, arus KE), rentang satuan wajar (kecepatan, arus, ketinggian, gelombang, endurance), waktu distress/datum berpasangan, kategori leeway terdaftar, kategori worksheet terisi lengkap. Hasil: daftar issue error/warning/info. Perbaiki (set_*) yang error, konfirmasikan warning ke pengguna.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: [],
    },
  },
  {
    name: 'fill_form',
    description: 'Susun DRAF dokumen resmi Perban 3/2020 (RENOPS Format I/II, Briefing, atau De-Briefing) dari worksheet/peta/Bank Data dengan generator DETERMINISTIK aplikasi — SEMUA angka dari state, bukan dari Anda. Gunakan untuk mengisi form Briefing/Renops atau menyusun draf dokumen. Hasil memuat: ringkasan section (READY/PENDING/ACTUAL_REQUIRED), daftar pertanyaan data yang hilang, dan fillPlan (pasangan field form → nilai READY) yang diterapkan lewat set_fields (briefing/renops) SETELAH konfirmasi pengguna. Pilih docType: RENOPS_I (kecelakaan kapal/pesawat), RENOPS_II (bencana/KKM), BRIEFING, DEBRIEFING. Dokumen resmi tetap DRAFT sampai disetujui SMC/pejabat berwenang — JANGAN menyatakan dokumen final.',
    parameters: {
      type: 'OBJECT',
      properties: {
        docType: { type: 'STRING', description: 'RENOPS_I | RENOPS_II | BRIEFING | DEBRIEFING' },
        selectedAssetId: { type: 'STRING', description: 'Id aset SRU pilihan (opsional, untuk Briefing/De-Briefing per SRU); tanpa ini aset pertama dipakai' },
      },
      required: ['docType'],
    },
  },
  {
    name: 'analyze_debrief',
    description: 'Analisis HASIL SORTIE de-briefing dengan kalkulator resmi: coverage (C) = luas disapu / Ao, POD tahap ini dan POD kumulatif dari kurva POD resmi (Figure I-12, parameter searchNumber), sisa area belum disapu, plus usulan tahap berikutnya. SEMUA angka input WAJIB dari pengguna/laporan sortie (luas disapu ATAU jam×kecepatan×sweep width) dan Ao dari Worksheet 1 — DILARANG mengarang angka. Jangan sebut POS (probability of containment tidak dihitung sistem).',
    parameters: {
      type: 'OBJECT',
      properties: {
        searchNumber: { type: 'NUMBER', description: 'Urutan pencarian sortie ini: 1 = pencarian pertama, 2 = kedua, dst. (1..5)' },
        aoTotalNm2: { type: 'NUMBER', description: 'Luas area kontainmen Ao (NM²) dari Worksheet 1 — WAJIB > 0' },
        sweptAreaNm2: { type: 'NUMBER', description: 'Luas aktual disapu sortie ini (NM²) dari laporan sortie — sumber utama' },
        hoursSearched: { type: 'NUMBER', description: 'Alternatif: jam pencarian efektif sortie ini' },
        searchSpeedKts: { type: 'NUMBER', description: 'Alternatif: kecepatan pencarian (kts)' },
        sweepWidthNm: { type: 'NUMBER', description: 'Alternatif: sweep width S (NM) dari lembar WS 2/WS 8' },
        previousCoverageC: { type: 'NUMBER', description: 'Coverage kumulatif tahap sebelumnya (bila ada) untuk POD kumulatif' },
      },
      required: ['searchNumber', 'aoTotalNm2'],
    },
  },
];

// ── Kompaksi hasil pipeline (tanpa array waypoint/vektor besar) ─────────────

function compactPipelineOutput(output: CasePipelineOutput): Record<string, unknown> {
  const compact: Record<string, unknown> = {
    ok: output.ok,
    steps: output.steps,
    assumptions: output.assumptions,
  };
  if (output.asw) {
    compact.asw = {
      dirFrom: round(output.asw.aswDirFrom, 1),
      speedKts: round(output.asw.aswSpeed, 2),
      totalHours: round(output.asw.totalHours, 2),
      observationCount: output.asw.observations.length,
    };
  }
  if (output.awa) {
    compact.awa = {
      isValid: output.awa.isValid,
      dirFrom: round(output.awa.awaDirFrom, 1),
      speedKts: round(output.awa.awaSpeed, 2),
      ...(output.awa.errors.length > 0 ? { errors: output.awa.errors } : {}),
    };
  }
  if (output.aero) {
    compact.aeroDrift = {
      positionValid: output.aero.positionValid,
      ...(output.aero.positionValid ? {
        landingPos: roundLatLng(output.aero.landingPos),
        totalDisplacementNm: round(output.aero.totalDisplacementNm, 1),
        aircraftActive: output.aero.aircraftActive,
        parachuteActive: output.aero.parachuteActive,
        glideDistanceNm: round(output.aero.aircraftGlideDistanceNm, 2),
        timeOfDescentMin: round(output.aero.aircraftTimeOfDescentMin, 3),
        headingTrueDeg: output.aero.aircraftDescentHeadingTrueDeg,
        windDisplacementNm: round(output.aero.aircraftWindDisplacementNm, 2),
        windDisplacementDir: output.aero.aircraftWindDisplacementDir,
      } : { validationErrors: output.aero.validationErrors }),
    };
  }
  if (output.datum) {
    compact.datumWs1 = {
      datum: roundLatLng(output.datum.datumB),
      bearingLkpToDatumDeg: round(output.datum.bearingAB, 1),
      distanceLkpToDatumNm: round(output.datum.distanceAB, 2),
      hoursOfDrift: round(output.datum.hours, 2),
      seaCurrentVector: { dirDeg: round(output.datum.seaVector.dir, 1), distNm: round(output.datum.seaVector.dist, 2) },
      windCurrentVector: { dirDeg: round(output.datum.wcVector.dir, 1), distNm: round(output.datum.wcVector.dist, 2) },
      leeway: { speedKts: round(output.datum.lwSpeed, 3), dirLeftDeg: round(output.datum.lwDirLeft, 1), dirRightDeg: round(output.datum.lwDirRight, 1) },
      dL: round(output.datum.dL, 2),
      dR: round(output.datum.dR, 2),
      LR: round(output.datum.LR, 2),
      De: round(output.datum.De, 2),
      dePercent: round(output.datum.dePercent, 2),
      E: round(output.datum.E, 2),
      fs: output.datum.fs,
      R: output.datum.RUp,
      AoSquareNm2: round(output.datum.areaSquareNM2, 1),
      ...(output.datum.warnings.length > 0 ? { warnings: output.datum.warnings } : {}),
    };
  }
  if (output.ws2Rows) {
    compact.ws2Rows = output.ws2Rows.map((entry) => ({ sruName: entry.sruName, ...compactWscRow(entry.result) }));
  }
  if (output.ws8Rows) {
    compact.ws8Rows = output.ws8Rows.map((entry) => ({ sruName: entry.sruName, ...compactWscRow(entry.result) }));
  }
  if (output.pattern) {
    compact.searchPattern = {
      type: output.pattern.type,
      code: output.pattern.code,
      csp: roundLatLng(output.pattern.csp),
      exitPoint: roundLatLng(output.pattern.exitPoint),
      totalDistanceNm: round(output.pattern.totalDistanceNm, 1),
      estimatedHours: round(output.pattern.estimatedHours, 2),
      waypointCount: output.pattern.waypoints.length,
      ...(output.pattern.description ? { description: output.pattern.description } : {}),
    };
  }
  if (output.allocation) {
    compact.assetAllocation = {
      isSufficient: output.allocation.isSufficient,
      coverageRatio: round(output.allocation.coverageRatio, 2),
      totalSweepAreaNm2: round(output.allocation.totalSweepAreaNm2, 1),
      requiredAreaAoNm2: round(output.allocation.requiredAreaAoNm2, 1),
      recommendation: output.allocation.recommendation,
      perAsset: output.allocation.perAsset.map((calc) => {
        const record = calc as unknown as Record<string, unknown>;
        const assetInput = record['asset'] as Record<string, unknown> | undefined;
        const flat: Record<string, unknown> = {
          name: str(assetInput?.name) ?? null,
          type: str(assetInput?.type) ?? null,
        };
        for (const [key, value] of Object.entries(record)) {
          if (key === 'asset') continue;
          if (typeof value === 'number') flat[key] = round(value, 2);
          else if (typeof value === 'string' || typeof value === 'boolean') flat[key] = value;
        }
        return flat;
      }),
    };
  }
  return compact;
}

function compactWscRow(result: {
  ready: boolean; Wu: number; fw: number; fs: number; ff: number; W: number; S: number; C: number; POD: number; T: number;
  windUsed: number; windSource: string; waveUsedM: number;
}): Record<string, unknown> {
  return {
    ready: result.ready,
    Wu: round(result.Wu, 2),
    fw: round(result.fw, 2),
    fs: round(result.fs, 2),
    ff: result.ff,
    W: round(result.W, 2),
    S: round(result.S, 2),
    C: round(result.C, 3),
    PODpercent: round(result.POD, 1),
    Thours: round(result.T, 2),
    windUsed: round(result.windUsed, 1),
    windSource: result.windSource,
    waveUsedM: round(result.waveUsedM, 2),
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function roundLatLng(value: { lat: number; lng: number }): { lat: number; lng: number } {
  return { lat: round(value.lat, 5), lng: round(value.lng, 5) };
}

// ── get_state: ringkasan per worksheet dari snapshot ────────────────────────

function buildGetState(state: Record<string, unknown>): Record<string, unknown> {
  const asw = asRecord(state.asw);
  const awa = asRecord(state.awa);
  const aero = asRecord(state.aero);
  const datum = asRecord(state.datum);
  const ws1 = asRecord(state.ws1);
  const weather = asRecord(state.weather);

  const worksheets: Record<string, unknown> = {
    asw: {
      observationCount: asArray(asw?.observations).length,
      distressTime: str(asw?.distressTime) ?? null,
      datumTime: str(asw?.datumTime) ?? null,
      intervalMode: str(asw?.obsIntervalMode) ?? null,
      aswErr: num(asw?.aswErr) ?? null,
    },
    awa: {
      layerCount: asArray(awa?.observations).length,
      distressAltFt: num(awa?.distressAltFt) ?? null,
      forecastSource: str(awa?.forecastSource) ?? null,
      forecastValidTime: str(awa?.forecastValidTime) ?? null,
    },
    aero: aero ? {
      useAircraftGlide: bool(aero.useAircraftGlide) ?? false,
      useParachute: bool(aero.useParachute) ?? false,
      altMaxFt: num(aero.aircraftAltMaxFt) ?? null,
      altMinFt: num(aero.aircraftAltMinFt) ?? null,
      glideRatio: num(aero.aircraftGlideRatio) ?? null,
      tasgKts: num(aero.aircraftTASgKts) ?? null,
      descentHeadingDeg: num(aero.aircraftDescentHeadingDeg) ?? null,
      headingReference: str(aero.aircraftHeadingReference) ?? null,
      variation: num(aero.magneticVariationDeg) !== undefined ? `${num(aero.magneticVariationDeg)}°${str(aero.magneticVariationDirection) ?? 'E'}` : null,
      incidentPos: aero.incidentPos ?? null,
      incidentTime: str(aero.incidentTime) ?? null,
      fixErrorXNm: num(aero.fixErrorXNm) ?? null,
      safetyFactorFs: num(aero.safetyFactorFs) ?? null,
    } : null,
    datum: {
      driftInterval: num(datum?.driftInterval) ?? null,
      latitude: num(datum?.latitude) ?? null,
      seaCurrent: (() => {
        const dir = num(datum?.seaCurrentDir);
        const speed = num(datum?.seaCurrentSpeed);
        if (dir === undefined && speed === undefined) return null;
        return { dirToDeg: dir ?? null, speedKts: speed ?? null, err: num(datum?.seaCurrentErr) ?? null };
      })(),
      leewayObjectId: str(datum?.leewayObjectId) ?? null,
      X: num(datum?.X) ?? null,
      Y: num(datum?.Y) ?? null,
      useWindCurrent: bool(datum?.useWindCurrent) ?? true,
    },
    ws1: { fs: num(ws1?.fs) ?? null, measuredDistanceNm: num(asRecord(ws1?.measured)?.distanceNm) ?? null },
    lkp: state.lkp ?? null,
    ws2Sheets: asArray(state.ws2Sheets).map((raw) => {
      const data = asRecord(asRecord(raw)?.data) ?? {};
      return {
        sruName: str(data.sruName) ?? null,
        searchPlatform: str(data.searchPlatform) ?? null,
        searchTas: num(data.searchTas) ?? null,
        searchObject: str(data.searchObject) ?? null,
        visibilityIndex: num(data.visibilityIndex) ?? null,
        isFatigue: str(data.isFatigue) ?? null,
        selectedHeightFt: num(data.selectedHeight) ?? null,
        searchNumber: num(data.searchNumber) ?? null,
        hoursAvailable: num(data.hoursAvailable) ?? null,
        caseWind: num(data.caseWindSpeed) !== undefined ? `${num(data.caseWindDirFrom) ?? '?'}°/${num(data.caseWindSpeed)} kts` : null,
        caseWaveHeightM: num(data.caseWaveHeightM) ?? null,
      };
    }),
    ws8Sheets: asArray(state.ws8Sheets).map((raw) => {
      const data = asRecord(asRecord(raw)?.data) ?? {};
      return {
        sruName: str(data.sruName) ?? null,
        sruType: str(data.sruType) ?? null,
        eyeHeight: str(data.eyeHeight) ?? null,
        searchObject: str(data.searchObject) ?? null,
        visibilityKm: str(data.visibilityKm) ?? null,
        isFatigue: str(data.isFatigue) ?? null,
        searchNumber: num(data.searchNumber) ?? null,
        vesselSpeedKts: num(data.vesselSpeedKts) ?? null,
        hoursAvailable: num(data.hoursAvailable) ?? null,
        caseWind: num(data.caseWindSpeed) !== undefined ? `${num(data.caseWindDirFrom) ?? '?'}°/${num(data.caseWindSpeed)} kts` : null,
        caseWaveHeightM: num(data.caseWaveHeightM) ?? null,
      };
    }),
    ws3SheetsCount: asArray(state.ws3Sheets).length,
    ws4: state.ws4 ? 'terisi' : null,
    intercept: state.intercept ? 'terisi' : null,
    assets: asArray(state.assets).map((raw) => {
      const asset = asRecord(raw) ?? {};
      return {
        name: str(asset.name) ?? null,
        type: str(asset.type) ?? null,
        homeBase: str(asset.homeBaseName) ?? null,
        homeBasePos: asset.homeBasePos ?? null,
        transitSpeedKts: num(asset.transitSpeedKts) ?? null,
        searchSpeedKts: num(asset.searchSpeedKts) ?? null,
        enduranceHours: num(asset.enduranceHours) ?? null,
        tafCondition: str(asset.tafCondition) ?? null,
      };
    }),
    pattern: {
      patternType: str(state.patternType) ?? null,
      orientationText: str(state.patternOrientationText) ?? null,
      environment: str(state.patternEnvironment) ?? null,
      worksheetSource: str(state.patternWorksheetSource) ?? null,
      turnDirection: str(state.patternTurn) ?? null,
    },
    weatherOverrides: weather ? {
      windOverride: asRecord(weather.windOverride) ? { dirFrom: num(asRecord(weather.windOverride)?.dirFrom), speed: num(asRecord(weather.windOverride)?.speed), hours: num(asRecord(weather.windOverride)?.hours) } : null,
      seaCurrentOverride: asRecord(weather.seaCurrentOverride) ? { dir: num(asRecord(weather.seaCurrentOverride)?.dir), speed: num(asRecord(weather.seaCurrentOverride)?.speed) } : null,
      visibilityOverrideNm: num(asRecord(weather.visibilityOverride)?.nm) ?? null,
      driftIntervalHours: num(weather.driftIntervalHours) ?? null,
    } : null,
  };

  // Kelengkapan rantai (CaseSchema path) — gagal parse = dilewati saja.
  const mapped = stateToCase(state);
  const completeness = mapped.ok && mapped.sarCase
    ? checkCaseCompleteness(mapped.sarCase, mapped.planner)
    : null;

  return {
    hasState: true,
    note: 'State worksheet saat pesan ini dikirim (hasil set_* yang belum dikonfirmasi pengguna belum termasuk).',
    worksheets,
    completeness: completeness ? {
      complete: completeness.complete,
      missingCount: completeness.missingCount,
      assumedCount: completeness.assumedCount,
      issues: completeness.issues.slice(0, 20).map((issue) => ({
        field: issue.field,
        worksheet: issue.worksheet,
        status: issue.status,
        reason: issue.reason.slice(0, 120),
      })),
    } : null,
    ...(mapped.warnings.length > 0 ? { mappingWarnings: mapped.warnings.slice(0, 8) } : {}),
  };
}

// ── Helper defensif ──────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

// ── Eksekusi ─────────────────────────────────────────────────────────────────

const MAX_RESULT_JSON_CHARS = 9000;

/** Eksekusi tool server-side. TIDAK pernah melempar. */
export function executeServerTool(
  name: string,
  args: unknown,
  ctx: ServerToolContext,
): ServerToolResult {
  const argsRecord = (args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const state = ctx.state && typeof ctx.state === 'object' && !Array.isArray(ctx.state)
    ? ctx.state
    : undefined;

  const build = (ok: boolean, payload: Record<string, unknown>, summary: string): ServerToolResult => {
    let json = JSON.stringify({ ok, ...payload });
    if (json.length > MAX_RESULT_JSON_CHARS) {
      json = JSON.stringify({
        ok,
        ...payload,
        truncated: true,
        note: `Hasil terpotong dari ${json.length} ke ${MAX_RESULT_JSON_CHARS} karakter — gunakan run_worksheet per worksheet untuk detail.`,
      }).slice(0, MAX_RESULT_JSON_CHARS);
    }
    return { ok, summary, json };
  };

  try {
    switch (name) {
      case 'lookup_table':
        return executeLookupTable(argsRecord);

      case 'request_reference_choice': {
        const fieldPath = str(argsRecord.fieldPath);
        if (!fieldPath) {
          return build(false, { error: `Argumen wajib: fieldPath. Field terdaftar: ${Object.keys(REFERENCE_CHOICE_FIELDS).join(', ')}.` }, 'request_reference_choice: fieldPath kosong.');
        }
        // Konteks objek dari state worksheet: jenis objek dicari + judul kasus
        // (searchObject ADW berisi craftType + callsign dari ekstraksi/pipeline).
        const parts: string[] = [];
        if (state) {
          const aero = state['aero'] as Record<string, unknown> | undefined;
          if (aero && typeof aero === 'object') {
            if (typeof aero['searchObject'] === 'string' && aero['searchObject'].trim()) parts.push(aero['searchObject']);
            if (typeof aero['caseTitle'] === 'string' && aero['caseTitle'].trim()) parts.push(aero['caseTitle']);
          }
        }
        const described = str(argsRecord.contextDescription);
        if (described) parts.push(described);
        const choice = buildReferenceChoice(fieldPath, parts.join('. '));
        if (!choice) {
          return build(false, {
            error: `Field "${fieldPath}" tidak terdaftar di registry pilihan referensi. Field terdaftar: ${Object.keys(REFERENCE_CHOICE_FIELDS).join(', ')}.`,
          }, 'request_reference_choice: field tidak dikenal.');
        }
        return {
          ok: true,
          summary: `Kartu pilihan ${fieldPath} disiapkan (rekomendasi: ${choice.recommendation ? choice.recommendation.label : 'tidak cukup data — minta keputusan planner'}; status ${choice.status}).`,
          json: JSON.stringify({ ok: true, ...referenceChoiceForModel(choice) }),
          referenceChoice: choice,
        };
      }

      case 'get_state': {
        if (!state) {
          return build(false, { error: 'State worksheet tidak tersedia — minta pengguna membuka aplikasi/refresh lalu ulangi.' }, 'get_state: state tidak tersedia.');
        }
        const payload = buildGetState(state);
        const missing = (payload.completeness as { missingCount?: number } | null)?.missingCount ?? 0;
        return build(true, payload, `get_state: worksheet ringkas + ${missing} data wajib masih kurang.`);
      }

      case 'run_pipeline':
      case 'run_worksheet': {
        if (!state) {
          return build(false, { error: 'State worksheet tidak tersedia — minta pengguna membuka aplikasi/refresh lalu ulangi.' }, `${name}: state tidak tersedia.`);
        }
        const mapped = stateToCase(state);
        if (!mapped.ok || !mapped.sarCase) {
          return build(false, { error: 'Snapshot state tidak dapat dipetakan ke kasus.', warnings: mapped.warnings }, `${name}: snapshot tidak valid.`);
        }
        const parsed = parseSarCase(mapped.sarCase);
        if (!parsed.ok) {
          return build(false, { error: 'Kasus tidak valid.', issues: parsed.issues }, `${name}: kasus tidak valid.`);
        }
        const output = runCasePipeline(parsed.data, mapped.planner);
        const compact = compactPipelineOutput(output);
        if (name === 'run_worksheet') {
          const worksheet = typeof argsRecord.worksheet === 'string' ? argsRecord.worksheet.trim().toLowerCase() : '';
          const aliases: Record<string, string[]> = {
            asw: ['asw'], awa: ['awa'], aero: ['aero', 'aerodrift', 'adw', 'aero-drift', 'aeronautical-drift'],
            datum: ['datum', 'ws1', 'ws 1', 'ws-1', 'search-area', 'luas-area'],
            ws2: ['ws2', 'ws 2', 'ws-2'], ws8: ['ws8', 'ws 8', 'ws-8'],
            pattern: ['pattern', 'search-pattern', 'csp', 'pola'],
            assets: ['assets', 'asset', 'allocation', 'alokasi', 'alokasi-aset'],
          };
          const matchedKey = Object.keys(aliases).find((key) => aliases[key].includes(worksheet));
          if (!matchedKey) {
            return build(false, {
              error: `Worksheet "${worksheet || '(kosong)'}" tidak dikenal. Pilihan: asw, awa, aero, datum, ws2, ws8, pattern, assets. WS 3/WS 4/Intercept dihitung worksheet aplikasi (belum di pipeline).`,
              fullPipeline: compact,
            }, `run_worksheet: worksheet "${worksheet}" tidak dikenal (daftar dikirim).`);
          }
          const filtered = filterPipelineStep(compact as Record<string, unknown>, matchedKey, output);
          const step = output.steps.find((entry) => entry.step === matchedKey)
            ?? output.steps.find((entry) => entry.step.startsWith(matchedKey));
          return build(true, filtered, `run_worksheet(${worksheet}): ${step ? step.status : 'ok'} — ${step?.detail ?? 'selesai'}.`);
        }
        const failedSteps = output.steps.filter((entry) => entry.status === 'error');
        return build(true, compact, `run_pipeline: ${output.ok ? 'semua langkah ok' : `${failedSteps.length} langkah error`} (${output.steps.length} langkah).`);
      }

      case 'validate_plan': {
        if (!state) {
          return build(false, { error: 'State worksheet tidak tersedia — minta pengguna membuka aplikasi/refresh lalu ulangi.' }, 'validate_plan: state tidak tersedia.');
        }
        const validation = validatePlanSnapshot(state);
        return build(validation.ok, {
          ok: validation.ok,
          errorCount: validation.errorCount,
          warningCount: validation.warningCount,
          infoCount: validation.infoCount,
          issues: validation.issues.map((issue) => ({
            level: issue.level,
            field: issue.field,
            message: issue.message.slice(0, 200),
          })),
        }, `validate_plan: ${validation.errorCount} error, ${validation.warningCount} warning, ${validation.infoCount} info.`);
      }

      case 'fill_form': {
        const docTypeArg = typeof argsRecord.docType === 'string' ? argsRecord.docType.trim().toUpperCase().replace(/\s+/g, '_') : '';
        const aliases: Record<string, DocType> = {
          RENOPS_I: 'RENOPS_I', RENOPS_1: 'RENOPS_I', RENOPS_I_2020: 'RENOPS_I',
          RENOPS_II: 'RENOPS_II', RENOPS_2: 'RENOPS_II',
          BRIEFING: 'BRIEFING',
          DEBRIEFING: 'DEBRIEFING', DE_BRIEFING: 'DEBRIEFING',
        };
        let docType = aliases[docTypeArg];
        if (!docType && (docTypeArg === 'AUTO' || docTypeArg === '')) {
          docType = pickRenopsType(ctx.bankFields ?? []);
        }
        if (!docType) {
          return build(false, { error: `docType "${argsRecord.docType ?? '(kosong)'}" tidak dikenal. Pilihan: RENOPS_I, RENOPS_II, BRIEFING, DEBRIEFING.` }, 'fill_form: docType tidak dikenal.');
        }
        const selectedAssetId = typeof argsRecord.selectedAssetId === 'string' && argsRecord.selectedAssetId.trim() !== '' ? argsRecord.selectedAssetId.trim() : undefined;
        const document = buildDocument(docType, ctx.documentSnapshot ?? null, ctx.bankFields ?? [], selectedAssetId);
        const plan = buildFillFormPlan(document);
        const compact = compactFillFormResult(document, plan);
        return build(true, compact, `fill_form(${docType}): draf "${document.title}" — ${document.validation.ready}/${document.validation.total} field READY, ${plan.worksheet ? `${Object.keys(plan.values).length} field siap diisi ke form ${plan.worksheet}` : 'tanpa pemetaan form'}, ${document.questions.length} pertanyaan data hilang.`);
      }

      case 'analyze_debrief': {
        const numArg = (key: string): number | undefined => {
          const raw = argsRecord[key];
          return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
        };
        const sortieInput: DebriefSortieInput = {
          searchNumber: (numArg('searchNumber') ?? 1) as DebriefSortieInput['searchNumber'],
          aoTotalNm2: numArg('aoTotalNm2') ?? NaN,
          sweptAreaNm2: numArg('sweptAreaNm2'),
          hoursSearched: numArg('hoursSearched'),
          searchSpeedKts: numArg('searchSpeedKts'),
          sweepWidthNm: numArg('sweepWidthNm'),
          previousCoverageC: numArg('previousCoverageC'),
        };
        const analysis = analyzeDebrief(sortieInput);
        return build(analysis.ok, analysis as unknown as Record<string, unknown>, analysis.ok
          ? `analyze_debrief: C=${analysis.cThis} → POD ${analysis.podThisPercent}%${analysis.podCumulativePercent !== null ? `; kumulatif C=${analysis.cCumulative} → POD ${analysis.podCumulativePercent}%` : ''}.`
          : `analyze_debrief: input kurang — ${analysis.error ?? 'tidak bisa dihitung'}.`);
      }

      default:
        return build(false, { error: `Tool "${name}" bukan tool server-side yang dikenal.` }, `Tool "${name}" tidak dikenal.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Eksekusi tool server gagal.';
    return build(false, { error: message }, `Tool ${name} gagal: ${message.slice(0, 80)}`);
  }
}

/** Filter output pipeline untuk run_worksheet: langkah target + prasyaratnya. */
function filterPipelineStep(
  compact: Record<string, unknown>,
  key: string,
  output: CasePipelineOutput,
): Record<string, unknown> {
  const keep = new Set<string>(['ok', 'steps', 'assumptions']);
  switch (key) {
    case 'asw': keep.add('asw'); break;
    case 'awa': keep.add('awa'); keep.add('asw'); break; // AWA tak bergantung ASW, tapi langkahnya ikut untuk konteks
    case 'aero': keep.add('aeroDrift'); keep.add('awa'); break;
    case 'datum': keep.add('datumWs1'); keep.add('asw'); keep.add('aeroDrift'); break;
    case 'ws2': keep.add('ws2Rows'); keep.add('datumWs1'); keep.add('asw'); break;
    case 'ws8': keep.add('ws8Rows'); keep.add('datumWs1'); keep.add('asw'); break;
    case 'pattern': keep.add('searchPattern'); keep.add('datumWs1'); keep.add('ws2Rows'); keep.add('ws8Rows'); break;
    case 'assets': keep.add('assetAllocation'); keep.add('searchPattern'); break;
    default: break;
  }
  const filtered: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(compact)) {
    if (keep.has(field)) filtered[field] = value;
  }
  // Langkah pipeline yang relevan saja.
  if (Array.isArray(compact.steps)) {
    const stepNames = [...keep].map((name) => STEP_KEY_BY_FIELD[name]).filter(Boolean) as string[];
    filtered.steps = (compact.steps as Array<{ step?: string }>).filter((entry) => entry.step && stepNames.includes(entry.step));
  }
  void output;
  return filtered;
}

const STEP_KEY_BY_FIELD: Record<string, string> = {
  asw: 'asw',
  awa: 'awa',
  aeroDrift: 'aero-drift',
  datumWs1: 'datum-ws1',
  ws2Rows: 'ws2-wsc-pod',
  ws8Rows: 'ws8-wsc-pod',
  searchPattern: 'search-pattern',
  assetAllocation: 'asset-allocation',
};
