/**
 * CASE NARRATIVE (Fase 5b AI Copilot) — mesin variasi narasi soal SAR.
 *
 * Prinsip mutlak (requirement Fase 5b no. 4 & 5):
 *  - SEMUA angka/spesifikasi berasal dari `SarCaseSchema` hasil generator
 *    deterministik. Modul ini TIDAK pernah menciptakan nilai baru — ia hanya
 *    menyusun kalimat dari nilai kasus dengan pola yang bervariasi.
 *  - Gaya bahasa: 'formal-ujian' (ujian kedinasan), 'narasi-operasional'
 *    (laporan operasi), 'skenario-simulasi' (skenario latihan), 'otomatis'
 *    (dipilih dari seed → instruktur mendapat variasi maksimal).
 *  - Pola kalimat & susunan informasi BERVARIASI lewat bank fragmen (tiap
 *    posisi punya ≥3 varian) + pengacakan urutan blok yang aman — sehingga
 *    soal dengan angka berbeda TIDAK terasa seperti template yang sama.
 *  - `parseBackNarrativeValues()` mem-parse kembali teks narasi menjadi nilai
 *    terstruktur dan membandingkannya dengan kasus — guardrail bahwa narasi
 *    tidak mengubah CaseSchema (dipakai test + validasi narasi LLM).
 *
 * Dependensi satu arah: modul ini memakai helper format dari caseNaskah.ts;
 * caseNaskah TIDAK mengimpor modul ini (renderCaseNaskah menerima teks
 * narasi jadi lewat opsi `narrativeText`).
 */

import type { SarCaseSchema, CaseIncident } from './caseSchema';
import { createRng, type Rng } from './caseGenerator';
import { fmtId, formatDmsSpaced, splitCaseTime, vegetationLabelOf, landPlatformLabelOf } from './caseNaskah';
import { formatDMS } from './coordFormat';

// ---------------------------------------------------------------------------
// Gaya bahasa
// ---------------------------------------------------------------------------

export const NARRATIVE_STYLES = ['formal-ujian', 'narasi-operasional', 'skenario-simulasi', 'otomatis'] as const;
export type NarrativeStyle = (typeof NARRATIVE_STYLES)[number];
export type ConcreteNarrativeStyle = Exclude<NarrativeStyle, 'otomatis'>;

export const NARRATIVE_STYLE_LABELS: Record<NarrativeStyle, string> = {
  'formal-ujian': 'Formal ujian kedinasan',
  'narasi-operasional': 'Narasi operasional',
  'skenario-simulasi': 'Skenario simulasi kejadian',
  'otomatis': 'Variasi otomatis (dari seed)',
};

/** 'otomatis' → salah satu gaya konkret dari seed (deterministik). */
export function resolveNarrativeStyle(style: NarrativeStyle, rng: Rng): ConcreteNarrativeStyle {
  if (style !== 'otomatis') return style;
  return rng.pick<ConcreteNarrativeStyle>(['formal-ujian', 'narasi-operasional', 'skenario-simulasi']);
}

// ---------------------------------------------------------------------------
// Konteks narasi — seluruh nilai diambil dari kasus (tanpa hitungan baru)
// ---------------------------------------------------------------------------

export interface NarrativeContext {
  inc: CaseIncident;
  style: ConcreteNarrativeStyle;
  isDitching: boolean;
  isLand: boolean;
  isMob: boolean;
  callsign: string;
  craftType: string;
  pob: number | undefined;
  office: string;
  infoSource: string;
  reportDate: string;
  reportTime: string;
  reportZone: string;
  lcDate: string;
  lcTime: string;
  lcZone: string;
  datumDate: string;
  datumTime: string;
  datumZone: string;
  headingStr: string;
  levelStr: string;        // "FL150" atau "1200 feet" atau ''
  lkpDms: string;
  stageList: string;
  stagesCount: number;
  searchNumberStr: string; // "pencarian ke-2" bila eksplisit, kalau tidak ''
  radialDeg: number | undefined;
  transitHours: number | undefined;
  vegetationLabel: string; // darat
  platformLabel: string;   // darat
  destination: string;     // darat: tujuan rute
}

function platformLabelOf(p?: 'fixed-wing' | 'helicopter'): string {
  return landPlatformLabelOf(p);
}

function lkpDmsOf(sarCase: SarCaseSchema): string {
  const c = sarCase.lkp?.coord;
  if (!c) return '';
  return `${formatDmsSpaced(c.dmsLat ?? formatDMS(c.lat, false))} – ${formatDmsSpaced(c.dmsLng ?? formatDMS(c.lng, true))}`;
}

function headingStrOf(inc: CaseIncident): string {
  if (inc.headingDeg === undefined) return '';
  const ref = inc.headingReference === 'magnetic' ? '(M)' : inc.headingReference === 'true' ? '(T)' : '';
  return `${fmtId(inc.headingDeg)}°${ref}`;
}

function levelStrOf(inc: CaseIncident): string {
  if (inc.flightLevelFt !== undefined) return `FL${inc.flightLevelFt}`;
  if (inc.altitudeFt !== undefined) return `${fmtId(inc.altitudeFt)} feet`;
  return '';
}

