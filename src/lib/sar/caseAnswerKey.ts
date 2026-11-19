/**
 * CASE ANSWER KEY (Fase 5b AI Copilot) — kunci jawaban instruktur untuk soal
 * hasil generator: tahapan penghitungan, sumber referensi tabel, dan rubrik
 * penilaian (total 100).
 *
 * Prinsip:
 *  - Angka kunci jawaban berasal dari FUNGSI LIB YANG SAMA dengan worksheet
 *    (runCasePipeline untuk laut; landSearchRadius + landSearchTables untuk
 *    darat) — tidak ada rumus baru, tidak ada angka LLM.
 *  - Referensi hanya menyebut tabel yang benar-benar ada di aplikasi
 *    (referenceTables.ts: I-1/I-2 leeway, I-3..I-8 sweep width, I-9/I-10
 *    darat, J-1/J-2/J-3 nav fix error, FIG-I-12 POD, FS-TABLE, N-13/N-14).
 *  - Rubrik mengikuti tasksRequested kasus; bobot dinormalisasi ke 100.
 */

import type { SarCaseSchema } from './caseSchema';
import { runCasePipeline, type CasePipelineOptions } from './casePipeline';
import type { CasePlannerInputs } from './caseAdapter';
import { fmtId, fmtHeading3, formatDmsDecimalMinutes, splitCaseTime } from './caseNaskah';
import { computePointRadius, computeLegTrapezoid, LAND_FS_OPTIONS, LAND_X0_NM, LAND_SRU_NAV_OPTIONS } from './landSearchRadius.mjs';
import {
  lookupLandWu,
  lookupLandFv,
  nearestLandTrackSpacing,
  LAND_SEARCH_VISIBILITIES,
  type LandSearchTarget,
  type LandSearchPlatform,
  type LandVegetation,
  type LandSearchHeight,
} from './landSearchTables';
import { haversineNm } from './caseGenerator';
import { formatDMS } from './coordFormat';

// ---------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------

export interface AnswerKeyStep {
  label: string;
  formula?: string;
  result: string;
  unit?: string;
  refTable?: string;
}

export interface AnswerKeyStage {
  no: number;
  worksheet: string;
  title: string;
  inputs: Array<{ label: string; value: string; refTable?: string }>;
  steps: AnswerKeyStep[];
  resultSummary: string;
}

export interface AnswerKeyReference {
  id: string;
  title: string;
  usage: string;
}

export interface AnswerKeyRubricItem {
  item: string;
  worksheet: string;
  weight: number;
  criteria: string;
}

export interface CaseAnswerKey {
  caseTitle: string;
  incidentType: string;
  generatorVersion: string;
  seed: string;
  stages: AnswerKeyStage[];
  references: AnswerKeyReference[];
  rubric: AnswerKeyRubricItem[];
  totalScore: number;
  notes: string[];
}

const STAGE_NO = () => ({ count: 0 });
const nextStageNo = (counter: { count: number }) => { counter.count += 1; return counter.count; };

