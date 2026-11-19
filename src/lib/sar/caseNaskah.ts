/**
 * CASE NASKAH (Fase 5a AI Copilot) — template naskah soal latihan SAR yang
 * meniru struktur naskah resmi Final Test PK-TAL (keputusan implementasi
 * no. 13): hal. 1 identitas + kronologi + instruksi; hal. 2 data target +
 * Aeronautical Drift + tabel angin per ketinggian; hal. 3 arus, deret angin,
 * dan tabel SRU. Template DINAMIS untuk jenis insiden pesawat/kapal — nilai
 * PK-TAL tidak di-hardcode.
 *
 * Aturan:
 *  - Tabel referensi IAMSAR/AUS SAR TIDAK dicetak ke naskah (hanya catatan
 *    bahwa peserta memakai lampiran resmi).
 *  - Koordinat dicetak gaya naskah (DMS); desimal tetap tersimpan di JSON
 *    kasus untuk worksheet.
 *  - Semua angka pada narasi berasal dari kasus (deterministik, tanpa LLM —
 *    narasi LLM ditambahkan di Fase 5b dan DIVALIDASI oleh
 *    `checkNaskahCoverage()` yang sama).
 *  - `case_completeness_check` = `checkNaskahCoverage()`: setiap field input
 *    worksheet yang relevan WAJIB muncul di naskah.
 */

import type { SarCaseSchema, CaseSru, CaseTarget } from './caseSchema';
import { formatDMS } from './coordFormat';

// ---------------------------------------------------------------------------
// Format angka & waktu gaya naskah (Bahasa Indonesia)
// ---------------------------------------------------------------------------

/** Angka gaya Indonesia: desimal koma, tanpa ribuan. */
export function fmtId(n: number, maxFrac = 2): string {
  if (!Number.isFinite(n)) return '-';
  const rounded = Number(n.toFixed(maxFrac));
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace('.', ',');
}

/** Arah 3 digit gaya naskah (055°). */
export function fmtHeading3(n: number): string {
  return `${Math.round(n) % 360}`.padStart(3, '0') + '°';
}

/** DMS berjarak gaya naskah: "06° 52′ 46″ S". */
export function formatDmsSpaced(dms: string): string {
  return dms.replace(/^(\d{2,3})°(\d{2})′(\d{2})″([NSEW])$/, '$1° $2′ $3″ $4');
}

/** DMS menit-desimal gaya tabel SRU: "6° 50,5′ S". */
export function formatDmsDecimalMinutes(value: number, isLng: boolean): string {
  const hemi = isLng ? (value >= 0 ? 'E' : 'W') : (value >= 0 ? 'N' : 'S');
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minutes = (abs - deg) * 60;
  const minStr = fmtId(minutes, minutes % 1 === 0 ? 0 : 1);
  return `${deg}° ${minStr}′ ${hemi}`;
}

export function formatCoordPairDmsDecimalMinutes(lat: number, lng: number): string {
  return `${formatDmsDecimalMinutes(lat, false)} – ${formatDmsDecimalMinutes(lng, true)}`;
}

/** Pecah string waktu kasus "18 November 2026 14.10 WIB" → date/time/zone. */
export function splitCaseTime(s: string): { date: string; time: string; zone: string } {
  const parts = s.trim().split(/\s+/);
  if (parts.length >= 3) {
    return { date: parts.slice(0, -2).join(' '), time: parts[parts.length - 2], zone: parts[parts.length - 1] };
  }
  return { date: s, time: '', zone: '' };
}

// ---------------------------------------------------------------------------
// Blok naskah
// ---------------------------------------------------------------------------

export type NaskahBlock =
  | { kind: 'identity'; openBook: boolean; date: string; fields: string[] }
  | { kind: 'title'; lines: string[] }
  | { kind: 'paragraph'; text: string; bold?: boolean }
  | { kind: 'section'; number: number; title: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbered'; items: string[] }
  | { kind: 'labelValue'; rows: Array<{ label: string; value: string }> }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'note'; text: string };

export interface CaseNaskah {
  caseTitle: string;
  blocks: NaskahBlock[];
  /** Rendisi teks polos (satu blok = beberapa baris) untuk coverage & print. */
  text: string;
  /** Deklarasi field → teks yang dicetak (untuk audit cepat di UI). */
  coveredFields: Record<string, string>;
}

export interface NaskahRenderOptions {
  /** True = nomor pencarian dinyatakan eksplisit di narasi (kasus mudah). */
  explicitSearchNumber?: boolean;
  /** Sertakan blok catatan "gunakan lampiran tabel resmi". */
  includeReferenceNote?: boolean;
  /** Gaya bahasa narasi (Fase 5b). Dengan `narrativeText`, teks narasi sudah
   *  dibangun `buildCaseNarrative()` (caseNarrative.ts) dan dipakai apa adanya. */
  narrativeText?: string;
}

/** Label vegetasi Tabel I-10 gaya naskah (dipakai juga caseNarrative). */
export function vegetationLabelOf(v?: string): string {
  switch (v) {
    case 'under-15': return 'vegetasi < 15%';
    case '15-60': return 'vegetasi 15-60%';
    case '60-85': return 'vegetasi 60-85%';
    case 'over-85': return 'vegetasi > 85%';
    default: return '';
  }
}

/** Label platform pencari darat gaya naskah. */
export function landPlatformLabelOf(p?: 'fixed-wing' | 'helicopter'): string {
  return p === 'helicopter' ? 'helikopter' : p === 'fixed-wing' ? 'pesawat sayap tetap' : '';
}

// ---------------------------------------------------------------------------
// Rendisi
// ---------------------------------------------------------------------------