/** Susun konteks narasi dari kasus (semua string siap cetak). */
export function buildNarrativeContext(sarCase: SarCaseSchema, style: ConcreteNarrativeStyle, opts: { explicitSearchNumber?: boolean } = {}): NarrativeContext {
  const inc = sarCase.incident;
  const report = inc.reportTime ? splitCaseTime(inc.reportTime) : { date: '', time: '', zone: '' };
  const lc = inc.lastContactTime ? splitCaseTime(inc.lastContactTime) : { date: '', time: '', zone: '' };
  const datum = sarCase.search?.datumTime ? splitCaseTime(sarCase.search.datumTime) : { date: '', time: '', zone: '' };
  const stages = sarCase.search?.stagesDone ?? [];
  const stagesCount = stages.length;
  const stageList = stagesCount === 0
    ? ''
    : stagesCount === 1
      ? 'stage 1'
      : `${stages.map((s) => `stage ${s.stage}`).slice(0, -1).join(', ')} dan stage ${stages[stages.length - 1]?.stage ?? ''}`;
  const isDitching = inc.type === 'aircraft-ditching';
  const isLand = inc.type === 'aircraft-land-crash' || inc.type === 'missing-person-land';
  const isMob = inc.type === 'person-overboard';
  return {
    inc,
    style,
    isDitching,
    isLand,
    isMob,
    callsign: inc.callsign ?? 'TARGET',
    craftType: inc.craftType ?? '',
    pob: inc.pob,
    office: sarCase.sarOffice?.name ?? 'Kantor SAR',
    infoSource: inc.infoSource ?? (isLand ? 'unit SAR darat' : 'ATS'),
    reportDate: report.date,
    reportTime: report.time,
    reportZone: report.zone,
    lcDate: lc.date,
    lcTime: lc.time,
    lcZone: lc.zone,
    datumDate: datum.date,
    datumTime: datum.time,
    datumZone: datum.zone,
    headingStr: headingStrOf(inc),
    levelStr: levelStrOf(inc),
    lkpDms: lkpDmsOf(sarCase),
    stageList,
    stagesCount,
    searchNumberStr: opts.explicitSearchNumber && sarCase.search?.searchNumber !== undefined
      ? `pencarian ke-${sarCase.search.searchNumber}`
      : '',
    radialDeg: sarCase.sarOffice?.radialDegToLkp,
    transitHours: sarCase.sarOffice?.transitHoursToLkp,
    vegetationLabel: vegetationLabelOf(sarCase.search?.terrainVegetation),
    platformLabel: platformLabelOf(sarCase.search?.landPlatform),
    destination: sarCase.search?.routeDestination ?? '',
  };
}

// ---------------------------------------------------------------------------
// Bank fragmen per gaya — tiap posisi punya beberapa varian kalimat
// ---------------------------------------------------------------------------

type Picker = <T>(items: readonly T[]) => T;

const pickFrom = (rng: Rng): Picker => <T,>(items: readonly T[]): T => rng.pick(items);

// ── Formal ujian kedinasan ─────────────────────────────────────────────────

const FORMAL_OPENERS: Array<(c: NarrativeContext) => string> = [
  (c) => `Pada tanggal ${c.reportDate} pukul ${c.reportTime} ${c.reportZone}, ${c.office} menerima informasi dari ${c.infoSource} bahwa pada tanggal ${c.lcDate} pukul ${c.lcTime} ${c.lcZone} terjadi kejadian darurat yang menimpa ${c.craftType ? `${c.craftType} ` : ''}${c.callsign}.`,
  (c) => `Pada tanggal ${c.reportDate} pukul ${c.reportTime} ${c.reportZone}, ${c.office} menerima laporan dari ${c.infoSource} mengenai kejadian darurat yang dialami ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign} pada tanggal ${c.lcDate} pukul ${c.lcTime} ${c.lcZone}.`,
  (c) => `Berikut disampaikan kronologi kejadian yang dilaporkan ${c.infoSource} kepada ${c.office} pada tanggal ${c.reportDate} pukul ${c.reportTime} ${c.reportZone}: pada tanggal ${c.lcDate} pukul ${c.lcTime} ${c.lcZone}, ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign} mengalami keadaan darurat.`,
  (c) => `Surat pemberitahuan dari ${c.infoSource} diterima ${c.office} pada tanggal ${c.reportDate} pukul ${c.reportTime} ${c.reportZone}, berisi laporan bahwa ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign} berada dalam keadaan darurat sejak tanggal ${c.lcDate} pukul ${c.lcTime} ${c.lcZone}.`,
];

const FORMAL_DISTRESS_AERO: Array<(c: NarrativeContext) => string> = [
  (c) => `Pada saat kejadian, ${c.infoSource} menerima panggilan "MAYDAY" dari pesawat dengan callsign ${c.callsign} setelah cek point ${c.inc.checkpoint ?? '-'} pada ketinggian ${c.levelStr} dengan heading ${c.headingStr}.`,
  (c) => `Panggilan "MAYDAY" dari ${c.callsign} diterima ${c.infoSource} setelah pesawat melewati cek point ${c.inc.checkpoint ?? '-'} pada ketinggian ${c.levelStr}, dengan heading ${c.headingStr}.`,
  (c) => `${c.callsign} mengucapkan panggilan "MAYDAY" kepada ${c.infoSource} setelah cek point ${c.inc.checkpoint ?? '-'}; pesawat berada pada ketinggian ${c.levelStr} dengan heading ${c.headingStr}.`,
];

const FORMAL_DAMAGE_DITCHING: Array<(c: NarrativeContext) => string> = [
  (c) => `Dilaporkan bahwa ${c.callsign} mengalami ${c.inc.damageDescription ?? 'kerusakan'} dan diindikasikan akan ditching.`,
  (c) => `Kondisi pesawat dilaporkan mengalami ${c.inc.damageDescription ?? 'kerusakan'}, sehingga pesawat diindikasikan akan ditching.`,
  (c) => `Berdasarkan laporan tersebut, ${c.callsign} diketahui mengalami ${c.inc.damageDescription ?? 'kerusakan'} dan diindikasikan akan ditching.`,
];

const FORMAL_DAMAGE_LANDCRASH: Array<(c: NarrativeContext) => string> = [
  (c) => `Dilaporkan bahwa ${c.callsign} mengalami ${c.inc.damageDescription ?? 'kerusakan'} dan diindikasikan jatuh di darat sekitar posisi terakhir.`,
  (c) => `Kondisi pesawat dilaporkan mengalami ${c.inc.damageDescription ?? 'kerusakan'} dan diperkirakan jatuh di darat.`,
  (c) => `${c.callsign} diduga jatuh di darat setelah mengalami ${c.inc.damageDescription ?? 'kerusakan'}.`,
];

const FORMAL_EQUIPMENT: Array<(c: NarrativeContext) => string> = [
  (c) => `Berdasarkan data perjalanan, perlengkapan keselamatan yang tersedia di ${c.callsign} adalah ${c.inc.lifeRaftCount ?? 0} buah life raft kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang dan POB ${c.callsign} sebanyak ${c.pob ?? '-'} orang.`,
  (c) => `Data perlengkapan keselamatan ${c.callsign}: ${c.inc.lifeRaftCount ?? 0} buah life raft berkapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang; jumlah POB sebanyak ${c.pob ?? '-'} orang.`,
  (c) => `Perlengkapan keselamatan yang dibawa ${c.callsign} terdiri atas ${c.inc.lifeRaftCount ?? 0} buah life raft kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang, dengan POB sebanyak ${c.pob ?? '-'} orang.`,
];