/** Bobot rubrik dasar per tugas (jumlah = 100 setelah normalisasi). */
const RUBRIC_WEIGHTS: Record<string, { worksheet: string; weight: number; criteria: string }> = {
  'aeronautical-drift': { worksheet: 'ADW', weight: 15, criteria: 'Data glide benar (TASg × TOC), vektor angin per lapisan, koordinat ditching ± toleransi 1 NM.' },
  asw: { worksheet: 'ASW', weight: 10, criteria: 'Vektor rata-rata deret angin benar; hours of drift dari selisih waktu; interval pengamatan tepat (6/3 jam).' },
  'search-area-abcd': { worksheet: 'Datum WS 1 + WS 2/WS 8', weight: 15, criteria: 'S→Wc benar (Tabel I-1/I-2), De% dari fs pencarian ke-n, E = De% × RUp, koordinat A-B-C-D lengkap.' },
  'wsc-pod': { worksheet: 'WS 2/WS 8', weight: 15, criteria: 'Wu dari tabel sesuai platform/visibilitas, Fw/Fs benar, C = W/S, POD dari kurva FIG-I-12 pencarian ke-n.' },
  'asset-allocation': { worksheet: 'Alokasi Aset', weight: 10, criteria: 'Transit vs di-scene, sweep area total vs Ao, kombinasi SRU memenuhi kebutuhan.' },
  'search-pattern-csp': { worksheet: 'Search Pattern', weight: 15, criteria: 'Jenis pola sesuai kasus, orientasi = bearing LKP→Datum, CSP benar, jarak pola konsisten S dan jumlah leg.' },
  'sru-task-assignment': { worksheet: 'RENOPS', weight: 10, criteria: 'Pembagian tugas tiap SRU mencantumkan lokasi, waktu, pola, dan callsign yang benar.' },
  'land-search-radius': { worksheet: 'WS 3/WS 4', weight: 20, criteria: 'x = x₀ + 0.1×Tr (Tabel J-2/J-3), e = √(x²+y²) (Tabel J-1), R = e×fs dibulatkan ke atas, area trapesium garis singgung benar.' },
  renops: { worksheet: 'RENOPS', weight: 5, criteria: 'Format RENOPS lengkap dan konsisten dengan angka kunci jawaban.' },
  briefing: { worksheet: 'Briefing', weight: 5, criteria: 'Briefing menyebut datum, pola, SRU, dan safety factor dengan benar.' },
  debriefing: { worksheet: 'De-briefing', weight: 5, criteria: 'De-briefing mencatat hasil pencarian dan POD aktual.' },
};

// ---------------------------------------------------------------------------
// Kunci jawaban — insiden LAUT (pipeline worksheet lengkap)
// ---------------------------------------------------------------------------