const TASK_LABELS: Record<string, string> = {
  'aeronautical-drift': 'Perhitungan Aeronautical Drift',
  asw: 'ASW',
  'search-area-abcd': 'Search Area (gambar Search Area lengkap koordinat A B C D, koordinat Datum Point)',
  'wsc-pod': 'W, S, C, POD',
  'asset-allocation': 'Perhitungan alokasi Aset',
  'search-pattern-csp': 'Search Pattern (CSP & gambar)',
  'sru-task-assignment': 'pembagian tugas SRU di Lokasi',
  'land-search-radius': 'Perhitungan Search Radius darat (WS 3/WS 4)',
  renops: 'Rencana Operasi SAR (RENOPS)',
  briefing: 'Briefing',
  debriefing: 'De-briefing',
};

const TARGET_ROW_LABELS_AIRCRAFT: Array<{ key: keyof CaseTarget; label: string; unit?: string }> = [
  { key: 'name', label: 'Type' },
  { key: 'flag', label: 'Bendera' },
  { key: 'lengthM', label: 'Length', unit: 'm' },
  { key: 'wingspanM', label: 'Wingspan', unit: 'm' },
  { key: 'heightM', label: 'Height', unit: 'm' },
  { key: 'wingAreaM2', label: 'Wing area', unit: 'm2' },
  { key: 'cabinHeightM', label: 'Cabin height', unit: 'm' },
  { key: 'cabinWidthM', label: 'Cabin width', unit: 'm' },
  { key: 'cruiseSpeedKts', label: 'Cruise speed', unit: 'kn' },
  { key: 'stallSpeedKts', label: 'Stall speed', unit: 'kn' },
  { key: 'rangeNm', label: 'Range', unit: 'nmi' },
  { key: 'serviceCeilingFt', label: 'Service ceiling', unit: 'ft' },
  { key: 'rateOfClimbFpm', label: 'Rate of climb', unit: 'ft/min' },
  { key: 'wingLoadingKgM2', label: 'Wing loading', unit: 'kg/m2' },
  { key: 'frequencies', label: 'Frequencies Radio' },
  { key: 'payload', label: 'Muatan' },
  { key: 'navigation', label: 'Navigasi Equipment' },
];

const TARGET_ROW_LABELS_VESSEL: Array<{ key: keyof CaseTarget; label: string; unit?: string }> = [
  { key: 'name', label: 'Type' },
  { key: 'flag', label: 'Bendera' },
  { key: 'lengthM', label: 'Length', unit: 'm' },
  { key: 'heightM', label: 'Height', unit: 'm' },
  { key: 'cruiseSpeedKts', label: 'Cruise speed', unit: 'kn' },
  { key: 'rangeNm', label: 'Range', unit: 'nmi' },
  { key: 'frequencies', label: 'Frequencies Radio' },
  { key: 'payload', label: 'Muatan' },
  { key: 'navigation', label: 'Navigasi Equipment' },
];

/** Target orang (MOB / missing person) — hanya identitas. */
const TARGET_ROW_LABELS_PERSON: Array<{ key: keyof CaseTarget; label: string; unit?: string }> = [
  { key: 'name', label: 'Target' },
  { key: 'flag', label: 'Keterangan' },
];

const SRU_KIND_LABEL: Record<CaseSru['kind'], string> = {
  helicopter: 'Helikopter',
  'fixed-wing': 'Pesawat',
  vessel: 'Rescue Boat',
};

function targetValueString(target: CaseTarget, key: keyof CaseTarget): string | undefined {
  const v = target[key];
  if (v === undefined || v === null || v === '') return undefined;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'number') return fmtId(v);
  return String(v);
}

function enduranceString(sru: CaseSru): string | undefined {
  if (sru.enduranceHours === undefined) return undefined;
  const h = `${sru.enduranceHours} Jam`;
  if (sru.enduranceMinutes !== undefined && sru.enduranceMinutes > 0) {
    return `${sru.enduranceHours} jam ${sru.enduranceMinutes} menit`;
  }
  return h;
}

function sruCoordString(sru: CaseSru): string | undefined {
  if (!sru.coord) return undefined;
  return formatCoordPairDmsDecimalMinutes(sru.coord.lat, sru.coord.lng);
}

interface CoverageEntry {
  field: string;
  /** Konteks baris (bila nilainya di dalam baris tabel). */
  context?: string;
  value: string;
}

/** Daftar field kasus yang WAJIB muncul di naskah + bentuk teksnya.
 *  Ini satu-satunya sumber kebenaran coverage — dirender dan dicek dari sini. */