const FORMAL_EQUIPMENT_MOB: Array<(c: NarrativeContext) => string> = [
  (c) => `Kapal ${c.callsign} melaporkan bahwa satu orang awak jatuh ke laut dan hilang; POB kapal sebanyak ${c.pob ?? '-'} orang dan perlengkapan di kapal adalah ${c.inc.lifeRaftCount ?? 0} buah life raft kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang.`,
  (c) => `Pelaporan darurat menyebutkan orang jatuh ke laut (Man Overboard) dari kapal ${c.callsign}; kapal membawa ${c.inc.lifeRaftCount ?? 0} buah life raft kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang dengan POB total ${c.pob ?? '-'} orang.`,
  (c) => `Kondisi kapal ${c.callsign}: POB ${c.pob ?? '-'} orang; satu orang dilaporkan jatuh ke laut dan belum ditemukan. Perlengkapan kapal berupa ${c.inc.lifeRaftCount ?? 0} buah life raft kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang.`,
];

const FORMAL_EQUIPMENT_LAND: Array<(c: NarrativeContext) => string> = [
  (c) => `Berdasarkan manifest, jumlah orang yang dicari (POB) sebanyak ${c.pob ?? '-'} orang.`,
  (c) => `Data manifest menyebutkan POB sebanyak ${c.pob ?? '-'} orang.`,
  (c) => `Jumlah personel yang dilaporkan hilang/dicari (POB) adalah ${c.pob ?? '-'} orang.`,
];

const FORMAL_OFFICE_RADIAL: Array<(c: NarrativeContext) => string> = [
  (c) => `Radial LKP dari ${c.office} adalah ${fmtId(c.radialDeg ?? 0)}° dan waktu tempuh ke LKP ± ${fmtId(c.transitHours ?? 0)} jam.`,
  (c) => `Posisi LKP berada pada radial ${fmtId(c.radialDeg ?? 0)}° dari ${c.office}, dengan waktu tempuh ± ${fmtId(c.transitHours ?? 0)} jam.`,
  (c) => `Dari ${c.office}, LKP terletak pada radial ${fmtId(c.radialDeg ?? 0)}°; perkiraan waktu tempuh ke LKP ± ${fmtId(c.transitHours ?? 0)} jam.`,
];

const FORMAL_LKP_COORD: Array<(c: NarrativeContext) => string> = [
  (c) => `Koordinat posisi terakhir (LKP) adalah ${c.lkpDms}.`,
  (c) => `Posisi terakhir diketahui pada koordinat ${c.lkpDms}.`,
  (c) => `Titik LKP tercatat pada koordinat ${c.lkpDms}.`,
];

const FORMAL_ROUTE_DEST: Array<(c: NarrativeContext) => string> = [
  (c) => `Pesawat dalam penerbangan menuju ${c.destination}; posisi terakhir diketahui pada koordinat ${c.lkpDms}.`,
  (c) => `Rute penerbangan mengarah ke ${c.destination}, dengan posisi terakhir pada koordinat ${c.lkpDms}.`,
  (c) => `${c.callsign} sedang dalam penerbangan ke ${c.destination} ketika posisi terakhir tercatat di ${c.lkpDms}.`,
];

const FORMAL_STAGES_NONE: Array<(c: NarrativeContext) => string> = [
  () => `Pencarian belum dilakukan; pencarian pertama akan dilaksanakan pada waktu Datum.`,
  () => `Sampai laporan ini disusun, belum ada pencarian yang dilaksanakan.`,
  () => `Tidak ada pencarian sebelumnya — operasi pencarian akan dimulai pada Datum Time.`,
];

const FORMAL_STAGES_DONE: Array<(c: NarrativeContext) => string> = [
  (c) => `Pencarian ${c.stageList} sudah dilakukan namun belum membuahkan hasil.`,
  (c) => `Pencarian pada ${c.stageList} telah dilaksanakan dengan hasil nihil.`,
  (c) => `Hasil pencarian ${c.stageList} yang sudah dilaksanakan adalah nihil (belum ditemukan).`,
];

const FORMAL_DATUM: Array<(c: NarrativeContext) => string> = [
  (c) => c.searchNumberStr
    ? `Pencarian selanjutnya adalah ${c.searchNumberStr} dan akan dimulai pada ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} (Datum Time).`
    : `Pencarian selanjutnya akan dimulai pada ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} (Datum Time).`,
  (c) => c.searchNumberStr
    ? `Datum Time ditetapkan pada ${c.datumDate} pukul ${c.datumTime} ${c.datumZone}; pencarian berikutnya merupakan ${c.searchNumberStr}.`
    : `Datum Time ditetapkan pada ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} untuk pencarian berikutnya.`,
  (c) => c.searchNumberStr
    ? `Pada ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} (Datum Time), ${c.searchNumberStr} akan dilaksanakan.`
    : `Pada ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} (Datum Time), pencarian berikutnya akan dilaksanakan.`,
];

const FORMAL_LAND_TERRAIN: Array<(c: NarrativeContext) => string> = [
  (c) => `Kondisi wilayah pencarian: ${c.vegetationLabel}; pencarian udara direncanakan menggunakan ${c.platformLabel}.`,
  (c) => `Wilayah darat yang dicari memiliki ${c.vegetationLabel}, dengan rencana pencarian menggunakan ${c.platformLabel}.`,
  (c) => `Pencarian direncanakan dari udara menggunakan ${c.platformLabel} pada wilayah dengan ${c.vegetationLabel}.`,
];

// ── Narasi operasional ──────────────────────────────────────────────────────

const OPS_OPENERS: Array<(c: NarrativeContext) => string> = [
  (c) => `Pukul ${c.reportTime} ${c.reportZone} tanggal ${c.reportDate}, ${c.infoSource} menghubungi ${c.office}: ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign} dalam keadaan darurat, kontak terakhir pukul ${c.lcTime} ${c.lcZone} tanggal ${c.lcDate}.`,
  (c) => `${c.office} menerima laporan darurat dari ${c.infoSource} pada ${c.reportDate} pukul ${c.reportTime} ${c.reportZone}. Kronologi: kejadian terjadi ${c.lcDate} pukul ${c.lcTime} ${c.lcZone} menimpa ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign}.`,
  (c) => `Ringkasan operasi — peringatan diterima pukul ${c.reportTime} ${c.reportZone} (${c.reportDate}) dari ${c.infoSource}; insiden melibatkan ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign} sejak pukul ${c.lcTime} ${c.lcZone}, ${c.lcDate}.`,
  (c) => `Catatan jaga ${c.office} (${c.reportDate}): pukul ${c.reportTime} ${c.reportZone} masuk laporan ${c.infoSource} — ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign} darurat, kontak terakhir ${c.lcDate} pukul ${c.lcTime} ${c.lcZone}.`,
];