function buildMaritimeAnswerKey(sarCase: SarCaseSchema, planner: CasePlannerInputs, options: CasePipelineOptions): { stages: AnswerKeyStage[]; references: AnswerKeyReference[]; notes: string[] } {
  const counter = STAGE_NO();
  const stages: AnswerKeyStage[] = [];
  const notes: string[] = [];
  const references: AnswerKeyReference[] = [
    { id: 'I-1/I-2', title: 'Leeway object types (51 objek)', usage: 'Kategori leeway target → kecepatan leeway (LW) Datum WS 1.' },
    { id: 'I-3/I-4', title: 'Uncorrected sweep width — kapal', usage: 'Wu lembar WS 8 (eye height 8/14 ft, MERSHIP).' },
    { id: 'I-5/I-6', title: 'Uncorrected sweep width — fixed-wing & helikopter (500–2000 ft)', usage: 'Wu lembar WS 2.' },
    { id: 'I-7', title: 'Weather correction fw (angin/gelombang)', usage: 'Koreksi cuaca sweep width.' },
    { id: 'I-8', title: 'Speed correction fs (TAS)', usage: 'Koreksi kecepatan sweep width WS 2.' },
    { id: 'J-1/J-2/J-3', title: 'Nav fix error (x/y, %DR)', usage: 'Galat posisi distress craft dan SRU.' },
    { id: 'FIG-I-12', title: 'POD vs coverage (kurva pencarian 1–5)', usage: 'POD dari coverage C pada nomor pencarian berjalan.' },
    { id: 'FS-TABLE', title: 'Safety factor fs pencarian 1–5', usage: 'fs datum (1.1/1.6/2.0/2.3/2.5) sesuai nomor pencarian.' },
  ];

  const pipeline = runCasePipeline(sarCase, { ...planner, ...options });
  if (!pipeline.ok) {
    notes.push('Pipeline tidak berjalan mulus — periksa langkah error sebelum memakai kunci jawaban.');
  }

  const lcParts = splitCaseTime(sarCase.incident.lastContactTime ?? '');
  const datumParts = splitCaseTime(sarCase.search?.datumTime ?? '');

  // ── ASW ──
  if (pipeline.asw) {
    const series = sarCase.sea?.surfaceWindSeries ?? [];
    stages.push({
      no: nextStageNo(counter),
      worksheet: 'ASW',
      title: 'Average Surface Wind (angin permukaan rata-rata)',
      inputs: [
        { label: 'Waktu kejadian (LC)', value: `${lcParts.time} ${lcParts.zone}` },
        { label: 'Datum Time', value: `${datumParts.time} ${datumParts.zone}` },
        { label: 'Pengamatan deret angin', value: `${series.length} baris (interval ${seriesIntervalLabel(series)})` },
      ],
      steps: [
        { label: 'Hours of drift (a)', formula: 'selisih LC → Datum Time', result: fmtId(pipeline.asw.totalHours), unit: 'jam' },
        { label: 'ASW arah (dari)', formula: 'rata-rata vektor deret angin', result: fmtHeading3(pipeline.asw.aswDirFrom), unit: '°T' },
        { label: 'ASW kecepatan', formula: 'rata-rata vektor deret angin', result: fmtId(pipeline.asw.aswSpeed), unit: 'knot' },
      ],
      resultSummary: `ASW ${fmtHeading3(pipeline.asw.aswDirFrom)} / ${fmtId(pipeline.asw.aswSpeed)} kts; hours of drift ${fmtId(pipeline.asw.totalHours)} jam.`,
    });
  }

  // ── AWA (ditching) ──
  if (pipeline.awa?.isValid) {
    stages.push({
      no: nextStageNo(counter),
      worksheet: 'AWA',
      title: 'Average Wind Aloft (angin ketinggian rata-rata)',
      inputs: [
        { label: 'Ketinggian kejadian', value: sarCase.incident.flightLevelFt !== undefined ? `FL${sarCase.incident.flightLevelFt}` : fmtId(sarCase.incident.altitudeFt ?? 0) + ' feet' },
        { label: 'Tabel angin per ketinggian', value: `${sarCase.aeroDrift?.windLayers?.length ?? 0} lapisan` },
      ],
      steps: [
        { label: 'AWA arah (dari)', formula: 'rata-rata berbobot ketinggian', result: fmtHeading3(pipeline.awa.awaDirFrom), unit: '°T' },
        { label: 'AWA kecepatan', formula: 'rata-rata berbobot ketinggian', result: fmtId(pipeline.awa.awaSpeed), unit: 'knot' },
        { label: 'Total kehilangan ketinggian', result: fmtId(pipeline.awa.totalAltLossKft), unit: 'kft' },
      ],
      resultSummary: `AWA ${fmtHeading3(pipeline.awa.awaDirFrom)} / ${fmtId(pipeline.awa.awaSpeed)} kts.`,
    });
  }

  // ── ADW (ditching) ──
  if (pipeline.aero) {
    const aero = pipeline.aero;
    stages.push({
      no: nextStageNo(counter),
      worksheet: 'ADW',
      title: 'Aeronautical Drift Worksheet',
      inputs: [
        { label: 'TAS glide', value: fmtId(sarCase.aeroDrift?.glideSpeedKts ?? 0) + ' kts' },
        { label: 'Glide ratio', value: `${fmtId(sarCase.aeroDrift?.glideRatio ?? 0)} : 1` },
        { label: 'Variasi', value: `${fmtId(sarCase.aeroDrift?.variationDeg ?? 0)}° ${sarCase.aeroDrift?.variationDirection ?? 'E'}`, refTable: 'Magnetik → true (E ditambah, W dikurangi)' },
      ],
      steps: [
        { label: 'Glide distance', formula: 'TASg × waktu descent', result: fmtId(aero.aircraftGlideDistanceNm), unit: 'NM', refTable: 'N-13 rate of descent parasut' },
        { label: 'Waktu descent', formula: 'ketinggian ÷ rate of descent', result: fmtId(aero.aircraftTimeOfDescentMin), unit: 'menit' },
        { label: 'Drift total pesawat', formula: 'AWA × waktu descent', result: fmtId(aero.totalDisplacementNm), unit: 'NM' },
        { label: 'Koordinat ditching', result: `${formatDMS(aero.landingPos.lat, false)} – ${formatDMS(aero.landingPos.lng, true)}` },
      ],
      resultSummary: `Perkiraan titik ditching ${formatDMS(aero.landingPos.lat, false)} – ${formatDMS(aero.landingPos.lng, true)} (drift ${fmtId(aero.totalDisplacementNm)} NM).`,
    });
  }

  // ── Datum WS 1 ──
  if (pipeline.datum) {
    const d = pipeline.datum;
    const area = pipeline.searchArea;
    const leewayId = planner.leewayObjectId ?? sarCase.target?.leewayObjectId ?? '-';
    stages.push({
      no: nextStageNo(counter),
      worksheet: 'Datum WS 1',
      title: 'Perhitungan Datum (S → Wc → LW → Datum)',
      inputs: [
        { label: 'Kategori leeway', value: leewayId, refTable: 'Tabel I-1/I-2' },
        { label: 'Arus laut', value: sarCase.sea?.current ? `${fmtHeading3(sarCase.sea.current.dirToDeg)} / ${fmtId(sarCase.sea.current.speedKts)} kts` : '-' },
        { label: 'Safety factor', value: fmtId(area?.fs ?? planner.fs ?? 1.1), refTable: 'FS-TABLE (fs pencarian ke-n)' },
        { label: 'De%', value: fmtId(area?.dePercent ?? 0) + '%', refTable: 'De kumulatif pencarian ke-n (12,5–33%)' },
      ],
      steps: [
        { label: 'Hours of drift', result: fmtId(d.hours), unit: 'jam' },
        { label: 'S (arus laut)', formula: 'kecepatan × jam', result: `${fmtId(d.seaVector.dist)} NM / ${fmtHeading3(d.seaVector.dir)}` },
        { label: 'Wc (arus angin)', formula: '0.0283 × V^(10/9) — Tabel FIG-I-1', result: `${fmtId(d.wcSpeed)} kts → ${fmtId(d.wcVector.dist)} NM / ${fmtHeading3(d.wcVector.dir)}`, refTable: 'FIG-I-1 wind current' },
        { label: 'LW (leeway)', formula: 'leeway rate × jam (kiri/kanan)', result: `${fmtId(d.lwDist)} NM (${fmtHeading3(d.lwDirLeft)} / ${fmtHeading3(d.lwDirRight)})`, refTable: 'Tabel I-1/I-2' },
        { label: 'Datum B', result: `${formatDMS(d.datumB.lat, false)} – ${formatDMS(d.datumB.lng, true)}` },
        { label: 'RUp = √(E²) lingkaran', formula: '√(2 × (S+Wc+LW)²) — radius upwind', result: fmtId(area?.RUp ?? d.RUp ?? 0), unit: 'NM' },
        { label: 'E = De% × RUp', formula: 'persen drift error × RUp', result: fmtId(area?.E ?? 0), unit: 'NM' },
        { label: 'Luas Ao (kotak)', formula: '(2 × RUp)²', result: fmtId(area?.aoSquareNm2 ?? 0), unit: 'NM²' },
      ],
      resultSummary: `Datum ${formatDMS(d.datumB.lat, false)} – ${formatDMS(d.datumB.lng, true)}; Ao kotak ${fmtId(area?.aoSquareNm2 ?? 0)} NM² (RUp ${fmtId(area?.RUp ?? 0)} NM, E ${fmtId(area?.E ?? 0)} NM).`,
    });
  }

  // ── WS 2 / WS 8 per SRU ──
  const wscRows = [
    ...(pipeline.ws2Rows ?? []).map((row) => ({ ...row, sheet: 'WS 2' as const })),
    ...(pipeline.ws8Rows ?? []).map((row) => ({ ...row, sheet: 'WS 8' as const })),
  ];
  for (const row of wscRows) {
    const r = row.result;
    stages.push({
      no: nextStageNo(counter),
      worksheet: row.sheet,
      title: `W, S, C, POD, T — ${row.sruName ?? 'SRU'}`,
      inputs: [
        { label: 'Wu', value: fmtId(r.Wu) + ' NM', refTable: row.sheet === 'WS 2' ? 'Tabel I-5/I-6' : 'Tabel I-3/I-4' },
        { label: 'Fw (koreksi cuaca)', value: fmtId(r.fw), refTable: 'Tabel I-7' },
        { label: 'Fs (koreksi kecepatan)', value: fmtId(r.fs), refTable: 'Tabel I-8' },
        { label: 'Fatigue', value: fmtId(r.ff) },
        { label: 'Track spacing S', value: fmtId(r.S) + ' NM' },
        { label: 'Nomor pencarian', value: String(sarCase.search?.searchNumber ?? 1), refTable: 'FIG-I-12 / FS-TABLE' },
      ],
      steps: [
        { label: 'W = Wu × Fw × Fs × Ff', formula: 'sweep width terkoreksi', result: fmtId(r.W), unit: 'NM' },
        { label: 'C = W / S', formula: 'coverage factor', result: fmtId(r.C, 3) },
        { label: 'POD', formula: 'kurva pencarian ke-n pada C', result: fmtId(r.POD, 1) + '%', refTable: 'FIG-I-12' },
        { label: 'T (jam pencarian)', formula: 'A / (S × V)', result: fmtId(r.T), unit: 'jam' },
      ],
      resultSummary: `${row.sruName ?? 'SRU'}: W ${fmtId(r.W)} NM, S ${fmtId(r.S)} NM, C ${fmtId(r.C, 2)}, POD ${fmtId(r.POD, 0)}%, T ${fmtId(r.T)} jam.`,
    });
  }

  // ── Pola pencarian ──
  if (pipeline.pattern) {
    const p = pipeline.pattern;
    stages.push({
      no: nextStageNo(counter),
      worksheet: 'Search Pattern',
      title: `Pola ${p.name} (${p.code})`,
      inputs: [
        { label: 'Jenis pola', value: p.type },
        { label: 'Track spacing', value: fmtId(options.trackSpacingNm ?? 0) + ' NM' },
        { label: 'Orientasi', value: fmtHeading3(options.patternOrientationDeg ?? 0) + ' (bearing LKP → Datum)' },
      ],
      steps: [
        { label: 'CSP', result: `${formatDMS(p.csp.lat, false)} – ${formatDMS(p.csp.lng, true)}` },
        { label: 'Exit point', result: `${formatDMS(p.exitPoint.lat, false)} – ${formatDMS(p.exitPoint.lng, true)}` },
        { label: 'Jarak total pola', result: fmtId(p.totalDistanceNm), unit: 'NM' },
        { label: 'Estimasi jam pola', result: fmtId(p.estimatedHours), unit: 'jam' },
      ],
      resultSummary: `${p.description} — total ${fmtId(p.totalDistanceNm)} NM, ± ${fmtId(p.estimatedHours)} jam.`,
    });
  }

  // ── Alokasi aset ──
  if (pipeline.allocation) {
    const al = pipeline.allocation;
    stages.push({
      no: nextStageNo(counter),
      worksheet: 'Alokasi Aset',
      title: 'Transit, sweep area, dan kebutuhan Ao',
      inputs: [
        { label: 'Ao (kotak datum)', value: fmtId(al.requiredAreaAoNm2) + ' NM²' },
        { label: 'Jumlah aset di-scene', value: String(al.perAsset.length) },
      ],
      steps: [
        { label: 'Total sweep area', formula: 'Σ (S × V × T efektif)', result: fmtId(al.totalSweepAreaNm2), unit: 'NM²' },
        { label: 'Coverage ratio', formula: 'sweep area / Ao', result: fmtId(al.coverageRatio * 100, 1) + '%' },
        { label: 'Rekomendasi', result: al.recommendation },
      ],
      resultSummary: `Sweep ${fmtId(al.totalSweepAreaNm2)} NM² vs Ao ${fmtId(al.requiredAreaAoNm2)} NM² → ${al.isSufficient ? 'CUKUP' : 'KURANG'} (${fmtId(al.coverageRatio * 100, 1)}%).`,
    });
  }

  return { stages, references, notes };
}