export function expectedNaskahFields(
  sarCase: SarCaseSchema,
  opts: NaskahRenderOptions = {},
): CoverageEntry[] {
  const out: CoverageEntry[] = [];
  const inc = sarCase.incident;
  const isDitching = inc.type === 'aircraft-ditching';
  const isPersonTarget = sarCase.target?.category === 'person';
  const isLand = inc.type === 'aircraft-land-crash' || inc.type === 'missing-person-land';

  out.push({ field: 'incident.callsign', value: inc.callsign ?? '-' });
  out.push({ field: 'incident.craftType', value: inc.craftType ?? '-' });
  out.push({ field: 'incident.pob', value: String(inc.pob ?? '-') });
  if (inc.lifeRaftCount !== undefined) {
    // Pemeriksaan berbasis konteks (frasa bebas bervariasi antar gaya bahasa);
    // kebenaran pasangan count×kapasitas dijaga ketat oleh parse-back.
    out.push({ field: 'incident.lifeRaft', context: 'life raft', value: String(inc.lifeRaftCount) });
    if (inc.lifeRaftCapacityPerRaft !== undefined) {
      out.push({ field: 'incident.lifeRaftCapacityPerRaft', context: 'life raft', value: String(inc.lifeRaftCapacityPerRaft) });
    }
  }
  out.push({ field: 'incident.infoSource', value: inc.infoSource ?? '-' });
  if (inc.reportTime) {
    const { time, zone } = splitCaseTime(inc.reportTime);
    out.push({ field: 'incident.reportTime', value: `${time} ${zone}` });
  }
  if (inc.lastContactTime) {
    const { date, time, zone } = splitCaseTime(inc.lastContactTime);
    out.push({ field: 'incident.lastContactTime', value: date, context: undefined });
    out.push({ field: 'incident.lastContactTime', value: `${time} ${zone}` });
  }
  if (inc.checkpoint) out.push({ field: 'incident.checkpoint', value: inc.checkpoint });
  if (inc.flightLevelFt !== undefined) out.push({ field: 'incident.flightLevelFt', value: `FL${inc.flightLevelFt}` });
  if (inc.altitudeFt !== undefined) out.push({ field: 'incident.altitudeFt', value: `${fmtId(inc.altitudeFt)} feet` });
  if (inc.headingDeg !== undefined) {
    const ref = inc.headingReference === 'magnetic' ? '(M)' : inc.headingReference === 'true' ? '(T)' : '';
    out.push({ field: 'incident.headingDeg', value: `${fmtId(inc.headingDeg)}°${ref}` });
  }
  if (inc.damageDescription) out.push({ field: 'incident.damageDescription', value: inc.damageDescription });
  if (inc.ditchingIndication) {
    out.push({ field: 'incident.ditchingIndication', value: isDitching ? 'ditching' : 'jatuh di darat' });
  }

  if (sarCase.sarOffice?.name) out.push({ field: 'sarOffice.name', value: sarCase.sarOffice.name });
  if (sarCase.sarOffice?.radialDegToLkp !== undefined) {
    out.push({ field: 'sarOffice.radialDegToLkp', value: `${fmtId(sarCase.sarOffice.radialDegToLkp)}°` });
  }
  if (sarCase.sarOffice?.transitHoursToLkp !== undefined) {
    // Konteks "jam" — frasa bebas bervariasi antar gaya; pasangan angka jam
    // divalidasi ketat oleh parse-back (sarOffice.transitHoursToLkp).
    out.push({ field: 'sarOffice.transitHoursToLkp', context: 'jam', value: fmtId(sarCase.sarOffice.transitHoursToLkp) });
  }

  if (sarCase.lkp?.coord) {
    out.push({
      field: 'lkp.coord',
      value: `${formatDmsSpaced(sarCase.lkp.coord.dmsLat ?? formatDMS(sarCase.lkp.coord.lat, false))} – ${formatDmsSpaced(sarCase.lkp.coord.dmsLng ?? formatDMS(sarCase.lkp.coord.lng, true))}`,
    });
  }

  // Blok target (pesawat/kapal/orang)
  const rows = isDitching ? TARGET_ROW_LABELS_AIRCRAFT : isPersonTarget ? TARGET_ROW_LABELS_PERSON : TARGET_ROW_LABELS_VESSEL;
  if (sarCase.target) {
    for (const row of rows) {
      const value = targetValueString(sarCase.target, row.key);
      if (value !== undefined) out.push({ field: `target.${String(row.key)}`, context: row.label, value });
    }
  }

  // Blok distrik/instansi pendukung (Fase 5b)
  for (const district of sarCase.supportingDistricts ?? []) {
    out.push({ field: 'supportingDistricts', value: district.name });
  }

  // Blok data pencarian darat (Fase 5b — WS 3/WS 4)
  if (isLand) {
    const search = sarCase.search;
    if (search?.routeDestination) out.push({ field: 'search.routeDestination', value: search.routeDestination });
    if (search?.routeDestinationCoord) {
      out.push({
        field: 'search.routeDestinationCoord',
        value: `${formatDmsSpaced(search.routeDestinationCoord.dmsLat ?? formatDMS(search.routeDestinationCoord.lat, false))} – ${formatDmsSpaced(search.routeDestinationCoord.dmsLng ?? formatDMS(search.routeDestinationCoord.lng, true))}`,
      });
    }
    if (search?.lastSeenTrackNm !== undefined) {
      out.push({ field: 'search.lastSeenTrackNm', value: `${fmtId(search.lastSeenTrackNm)} NM` });
    }
    const vegLabel = vegetationLabelOf(search?.terrainVegetation);
    if (vegLabel) out.push({ field: 'search.terrainVegetation', value: vegLabel });
    const platformLabel = landPlatformLabelOf(search?.landPlatform);
    if (platformLabel) out.push({ field: 'search.landPlatform', value: platformLabel });
  }

  // Blok Aeronautical Drift (pesawat)
  if (isDitching && sarCase.aeroDrift) {
    out.push({ field: 'aeroDrift.glideSpeedKts', context: 'Glide Speed', value: `${fmtId(sarCase.aeroDrift.glideSpeedKts ?? 0)} Knots` });
    out.push({ field: 'aeroDrift.glideRatio', context: 'Glide Ratio', value: `${fmtId(sarCase.aeroDrift.glideRatio ?? 0)}:1` });
    if (sarCase.aeroDrift.variationDeg !== undefined) {
      out.push({
        field: 'aeroDrift.variation',
        context: 'Variation',
        value: `${fmtId(sarCase.aeroDrift.variationDeg)}° ${sarCase.aeroDrift.variationDirection ?? 'E'}`,
      });
    }
    (sarCase.aeroDrift.windLayers ?? []).forEach((layer, idx) => {
      const label = layer.altitudeLabel ?? (layer.altitudeFt === 0 ? 'Surface' : `${layer.altitudeFt} Feet`);
      out.push({ field: `aeroDrift.windLayers[${idx}].dir`, context: label, value: fmtHeading3(layer.windDirFrom) });
      out.push({ field: `aeroDrift.windLayers[${idx}].speed`, context: label, value: fmtId(layer.windSpeedKts) });
    });
  }

  // Blok laut
  if (sarCase.sea?.current) {
    out.push({
      field: 'sea.current',
      context: 'Arus laut di lokasi',
      value: `${fmtHeading3(sarCase.sea.current.dirToDeg)} / ${fmtId(sarCase.sea.current.speedKts)} knots`,
    });
  }
  if (sarCase.sea?.waveHeightM !== undefined) {
    out.push({ field: 'sea.waveHeightM', context: 'Tinggi gelombang', value: `${fmtId(sarCase.sea.waveHeightM)} meter` });
  }
  (sarCase.sea?.surfaceWindSeries ?? []).forEach((entry, idx) => {
    out.push({ field: `sea.surfaceWindSeries[${idx}]`, context: entry.obsTime, value: `${fmtHeading3(entry.windDirFrom)} / ${fmtId(entry.windSpeedKts)} kts` });
  });

  if (sarCase.search?.datumTime) {
    const { time, zone } = splitCaseTime(sarCase.search.datumTime);
    out.push({ field: 'search.datumTime', value: `${time} ${zone}` });
  }
  for (const stage of sarCase.search?.stagesDone ?? []) {
    out.push({ field: `search.stagesDone[${stage.stage}]`, value: `stage ${stage.stage}` });
  }
  if (opts.explicitSearchNumber && sarCase.search?.searchNumber !== undefined) {
    out.push({ field: 'search.searchNumber', value: `pencarian ke-${sarCase.search.searchNumber}` });
  }

  // SRU
  for (const sru of sarCase.sru ?? []) {
    const col = sru.callsign;
    out.push({ field: `sru[${col}].callsign`, context: 'Call-Sign', value: col });
    out.push({ field: `sru[${col}].model`, context: 'Tipe', value: sru.model ?? '-' });
    if (sruCoordString(sru)) out.push({ field: `sru[${col}].coord`, context: 'Koordinat lokasi aset', value: sruCoordString(sru) as string });
    if (enduranceString(sru)) out.push({ field: `sru[${col}].endurance`, context: 'Endurance', value: enduranceString(sru) as string });
    if (sru.tasMaxKts !== undefined) out.push({ field: `sru[${col}].tasMaxKts`, context: 'TAS / Speed Max', value: fmtId(sru.tasMaxKts) });
    if (sru.tasSearchKts !== undefined) out.push({ field: `sru[${col}].tasSearchKts`, context: 'TAS / Speed di', value: fmtId(sru.tasSearchKts) });
    if (sru.visibilityKm !== undefined) out.push({ field: `sru[${col}].visibilityKm`, context: 'Visibility', value: fmtId(sru.visibilityKm) });
    if (sru.windDirFrom !== undefined) {
      out.push({ field: `sru[${col}].wind`, context: 'Wind', value: `${fmtHeading3(sru.windDirFrom)} / ${fmtId(sru.windSpeedKts ?? 0)} kts` });
    }
    if (sru.observerCondition) out.push({ field: `sru[${col}].observerCondition`, context: 'Kondisi Observer', value: sru.observerCondition });
    if (sru.taf) out.push({ field: `sru[${col}].taf`, context: 'TAF', value: sru.taf });
    if (sru.frequencies) out.push({ field: `sru[${col}].frequencies`, context: 'Radio Frequencies', value: sru.frequencies.join(' and ') });
    if (sru.captain) out.push({ field: `sru[${col}].captain`, context: 'Captain', value: sru.captain });
    if (sru.phoneSatellite) out.push({ field: `sru[${col}].phoneSatellite`, context: 'HP Satelite', value: sru.phoneSatellite });
    if (sru.navigation) out.push({ field: `sru[${col}].navigation`, context: 'Navigation', value: sru.navigation.join(', ') });
  }

  return out;
}