const OPS_DISTRESS_AERO: Array<(c: NarrativeContext) => string> = [
  (c) => `MAYDAY diterima ${c.infoSource} setelah cek point ${c.inc.checkpoint ?? '-'}, ketinggian ${c.levelStr}, heading ${c.headingStr}.`,
  (c) => `Panggilan "MAYDAY" ${c.callsign} masuk setelah cek point ${c.inc.checkpoint ?? '-'} — pesawat di ${c.levelStr}, heading ${c.headingStr}.`,
  (c) => `Data radio: "MAYDAY" dari ${c.callsign} setelah cek point ${c.inc.checkpoint ?? '-'}; ketinggian ${c.levelStr}; heading ${c.headingStr}.`,
];

const OPS_DAMAGE_DITCHING: Array<(c: NarrativeContext) => string> = [
  (c) => `Kerusakan: ${c.inc.damageDescription ?? 'kerusakan'} — diindikasikan akan ditching.`,
  (c) => `Pesawat mengalami ${c.inc.damageDescription ?? 'kerusakan'}; indikasi ditching.`,
  (c) => `Indikasi akhir: ditching setelah ${c.inc.damageDescription ?? 'kerusakan'}.`,
];

const OPS_DAMAGE_LANDCRASH: Array<(c: NarrativeContext) => string> = [
  (c) => `Kerusakan: ${c.inc.damageDescription ?? 'kerusakan'} — indikasi jatuh di darat.`,
  (c) => `Pesawat mengalami ${c.inc.damageDescription ?? 'kerusakan'}; diperkirakan jatuh di darat (crash on land).`,
  (c) => `Indikasi akhir: jatuh di darat setelah ${c.inc.damageDescription ?? 'kerusakan'}.`,
];

const OPS_EQUIPMENT: Array<(c: NarrativeContext) => string> = [
  (c) => `Perlengkapan: ${c.inc.lifeRaftCount ?? 0} life raft × ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang; POB ${c.pob ?? '-'} orang.`,
  (c) => `Data cepat — life raft: ${c.inc.lifeRaftCount ?? 0} buah (kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang per unit); POB: ${c.pob ?? '-'} orang.`,
  (c) => `POB ${c.pob ?? '-'} orang; perlengkapan keselamatan ${c.inc.lifeRaftCount ?? 0} buah life raft kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang.`,
];

const OPS_EQUIPMENT_MOB: Array<(c: NarrativeContext) => string> = [
  (c) => `Kejadian: satu orang jatuh ke laut dari ${c.callsign}. POB kapal ${c.pob ?? '-'} orang; perlengkapan ${c.inc.lifeRaftCount ?? 0} life raft × ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang.`,
  (c) => `Status: Man Overboard dari kapal ${c.callsign} — 1 orang hilang di laut. POB: ${c.pob ?? '-'} orang; life raft: ${c.inc.lifeRaftCount ?? 0} buah (kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang).`,
  (c) => `Kapal ${c.callsign} melapor MOB — satu orang jatuh. Kapal membawa ${c.inc.lifeRaftCount ?? 0} life raft (kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang), POB ${c.pob ?? '-'} orang.`,
];

const OPS_EQUIPMENT_LAND: Array<(c: NarrativeContext) => string> = [
  (c) => `POB (jumlah orang dicari): ${c.pob ?? '-'} orang.`,
  (c) => `Data manifest — POB: ${c.pob ?? '-'} orang.`,
  (c) => `Personel dicari: ${c.pob ?? '-'} orang (POB).`,
];

const OPS_RADIAL: Array<(c: NarrativeContext) => string> = [
  (c) => `Radial LKP dari ${c.office}: ${fmtId(c.radialDeg ?? 0)}°; transit ± ${fmtId(c.transitHours ?? 0)} jam.`,
  (c) => `Radial LKP ${fmtId(c.radialDeg ?? 0)}° dari ${c.office} — perkiraan transit ± ${fmtId(c.transitHours ?? 0)} jam.`,
  (c) => `Status: radial ${fmtId(c.radialDeg ?? 0)}°, waktu tempuh ± ${fmtId(c.transitHours ?? 0)} jam dari ${c.office}.`,
];

const OPS_LKP_COORD: Array<(c: NarrativeContext) => string> = [
  (c) => `LKP: ${c.lkpDms}.`,
  (c) => `Posisi terakhir: ${c.lkpDms}.`,
  (c) => `Koordinat LKP ${c.lkpDms}.`,
];

const OPS_ROUTE_DEST: Array<(c: NarrativeContext) => string> = [
  (c) => `Rute menuju ${c.destination}; LKP di ${c.lkpDms}.`,
  (c) => `Tujuan penerbangan ${c.destination} — posisi terakhir ${c.lkpDms}.`,
  (c) => `Pesawat dalam rute ke ${c.destination}, terakhir tercatat di ${c.lkpDms}.`,
];

const OPS_STAGES_NONE: Array<(c: NarrativeContext) => string> = [
  () => `Status pencarian: belum ada stage yang dijalankan.`,
  () => `Belum ada pencarian sebelumnya — pencarian pertama dimulai pada Datum Time.`,
  () => `Log operasi: belum ada upaya pencarian sebelum laporan ini.`,
];

const OPS_STAGES_DONE: Array<(c: NarrativeContext) => string> = [
  (c) => `Status pencarian: ${c.stageList} sudah dijalankan, hasil nihil.`,
  (c) => `Upaya sebelumnya (${c.stageList}) nihil.`,
  (c) => `Log pencarian: ${c.stageList} selesai tanpa penemuan.`,
];

const OPS_DATUM: Array<(c: NarrativeContext) => string> = [
  (c) => c.searchNumberStr
    ? `Datum Time ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} — ${c.searchNumberStr}.`
    : `Datum Time ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} untuk pencarian berikutnya.`,
  (c) => c.searchNumberStr
    ? `Pencarian dilanjutkan pada ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} (${c.searchNumberStr}).`
    : `Pencarian berikutnya dimulai ${c.datumDate} pukul ${c.datumTime} ${c.datumZone}.`,
  (c) => c.searchNumberStr
    ? `${c.searchNumberStr} akan berjalan mulai ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} (Datum Time).`
    : `Jadwal: pencarian berikutnya mulai ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} (Datum Time).`,
];