function seriesIntervalLabel(series: Array<{ obsTime: string }>): string {
  const hours = series.map((s) => {
    const m = /(\d{1,2})\.\d{2}\s+\w+$/.exec(s.obsTime);
    return m ? Number(m[1]) : null;
  }).filter((h): h is number => h !== null).sort((a, b) => a - b);
  if (hours.length < 2) return 'berwaktu';
  const diffs = new Set<number>();
  for (let i = 1; i < hours.length; i++) diffs.add(hours[i] - hours[i - 1]);
  return diffs.size === 1 && diffs.has(3) ? '3 jam' : '6 jam';
}

// ---------------------------------------------------------------------------
// Kunci jawaban — insiden DARAT (WS 3/WS 4 search radius)
// ---------------------------------------------------------------------------

function buildLandAnswerKey(sarCase: SarCaseSchema, planner: CasePlannerInputs): { stages: AnswerKeyStage[]; references: AnswerKeyReference[]; notes: string[] } {
  const counter = STAGE_NO();
  const stages: AnswerKeyStage[] = [];
  const notes: string[] = [];
  const search = sarCase.search ?? {};
  const platform = (search.landPlatform ?? 'fixed-wing') as LandSearchPlatform;
  const vegetation = (search.terrainVegetation ?? 'under-15') as LandVegetation;
  const target: LandSearchTarget = sarCase.target?.category === 'person'
    ? 'person'
    : ((sarCase.target?.wingspanM ?? 0) >= 25 ? 'aircraft-over-5700' : 'aircraft-under-5700');
  const isCrash = sarCase.incident.type === 'aircraft-land-crash';
  // Tr: pesawat = jarak LKP → tujuan rute; orang = jarak tempuh sejak terakhir terlihat.
  let trNm: number | undefined;
  if (isCrash && search.routeDestinationCoord) {
    const dest = search.routeDestinationCoord;
    trNm = haversineNm(
      { lat: sarCase.lkp?.coord?.lat ?? 0, lng: sarCase.lkp?.coord?.lng ?? 0 },
      { lat: dest.lat, lng: dest.lng },
    );
  } else if (search.lastSeenTrackNm !== undefined) {
    trNm = search.lastSeenTrackNm;
  }

  const references: AnswerKeyReference[] = [
    { id: 'I-9/I-10', title: 'Sweep width & vegetasi pencarian darat', usage: `Wu (${target}, ${platform}, visibilitas ${search.visibilityKm ?? 5} km) dan Fv (vegetasi ${vegetation}).` },
    { id: 'J-1/J-2/J-3', title: 'Nav fix error (x/y, %DR)', usage: 'x₀ fix error dasar (GPS 5 / non-GPS 10 NM) dan galat navigasi SRU y.' },
    { id: 'FS-TABLE', title: 'Safety factor fs pencarian darat 1–5', usage: `fs pencarian ke-${sarCase.search?.searchNumber ?? 1} dari 1.1/1.8/2.0/2.3/2.6.` },
  ];

  // x₀: planner memilih GPS/non-GPS (Tabel J-2) — default GPS 5 NM, dicatat sbg asumsi.
  const x0Nm = planner.landX0Nm ?? LAND_X0_NM.gps;
  notes.push(`x₀ = ${fmtId(x0Nm)} NM (Tabel J-2 — ${x0Nm === LAND_X0_NM.gps ? 'GPS' : 'non-GPS'}; pilihan planner, naskah tidak menetapkannya).`);
  // y: galat navigasi SRU (Tabel J-1) — default GPS 0.1 NM.
  const yNm = planner.landYNm ?? LAND_SRU_NAV_OPTIONS.find((o) => o.id === 'gps')?.value ?? 0.1;
  notes.push(`y = ${fmtId(yNm)} NM (Tabel J-1 — GPS; pilihan planner).`);

  const searchNumber = Math.min(5, Math.max(1, sarCase.search?.searchNumber ?? 1));
  const fs = LAND_FS_OPTIONS[searchNumber - 1] ?? 1.1;

  // ── Data rute ──
  if (isCrash && trNm !== undefined) {
    const dest = search.routeDestinationCoord;
    stages.push({
      no: nextStageNo(counter),
      worksheet: 'WS 4',
      title: 'Data rute dan Tr',
      inputs: [
        { label: 'LKP (posisi terakhir)', value: sarCase.lkp?.coord ? `${formatDMS(sarCase.lkp.coord.lat, false)} – ${formatDMS(sarCase.lkp.coord.lng, true)}` : '-' },
        { label: 'Tujuan rute', value: search.routeDestination ? `${search.routeDestination} (${dest ? `${formatDMS(dest.lat, false)} – ${formatDMS(dest.lng, true)}` : '-'})` : '-' },
      ],
      steps: [
        { label: 'Tr (jarak LKP → tujuan)', formula: 'great-circle (haversine)', result: fmtId(trNm), unit: 'NM' },
      ],
      resultSummary: `Tr = ${fmtId(trNm)} NM dari LKP ke ${search.routeDestination ?? 'tujuan'}.`,
    });
  }

  // ── Radius titik (posibility circle) di LKP/last-seen ──
  if (trNm !== undefined) {
    const radius = computePointRadius({ trNm, x0Nm, yNm, fs });
    stages.push({
      no: nextStageNo(counter),
      worksheet: 'WS 4',
      title: `Search radius possibility area (pencarian ke-${searchNumber})`,
      inputs: [
        { label: 'Tr', value: fmtId(radius.trNm) + ' NM' },
        { label: 'x₀', value: fmtId(x0Nm) + ' NM', refTable: 'Tabel J-2' },
        { label: 'y', value: fmtId(yNm) + ' NM', refTable: 'Tabel J-1' },
        { label: 'fs', value: fmtId(fs), refTable: 'FS-TABLE darat' },
      ],
      steps: [
        { label: 'x = x₀ + 0.1 × Tr', formula: 'DR 10% dari Tr (Tabel J-3 pesawat)', result: fmtId(radius.xNm), unit: 'NM', refTable: 'Tabel J-3' },
        { label: 'e = √(x² + y²)', formula: 'galat gabungan', result: fmtId(radius.eNm), unit: 'NM' },
        { label: 'R = e × fs', formula: 'radius pencarian', result: fmtId(radius.rNm), unit: 'NM' },
        { label: 'R (dibulatkan ke atas)', formula: 'ke bilangan bulat NM', result: `${radius.rRoundedNm} NM` },
      ],
      resultSummary: `Possibility circle radius ${radius.rRoundedNm} NM di sekitar titik ${isCrash ? 'LKP dan tujuan rute' : 'posisi terakhir terlihat'}.`,
    });
  }

  // ── Sweep width darat (Wu × Fv) + track spacing ──
  const heightFt: LandSearchHeight = 1000;
  const visibility = nearestLandVisibility(search.visibilityKm);
  const wu = lookupLandWu(target, heightFt, visibility);
  const fv = lookupLandFv(target, vegetation);
  if (wu !== null && fv !== null) {
    const width = wu * fv;
    const spacing = nearestLandTrackSpacing(width, platform);
    stages.push({
      no: nextStageNo(counter),
      worksheet: 'WS 3',
      title: 'Sweep width darat dan track spacing',
      inputs: [
        { label: 'Target', value: target },
        { label: 'Platform', value: platform === 'helicopter' ? 'helikopter' : 'pesawat sayap tetap' },
        { label: 'Ketinggian pencarian', value: `${heightFt} ft` },
        { label: 'Visibilitas', value: `${visibility} km` },
        { label: 'Vegetasi', value: vegetation, refTable: 'Tabel I-10' },
      ],
      steps: [
        { label: 'Wu (uncorrected)', formula: `${target} @ ${heightFt} ft / ${visibility} km`, result: fmtId(wu), unit: 'NM', refTable: 'Tabel I-9' },
        { label: 'Fv (vegetasi)', formula: `vegetasi ${vegetation}`, result: fmtId(fv), refTable: 'Tabel I-10' },
        { label: 'W = Wu × Fv', formula: 'sweep width darat', result: fmtId(width, 3), unit: 'NM' },
        { label: 'S (interval terdekat)', formula: platform === 'fixed-wing' ? 'kelipatan 0.5 NM' : 'kelipatan 0.25 NM', result: fmtId(spacing), unit: 'NM' },
      ],
      resultSummary: `W = ${fmtId(width, 2)} NM → S = ${fmtId(spacing)} NM (interval ${platform === 'fixed-wing' ? '0.5' : '0.25'} NM).`,
    });
  }

  // ── Area trapesium antara dua possibility circle (pesawat) ──
  if (isCrash && trNm !== undefined && search.routeDestinationCoord) {
    const rA = computePointRadius({ trNm, x0Nm, yNm, fs }).rRoundedNm;
    const rB = rA; // kedua titik memakai Tr yang sama → radius sama
    const trap = computeLegTrapezoid(trNm, rA, rB);
    stages.push({
      no: nextStageNo(counter),
      worksheet: 'WS 4',
      title: 'Area pencarian trapesium (garis singgung luar dua lingkaran)',
      inputs: [
        { label: 'Radius lingkaran A dan B', value: `${rA} NM` },
        { label: 'Jarak antar titik (Tr)', value: fmtId(trNm) + ' NM' },
      ],
      steps: [
        { label: 'Luas trapesium', formula: 'L = (a + b) × h / 2 (garis singgung luar)', result: fmtId(trap.areaSqNm), unit: 'NM²' },
      ],
      resultSummary: `Area pencarian trapesium ≈ ${fmtId(trap.areaSqNm)} NM² di sepanjang rute LKP → tujuan.`,
    });
  }

  return { stages, references, notes };
}