/** Susun blok naskah lengkap. Narasi: `opts.narrativeText` (gaya bahasa Fase
 *  5b) bila ada; selain itu template bawaan gaya naskah resmi (deterministik,
 *  tanpa LLM). Data section selalu dirender dari kasus. */
export function renderCaseNaskah(
  sarCase: SarCaseSchema,
  opts: NaskahRenderOptions = {},
): CaseNaskah {
  const inc = sarCase.incident;
  const isAircraft = inc.type === 'aircraft-ditching';
  const isLand = inc.type === 'aircraft-land-crash' || inc.type === 'missing-person-land';
  const callsign = inc.callsign ?? 'TARGET';
  const blocks: NaskahBlock[] = [];
  const covered: Record<string, string> = {};
  const mark = (entries: CoverageEntry[]) => {
    for (const e of entries) {
      covered[e.field] = e.context ? `${e.context} ⇒ ${e.value}` : e.value;
    }
  };

  // ── Kop & identitas ──
  const exam = sarCase.examHeader ?? {};
  blocks.push({
    kind: 'identity',
    openBook: exam.isOpenBook ?? true,
    date: exam.examDate ?? '',
    fields: ['Nama', 'Unit Kerja', 'Nomor PIN'],
  });
  const titleLines = [
    exam.title ?? 'SOAL LATIHAN',
    `${exam.trainingName ?? 'Diklat SAR Tingkat Spesialis SAR Planning'}${exam.angkatan ? ` Angk. ${exam.angkatan}` : ''}${exam.year ? ` Tahun ${exam.year}` : ''}`,
    `Waktu: ${exam.durationMinutes ?? 360} Menit`,
  ];
  blocks.push({ kind: 'title', lines: titleLines });

  // ── Narasi kronologi ──
  const reportParts = inc.reportTime ? splitCaseTime(inc.reportTime) : null;
  const lastContactParts = inc.lastContactTime ? splitCaseTime(inc.lastContactTime) : null;
  const datumParts = sarCase.search?.datumTime ? splitCaseTime(sarCase.search.datumTime) : null;
  const office = sarCase.sarOffice?.name ?? 'Kantor SAR';
  const stages = sarCase.search?.stagesDone ?? [];
  const stageList = stages.length === 0
    ? ''
    : stages.length === 1
      ? 'stage 1'
      : `${stages.map((s) => `stage ${s.stage}`).slice(0, -1).join(', ')} dan stage ${stages[stages.length - 1]?.stage ?? ''}`;
  const stageSentence = stages.length === 0
    ? 'Pencarian belum dilakukan; pencarian pertama dilaksanakan pada Datum Time.'
    : `Dan pencarian ${stageList} sudah dilakukan namun belum membuahkan hasil.`;
  const taskItems = (sarCase.tasksRequested ?? []).map((t) => TASK_LABELS[t] ?? t);
  const incidentTypeLabel = isAircraft
    ? 'Kecelakaan Pesawat'
    : isLand
      ? (inc.type === 'aircraft-land-crash' ? 'Kecelakaan Pesawat Darat' : 'Pencarian Orang Hilang Darat')
      : inc.type === 'person-overboard'
        ? 'Man Overboard'
        : 'Kecelakaan Kapal';

  if (opts.narrativeText) {
    // Fase 5b: narasi gaya bahasa pilihan instruktur (buildCaseNarrative).
    blocks.push({ kind: 'paragraph', text: opts.narrativeText });
  } else if (isAircraft) {
    const narrative = [
      `Pada tanggal ${reportParts?.date ?? ''} pukul ${reportParts?.time ?? ''} ${reportParts?.zone ?? ''} ${office} menerima informasi dari ${inc.infoSource ?? 'ATS'}, bahwa pada tanggal ${lastContactParts?.date ?? ''} pukul ${lastContactParts?.time ?? ''} ${lastContactParts?.zone ?? ''} ${inc.infoSource ?? 'ATS'} menerima panggilan "MAYDAY" dari pesawat dengan callsign ${callsign} setelah cek point ${inc.checkpoint ?? '-'} di ketinggian FL${inc.flightLevelFt ?? '-'} dengan heading ${fmtId(inc.headingDeg ?? 0)}°${inc.headingReference === 'magnetic' ? '(M)' : inc.headingReference === 'true' ? '(T)' : ''}.`,
      `Dilaporkan bahwa ${callsign} mengalami ${inc.damageDescription ?? 'kerusakan'} dan diindikasikan akan ditching.`,
      `Berdasarkan data flight plan, perlengkapan keselamatan yang tersedia di ${callsign} adalah ${inc.lifeRaftCount ?? 0} buah life raft kapasitas ${inc.lifeRaftCapacityPerRaft ?? '-'} orang dan POB ${callsign} sebanyak ${inc.pob ?? '-'} orang.`,
      `Radial LKP dari ${office} adalah ${fmtId(sarCase.sarOffice?.radialDegToLkp ?? 0)}° dan waktu tempuh ke LKP ± ${fmtId(sarCase.sarOffice?.transitHoursToLkp ?? 0)} jam.`,
      `Berdasarkan perhitungan Aeronautical Drift, dihasilkan koordinat perkiraan ditching ${callsign}.`,
      stageSentence,
      opts.explicitSearchNumber && sarCase.search?.searchNumber !== undefined
        ? `Pencarian selanjutnya adalah pencarian ke-${sarCase.search.searchNumber} dan akan dimulai pada ${datumParts?.date ?? ''} pukul ${datumParts?.time ?? ''} ${datumParts?.zone ?? ''} (Datum Time).`
        : `Pencarian selanjutnya akan dimulai pada ${datumParts?.date ?? ''} pukul ${datumParts?.time ?? ''} ${datumParts?.zone ?? ''} (Datum Time).`,
    ].join(' ');
    blocks.push({ kind: 'paragraph', text: narrative });
  } else if (isLand) {
    const lkpCoord = sarCase.lkp?.coord;
    const destCoord = sarCase.search?.routeDestinationCoord;
    const narrative = [
      `Pada tanggal ${reportParts?.date ?? ''} pukul ${reportParts?.time ?? ''} ${reportParts?.zone ?? ''} ${office} menerima informasi dari ${inc.infoSource ?? 'unit darat'}, bahwa pada tanggal ${lastContactParts?.date ?? ''} pukul ${lastContactParts?.time ?? ''} ${lastContactParts?.zone ?? ''} ${callsign} (${inc.craftType ?? 'target'}) mengalami kejadian darurat di wilayah darat.`,
      inc.type === 'aircraft-land-crash'
        ? `Dilaporkan bahwa ${callsign} mengalami ${inc.damageDescription ?? 'kerusakan'} dan diindikasikan jatuh di darat pada posisi ${lkpCoord ? `${formatDmsSpaced(lkpCoord.dmsLat ?? formatDMS(lkpCoord.lat, false))} – ${formatDmsSpaced(lkpCoord.dmsLng ?? formatDMS(lkpCoord.lng, true))}` : '-'}.`
        : `Posisi terakhir terlihat dilaporkan pada koordinat ${lkpCoord ? `${formatDmsSpaced(lkpCoord.dmsLat ?? formatDMS(lkpCoord.lat, false))} – ${formatDmsSpaced(lkpCoord.dmsLng ?? formatDMS(lkpCoord.lng, true))}` : '-'}, dengan perkiraan jarak tempuh sejak terakhir terlihat ${fmtId(sarCase.search?.lastSeenTrackNm ?? 0)} NM.`,
      sarCase.search?.routeDestination
        ? `Rute diperkirakan menuju ${sarCase.search.routeDestination}${destCoord ? ` (${formatDmsSpaced(destCoord.dmsLat ?? formatDMS(destCoord.lat, false))} – ${formatDmsSpaced(destCoord.dmsLng ?? formatDMS(destCoord.lng, true))})` : ''}.`
        : '',
      `Jumlah orang yang dicari (POB) sebanyak ${inc.pob ?? '-'} orang.`,
      `Radial LKP dari ${office} adalah ${fmtId(sarCase.sarOffice?.radialDegToLkp ?? 0)}° dan waktu tempuh ke LKP ± ${fmtId(sarCase.sarOffice?.transitHoursToLkp ?? 0)} jam.`,
      stageSentence,
      opts.explicitSearchNumber && sarCase.search?.searchNumber !== undefined
        ? `Pencarian selanjutnya adalah pencarian ke-${sarCase.search.searchNumber} dan akan dimulai pada ${datumParts?.date ?? ''} pukul ${datumParts?.time ?? ''} ${datumParts?.zone ?? ''} (Datum Time).`
        : `Pencarian selanjutnya akan dimulai pada ${datumParts?.date ?? ''} pukul ${datumParts?.time ?? ''} ${datumParts?.zone ?? ''} (Datum Time).`,
    ].filter((s) => s.length > 0).join(' ');
    blocks.push({ kind: 'paragraph', text: narrative });
  } else if (inc.type === 'person-overboard') {
    const lkpCoord = sarCase.lkp?.coord;
    const narrative = [
      `Pada tanggal ${reportParts?.date ?? ''} pukul ${reportParts?.time ?? ''} ${reportParts?.zone ?? ''} ${office} menerima informasi dari ${inc.infoSource ?? 'MRA/ATS'}, bahwa pada tanggal ${lastContactParts?.date ?? ''} pukul ${lastContactParts?.time ?? ''} ${lastContactParts?.zone ?? ''} satu orang awak jatuh ke laut (Man Overboard) dari ${inc.craftType ?? 'kapal'} ${callsign} pada posisi ${lkpCoord ? `${formatDmsSpaced(lkpCoord.dmsLat ?? formatDMS(lkpCoord.lat, false))} – ${formatDmsSpaced(lkpCoord.dmsLng ?? formatDMS(lkpCoord.lng, true))}` : '-'}.`,
      `Kapal melaporkan POB sebanyak ${inc.pob ?? '-'} orang dan membawa ${inc.lifeRaftCount ?? 0} buah life raft kapasitas ${inc.lifeRaftCapacityPerRaft ?? '-'} orang.`,
      `Radial LKP dari ${office} adalah ${fmtId(sarCase.sarOffice?.radialDegToLkp ?? 0)}° dan waktu tempuh ke LKP ± ${fmtId(sarCase.sarOffice?.transitHoursToLkp ?? 0)} jam.`,
      stageSentence,
      opts.explicitSearchNumber && sarCase.search?.searchNumber !== undefined
        ? `Pencarian selanjutnya adalah pencarian ke-${sarCase.search.searchNumber} dan akan dimulai pada ${datumParts?.date ?? ''} pukul ${datumParts?.time ?? ''} ${datumParts?.zone ?? ''} (Datum Time).`
        : `Pencarian selanjutnya akan dimulai pada ${datumParts?.date ?? ''} pukul ${datumParts?.time ?? ''} ${datumParts?.zone ?? ''} (Datum Time).`,
    ].join(' ');
    blocks.push({ kind: 'paragraph', text: narrative });
  } else {
    const lkpCoord = sarCase.lkp?.coord;
    const narrative = [
      `Pada tanggal ${reportParts?.date ?? ''} pukul ${reportParts?.time ?? ''} ${reportParts?.zone ?? ''} ${office} menerima informasi dari ${inc.infoSource ?? 'MRA/ATS'}, bahwa pada tanggal ${lastContactParts?.date ?? ''} pukul ${lastContactParts?.time ?? ''} ${lastContactParts?.zone ?? ''} ${inc.infoSource ?? 'MRA/ATS'} menerima laporan darurat dari kapal ${callsign} (${inc.craftType ?? 'kapal'}).`,
      `Kapal dilaporkan dalam kondisi darurat dan akan tenggelam pada posisi ${lkpCoord ? `${formatDmsSpaced(lkpCoord.dmsLat ?? formatDMS(lkpCoord.lat, false))} – ${formatDmsSpaced(lkpCoord.dmsLng ?? formatDMS(lkpCoord.lng, true))}` : '-'}.`,
      `Berdasarkan data pelayaran, perlengkapan keselamatan yang tersedia di ${callsign} adalah ${inc.lifeRaftCount ?? 0} buah life raft kapasitas ${inc.lifeRaftCapacityPerRaft ?? '-'} orang dan POB sebanyak ${inc.pob ?? '-'} orang.`,
      `Radial LKP dari ${office} adalah ${fmtId(sarCase.sarOffice?.radialDegToLkp ?? 0)}° dan waktu tempuh ke LKP ± ${fmtId(sarCase.sarOffice?.transitHoursToLkp ?? 0)} jam.`,
      stageSentence,
      opts.explicitSearchNumber && sarCase.search?.searchNumber !== undefined
        ? `Pencarian selanjutnya adalah pencarian ke-${sarCase.search.searchNumber} dan akan dimulai pada ${datumParts?.date ?? ''} pukul ${datumParts?.time ?? ''} ${datumParts?.zone ?? ''} (Datum Time).`
        : `Pencarian selanjutnya akan dimulai pada ${datumParts?.date ?? ''} pukul ${datumParts?.time ?? ''} ${datumParts?.zone ?? ''} (Datum Time).`,
    ].join(' ');
    blocks.push({ kind: 'paragraph', text: narrative });
  }

  // ── Instruksi ──
  blocks.push({
    kind: 'paragraph',
    bold: true,
    text: `Buatlah Rencana Operasi SAR ${incidentTypeLabel} ${callsign.replace(/\s+$/, '')} yang meliputi : ${taskItems.join(', ')} dengan data-data sebagai berikut:`,
  });

  // ── Bagian 1: Data target ──
  let sectionNumber = 1;
  const target = sarCase.target;
  const isPersonTarget = target?.category === 'person';
  blocks.push({
    kind: 'section',
    number: sectionNumber,
    title: `Data ${isAircraft ? 'Pesawat' : isPersonTarget ? 'Target' : 'Kapal'} ${callsign}`,
  });
  if (target) {
    const rows = (isAircraft ? TARGET_ROW_LABELS_AIRCRAFT : isPersonTarget ? TARGET_ROW_LABELS_PERSON : TARGET_ROW_LABELS_VESSEL)
      .map(({ key, label }) => {
        const value = targetValueString(target, key);
        return value !== undefined ? { label, value } : null;
      })
      .filter((r): r is { label: string; value: string } => r !== null);
    blocks.push({ kind: 'labelValue', rows });
  }
  sectionNumber += 1;

  // ── Bagian distrik/instansi pendukung (Fase 5b) ──
  const districts = sarCase.supportingDistricts ?? [];
  if (districts.length > 0) {
    blocks.push({ kind: 'section', number: sectionNumber, title: 'Distrik/instansi SAR pendukung :' });
    blocks.push({ kind: 'bullets', items: districts.map((d) => `${d.name}${d.note ? ` — ${d.note}` : ''}`) });
    sectionNumber += 1;
  }

  // ── Bagian 2 (pesawat): Aeronautical Drift + tabel angin ──
  if (isAircraft && sarCase.aeroDrift) {
    const aero = sarCase.aeroDrift;
    const lkpCoord = sarCase.lkp?.coord;
    const bullets: string[] = [];
    if (lkpCoord) {
      bullets.push(`Koordinat Lost Contact : ${formatDmsSpaced(lkpCoord.dmsLat ?? formatDMS(lkpCoord.lat, false))} – ${formatDmsSpaced(lkpCoord.dmsLng ?? formatDMS(lkpCoord.lng, true))}`);
    }
    bullets.push(`Glide Speed : ${fmtId(aero.glideSpeedKts ?? 0)} Knots`);
    bullets.push(`Glide Ratio : ${fmtId(aero.glideRatio ?? 0)}:1`);
    if (aero.variationDeg !== undefined) {
      bullets.push(`Variation : ${fmtId(aero.variationDeg)}° ${aero.variationDirection ?? 'E'}`);
    }
    blocks.push({ kind: 'section', number: sectionNumber, title: 'Data perhitungan Aeronautical Drift :' });
    blocks.push({ kind: 'bullets', items: bullets });
    if ((aero.windLayers ?? []).length > 0) {
      blocks.push({
        kind: 'table',
        columns: ['ALTITUDE', 'DIRECTION', 'VELOCITY'],
        rows: (aero.windLayers ?? []).map((layer) => [
          layer.altitudeLabel ?? (layer.altitudeFt === 0 ? 'Surface' : `${layer.altitudeFt} Feet`),
          fmtHeading3(layer.windDirFrom),
          fmtId(layer.windSpeedKts),
        ]),
      });
    }
    sectionNumber += 1;
  }

  // ── Bagian pencarian darat (Fase 5b — WS 3/WS 4) ──
  if (isLand) {
    const lkpCoord = sarCase.lkp?.coord;
    const bullets: string[] = [];
    if (lkpCoord) {
      bullets.push(`Koordinat posisi terakhir : ${formatDmsSpaced(lkpCoord.dmsLat ?? formatDMS(lkpCoord.lat, false))} – ${formatDmsSpaced(lkpCoord.dmsLng ?? formatDMS(lkpCoord.lng, true))}`);
    }
    if (sarCase.search?.routeDestination) {
      const destCoord = sarCase.search.routeDestinationCoord;
      bullets.push(`Tujuan rute : ${sarCase.search.routeDestination}${destCoord ? ` (${formatDmsSpaced(destCoord.dmsLat ?? formatDMS(destCoord.lat, false))} – ${formatDmsSpaced(destCoord.dmsLng ?? formatDMS(destCoord.lng, true))})` : ''}`);
    }
    if (sarCase.search?.lastSeenTrackNm !== undefined) {
      bullets.push(`Perkiraan jarak tempuh sejak terakhir terlihat : ${fmtId(sarCase.search.lastSeenTrackNm)} NM`);
    }
    const vegLabel = vegetationLabelOf(sarCase.search?.terrainVegetation);
    if (vegLabel) bullets.push(`Kondisi wilayah : ${vegLabel}`);
    const platformLabel = landPlatformLabelOf(sarCase.search?.landPlatform);
    if (platformLabel) bullets.push(`Platform pencarian : ${platformLabel}`);
    blocks.push({ kind: 'section', number: sectionNumber, title: 'Data pencarian darat (WS 3/WS 4) :' });
    blocks.push({ kind: 'bullets', items: bullets });
    sectionNumber += 1;
  }

  // ── Bagian terakhir: arus, angin, gelombang, SRU ──
  const seaBullets: string[] = [];
  if (sarCase.sea?.current) {
    seaBullets.push(`Arus laut di lokasi : ${fmtHeading3(sarCase.sea.current.dirToDeg)} / ${fmtId(sarCase.sea.current.speedKts)} knots`);
  }
  if (sarCase.sea?.waveHeightM !== undefined) {
    seaBullets.push(`Tinggi gelombang di lokasi : ${fmtId(sarCase.sea.waveHeightM)} meter`);
  }
  blocks.push({
    kind: 'section',
    number: sectionNumber,
    title: isLand
      ? 'Data angin, dan asset SRU :'
      : `Data arus${sarCase.sea?.waveHeightM !== undefined ? ', gelombang,' : ''} angin, dan asset SRU :`,
  });
  if (seaBullets.length > 0) blocks.push({ kind: 'bullets', items: seaBullets });
  const series = sarCase.sea?.surfaceWindSeries ?? [];
  if (series.length > 0) {
    const firstDay = series[0] ? splitCaseTime(series[0].obsTime).date : '';
    const lastDay = series.length > 0 ? splitCaseTime(series[series.length - 1].obsTime).date : '';
    const dateRange = firstDay && lastDay && firstDay !== lastDay
      ? `Data angin dari tanggal ${firstDay} s.d. ${lastDay}:`
      : `Data angin dari tanggal ${firstDay}:`;
    blocks.push({ kind: 'paragraph', text: dateRange });
    blocks.push({
      kind: 'numbered',
      items: series.map((entry) => {
        const { date, time, zone } = splitCaseTime(entry.obsTime);
        return `${date} ${time} ${zone}  ${fmtHeading3(entry.windDirFrom)} / ${fmtId(entry.windSpeedKts)} kts`;
      }),
    });
  }
  if ((sarCase.sru ?? []).length > 0) {
    const columns = ['SRU', ...(sarCase.sru ?? []).map((s) => SRU_KIND_LABEL[s.kind])];
    const cell = (sru: CaseSru, value: string) => value; // placeholder agar tipe jelas
    void cell;
    const rowDefs: Array<{ label: string; valueOf: (sru: CaseSru) => string | undefined }> = [
      { label: 'Tipe', valueOf: (s) => s.model },
      { label: 'Koordinat lokasi aset', valueOf: (s) => sruCoordString(s) },
      { label: 'Endurance', valueOf: (s) => enduranceString(s) },
      { label: 'Call-Sign', valueOf: (s) => s.callsign },
      { label: 'TAS / Speed Max', valueOf: (s) => (s.tasMaxKts !== undefined ? `${fmtId(s.tasMaxKts)} kts` : undefined) },
      { label: 'TAS / Speed di area pencarian', valueOf: (s) => (s.tasSearchKts !== undefined ? `${fmtId(s.tasSearchKts)} kts` : undefined) },
      { label: 'Visibility', valueOf: (s) => (s.visibilityKm !== undefined ? `${fmtId(s.visibilityKm)} km` : undefined) },
      { label: 'Wind', valueOf: (s) => (s.windDirFrom !== undefined ? `${fmtHeading3(s.windDirFrom)} / ${fmtId(s.windSpeedKts ?? 0)} kts` : undefined) },
      { label: 'Kondisi Observer', valueOf: (s) => s.observerCondition },
      { label: 'TAF', valueOf: (s) => s.taf },
      { label: 'Radio Frequencies', valueOf: (s) => (s.frequencies ? s.frequencies.join(' and ') : undefined) },
      { label: 'Captain', valueOf: (s) => s.captain },
      { label: 'HP Satelite', valueOf: (s) => s.phoneSatellite },
      { label: 'Navigation Equipment', valueOf: (s) => (s.navigation ? s.navigation.join(', ') : undefined) },
    ];
    const rows = rowDefs.map(({ label, valueOf }) => [
      label,
      ...(sarCase.sru ?? []).map((sru) => valueOf(sru) ?? '-'),
    ]);
    blocks.push({ kind: 'table', columns, rows });
  }

  // ── Catatan referensi ──
  if (opts.includeReferenceNote !== false) {
    blocks.push({
      kind: 'note',
      text: 'Tabel referensi IAMSAR/AUS SAR (Lampiran I-N, J) TIDAK disertakan dalam naskah ini — gunakan lampiran tabel resmi yang disediakan.',
    });
  }

  const text = naskahToPlainText(blocks);
  mark(expectedNaskahFields(sarCase, opts));
  return {
    caseTitle: sarCase.caseTitle ?? callsign,
    blocks,
    text,
    coveredFields: covered,
  };
}