const OPS_LAND_TERRAIN: Array<(c: NarrativeContext) => string> = [
  (c) => `Medan: ${c.vegetationLabel}; platform pencari: ${c.platformLabel}.`,
  (c) => `Kondisi wilayah — ${c.vegetationLabel}; pencarian udara pakai ${c.platformLabel}.`,
  (c) => `Pencari: ${c.platformLabel}; wilayah ${c.vegetationLabel}.`,
];

// ── Skenario simulasi kejadian ─────────────────────────────────────────────

const SIM_OPENERS: Array<(c: NarrativeContext) => string> = [
  (c) => `Skenario simulasi — Anda bertindak sebagai perencana operasi SAR di ${c.office}. Pada tanggal ${c.reportDate} pukul ${c.reportTime} ${c.reportZone}, ${c.infoSource} menyampaikan informasi darurat: ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign} mengalami kejadian darurat pada tanggal ${c.lcDate} pukul ${c.lcTime} ${c.lcZone}.`,
  (c) => `Latihan dimulai: layar Anda menampilkan panggilan darurat yang masuk ke ${c.office} pada tanggal ${c.reportDate} pukul ${c.reportTime} ${c.reportZone}. ${c.infoSource} melaporkan bahwa ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign} mengalami insiden pada tanggal ${c.lcDate} pukul ${c.lcTime} ${c.lcZone}.`,
  (c) => `Anda adalah duty planner ${c.office}. Tepat pukul ${c.reportTime} ${c.reportZone} tanggal ${c.reportDate}, ${c.infoSource} meneruskan laporan: ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign} dalam bahaya sejak tanggal ${c.lcDate} pukul ${c.lcTime} ${c.lcZone}.`,
  (c) => `Skenario latihan berikut disusun untuk menilai kemampuan perencanaan SAR. Situasi awal: pada tanggal ${c.reportDate} pukul ${c.reportTime} ${c.reportZone}, ${c.office} menerima pemberitahuan dari ${c.infoSource} tentang kejadian darurat ${c.craftType ? `${c.craftType} ${c.callsign}` : c.callsign} yang terjadi pada tanggal ${c.lcDate} pukul ${c.lcTime} ${c.lcZone}.`,
];

const SIM_DISTRESS_AERO: Array<(c: NarrativeContext) => string> = [
  (c) => `Dalam simulasi ini, rekaman radio memperlihatkan panggilan "MAYDAY" dari ${c.callsign} setelah cek point ${c.inc.checkpoint ?? '-'} pada ketinggian ${c.levelStr}, heading ${c.headingStr}.`,
  (c) => `Data yang Anda terima: "MAYDAY" dari ${c.callsign} dipancarkan setelah cek point ${c.inc.checkpoint ?? '-'}; pesawat pada ketinggian ${c.levelStr} dengan heading ${c.headingStr}.`,
  (c) => `Audiorealitas latihan: suara pilot ${c.callsign} mengucapkan "MAYDAY" setelah melewati cek point ${c.inc.checkpoint ?? '-'}, di ketinggian ${c.levelStr}, heading ${c.headingStr}.`,
];

const SIM_DAMAGE_DITCHING: Array<(c: NarrativeContext) => string> = [
  (c) => `Instruktur menambahkan informasi: pesawat mengalami ${c.inc.damageDescription ?? 'kerusakan'} dan diindikasikan akan ditching.`,
  (c) => `Kondisi terkini dalam simulasi: ${c.inc.damageDescription ?? 'kerusakan'} — pesawat diindikasikan akan ditching.`,
  (c) => `Situasi berkembang: ${c.callsign} mengalami ${c.inc.damageDescription ?? 'kerusakan'}; indikasi kuat akan ditching.`,
];

const SIM_DAMAGE_LANDCRASH: Array<(c: NarrativeContext) => string> = [
  (c) => `Instruktur menambahkan informasi: pesawat mengalami ${c.inc.damageDescription ?? 'kerusakan'} dan diindikasikan jatuh di darat.`,
  (c) => `Kondisi terkini dalam simulasi: ${c.inc.damageDescription ?? 'kerusakan'} — diperkirakan jatuh di darat.`,
  (c) => `Situasi berkembang: ${c.callsign} mengalami ${c.inc.damageDescription ?? 'kerusakan'}; kemungkinan besar jatuh di darat.`,
];

const SIM_EQUIPMENT: Array<(c: NarrativeContext) => string> = [
  (c) => `Berita yang Anda baca di kartu latihan: ${c.callsign} membawa ${c.inc.lifeRaftCount ?? 0} buah life raft kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang, dengan POB ${c.pob ?? '-'} orang.`,
  (c) => `Kartu data simulasi — life raft: ${c.inc.lifeRaftCount ?? 0} buah (kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang); POB: ${c.pob ?? '-'} orang.`,
  (c) => `Sepanjang latihan, anggap ${c.callsign} memiliki ${c.inc.lifeRaftCount ?? 0} buah life raft kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang dan POB ${c.pob ?? '-'} orang.`,
];

const SIM_EQUIPMENT_MOB: Array<(c: NarrativeContext) => string> = [
  (c) => `Kejadian dalam simulasi: satu awak kapal ${c.callsign} jatuh ke laut. Kapal membawa ${c.inc.lifeRaftCount ?? 0} life raft kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang; POB ${c.pob ?? '-'} orang.`,
  (c) => `Kartu kejadian — Man Overboard di kapal ${c.callsign}: 1 orang hilang. POB kapal ${c.pob ?? '-'} orang; ${c.inc.lifeRaftCount ?? 0} life raft (kapasitas ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang).`,
  (c) => `Selama latihan, perlakukan situasi sebagai MOB nyata: satu orang jatuh dari ${c.callsign}. Data kapal: POB ${c.pob ?? '-'} orang, ${c.inc.lifeRaftCount ?? 0} life raft × ${c.inc.lifeRaftCapacityPerRaft ?? '-'} orang.`,
];

const SIM_EQUIPMENT_LAND: Array<(c: NarrativeContext) => string> = [
  (c) => `Kartu latihan mencantumkan POB ${c.pob ?? '-'} orang.`,
  (c) => `Dalam skenario ini, jumlah orang yang dicari (POB) adalah ${c.pob ?? '-'} orang.`,
  (c) => `Petunjuk instruktur: POB ${c.pob ?? '-'} orang.`,
];