function nearestLandVisibility(km: number | undefined): number {
  const v = km ?? 5;
  return LAND_SEARCH_VISIBILITIES.reduce((best, candidate) =>
    Math.abs(candidate - v) < Math.abs(best - v) ? candidate : best, LAND_SEARCH_VISIBILITIES[0] as number);
}

// ---------------------------------------------------------------------------
// API utama
// ---------------------------------------------------------------------------

/** Kunci jawaban lengkap untuk satu kasus generator.
 *  Laut: hasil pipeline worksheet; darat: perhitungan WS 3/WS 4. */
export function buildCaseAnswerKey(
  sarCase: SarCaseSchema,
  planner: CasePlannerInputs = {},
  options: CasePipelineOptions = {},
): CaseAnswerKey {
  const isLand = sarCase.incident.type === 'aircraft-land-crash' || sarCase.incident.type === 'missing-person-land';
  const { stages, references, notes } = isLand
    ? buildLandAnswerKey(sarCase, planner)
    : buildMaritimeAnswerKey(sarCase, planner, options);

  // Rubrik dari tasksRequested — bobot dinormalisasi ke total tepat 100
  // (item terakhir menyerap sisa pembulatan).
  const tasks = sarCase.tasksRequested ?? [];
  const rawItems = tasks.map((t) => ({ task: t, ...RUBRIC_WEIGHTS[t] })).filter((i) => i.worksheet);
  const rawTotal = rawItems.reduce((sum, i) => sum + i.weight, 0);
  const rubric: AnswerKeyRubricItem[] = rawItems.map((i) => ({
    item: i.task,
    worksheet: i.worksheet,
    weight: Math.round((i.weight / rawTotal) * 1000) / 10,
    criteria: i.criteria,
  }));
  if (rubric.length > 0) {
    const sumExceptLast = rubric.slice(0, -1).reduce((sum, i) => sum + i.weight, 0);
    rubric[rubric.length - 1].weight = Math.round((100 - sumExceptLast) * 10) / 10;
  }

  return {
    caseTitle: sarCase.caseTitle ?? 'Soal latihan SAR',
    incidentType: sarCase.incident.type,
    generatorVersion: '5b',
    seed: sarCase.meta?.seed ?? '',
    stages,
    references,
    rubric,
    totalScore: 100,
    notes,
  };
}