/** Rendisi teks polos: labelValue "label : value", table rows "c1 — c2 — c3". */
export function naskahToPlainText(blocks: NaskahBlock[]): string {
  const lines: string[] = [];
  let sectionNumber = 0;
  for (const block of blocks) {
    switch (block.kind) {
      case 'identity':
        lines.push(`Open Book: ${block.openBook ? 'Ya' : 'Tidak'}`);
        if (block.date) lines.push(`Tanggal: ${block.date}`);
        lines.push(block.fields.join(' / '));
        lines.push('');
        break;
      case 'title':
        lines.push(...block.lines, '');
        break;
      case 'paragraph':
        lines.push(block.text, '');
        break;
      case 'section':
        sectionNumber += 1;
        lines.push(`${sectionNumber}. ${block.title}`, '');
        break;
      case 'bullets':
        lines.push(...block.items.map((i) => `- ${i}`), '');
        break;
      case 'numbered':
        lines.push(...block.items.map((i, idx) => `${idx + 1}) ${i}`), '');
        break;
      case 'labelValue':
        lines.push(...block.rows.map((r) => `${r.label} : ${r.value}`), '');
        break;
      case 'table':
        lines.push(block.columns.join(' — '));
        lines.push(...block.rows.map((r) => r.join(' — ')));
        lines.push('');
        break;
      case 'note':
        lines.push(`Catatan: ${block.text}`, '');
        break;
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// case_completeness_check — coverage field kasus terhadap teks naskah
// ---------------------------------------------------------------------------

export interface NaskahCoverageIssue {
  field: string;
  expected: string;
  reason: string;
}

export interface NaskahCoverage {
  covered: boolean;
  total: number;
  coveredCount: number;
  issues: NaskahCoverageIssue[];
}

function normalizeForMatch(s: string): string {
  return s
    .replace(/[\u00B0\u2070]/g, '°')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Periksa setiap field wajib muncul di teks naskah (per baris, dengan konteks
 *  bila nilainya bagian dari baris tabel). Dipakai pada naskah template Fase
 *  5a DAN narasi LLM Fase 5b. */
export function checkNaskahCoverage(
  sarCase: SarCaseSchema,
  naskah: { text: string } | { text: string; coveredFields?: Record<string, string> },
  opts: NaskahRenderOptions = {},
): NaskahCoverage {
  const expected = expectedNaskahFields(sarCase, opts);
  const declared = 'coveredFields' in naskah ? naskah.coveredFields ?? {} : undefined;
  const lines = naskah.text.split('\n').map(normalizeForMatch);
  const issues: NaskahCoverageIssue[] = [];
  let coveredCount = 0;

  for (const entry of expected) {
    const value = normalizeForMatch(entry.value);
    const context = entry.context ? normalizeForMatch(entry.context) : undefined;
    let covered: boolean;
    if (context) {
      covered = lines.some((line) => line.includes(context) && line.includes(value));
    } else {
      covered = lines.some((line) => line.includes(value));
    }
    if (covered) coveredCount += 1;
    else {
      issues.push({
        field: entry.field,
        expected: entry.context ? `${entry.context} ⇒ ${entry.value}` : entry.value,
        reason: context
          ? `Tidak ada baris berisi "${entry.context}" dan "${entry.value}".`
          : `Teks naskah tidak memuat "${entry.value}".`,
      });
    }
    if (declared && !(entry.field in declared)) {
      issues.push({
        field: entry.field,
        expected: entry.context ? `${entry.context} ⇒ ${entry.value}` : entry.value,
        reason: 'Field tidak dideklarasikan di coveredFields naskah.',
      });
    }
  }

  return {
    covered: issues.length === 0,
    total: expected.length,
    coveredCount,
    issues,
  };
}