const SIM_RADIAL: Array<(c: NarrativeContext) => string> = [
  (c) => `Peta latihan menunjukkan radial LKP ${fmtId(c.radialDeg ?? 0)}° dari ${c.office}, waktu tempuh ± ${fmtId(c.transitHours ?? 0)} jam.`,
  (c) => `Data navigasi simulasi: LKP pada radial ${fmtId(c.radialDeg ?? 0)}° dari ${c.office}; perkiraan transit ± ${fmtId(c.transitHours ?? 0)} jam.`,
  (c) => `Ukur sendiri di peta latihan — radial LKP ${fmtId(c.radialDeg ?? 0)}°, transit ± ${fmtId(c.transitHours ?? 0)} jam dari ${c.office}.`,
];

const SIM_LKP_COORD: Array<(c: NarrativeContext) => string> = [
  (c) => `Koordinat LKP ditampilkan di peta: ${c.lkpDms}.`,
  (c) => `Titik posisi terakhir pada peta latihan: ${c.lkpDms}.`,
  (c) => `LKP simulasi: ${c.lkpDms}.`,
];

const SIM_ROUTE_DEST: Array<(c: NarrativeContext) => string> = [
  (c) => `Rute simulasi menuju ${c.destination}; titik terakhir di ${c.lkpDms}.`,
  (c) => `Peta menampilkan rute ke ${c.destination} dengan posisi terakhir ${c.lkpDms}.`,
  (c) => `Pesawat latihan dalam rute ke ${c.destination}, terakhir terdeteksi di ${c.lkpDms}.`,
];

const SIM_STAGES_NONE: Array<(c: NarrativeContext) => string> = [
  () => `Injekan pertama: belum ada pencarian yang berjalan — Anda memulai dari nol.`,
  () => `Status latihan: belum ada stage pencarian sebelumnya.`,
  () => `Simulasi baru dimulai; belum ada upaya pencarian sebelum Datum Time.`,
];

const SIM_STAGES_DONE: Array<(c: NarrativeContext) => string> = [
  (c) => `Injekan situasi: pencarian ${c.stageList} sudah berjalan dan nihil.`,
  (c) => `Instruktur menyuntikkan info: ${c.stageList} telah dicari tanpa hasil.`,
  (c) => `Riwayat latihan — ${c.stageList} sudah dilaksanakan, hasil nihil.`,
];

const SIM_DATUM: Array<(c: NarrativeContext) => string> = [
  (c) => c.searchNumberStr
    ? `Waktu mulai pencarian berikutnya (Datum Time): ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} — ini ${c.searchNumberStr}.`
    : `Waktu mulai pencarian berikutnya (Datum Time): ${c.datumDate} pukul ${c.datumTime} ${c.datumZone}.`,
  (c) => c.searchNumberStr
    ? `Setelah jeda, ${c.searchNumberStr} dimulai pada ${c.datumDate} pukul ${c.datumTime} ${c.datumZone}.`
    : `Pencarian dilanjutkan pada ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} (Datum Time).`,
  (c) => c.searchNumberStr
    ? `Injekan waktu: Datum Time ${c.datumDate} pukul ${c.datumTime} ${c.datumZone}; ${c.searchNumberStr} dimulai.`
    : `Injekan waktu: Datum Time ${c.datumDate} pukul ${c.datumTime} ${c.datumZone} untuk pencarian berikutnya.`,
];

const SIM_LAND_TERRAIN: Array<(c: NarrativeContext) => string> = [
  (c) => `Ortophoto latihan menunjukkan ${c.vegetationLabel}; pencarian udara memakai ${c.platformLabel}.`,
  (c) => `Dalam simulasi, wilayah darat memiliki ${c.vegetationLabel} — platform pencari ${c.platformLabel}.`,
  (c) => `Petunjuk medan: ${c.vegetationLabel}; rencana pencarian pakai ${c.platformLabel}.`,
];

// ---------------------------------------------------------------------------
// Perakitan narasi per gaya
// ---------------------------------------------------------------------------

interface StylePack {
  openers: Array<(c: NarrativeContext) => string>;
  distressAero: Array<(c: NarrativeContext) => string>;
  damageDitching: Array<(c: NarrativeContext) => string>;
  damageLandCrash: Array<(c: NarrativeContext) => string>;
  equipment: Array<(c: NarrativeContext) => string>;
  equipmentMob: Array<(c: NarrativeContext) => string>;
  equipmentLand: Array<(c: NarrativeContext) => string>;
  radial: Array<(c: NarrativeContext) => string>;
  lkpCoord: Array<(c: NarrativeContext) => string>;
  routeDest: Array<(c: NarrativeContext) => string>;
  stagesNone: Array<(c: NarrativeContext) => string>;
  stagesDone: Array<(c: NarrativeContext) => string>;
  datum: Array<(c: NarrativeContext) => string>;
  landTerrain: Array<(c: NarrativeContext) => string>;
  /** Gaya ops: pemisah kalimat ringkas. */
  separator: string;
}

const PACKS: Record<ConcreteNarrativeStyle, StylePack> = {
  'formal-ujian': {
    openers: FORMAL_OPENERS, distressAero: FORMAL_DISTRESS_AERO,
    damageDitching: FORMAL_DAMAGE_DITCHING, damageLandCrash: FORMAL_DAMAGE_LANDCRASH,
    equipment: FORMAL_EQUIPMENT, equipmentMob: FORMAL_EQUIPMENT_MOB, equipmentLand: FORMAL_EQUIPMENT_LAND,
    radial: FORMAL_OFFICE_RADIAL, lkpCoord: FORMAL_LKP_COORD, routeDest: FORMAL_ROUTE_DEST,
    stagesNone: FORMAL_STAGES_NONE, stagesDone: FORMAL_STAGES_DONE, datum: FORMAL_DATUM,
    landTerrain: FORMAL_LAND_TERRAIN, separator: ' ',
  },
  'narasi-operasional': {
    openers: OPS_OPENERS, distressAero: OPS_DISTRESS_AERO,
    damageDitching: OPS_DAMAGE_DITCHING, damageLandCrash: OPS_DAMAGE_LANDCRASH,
    equipment: OPS_EQUIPMENT, equipmentMob: OPS_EQUIPMENT_MOB, equipmentLand: OPS_EQUIPMENT_LAND,
    radial: OPS_RADIAL, lkpCoord: OPS_LKP_COORD, routeDest: OPS_ROUTE_DEST,
    stagesNone: OPS_STAGES_NONE, stagesDone: OPS_STAGES_DONE, datum: OPS_DATUM,
    landTerrain: OPS_LAND_TERRAIN, separator: ' ',
  },
  'skenario-simulasi': {
    openers: SIM_OPENERS, distressAero: SIM_DISTRESS_AERO,
    damageDitching: SIM_DAMAGE_DITCHING, damageLandCrash: SIM_DAMAGE_LANDCRASH,
    equipment: SIM_EQUIPMENT, equipmentMob: SIM_EQUIPMENT_MOB, equipmentLand: SIM_EQUIPMENT_LAND,
    radial: SIM_RADIAL, lkpCoord: SIM_LKP_COORD, routeDest: SIM_ROUTE_DEST,
    stagesNone: SIM_STAGES_NONE, stagesDone: SIM_STAGES_DONE, datum: SIM_DATUM,
    landTerrain: SIM_LAND_TERRAIN, separator: ' ',
  },
};

export interface BuildNarrativeOptions {
  /** True = nomor pencarian dinyatakan eksplisit di narasi (kasus mudah). */
  explicitSearchNumber?: boolean;
  /** Seed variasi narasi (default: seed kasus + gaya). */
  variantSeed?: string;
}

/** Susun paragraf narasi penuh untuk kasus + gaya — deterministik dari seed.
 *  Semua nilai berasal dari kasus; modul ini hanya menyusun kalimat. */
export function buildCaseNarrative(sarCase: SarCaseSchema, style: NarrativeStyle, opts: BuildNarrativeOptions = {}): { text: string; style: ConcreteNarrativeStyle } {
  const variantRng = createRng(`${opts.variantSeed ?? sarCase.meta?.seed ?? 'naskah'}|narasi|${style}`);
  const concrete = resolveNarrativeStyle(style, variantRng);
  const rng = variantRng;
  const pick = pickFrom(rng);
  const c = buildNarrativeContext(sarCase, concrete, { explicitSearchNumber: opts.explicitSearchNumber });
  const pack = PACKS[concrete];

  // Kalimat-kalimat opsional disusun sebagai blok, lalu urutan blok yang
  // independen diacak (kronologi inti tetap urut: opener → distress → damage).
  const sentences: string[] = [];
  sentences.push(pick(pack.openers)(c));

  if (c.isDitching || (c.isLand && c.inc.type === 'aircraft-land-crash')) {
    sentences.push(pick(pack.distressAero)(c));
    sentences.push(c.isDitching ? pick(pack.damageDitching)(c) : pick(pack.damageLandCrash)(c));
  }

  // Perlengkapan/POB per jenis.
  sentences.push((c.isMob ? pick(pack.equipmentMob) : c.isLand ? pick(pack.equipmentLand) : pick(pack.equipment))(c));

  // Blok posisi: radial + LKP (laut) atau rute + LKP (darat).
  const positionBlocks: string[] = [];
  positionBlocks.push(pick(pack.radial)(c));
  if (c.isLand && c.inc.type === 'aircraft-land-crash' && c.destination) {
    positionBlocks.push(pick(pack.routeDest)(c));
  } else {
    positionBlocks.push(pick(pack.lkpCoord)(c));
  }
  if (c.isLand) positionBlocks.push(pick(pack.landTerrain)(c));
  // Urutan blok posisi diacak (radial ↔ koordinat ↔ medan) — variasi susunan.
  const shuffled = rng.bool(0.5) ? [positionBlocks[1], positionBlocks[0], ...positionBlocks.slice(2)] : positionBlocks;
  sentences.push(...shuffled);

  // Stage & datum (blok akhir tetap urut: status pencarian → datum time).
  sentences.push((c.stagesCount === 0 ? pick(pack.stagesNone) : pick(pack.stagesDone))(c));
  sentences.push(pick(pack.datum)(c));

  return { text: sentences.join(pack.separator), style: concrete };
}

// ---------------------------------------------------------------------------
// Parse-back — narasi tidak boleh mengubah nilai CaseSchema
// ---------------------------------------------------------------------------

export interface ParseBackIssue {
  field: string;
  expected: string;
  extracted: string;
  reason: string;
}

export interface ParseBackResult {
  ok: boolean;
  checkedFields: number;
  issues: ParseBackIssue[];
}

interface ExtractRule {
  field: string;
  expected: string;
  /** Ekstraksi berlabel — pattern harus menangkap 1 grup = nilai terformat. */
  patterns: RegExp[];
}

/** Angka gaya Indonesia ("2,5") → number. */
function parseIdNumber(s: string): number | null {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Escape string untuk dipakai sebagai literal dalam RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Daftar aturan parse-back untuk kasus ini — berlabel, gaya-agnostik
 *  (label kunci dipakai konsisten di ketiga gaya narasi). */
function extractRules(sarCase: SarCaseSchema, c: NarrativeContext): ExtractRule[] {
  const rules: ExtractRule[] = [];
  const inc = sarCase.incident;

  if (inc.pob !== undefined) {
    rules.push({
      field: 'incident.pob',
      expected: String(inc.pob),
      // "orang" wajib mengikuti angka POB agar tidak menangkap digit callsign/
      // koordinat yang kebetulan berada setelah kata POB. Pola ke-4 menoleransi
      // SATU deret digit di antara (callsign kapal, mis. "POB TB. Samudra-96
      // sebanyak 12 orang").
      patterns: [/POB[^0-9]{0,40}?(\d+)\s*orang/i, /(\d+)\s*orang\s*\(\s*POB\s*\)/i, /POB:\s*(\d+)\s*orang/i, /POB[^0-9]{0,40}?\d+[^0-9]{0,40}?(\d+)\s*orang/i],
    });
  }
  if (inc.lifeRaftCount !== undefined) {
    rules.push({
      field: 'incident.lifeRaftCount',
      expected: String(inc.lifeRaftCount),
      // Angka count harus diikuti kata "life raft" (bukan kebalikannya) supaya
      // kapasitas tidak tertukar dengan count.
      patterns: [/(\d+)\s*(?:buah\s*)?life\s*raft/i, /life\s*raft:\s*(\d+)/i],
    });
  }
  if (inc.lifeRaftCapacityPerRaft !== undefined) {
    rules.push({
      field: 'incident.lifeRaftCapacityPerRaft',
      expected: String(inc.lifeRaftCapacityPerRaft),
      patterns: [/kapasitas\s*(\d+)\s*orang/i, /kapasitas\s*(\d+)/i, /life\s*raft[^0-9]{0,20}×\s*(\d+)\s*orang/i],
    });
  }
  if (c.radialDeg !== undefined) {
    rules.push({
      field: 'sarOffice.radialDegToLkp',
      expected: String(Math.round(c.radialDeg)),
      // Hanya pola berlabel "radial" — label "LKP" juga menempel pada koordinat
      // DMS sehingga rawan menangkap derajat koordinat.
      patterns: [/radial[^0-9]{0,80}?(\d{1,3})\s*°?/i],
    });
  }
  if (c.transitHours !== undefined) {
    rules.push({
      field: 'sarOffice.transitHoursToLkp',
      expected: fmtId(c.transitHours),
      patterns: [/(?:waktu\s*tempuh|transit|perkiraan\s*transit)[^0-9]{0,30}(?:±\s*)?(\d+(?:,\d+)?)\s*jam/i],
    });
  }
  if (c.levelStr.startsWith('FL')) {
    rules.push({ field: 'incident.flightLevelFt', expected: c.levelStr, patterns: [/(FL\s?\d{3})/i] });
  } else if (c.levelStr) {
    rules.push({ field: 'incident.altitudeFt', expected: c.levelStr, patterns: [new RegExp(`(${c.levelStr.replace(',', '\\,')})`)] });
  }
  if (c.headingStr) {
    rules.push({ field: 'incident.headingDeg', expected: c.headingStr, patterns: [new RegExp(`heading\\s*(\\d{1,3}\\s*°\\s*\\(?[MT]\\)?)`, 'i')] });
  }
  if (c.lkpDms) {
    rules.push({ field: 'lkp.coord', expected: c.lkpDms, patterns: [new RegExp(c.lkpDms.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))] });
  }
  if (c.lcTime) {
    rules.push({ field: 'incident.lastContactTime', expected: `${c.lcTime} ${c.lcZone}`, patterns: [new RegExp(`${escapeRegex(c.lcTime)}\\s*${c.lcZone}`)] });
  }
  if (c.datumTime) {
    rules.push({ field: 'search.datumTime', expected: `${c.datumTime} ${c.datumZone}`, patterns: [new RegExp(`${escapeRegex(c.datumTime)}\\s*${c.datumZone}`)] });
  }
  if (inc.callsign) {
    rules.push({ field: 'incident.callsign', expected: inc.callsign, patterns: [new RegExp(inc.callsign.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))] });
  }
  return rules;
}

/** Parse kembali teks narasi/naskah menjadi nilai dan bandingkan dengan kasus.
 *  Setiap field yang tidak bisa diekstrak atau BERBEDA dari kasus = issue. */
export function parseBackNarrativeValues(sarCase: SarCaseSchema, text: string, opts: BuildNarrativeOptions = {}): ParseBackResult {
  const styleRng = createRng(`${opts.variantSeed ?? sarCase.meta?.seed ?? 'naskah'}|narasi|otomatis`);
  const concrete = resolveNarrativeStyle('otomatis', styleRng);
  const c = buildNarrativeContext(sarCase, concrete, { explicitSearchNumber: opts.explicitSearchNumber });
  const rules = extractRules(sarCase, c);
  const issues: ParseBackIssue[] = [];

  for (const rule of rules) {
    let extracted: string | null = null;
    for (const pattern of rule.patterns) {
      const m = pattern.exec(text);
      if (m) {
        extracted = (m[1] ?? m[0]).trim();
        break;
      }
    }
    if (extracted === null) {
      issues.push({ field: rule.field, expected: rule.expected, extracted: '', reason: 'Nilai tidak dapat di-parse kembali dari teks narasi.' });
      continue;
    }
    // Normalisasi angka: "13.50" waktu vs "2,5" desimal vs "150" bulat.
    const norm = (s: string) => s.replace(/\s+/g, ' ').replace('(', '').replace(')', '').toUpperCase().replace('°', '°').trim();
    const expectedNum = parseIdNumber(rule.expected);
    const extractedNum = parseIdNumber(extracted);
    const same = expectedNum !== null && extractedNum !== null && rule.field !== 'incident.lastContactTime' && rule.field !== 'search.datumTime'
      ? Math.abs(expectedNum - extractedNum) < 1e-9
      : norm(extracted) === norm(rule.expected)
        || norm(extracted).replace(' ', '') === norm(rule.expected).replace(' ', '');
    if (!same) {
      issues.push({ field: rule.field, expected: rule.expected, extracted, reason: 'Nilai hasil parse-back berbeda dari CaseSchema — narasi tidak boleh mengubah nilai.' });
    }
  }

  return { ok: issues.length === 0, checkedFields: rules.length, issues };
}

/** Kumpulan token angka yang DIIZINKAN muncul dalam narasi kasus (dipakai
 *  guardrail narasi LLM: angka di luar daftar = narasi mengubah data). */
export function allowedNarrativeNumberTokens(sarCase: SarCaseSchema, opts: BuildNarrativeOptions = {}): Set<string> {
  const c = buildNarrativeContext(sarCase, resolveNarrativeStyle('formal-ujian', createRng('allowlist')), { explicitSearchNumber: opts.explicitSearchNumber });
  const tokens = new Set<string>();
  const add = (v: string | number | undefined) => {
    if (v === undefined) return;
    const s = String(v);
    tokens.add(s);
    tokens.add(s.replace('.', ','));
    tokens.add(String(Math.round(Number(s))));
  };
  add(c.inc.pob);
  add(c.inc.lifeRaftCount);
  add(c.inc.lifeRaftCapacityPerRaft);
  add(c.inc.flightLevelFt);
  add(c.inc.altitudeFt);
  add(c.inc.headingDeg);
  add(c.radialDeg);
  add(c.transitHours);
  for (const t of [c.reportTime, c.reportDate, c.lcTime, c.lcDate, c.datumTime, c.datumDate]) {
    if (!t) continue;
    for (const part of t.split(/[\s.]+/)) {
      if (/^\d+$/.test(part)) tokens.add(part);
    }
  }
  if (c.lkpDms) {
    for (const part of c.lkpDms.split(/[°′″\s–-]+/)) {
      if (/^\d+$/.test(part)) tokens.add(part);
    }
  }
  for (const stage of sarCase.search?.stagesDone ?? []) tokens.add(String(stage.stage));
  if (sarCase.search?.searchNumber !== undefined) tokens.add(String(sarCase.search.searchNumber));
  return tokens;
}
