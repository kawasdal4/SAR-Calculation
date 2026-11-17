/**
 * BANK DATA KASUS & GENERATOR DOKUMEN RESMI (Perban 3/2020)
 *
 * Implementasi Panduan Agent RENOPS / Briefing / De-Briefing:
 *  - Soal Kasus dianalisis AI menjadi Bank Data (fakta terstruktur + provenance per field).
 *  - Dokumen (RENOPS Format I/II, Briefing, De-Briefing) diisi dengan rantai sumber:
 *      Worksheet results → Map features → Bank Data → PENDING (ditanyakan ke pengguna).
 *  - Agent tidak pernah mengarang angka/koordinat/nama/frekuensi/cuaca.
 *  - Angka perhitungan HANYA dari worksheet (WS1 datum/area, WS2/WS3/WS8 track spacing).
 *  - Data planned dipisahkan dari data actual (De-Briefing = ACTUAL_REQUIRED).
 *
 * Acuan: Perban No. 3 Tahun 2020 Lampiran II & VI, Panduan Agent SAR Planning.
 */

import { formatDMS } from './coordFormat';

// ============================================================================
// Tipe dasar
// ============================================================================

export type FieldStatus = 'READY' | 'PENDING' | 'CONFLICT' | 'STALE' | 'ACTUAL_REQUIRED';
export type SourceType =
  | 'case' | 'worksheet' | 'map' | 'asset' | 'personnel'
  | 'communications' | 'actual_report' | 'manual_confirmed' | 'unknown';
export type PlannedActual = 'planned' | 'actual';
export type DocType = 'RENOPS_I' | 'RENOPS_II' | 'BRIEFING' | 'DEBRIEFING';

/** Satu fakta pada Bank Data. */
export interface DataBankField {
  key: string;
  label: string;
  value: string | null;
  unit?: string | null;
  sourceType: SourceType;
  sourceRef?: string | null;
  status: FieldStatus;
  plannedActual?: PlannedActual;
  question?: string | null;
  updatedAt?: string;
}

export interface SnapshotLatLng { lat: number; lng: number }

/** Snapshot state aplikasi (worksheet + peta) yang dikirim saat generate dokumen. */
export interface DocumentSnapshot {
  lkp?: SnapshotLatLng | null;
  lkpSet?: boolean;
  datum?: {
    datumLeft?: SnapshotLatLng;
    datumRight?: SnapshotLatLng;
    driftDistanceNm?: number;
    totalDriftErrorNm?: number;
    searchAreaRadiusNm?: number;
  } | null;
  searchArea?: {
    center?: SnapshotLatLng;
    lengthNm?: number;
    widthNm?: number;
    orientationDeg?: number;
    areaSqNm?: number;
    trackSpacingNm?: number;
    safetyFactor?: number;
    podPercent?: number;
  } | null;
  asw?: { dirFrom?: number; speedKts?: number } | null;
  awa?: { dirFrom?: number; speedKts?: number } | null;
  /** Hasil Practical Track Spacing per worksheet (sesuai routing Panduan Agent §7). */
  trackSpacing?: {
    ws2Nm?: number | null;      // fixed-wing / helikopter pencarian maritim
    ws3Nm?: number | null;      // pencarian darat (fixed-wing/heli)
    ws8Nm?: number | null;      // kapal / RIB / Sea Rider
  } | null;
  pattern?: {
    type?: string;              // PS / SS / TS / etc.
    orientation?: string;
    environment?: '' | 'water' | 'land';
    worksheetSource?: '' | 'ws2' | 'ws3' | 'ws8';
    trackLineLengthText?: string;
  } | null;
  assets?: Array<{
    id: string;
    name: string;
    type: string;               // SruType
    homeBaseName?: string;
    transitSpeedKts?: number;
    searchSpeedKts?: number;
    enduranceHours?: number;
    sweepWidthNm?: number;
    assignedSubArea?: string;
  }> | null;
  mapPoints?: Array<{ id: string; lat: number; lng: number; label?: string }> | null;
}

export interface ResolvedField {
  key: string;
  label: string;
  value: string;
  unit?: string;
  sourceType: SourceType;
  sourceRef?: string;
  status: FieldStatus;
  plannedActual?: PlannedActual;
  question?: string;
}

export interface DocTable {
  title: string;
  columns: string[];
  rows: string[][];
  /** Provenance per baris (dirender sebagai catatan sumber). */
  provenance?: string[];
}

export interface DocSection {
  id: string;
  title: string;
  /** Narasi tersusun dari data sumber (tanpa mengubah angka). */
  narrative?: string[];
  fields?: ResolvedField[];
  tables?: DocTable[];
  note?: string;
}

export interface GeneratedDocument {
  docType: DocType;
  title: string;
  subtitle: string;
  sections: DocSection[];
  validation: {
    ready: number; pending: number; conflict: number; actualRequired: number; total: number;
  };
  /** Data yang belum tersedia — AI meminta kepada pengguna. */
  questions: { key: string; label: string; question: string }[];
  meta: {
    incidentType?: 'ACCIDENT' | 'DISASTER';
    generatedAt: string;
    sourcesUsed: Record<SourceType, number>;
  };
}

export const PENDING_TEXT = 'Belum tersedia / perlu konfirmasi';

// ============================================================================
// Definisi fakta kasus (kunci kanonik Bank Data)
// ============================================================================

export interface CaseFactDef {
  key: string;
  label: string;
  hint?: string;
  plannedActual?: PlannedActual;
}

/** Fakta kasus yang dapat diekstraksi AI dari Soal Kasus / diisi manual pengguna. */
export const CASE_FACT_DEFS: CaseFactDef[] = [
  { key: 'office', label: 'Kantor Pencarian dan Pertolongan' },
  { key: 'incidentLabel', label: 'Jenis kejadian (kecelakaan/bencana/KKM)', hint: 'Pertahankan kata "diduga" bila ada' },
  { key: 'targetName', label: 'Nama kapal/pesawat kecelakaan' },
  { key: 'callSign', label: 'Call Sign / MMSI / IMO Number' },
  { key: 'lkpCoord', label: 'Koordinat LKP / lokasi kejadian', hint: 'Format apa pun asal persis seperti sumber' },
  { key: 'route', label: 'Rute kapal/pesawat' },
  { key: 'eventTime', label: 'Waktu kejadian (TW ... G/H/I)' },
  { key: 'reportTime', label: 'Waktu laporan diterima (TW ... G/H/I)' },
  { key: 'reportSource', label: 'Sumber/pelapor informasi' },
  { key: 'reportChannel', label: 'Media penerimaan laporan (Tlp/E-Mail/dll)' },
  { key: 'targetKind', label: 'Jenis kapal/pesawat' },
  { key: 'color', label: 'Warna objek' },
  { key: 'flag', label: 'Bendera' },
  { key: 'cause', label: 'Penyebab kecelakaan', hint: 'Hanya bila tertulis eksplisit' },
  { key: 'searchObject', label: 'Objek yang dicari' },
  { key: 'crewCount', label: 'Jumlah crew' },
  { key: 'passengerCount', label: 'Jumlah penumpang' },
  { key: 'pobTotal', label: 'Jumlah POB (total orang di atas kapal)' },
  { key: 'distressFreq', label: 'Frekuensi yang digunakan objek yang dicari' },
  { key: 'cargo', label: 'Muatan' },
  { key: 'victimCount', label: 'Jumlah korban dalam pencarian' },
  { key: 'victimStatus', label: 'Status korban (DP/hilang/ditemukan/dll)' },
  { key: 'previousEfforts', label: 'Upaya yang telah dilakukan' },
  { key: 'preparedSruAir', label: 'SRU udara yang dipersiapkan' },
  { key: 'preparedSruSea', label: 'SRU laut yang dipersiapkan' },
  { key: 'preparedSruLand', label: 'SRU darat yang dipersiapkan' },
  { key: 'preparedEquipment', label: 'Peralatan yang dipersiapkan' },
  { key: 'weather', label: 'Data cuaca (dari soal/prakiraan)' },
  { key: 'disasterType', label: 'Jenis bencana/KKM (untuk Format II)' },
  { key: 'taskNarrative', label: 'Tugas misi (bila tertulis di soal)' },
  { key: 'rescuePlan', label: 'Rencana penyelamatan/rescue plan' },
  { key: 'victimTransport', label: 'Transportasi korban' },
  { key: 'adminLogistics', label: 'Administrasi & logistik (jumlah orang, hari, BBM)' },
  { key: 'commsPlan', label: 'Jaring/frekuensi komunikasi rencana' },
  { key: 'potentialSar', label: 'Potensi SAR yang dilibatkan' },
  { key: 'opTime', label: 'Waktu operasi/planning stage' },
  { key: 'opDay', label: 'Hari operasi (HARI KE-...)' },
  { key: 'cspCoord', label: 'Koordinat Commence Search Point (CSP)' },
  { key: 'patternPlan', label: 'Pola pencarian rencana' },
  { key: 'altitudePlan', label: 'Ketinggian pencarian pesawat (rencana)' },
  { key: 'smcName', label: 'Nama SMC/Koordinator Misi', hint: 'Hanya bila tertulis di soal' },
  { key: 'oscName', label: 'Nama OSC/Koordinator Lapangan', hint: 'Hanya bila tertulis di soal' },
  // ---- Field aktual (khusus De-Briefing) ----
  { key: 'actualDeparturePoint', label: 'Titik keberangkatan aktual', plannedActual: 'actual' },
  { key: 'actualLandingPoint', label: 'Point of landing aktual', plannedActual: 'actual' },
  { key: 'actualDepartureTime', label: 'Waktu berangkat aktual', plannedActual: 'actual' },
  { key: 'actualArrivalTime', label: 'Waktu tiba aktual', plannedActual: 'actual' },
  { key: 'actualArea', label: 'Posisi/koordinat/area pencarian aktual', plannedActual: 'actual' },
  { key: 'actualPattern', label: 'Pola pencarian aktual', plannedActual: 'actual' },
  { key: 'actualAltitude', label: 'Ketinggian pesawat aktual', plannedActual: 'actual' },
  { key: 'actualConstraints', label: 'Kendala di lapangan', plannedActual: 'actual' },
  { key: 'observerCount', label: 'Jumlah observer', plannedActual: 'actual' },
  { key: 'actualWeather', label: 'Kondisi cuaca aktual (angin, jarak pandang)', plannedActual: 'actual' },
  { key: 'actualSearchObject', label: 'Objek pencarian aktual', plannedActual: 'actual' },
  { key: 'victimFound', label: 'Jumlah dan kondisi korban ditemukan', plannedActual: 'actual' },
  { key: 'otherFindings', label: 'Informasi lain yang didapat', plannedActual: 'actual' },
  { key: 'actualComms', label: 'Komunikasi aktual (frekuensi, alat)', plannedActual: 'actual' },
  { key: 'otherNotes', label: 'Hal-hal lain yang perlu disampaikan', plannedActual: 'actual' },
  { key: 'debriefDate', label: 'Tanggal debriefing', plannedActual: 'actual' },
  { key: 'debriefName', label: 'Nama petugas debriefing', plannedActual: 'actual' },
];

export const CASE_FACT_MAP: Record<string, CaseFactDef> = Object.fromEntries(
  CASE_FACT_DEFS.map((d) => [d.key, d]),
);

// ============================================================================
// Helper umum
// ============================================================================

const UNKNOWN_LABEL = 'Tidak diketahui / belum tersedia';

function bankBy(bank: DataBankField[], key: string): DataBankField | undefined {
  return bank.find((f) => f.key === key && (f.value ?? '').trim().length > 0);
}

/** Nilai bank siap pakai, atau null. */
function bankValue(bank: DataBankField[], key: string): string | null {
  const f = bankBy(bank, key);
  return f ? f.value!.trim() : null;
}

/** Tipe sumber asli field bank (case / manual_confirmed / actual_report), atau fallback. */
function bankSrc(bank: DataBankField[], key: string, fallback: SourceType = 'case'): SourceType {
  const f = bankBy(bank, key);
  return f ? f.sourceType : fallback;
}

function coordText(p?: SnapshotLatLng | null): string | null {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  if (p.lat === 0 && p.lng === 0) return null;
  return `${formatDMS(p.lat, false)} ${formatDMS(p.lng, true)}`;
}

function numText(v: number | undefined | null, digits = 1): string | null {
  if (v === undefined || v === null || !Number.isFinite(v) || v === 0) return null;
  return String(Number(v.toFixed(digits)));
}

function field(
  key: string,
  label: string,
  value: string | null,
  opts: {
    unit?: string;
    sourceType?: SourceType;
    sourceRef?: string;
    status?: FieldStatus;
    plannedActual?: PlannedActual;
    question?: string;
  } = {},
): ResolvedField {
  const status = opts.status ?? (value && value.trim() ? 'READY' : 'PENDING');
  return {
    key,
    label,
    value: value && value.trim() ? value.trim() : PENDING_TEXT,
    unit: opts.unit,
    sourceType: opts.sourceType ?? (value && value.trim() ? 'case' : 'unknown'),
    sourceRef: opts.sourceRef,
    status,
    plannedActual: opts.plannedActual,
    question: opts.question,
  };
}

/** Tambahkan pertanyaan default bila field PENDING tanpa pertanyaan. */
function withDefaultQuestion(f: ResolvedField): ResolvedField {
  if (f.status === 'PENDING' && !f.question) {
    f.question = `${f.label}: mohon lengkapi datanya.`;
  }
  if (f.status === 'ACTUAL_REQUIRED' && !f.question) {
    f.question = `${f.label}: belum ada laporan aktual — mohon isi setelah penugasan (laporan SRU/debrief).`;
  }
  return f;
}

/** Sudut polygon search area dari center + panjang + lebar + orientasi (° dari utara). */
export function computeAreaCorners(
  center: SnapshotLatLng,
  lengthNm: number,
  widthNm: number,
  orientationDeg: number,
): SnapshotLatLng[] {
  const rad = (orientationDeg * Math.PI) / 180;
  const dxL = (lengthNm / 2) * Math.sin(rad) / 60;
  const dyL = (lengthNm / 2) * Math.cos(rad) / 60;
  const dxW = (widthNm / 2) * Math.cos(rad) / 60;
  const dyW = (widthNm / 2) * -Math.sin(rad) / 60;
  return [
    { lat: center.lat + dyL + dyW, lng: center.lng + dxL + dxW }, // A
    { lat: center.lat + dyL - dyW, lng: center.lng + dxL - dxW }, // B
    { lat: center.lat - dyL - dyW, lng: center.lng - dxL - dxW }, // C
    { lat: center.lat - dyL + dyW, lng: center.lng - dxL + dxW }, // D
  ];
}

export interface TrackSpacingResolution {
  valueNm: number | null;
  sourceRef: string;
  sourceType: SourceType;
  note: string;
}

/**
 * Routing sumber Track Spacing sesuai Panduan Agent §7:
 *  - Fixed wing / helikopter pencarian maritim → WS 2
 *  - Kapal / RIB / Sea Rider → WS 8
 *  - Land search → WS 3 (W = Wu × Fv × Ff; S khusus WS3)
 *  - Pola/metode lain → data tasking/peta; agent tidak membuat nilai sendiri.
 */
export function resolveTrackSpacing(snap: DocumentSnapshot | null, bank: DataBankField[]): TrackSpacingResolution {
  const ts = snap?.trackSpacing ?? {};
  const env = snap?.pattern?.environment ?? '';
  const src = snap?.pattern?.worksheetSource ?? '';
  const bankTs = bankValue(bank, 'trackSpacingPlan');

  // 1) Sumber eksplisit yang dipilih pengguna pada peta/worksheet.
  if (src === 'ws2' && numText(ts.ws2Nm)) {
    return { valueNm: ts.ws2Nm!, sourceRef: 'Worksheet 2 — Practical Track Spacing (S)', sourceType: 'worksheet', note: 'Fixed-wing/helikopter pencarian maritim → sumber S = WS 2.' };
  }
  if (src === 'ws8' && numText(ts.ws8Nm)) {
    return { valueNm: ts.ws8Nm!, sourceRef: 'Worksheet 8 — Practical Track Spacing (S)', sourceType: 'worksheet', note: 'Kapal/RIB/Sea Rider → sumber S = WS 8.' };
  }
  if (src === 'ws3' && numText(ts.ws3Nm)) {
    return { valueNm: ts.ws3Nm!, sourceRef: 'Worksheet 3 — Land Search Track Spacing (S)', sourceType: 'worksheet', note: 'Pencarian darat → sumber S = WS 3.' };
  }

  // 2) Routing otomatis menurut lingkungan pencarian.
  if (env === 'land' && numText(ts.ws3Nm)) {
    return { valueNm: ts.ws3Nm!, sourceRef: 'Worksheet 3 — Land Search Track Spacing (S)', sourceType: 'worksheet', note: 'Lingkungan darat → sumber S = WS 3.' };
  }
  if (env === 'water') {
    const hasAirAsset = (snap?.assets ?? []).some((a) => a.type === 'helicopter' || a.type === 'fixed-wing-aircraft');
    if (hasAirAsset && numText(ts.ws2Nm)) {
      return { valueNm: ts.ws2Nm!, sourceRef: 'Worksheet 2 — Practical Track Spacing (S)', sourceType: 'worksheet', note: 'Aset udara pada pencarian maritim → sumber S = WS 2.' };
    }
    if (numText(ts.ws8Nm)) {
      return { valueNm: ts.ws8Nm!, sourceRef: 'Worksheet 8 — Practical Track Spacing (S)', sourceType: 'worksheet', note: 'Aset laut → sumber S = WS 8.' };
    }
    if (numText(ts.ws2Nm)) {
      return { valueNm: ts.ws2Nm!, sourceRef: 'Worksheet 2 — Practical Track Spacing (S)', sourceType: 'worksheet', note: 'S dari WS 2 (pencarian maritim).' };
    }
  }

  // 3) Bank data (hanya bila nilai S benar-benar tertulis di soal/rencana).
  if (bankTs) {
    return { valueNm: Number(bankTs) || null, sourceRef: 'Bank Data (soal kasus)', sourceType: 'case', note: 'S dari Soal Kasus — pastikan sesuai worksheet routing.' };
  }
  return { valueNm: null, sourceRef: '', sourceType: 'unknown', note: 'S tidak diisi dari pola visual — jalankan worksheet routing yang sesuai (WS 2 / WS 3 / WS 8).' };
}

const PATTERN_LABELS: Record<string, string> = {
  PS: 'Parallel Sweep (PS)',
  SS: 'Sector Search (SS)',
  TS: 'Trackline (TS)',
  CO: 'Contour (CO)',
  FL: 'Flare Search (FL)',
  HM: 'Homing (HM)',
  EXP: 'Expanding Square (EXP)',
  SB: 'Sector Box (SB)',
};

function patternLabel(type?: string): string | null {
  if (!type) return null;
  return PATTERN_LABELS[type] ?? type;
}

// ============================================================================
// RESOLUSI SUMBER PER FIELD (worksheet → peta → bank → PENDING)
// ============================================================================

interface SourcePick {
  value: string | null;
  sourceType: SourceType;
  sourceRef?: string;
}

/** Lokasi kejadian: marker LKP peta/worksheet → bank → PENDING. */
function resolveLkp(snap: DocumentSnapshot | null, bank: DataBankField[]): SourcePick & { conflict?: string } {
  const mapCoord = snap?.lkpSet ? coordText(snap.lkp) : null;
  const bankCoord = bankValue(bank, 'lkpCoord');
  if (mapCoord && bankCoord && mapCoord !== bankCoord) {
    // Tampil keduanya — konflik minta verifikasi SMC (Panduan Agent §15).
    return {
      value: `${mapCoord} (peta/worksheet) ‖ ${bankCoord} (soal kasus)`,
      sourceType: 'map',
      sourceRef: 'LKP marker peta vs Soal Kasus',
      conflict: `LKP peta (${mapCoord}) berbeda dengan Soal Kasus (${bankCoord}) — minta verifikasi SMC.`,
    };
  }
  if (mapCoord) return { value: mapCoord, sourceType: 'map', sourceRef: 'LKP marker peta aplikasi' };
  if (bankCoord) return { value: bankCoord, sourceType: 'case', sourceRef: 'Soal Kasus' };
  return { value: null, sourceType: 'unknown' };
}

/** Posisi datum: HANYA dari hasil worksheet (WS 1 / Datum). */
function resolveDatumText(snap: DocumentSnapshot | null): SourcePick {
  const d = snap?.datum;
  const left = coordText(d?.datumLeft ?? null);
  const right = coordText(d?.datumRight ?? null);
  if (left && right) {
    return { value: `Datum Kiri: ${left} — Datum Kanan: ${right}`, sourceType: 'worksheet', sourceRef: 'Worksheet 1 (Datum)' };
  }
  if (left) return { value: `Datum: ${left}`, sourceType: 'worksheet', sourceRef: 'Worksheet 1 (Datum)' };
  return { value: null, sourceType: 'unknown' };
}

/** Koordinat sudut Search Area (A–D): dari hasil worksheet/geometry peta. */
function resolveAreaCorners(snap: DocumentSnapshot | null): SourcePick {
  const sa = snap?.searchArea;
  if (sa?.center && sa.lengthNm && sa.widthNm) {
    const corners = computeAreaCorners(sa.center, sa.lengthNm, sa.widthNm, sa.orientationDeg ?? 0);
    const labels = ['A', 'B', 'C', 'D'];
    const text = corners
      .map((c, i) => `${labels[i]}: ${coordText(c)}`)
      .join('\n');
    return { value: text, sourceType: 'worksheet', sourceRef: 'Worksheet 1 / geometri Search Area peta' };
  }
  // Fallback: area dari datum kiri/kanan (area dat-2 titik) — tetap sumber worksheet.
  const d = snap?.datum;
  const left = coordText(d?.datumLeft ?? null);
  const right = coordText(d?.datumRight ?? null);
  if (left && right) {
    return { value: `A: ${left}\nD: ${right}`, sourceType: 'worksheet', sourceRef: 'Worksheet 1 (Datum kiri/kanan)' };
  }
  const bankArea = null; // koordinat area BUKAN fakta soal — wajib hasil worksheet/peta.
  void bankArea;
  return { value: null, sourceType: 'unknown' };
}

/** Nama/narasi judul dokumen. */
function docTitles(docType: DocType, bank: DataBankField[]): { title: string; subtitle: string } {
  const opDay = bankValue(bank, 'opDay') ?? '...';
  if (docType === 'RENOPS_I') {
    const target = bankValue(bank, 'targetName') ?? UNKNOWN_LABEL;
    return {
      title: `RENCANA OPERASI PENCARIAN DAN PERTOLONGAN HARI KE-${opDay}`,
      subtitle: `KECELAKAAN KAPAL/PESAWAT UDARA ${target.toUpperCase()}`,
    };
  }
  if (docType === 'RENOPS_II') {
    const disasterRaw = bankValue(bank, 'disasterType') ?? bankValue(bank, 'incidentLabel') ?? UNKNOWN_LABEL;
    // Hindari duplikasi label bila sumber sudah memuat frasa jenis kejadian.
    const subtitle = /bencana dan\/atau|kondisi membahayakan/i.test(disasterRaw)
      ? disasterRaw.toUpperCase()
      : `BENCANA DAN/ATAU KONDISI MEMBAHAYAKAN MANUSIA ${disasterRaw.toUpperCase()}`;
    return {
      title: `RENCANA OPERASI PENCARIAN DAN PERTOLONGAN HARI KE-${opDay}`,
      subtitle,
    };
  }
  if (docType === 'BRIEFING') {
    return { title: 'BRIEFING UNIT PENCARIAN DAN PERTOLONGAN', subtitle: 'Format B — Lampiran II Perban 3/2020' };
  }
  return { title: 'DE-BRIEFING UNIT PENCARIAN DAN PERTOLONGAN', subtitle: 'Format C — Lampiran II Perban 3/2020' };
}

// ============================================================================
// BUILDER — RENOPS (Format I & II)
// ============================================================================

function bankOrPending(bank: DataBankField[], key: string, question?: string): SourcePick {
  const v = bankValue(bank, key);
  if (v) return { value: v, sourceType: bankBy(bank, key)!.sourceType, sourceRef: 'Soal Kasus / Bank Data' };
  return { value: null, sourceType: 'unknown' };
}

/** Narasi Tahap Menyadari dari fakta kasus — susunan kalimat, angka tetap dari sumber. */
function awarenessNarrative(bank: DataBankField[], lkpPick: SourcePick): string[] {
  const cleanTw = (v: string) => v.replace(/^TW\s*/i, '').trim();
  const office = bankValue(bank, 'office') ?? '................';
  const reportTime = bankValue(bank, 'reportTime') ? cleanTw(bankValue(bank, 'reportTime')!) : '....';
  const reportSource = bankValue(bank, 'reportSource') ?? '................';
  const channel = bankValue(bank, 'reportChannel') ?? 'via Tlp/E-Mail';
  const eventTime = bankValue(bank, 'eventTime') ? cleanTw(bankValue(bank, 'eventTime')!) : '....';
  const incident = bankValue(bank, 'incidentLabel') ?? bankValue(bank, 'disasterType') ?? '................';
  const lkp = lkpPick.value ?? '...°...′...″ S - ...°...′...″ E';
  return [
    `Pada TW ${reportTime} Kantor Pencarian dan Pertolongan ${office} menerima info dari ${reportSource} (${channel}) bahwa pada TW ${eventTime} telah terjadi ${incident} pada koordinat ${lkp}.`,
  ];
}

function buildAllocationTables(snap: DocumentSnapshot | null, bank: DataBankField[]): DocTable[] {
  const assets = snap?.assets ?? [];
  const airAssets = assets.filter((a) => a.type === 'helicopter' || a.type === 'fixed-wing-aircraft');
  const seaAssets = assets.filter((a) => ['rescue-vessel', 'patrol-boat', 'rib', 'sea-rider'].includes(a.type));
  const landAssets = assets.filter((a) => !airAssets.includes(a) && !seaAssets.includes(a));
  const bankAir = bankValue(bank, 'preparedSruAir');
  const bankSea = bankValue(bank, 'preparedSruSea');
  const bankLand = bankValue(bank, 'preparedSruLand');
  const tables: DocTable[] = [];

  const mkRow = (a: DocumentSnapshot['assets'][number] | null, name: string): string[] => {
    if (!a) return [name, '-', '-', '-', '-', PENDING_TEXT, PENDING_TEXT];
    const endurance = numText(a.enduranceHours, 1) ? `${numText(a.enduranceHours, 1)} jam` : PENDING_TEXT;
    const transit = numText(a.transitSpeedKts, 0) ? `${numText(a.transitSpeedKts, 0)} kts` : PENDING_TEXT;
    return [name, endurance, transit, PENDING_TEXT, PENDING_TEXT, PENDING_TEXT, PENDING_TEXT];
  };
  const cols = ['Assets', 'Total Endurance', 'Transit', 'Reserve', 'Weather (TAF)', 'OSE', 'Keterangan'];
  const prov: string[] = [];
  const collect = (list: DocumentSnapshot['assets'], fallback: string | null, domain: string) => {
    const rows: string[][] = [];
    if (list.length === 0 && fallback) {
      rows.push([fallback, PENDING_TEXT, PENDING_TEXT, PENDING_TEXT, PENDING_TEXT, PENDING_TEXT, PENDING_TEXT]);
      prov.push(`${domain}: ${fallback} — sumber Soal Kasus (detail endurance/transit perlu data aset).`);
    } else if (list.length === 0) {
      rows.push(['—', '-', '-', '-', '-', '-', '-']);
    } else {
      for (const a of list) {
        rows.push(mkRow(a, a.name + (a.assignedSubArea ? ` (${a.assignedSubArea})` : '')));
        prov.push(`${a.name}: endurance/speed dari Alokasi Aset SRU (worksheet); Reserve/OSE/TAF belum tersedia.`);
      }
    }
    return rows;
  };

  tables.push({ title: '1) Udara', columns: cols, rows: collect(airAssets, bankAir, 'SRU udara'), provenance: prov.slice() });
  tables.push({ title: '2) Laut', columns: cols, rows: collect(seaAssets, bankSea, 'SRU laut'), provenance: [] });
  tables.push({ title: '3) Darat', columns: cols, rows: collect(landAssets, bankLand, 'SRU darat'), provenance: [] });
  return tables;
}

function buildTaskingTable(
  snap: DocumentSnapshot | null,
  bank: DataBankField[],
  tsRes: TrackSpacingResolution,
): DocTable {
  const assets = snap?.assets ?? [];
  const pattern = patternLabel(snap?.pattern?.type) ?? bankValue(bank, 'patternPlan') ?? null;
  const bankPattern = pattern ? null : null;
  void bankPattern;
  const columns = ['Unsur', 'Tugas', 'Luas Area', 'Pola Pencarian', 'Track Spacing'];
  const provenance: string[] = [];
  const rows: string[][] = [];
  if (assets.length === 0) {
    rows.push([PENDING_TEXT, PENDING_TEXT, PENDING_TEXT, pattern ?? PENDING_TEXT, tsRes.valueNm ? `${tsRes.valueNm} NM` : PENDING_TEXT]);
    provenance.push('Belum ada aset dialokasikan — jalankan worksheet Alokasi Aset SRU.');
  } else {
    for (const a of assets) {
      rows.push([
        `${a.name}${a.type ? ` (${a.type.replace(/-/g, ' ')})` : ''}`,
        a.assignedSubArea ?? bankValue(bank, 'taskNarrative') ?? PENDING_TEXT,
        a.assignedSubArea ?? PENDING_TEXT,
        pattern ?? PENDING_TEXT,
        tsRes.valueNm ? `${tsRes.valueNm} NM` : PENDING_TEXT,
      ]);
      provenance.push(`${a.name}: nama/tugas/area dari Alokasi Aset SRU; pola dari layer peta; ${tsRes.note}`);
    }
  }
  return { title: 'd. Penugasan Unsur Pencarian dan Pertolongan', columns, rows, provenance };
}

function buildPlanningSection(
  docType: DocType,
  snap: DocumentSnapshot | null,
  bank: DataBankField[],
): DocSection[] {
  const lkpPick = resolveLkp(snap, bank);
  const datumPick = resolveDatumText(snap);
  const cornersPick = resolveAreaCorners(snap);
  const tsRes = resolveTrackSpacing(snap, bank);
  const sa = snap?.searchArea;
  const areaSize = numText(sa?.areaSqNm, 0);
  const opTime = bankValue(bank, 'opTime');
  const sections: DocSection[] = [];

  sections.push({
    id: 'planning',
    title: '1. Planning Stage',
    fields: [
      withDefaultQuestion(field('opTime', 'a. Waktu', opTime, { sourceType: bankSrc(bank, 'opTime', 'unknown'), question: 'Waktu operasi/planning stage: mohon isi window operasi (mulai/akhir).' })),
      withDefaultQuestion(field('datumPos', '2) Posisi Datum', datumPick.value, { sourceType: datumPick.sourceType, sourceRef: datumPick.sourceRef, question: 'Posisi datum belum ada — jalankan Worksheet 1 (Datum) agar datum terhitung dari aplikasi.' })),
      withDefaultQuestion(field('areaCoords', '3) Koordinat Area Pencarian (A–B–C–D)', cornersPick.value, { sourceType: cornersPick.sourceType, sourceRef: cornersPick.sourceRef, question: 'Koordinat area pencarian belum ada — hasil worksheet/plot peta diperlukan.' })),
      withDefaultQuestion(field('areaSize', 'Luas Area Pencarian', areaSize ? `${areaSize} NM²` : null, { sourceType: 'worksheet', sourceRef: 'Worksheet 1 (Ao)', question: 'Luas area pencarian belum ada — jalankan Worksheet 1/Search Plan.' })),
      withDefaultQuestion(field('luarArea', '1) Luar Area Pencarian', bankValue(bank, 'areaNotes'), { sourceType: bankSrc(bank, 'areaNotes'), question: 'Batas luar area pencarian: mohon isi bila ada definisi di rencana.' })),
      withDefaultQuestion(field('trackSpacing', 'Track Spacing (S)', tsRes.valueNm ? `${tsRes.valueNm} NM` : null, { sourceType: tsRes.sourceType, sourceRef: tsRes.sourceRef, question: 'Track Spacing belum tersedia — jalankan worksheet routing yang sesuai (WS 2 udara maritim / WS 8 kapal / WS 3 darat).' })),
      withDefaultQuestion(field('csp', 'Commence Search Point (CSP)', bankValue(bank, 'cspCoord'), { sourceType: bankSrc(bank, 'cspCoord', 'map'), sourceRef: 'CSP map feature', question: 'CSP belum ditandai — mohon tandai/tulis koordinat CSP di peta (jangan memakai datum/center area otomatis).' })),
    ],
    tables: [
      ...buildAllocationTables(snap, bank),
      buildTaskingTable(snap, bank, tsRes),
    ],
    note: tsRes.note,
  });

  const rescue = bankValue(bank, 'rescuePlan');
  const transport = bankValue(bank, 'victimTransport');
  sections.push({
    id: 'rescue',
    title: 'e-g. Rescue Plan, Transportasi Korban, Briefing',
    fields: [
      withDefaultQuestion(field('rescuePlan', 'e. Rencana Penyelamatan (Rescue Plan)', rescue, { sourceType: rescue ? bankSrc(bank, 'rescuePlan') : 'unknown', question: 'Rescue plan: mohon tetapkan tindakan/peralatan penyelamatan untuk skenario ini.' })),
      withDefaultQuestion(field('victimTransport', 'f. Transportasi Korban', transport, { sourceType: transport ? bankSrc(bank, 'victimTransport') : 'unknown', question: 'Transportasi korban: mohon konfirmasi fasilitas tujuan/jalur evakuasi.' })),
      withDefaultQuestion(field('briefingPlan', 'g. Briefing and Debriefing', 'Briefing dilaksanakan untuk masing-masing SRU sebelum penugasan (dokumen Briefing pada aplikasi). De-Briefing diisi setelah laporan aktual diterima.', { sourceType: 'manual_confirmed' })),
    ],
  });
  sections.push({
    id: 'operation',
    title: '2. Operation Stage',
    narrative: [
      'Operation stage akan dilaksanakan sesuai dengan Rencana Operasi / Planning Stage yang telah dibuat.',
    ],
    note: 'Kronologi aktual diisi dari log operasi setelah pelaksanaan (ACTUAL_REQUIRED).',
  });
  void docType;
  return sections;
}

function buildRenops(docType: DocType, snap: DocumentSnapshot | null, bank: DataBankField[]): GeneratedDocument {
  const lkpPick = resolveLkp(snap, bank);
  const { title, subtitle } = docTitles(docType, bank);
  const sections: DocSection[] = [];
  const conflictWarnings: string[] = [];
  if (lkpPick.conflict) conflictWarnings.push(lkpPick.conflict);

  // ---- A. SITUASI ----
  const isFormatI = docType === 'RENOPS_I';
  const situasiFields: ResolvedField[] = [];
  if (isFormatI) {
    const rows: string[][] = [];
    const prov: string[] = [];
    const addRow = (label: string, pick: SourcePick, question?: string) => {
      rows.push([label, pick.value ?? PENDING_TEXT]);
      if (pick.sourceRef) prov.push(`${label}: ${pick.sourceRef}`);
    };
    addRow('NAMA KAPAL/PESAWAT', bankOrPending(bank, 'targetName'), 'Nama objek kecelakaan belum ada — mohon isi dari soal kasus.');
    addRow('CALL SIGN / MMSI / IMO NUMBER', bankOrPending(bank, 'callSign'));
    addRow('LOKASI / POSISI KECELAKAAN', lkpPick);
    addRow('RUTE KAPAL/PESAWAT', bankOrPending(bank, 'route'));
    addRow('WAKTU KEJADIAN (TW G/H/I)', bankOrPending(bank, 'eventTime'));
    addRow('JENIS KAPAL/PESAWAT', bankOrPending(bank, 'targetKind'));
    addRow('WARNA', bankOrPending(bank, 'color'));
    addRow('BENDERA', bankOrPending(bank, 'flag'));
    addRow('PENYEBAB KECELAKAAN', bankOrPending(bank, 'cause'), 'Penyebab kecelakaan tidak boleh disimpulkan — isi hanya bila ada info terkonfirmasi.');
    addRow('OBJEK YANG DICARI', bankOrPending(bank, 'searchObject'));
    addRow('JUMLAH CREW', bankOrPending(bank, 'crewCount'));
    addRow('JUMLAH PENUMPANG', bankOrPending(bank, 'passengerCount'));
    addRow('JUMLAH POB', bankOrPending(bank, 'pobTotal'));
    addRow('UPAYA YANG TELAH DILAKUKAN', bankOrPending(bank, 'previousEfforts'));
    addRow('JUMLAH KORBAN DALAM PENCARIAN', bankOrPending(bank, 'victimCount'));
    addRow('MUATAN', bankOrPending(bank, 'cargo'));
    situasiFields.push(...rows.map((r, i) => withDefaultQuestion(field(`fmt1_${i}`, r[0], r[1], {
      sourceType: r[1] === PENDING_TEXT ? 'unknown' : 'case',
      sourceRef: prov[i],
    }))));
  } else {
    situasiFields.push(
      withDefaultQuestion(field('disasterType', 'a. Jenis Bencana dan/atau Kondisi Membahayakan Manusia', bankValue(bank, 'disasterType') ?? bankValue(bank, 'incidentLabel'), { question: 'Jenis bencana/KKM: mohon isi sesuai label kasus (jangan pakai dugaan penyebab).' })),
      withDefaultQuestion(field('victimData', 'b. Data Korban', [bankValue(bank, 'victimCount'), bankValue(bank, 'victimStatus'), bankValue(bank, 'pobTotal')].filter(Boolean).join(' — ') || null, { question: 'Data korban (jumlah/status): mohon lengkapi dari kasus.' })),
      withDefaultQuestion(field('weatherCase', 'c. Cuaca', bankValue(bank, 'weather') ?? (snap?.asw?.speedKts ? `ASW ${snap.asw.dirFrom}°/${snap.asw.speedKts} kts (hasil worksheet)` : null), { sourceType: bankValue(bank, 'weather') ? 'case' : 'worksheet', question: 'Data cuaca belum ada — isi prakiraan/input cuaca beserta sumber dan waktunya.' })),
    );
  }

  sections.push({
    id: 'situasi',
    title: 'A. SITUASI',
    narrative: awarenessNarrative(bank, lkpPick),
    fields: situasiFields,
    tables: isFormatI ? [] : [{
      title: 'Peta Lokasi Kejadian dan Peta Lokasi Penemuan',
      columns: ['Item', 'Keterangan'],
      rows: [
        ['Peta Lokasi Kejadian', lkpPick.value ? `Snapshot peta aplikasi menampilkan LKP ${lkpPick.value}` : PENDING_TEXT],
        ['Peta Lokasi Penemuan Korban', bankValue(bank, 'victimFound') ? `Tersedia laporan penemuan: ${bankValue(bank, 'victimFound')}` : 'Belum ada penemuan — marker tidak dibuat tanpa laporan.'],
      ],
      provenance: ['Snapshot peta diambil dari peta aplikasi versi terkini (Print Companion Map).'],
    }],
    note: 'Informasi dugaan ("diduga", "diperkirakan") dipertahankan sesuai sumber — tidak diubah menjadi fakta.',
  });

  // ---- 2. Tahap Tindak Awal ----
  const assetsList = snap?.assets ?? [];
  const airFromAssets = assetsList.filter((a) => a.type === 'helicopter' || a.type === 'fixed-wing-aircraft').map((a) => a.name).join(', ');
  const seaFromAssets = assetsList.filter((a) => ['rescue-vessel', 'patrol-boat', 'rib', 'sea-rider'].includes(a.type)).map((a) => a.name).join(', ');
  const landFromAssets = assetsList.filter((a) => !['helicopter', 'fixed-wing-aircraft', 'rescue-vessel', 'patrol-boat', 'rib', 'sea-rider'].includes(a.type)).map((a) => a.name).join(', ');
  const tindakAwal: ResolvedField[] = [
    withDefaultQuestion(field('previousEfforts2', 'a. Upaya Sebelumnya', bankValue(bank, 'previousEfforts'), { question: 'Upaya sebelumnya: mohon uraikan tindakan yang sudah dilaksanakan beserta waktunya.' })),
    withDefaultQuestion(field('preparedSruAir', 'Persiapan — SRU Udara', bankValue(bank, 'preparedSruAir') || airFromAssets || null, { sourceType: bankValue(bank, 'preparedSruAir') ? 'case' : (airFromAssets ? 'asset' : 'unknown'), sourceRef: airFromAssets ? 'Alokasi Aset SRU' : undefined, question: 'SRU udara yang dipersiapkan belum ada — mohon tetapkan dari alokasi aset.' })),
    withDefaultQuestion(field('preparedSruSea', 'Persiapan — SRU Laut', bankValue(bank, 'preparedSruSea') || seaFromAssets || null, { sourceType: bankValue(bank, 'preparedSruSea') ? 'case' : (seaFromAssets ? 'asset' : 'unknown'), sourceRef: seaFromAssets ? 'Alokasi Aset SRU' : undefined, question: 'SRU laut yang dipersiapkan belum ada — mohon tetapkan dari alokasi aset.' })),
    withDefaultQuestion(field('preparedSruLand', 'Persiapan — SRU Darat', bankValue(bank, 'preparedSruLand') || landFromAssets || null, { sourceType: bankValue(bank, 'preparedSruLand') ? 'case' : (landFromAssets ? 'asset' : 'unknown'), sourceRef: landFromAssets ? 'Alokasi Aset SRU' : undefined, question: 'SRU darat yang dipersiapkan: mohon isi bila ada.' })),
    withDefaultQuestion(field('preparedEquipment', 'Peralatan yang dipersiapkan', bankValue(bank, 'preparedEquipment'), { question: 'Daftar peralatan: mohon isi dari manifest peralatan yang ditugaskan.' })),
  ];
  sections.push({ id: 'tindak-awal', title: '2. Tahap Tindak Awal', fields: tindakAwal });

  // ---- B. TUGAS ----
  const searchObject = bankValue(bank, 'searchObject');
  sections.push({
    id: 'tugas',
    title: 'B. TUGAS',
    narrative: [
      bankValue(bank, 'taskNarrative') ??
        `Melaksanakan operasi pencarian dan pertolongan terhadap ${searchObject ?? 'objek pencarian'} pada Search Area hasil perencanaan, berdasarkan koordinat/area yang ditetapkan SMC, serta melakukan rescue/evakuasi sesuai rescue plan.`,
    ],
    note: bankValue(bank, 'taskNarrative') ? undefined : 'Narasi tugas disusun dari data kasus — angka/area tetap mengikuti sumber aplikasi.',
  });

  // ---- C. PELAKSANAAN ----
  sections.push(...buildPlanningSection(docType, snap, bank));

  // ---- D. ADMINISTRASI DAN LOGISTIK ----
  const adminRows: string[][] = [
    ['Administrasi', bankValue(bank, 'adminLogistics') ? 'Buku jurnal, catatan pergerakan unsur, data personel sesuai ketentuan (lihat Bank Data).' : 'Buku jurnal; catatan pergerakan unsur; catatan data unsur/personil yang terlibat.'],
    ['Logistik', bankValue(bank, 'adminLogistics') ?? PENDING_TEXT],
  ];
  sections.push({
    id: 'admin',
    title: 'D. ADMINISTRASI DAN LOGISTIK',
    tables: [{ title: '', columns: ['Bagian', 'Isi'], rows: adminRows, provenance: ['Logistik (permakanan/BBM/hari) wajib dari kalkulasi/permintaan logistik — tidak boleh diperkirakan agent.'] }],
    fields: [withDefaultQuestion(field('logisticsDetail', 'Rincian logistik (permakanan/BBM)', bankValue(bank, 'adminLogistics'), { sourceType: bankSrc(bank, 'adminLogistics'), question: 'Logistik: mohon isi jumlah orang, hari, dan kebutuhan BBM dari kalkulasi logistik.' }))],
  });

  // ---- E. KOORDINASI, PENGENDALIAN, DAN KOMUNIKASI ----
  sections.push({
    id: 'koordinasi',
    title: 'E. KOORDINASI, PENGENDALIAN, DAN KOMUNIKASI',
    fields: [
      withDefaultQuestion(field('smcName', 'Koordinator Misi (SMC)', bankValue(bank, 'smcName'), { sourceType: bankSrc(bank, 'smcName', 'personnel'), question: 'Nama SMC/Koordinator Misi wajib dari pejabat berwenang — agent tidak menetapkan sendiri.' })),
      withDefaultQuestion(field('oscName', 'OSC/Koordinator Lapangan', bankValue(bank, 'oscName'), { sourceType: bankSrc(bank, 'oscName', 'personnel'), question: 'Nama OSC: mohon tetapkan oleh SMC.' })),
      withDefaultQuestion(field('commsPlan', 'Jaring komunikasi (frekuensi/call sign/kanal)', bankValue(bank, 'commsPlan'), { sourceType: bankSrc(bank, 'commsPlan', 'communications'), question: 'Jaring komunikasi: mohon cantumkan frekuensi TX/RX, call sign, dan kanal sesuai rencana komunikasi resmi.' })),
      withDefaultQuestion(field('potentialSar', 'Potensi SAR yang dilibatkan', bankValue(bank, 'potentialSar'), { sourceType: bankSrc(bank, 'potentialSar'), question: 'Potensi SAR: mohon rinci instansi/unit yang dihubungi dan status kesiapannya.' })),
      field('emergencyCall', 'Kontak Darurat Basarnas', 'Kantor Pusat: Telp 021-65867510/65867511, Faks 021-65867512, Emergency Call 115', { sourceType: 'manual_confirmed', sourceRef: 'Lampiran VI Perban 3/2020' }),
    ],
    note: 'Struktur organisasi, penetapan penugasan, dan persetujuan RENOPS tetap keputusan SMC/pejabat berwenang.',
  });

  return {
    docType,
    title,
    subtitle,
    sections,
    validation: validateDocument(sections, conflictWarnings),
    questions: collectQuestions(sections),
    meta: {
      incidentType: isFormatI ? 'ACCIDENT' : 'DISASTER',
      generatedAt: new Date().toISOString(),
      sourcesUsed: countSources(sections),
    },
  };
}

// ============================================================================
// BUILDER — BRIEFING (Lampiran II B)
// ============================================================================

function buildBriefing(snap: DocumentSnapshot | null, bank: DataBankField[], selectedAssetId?: string): GeneratedDocument {
  const assets = snap?.assets ?? [];
  const asset = assets.find((a) => a.id === selectedAssetId) ?? assets[0] ?? null;
  const lkpPick = resolveLkp(snap, bank);
  const tsRes = resolveTrackSpacing(snap, bank);
  const sa = snap?.searchArea;
  const pattern = patternLabel(snap?.pattern?.type) ?? bankValue(bank, 'patternPlan');
  const conflictWarnings: string[] = [];
  if (lkpPick.conflict) conflictWarnings.push(lkpPick.conflict);
  const { title, subtitle } = docTitles('BRIEFING', bank);

  const fields: ResolvedField[] = [
    withDefaultQuestion(field('office', 'Kantor Pencarian dan Pertolongan', bankValue(bank, 'office'), { question: 'Kantor SAR pelaksana: mohon isi (mis. Kanto SAR Tegal).' })),
    field('briefDate', 'Tanggal briefing', new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }), { sourceType: 'manual_confirmed' }),
    field('sruName', 'Jumlah, nama kapal/pesawat pencari', asset ? `${asset.name}${asset.type ? ` — ${asset.type.replace(/-/g, ' ')}` : ''}` : null, { sourceType: asset ? 'asset' : 'unknown', sourceRef: 'Alokasi Aset SRU', question: 'SRU pencari belum dialokasikan — mohon alokasikan aset pada worksheet Alokasi Aset SRU.' }),
    withDefaultQuestion(field('pilotName', 'Nama Nakhoda/Pilot', bankValue(bank, 'pilotName'), { sourceType: 'personnel', question: 'Nama Nakhoda/Pilot wajib dari penugasan personel — agent tidak menetapkan nama.' })),
    withDefaultQuestion(field('incidentBrief', 'Informasi detail tentang kecelakaan/bencana/KKM', [bankValue(bank, 'incidentLabel'), bankValue(bank, 'eventTime'), bankValue(bank, 'lkpCoord')].filter(Boolean).join(' · ') || null, { question: 'Ringkasan kejadian: mohon lengkapi kronologi dari kasus.' })),
    withDefaultQuestion(field('searchObjectBrief', 'Informasi tentang objek yang dicari', bankValue(bank, 'searchObject'), { question: 'Objek yang dicari (ciri, jumlah, warna): mohon lengkapi.' })),
    field('assetData', 'Data-data kapal/pesawat', asset ? `${asset.name} — transit ${asset.transitSpeedKts ?? '?'} kts, search ${asset.searchSpeedKts ?? '?'} kts, endurance ${asset.enduranceHours ?? '?'} jam, base ${asset.homeBaseName ?? '-'} (data SRU pencari, bukan objek kecelakaan)` : PENDING_TEXT, { sourceType: asset ? 'asset' : 'unknown', sourceRef: 'Alokasi Aset SRU' }),
    withDefaultQuestion(field('pobBrief', 'Jumlah POB', bankValue(bank, 'pobTotal'), { question: 'POB objek kecelakaan: mohon isi (berbeda dari crew SRU).' })),
    withDefaultQuestion(field('freqBrief', 'Frek. yang digunakan objek yang dicari', bankValue(bank, 'distressFreq'), { question: 'Frekuensi distress/ELT/EPIRB/PLB objek: mohon isi bila tercatat; bila tidak ada tulis "belum diketahui".' })),
    withDefaultQuestion(field('areaBrief', 'Luas/Lokasi/koordinat Area Pencarian', [sa?.areaSqNm ? `Luas ${numText(sa.areaSqNm, 0)} NM²` : null, resolveAreaCorners(snap).value ? 'Koord. A–D dari worksheet/peta' : null, lkpPick.value ? `LKP ${lkpPick.value}` : null].filter(Boolean).join(' · ') || null, { sourceType: sa ? 'worksheet' : 'unknown', sourceRef: 'Worksheet 1 / peta', question: 'Area pencarian belum ada — jalankan Worksheet 1/plot peta.' })),
    withDefaultQuestion(field('patternBrief', 'Pola pencarian', pattern, { sourceType: snap?.pattern?.type ? 'map' : 'unknown', sourceRef: 'Search pattern layer peta', question: 'Pola pencarian belum diplot — mohon plot pola pada peta (beserta heading).' })),
    withDefaultQuestion(field('altitudeBrief', 'Ketinggian pesawat', bankValue(bank, 'altitudePlan'), { question: 'Ketinggian pencarian pesawat: mohon isi bila SRU udara ditugaskan (N/A untuk SRU non-udara).' })),
    withDefaultQuestion(field('weatherBrief', 'Data Cuaca', [bankValue(bank, 'weather'), snap?.asw?.speedKts ? `ASW ${snap.asw.dirFrom}°T/${snap.asw.speedKts} kts` : null, snap?.awa?.speedKts ? `AWA ${snap.awa.dirFrom}°T/${snap.awa.speedKts} kts` : null].filter(Boolean).join(' · ') || null, { sourceType: bankValue(bank, 'weather') ? 'case' : 'worksheet', question: 'Data cuaca (prakiraan/TAF + periode): mohon lengkapi — jangan disamakan dengan cuaca aktual.' })),
    withDefaultQuestion(field('cspBrief', 'Koordinat Commence Search Point', bankValue(bank, 'cspCoord'), { sourceType: 'map', sourceRef: 'CSP map feature', question: 'CSP belum ada — mohon tandai di peta (bukan datum/center area).' })),
    withDefaultQuestion(field('commsBrief', 'Komunikasi', bankValue(bank, 'commsPlan'), { sourceType: 'communications', question: 'Komunikasi briefing: primary/secondary freq, call sign, interval check-in, prosedur lost-comm.' })),
  ];

  const sections: DocSection[] = [
    { id: 'briefing-fields', title: 'Format Briefing (Lampiran II B)', fields },
    {
      id: 'briefing-notes',
      title: 'Materi Tambahan Briefing (addendum SAR Planning)',
      narrative: [
        `Misi dan tugas: mencari ${bankValue(bank, 'searchObject') ?? 'objek pencarian'} pada area yang ditugaskan; lapor hasil kepada SMC/OSC sesuai jaring komunikasi.`,
        `Rincian area: ${sa?.areaSqNm ? `luas ${numText(sa.areaSqNm, 0)} NM², ` : ''}pola ${pattern ?? PENDING_TEXT}${tsRes.valueNm ? `, Track Spacing ${tsRes.valueNm} NM (${tsRes.sourceRef})` : ''}.`,
        'Keselamatan: periksa hazard lokasi/cuaca/medan dan batasan Alut; konfirmasi prosedur darurat sebelum bergerak.',
        'Tindakan saat melihat target: jaga posisi/koordinat, tandai target, lapor posisi + deskripsi; jangan melakukan tindakan di luar penugasan.',
        'Konfirmasi pemahaman: setiap SRU wajib mengulang misi, area, pola, CSP, batas sektor, komunikasi, dan keselamatan sebelum bergerak.',
      ],
      tables: tsRes.valueNm ? [] : [{
        title: 'Peringatan Track Spacing',
        columns: ['Kondisi', 'Tindakan'],
        rows: [['Nilai S belum tersedia', tsRes.note]],
      }],
      note: 'Perubahan situasi saat transit harus dikirim ke SRU dan direkam sebagai update briefing.',
    },
  ];

  return {
    docType: 'BRIEFING',
    title,
    subtitle: asset ? `${subtitle} — SRU: ${asset.name}` : subtitle,
    sections,
    validation: validateDocument(sections, conflictWarnings),
    questions: collectQuestions(sections),
    meta: {
      incidentType: bankValue(bank, 'incidentLabel')?.toLowerCase().includes('bencana') ? 'DISASTER' : 'ACCIDENT',
      generatedAt: new Date().toISOString(),
      sourcesUsed: countSources(sections),
    },
  };
}

// ============================================================================
// BUILDER — DE-BRIEFING (Lampiran II C) — semua field ACTUAL_REQUIRED
// ============================================================================

function buildDebriefing(snap: DocumentSnapshot | null, bank: DataBankField[], selectedAssetId?: string): GeneratedDocument {
  const assets = snap?.assets ?? [];
  const asset = assets.find((a) => a.id === selectedAssetId) ?? assets[0] ?? null;
  const { title, subtitle } = docTitles('DEBRIEFING', bank);
  const plannedPattern = patternLabel(snap?.pattern?.type) ?? bankValue(bank, 'patternPlan');

  const mkActual = (key: string, label: string, question: string): ResolvedField =>
    withDefaultQuestion(field(key, label, bankValue(bank, key), {
      sourceType: bankValue(bank, key) ? 'actual_report' : 'unknown',
      status: bankValue(bank, key) ? 'READY' : 'ACTUAL_REQUIRED',
      plannedActual: 'actual',
      question,
    }));

  const fields: ResolvedField[] = [
    withDefaultQuestion(field('officeD', 'Kantor Pencarian dan Pertolongan', bankValue(bank, 'office'), { question: 'Kantor SAR pelaksana: mohon isi.' })),
    mkActual('debriefDate2', 'Tanggal debriefing', 'Tanggal debriefing: mohon isi sesuai pelaksanaan.'),
    field('sruD', 'Kapal/pesawat pencari', asset ? asset.name : null, { sourceType: asset ? 'asset' : 'unknown', sourceRef: 'Alokasi Aset SRU', question: 'SRU yang benar-benar melaksanakan tugas: mohon pilih/catat (bukan seluruh aset yang direncanakan).' }),
    mkActual('actualDeparturePoint', 'Titik keberangkatan / Point of departure', 'Titik keberangkatan aktual: mohon isi dari log sortie/laporan SRU (bukan rencana).'),
    mkActual('actualLandingPoint', 'Point of landing', 'Titik tiba/akhir tugas aktual: mohon isi dari log pelaksanaan.'),
    mkActual('actualDepartureTime', 'Waktu Berangkat', 'Waktu berangkat aktual: mohon isi dari log (bukan waktu rencana).'),
    mkActual('actualArrivalTime', 'Waktu tiba', 'Waktu tiba aktual: mohon isi dari log (bukan ETA worksheet).'),
    mkActual('actualArea', 'Posisi/koordinat/Area Pencarian', 'Area yang benar-benar disapu: mohon unggah/catat actual track atau hasil pelaksanaan — jangan menyalin pola rencana sebagai bukti jalur.'),
    mkActual('actualPattern', 'Pola pencarian', `Pola yang dijalankan (rencana: ${plannedPattern ?? PENDING_TEXT}); sebutkan bila ada perubahan.`),
    mkActual('actualAltitude', 'Ketinggian pesawat', 'Ketinggian aktual dari flight log/pilot report (bila SRU udara).'),
    mkActual('actualConstraints', 'Kendala di lapangan', 'Kendala teknis/cuaca/medan/komunikasi/endurance: mohon catat sebagaimana dilaporkan.'),
    mkActual('observerCount', 'Jumlah observer', 'Jumlah observer aktual (berbeda dari crew SRU): mohon isi.'),
    mkActual('actualWeather', 'Kondisi cuaca (angin, jarak pandang, dll.)', 'Cuaca aktual dari pengamatan/laporan lapangan — terpisah dari forecast briefing.'),
    mkActual('actualSearchObject', 'Objek pencarian', 'Objek yang benar-benar dicari pada sortie ini: mohon konfirmasi.'),
    mkActual('victimFound', 'Jumlah dan kondisi korban', 'Jumlah & kondisi korban aktual terbaru (jangan pakai POB awal sebagai jumlah ditemukan).'),
    mkActual('otherFindings', 'Informasi lain yang didapat', 'Temuan/petunjuk/investigasi lain: mohon isi beserta sumbernya.'),
    mkActual('actualComms', 'Komunikasi (frekuensi, alat komunikasi, dll.)', 'Frekuensi/alat yang benar-benar dipakai, kualitas, gangguan: mohon catat dari radio log.'),
    mkActual('otherNotes', 'Hal-hal lain yang perlu disampaikan', 'Area yang tidak/belum tersapu penuh, perubahan pola, rekomendasi, catatan keselamatan.'),
    mkActual('debriefName', 'Nama (petugas pelapor debriefing)', 'Nama pelapor debriefing: mohon isi.'),
  ];

  const sections: DocSection[] = [
    {
      id: 'debrief-fields',
      title: 'Format De-Briefing (Lampiran II C)',
      fields,
      note: 'Seluruh field debriefing memakai data AKTUAL (laporan SRU / log pelaksanaan). Nilai planned hanya pembanding — agent tidak menyalin rencana sebagai fakta.',
    },
  ];

  return {
    docType: 'DEBRIEFING',
    title,
    subtitle,
    sections,
    validation: validateDocument(sections, []),
    questions: collectQuestions(sections),
    meta: {
      incidentType: 'DISASTER',
      generatedAt: new Date().toISOString(),
      sourcesUsed: countSources(sections),
    },
  };
}

// ============================================================================
// VALIDASI & PERTANYAAN
// ============================================================================

function validateDocument(sections: DocSection[], conflictWarnings: string[]) {
  let ready = 0; let pending = 0; let conflict = conflictWarnings.length; let actualRequired = 0; let total = 0;
  const counts: Record<SourceType, number> = {
    case: 0, worksheet: 0, map: 0, asset: 0, personnel: 0,
    communications: 0, actual_report: 0, manual_confirmed: 0, unknown: 0,
  };
  for (const s of sections) {
    for (const f of s.fields ?? []) {
      total += 1;
      if (f.status === 'READY') ready += 1;
      else if (f.status === 'PENDING') pending += 1;
      else if (f.status === 'CONFLICT') conflict += 1;
      else if (f.status === 'ACTUAL_REQUIRED') actualRequired += 1;
      counts[f.sourceType] = (counts[f.sourceType] ?? 0) + 1;
    }
  }
  return { ready, pending, conflict, actualRequired, total, conflictWarnings, counts: counts as Record<string, number> };
}

function collectQuestions(sections: DocSection[]): { key: string; label: string; question: string }[] {
  const out: { key: string; label: string; question: string }[] = [];
  for (const s of sections) {
    for (const f of s.fields ?? []) {
      if ((f.status === 'PENDING' || f.status === 'ACTUAL_REQUIRED') && f.question) {
        out.push({ key: f.key, label: f.label, question: f.question });
      }
    }
  }
  return out;
}

function countSources(sections: DocSection[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of sections) for (const f of s.fields ?? []) counts[f.sourceType] = (counts[f.sourceType] ?? 0) + 1;
  return counts;
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/** Bangun dokumen resmi dari snapshot aplikasi + Bank Data (deterministik, tanpa LLM). */
export function buildDocument(
  docType: DocType,
  snapshot: DocumentSnapshot | null,
  bank: DataBankField[],
  selectedAssetId?: string,
): GeneratedDocument {
  if (docType === 'BRIEFING') return buildBriefing(snapshot, bank, selectedAssetId);
  if (docType === 'DEBRIEFING') return buildDebriefing(snapshot, bank, selectedAssetId);
  return buildRenops(docType, snapshot, bank);
}

/** Pilih format RENOPS sesuai incident type (Panduan Agent §3). */
export function pickRenopsType(bank: DataBankField[], incidentTypeHint?: string): DocType {
  // Panduan Agent langkah 2: incident_type kecelakaan kapal/pesawat → Format I;
  // bencana / Kondisi Membahayakan Manusia → Format II. Hint dari hasil analisis
  // Soal Kasus (kolom incidentType) bersifat otoritatif; keyword hanya fallback.
  if (incidentTypeHint === 'ACCIDENT') return 'RENOPS_I';
  if (incidentTypeHint === 'DISASTER') return 'RENOPS_II';
  const t = (bankValue(bank, 'incidentLabel') ?? '').toLowerCase();
  // Cek kecelakaan lebih dulu: "kapal tenggelam"/"kapal hilang kontak" = kecelakaan kapal,
  // sedangkan "orang diduga tenggelam" (tanpa kapal/pesawat) = KKM.
  const accidentKeys = ['kecelakaan', 'crash', 'accident', 'kapal', 'pesawat', 'hilang kontak', 'missing'];
  const disasterKeys = ['bencana', 'membahayakan', 'tenggelam'];
  if (accidentKeys.some((k) => t.includes(k))) return 'RENOPS_I';
  if (disasterKeys.some((k) => t.includes(k))) return 'RENOPS_II';
  return 'RENOPS_II';
}

/** Susun teks prompt ekstraksi Soal Kasus → Bank Data untuk LLM (dipakai API route). */
export function buildExtractionPrompt(rawText: string): string {
  const defs = CASE_FACT_DEFS.filter((d) => !d.plannedActual).map((d) => `- ${d.key}: ${d.label}${d.hint ? ` (${d.hint})` : ''}`).join('\n');
  return `TUGAS: Analisis Soal Kasus SAR berikut dan ekstrak fakta menjadi Bank Data terstruktur.

ATURAN MUTLAK:
1. JANGAN mengarang angka, koordinat, waktu, nama, frekuensi, atau kondisi cuaca. Nilai harus ada di teks sumber.
2. Salin nilai PERSIS dari sumber (pertahankan satuan, format TW G/H/I, ejaan lokasi, dan kata "diduga/diperkirakan").
3. Jika suatu fakta TIDAK ada di teks, JANGAN memasukkan field itu.
4. Buat daftar pertanyaan (questions) untuk SETIAP fakta penting yang hilang. Setiap pertanyaan WAJIB menyertakan "key" = kunci fakta kanonik yang dimaksud (dari daftar di bawah) agar jawaban pengguna otomatis mengisi field itu; gunakan "other" hanya bila tidak ada kunci yang cocok. Pertanyaan spesifik dalam Bahasa Indonesia.
5. incidentType: "ACCIDENT" bila kecelakaan kapal/pesawat udara; "DISASTER" bila bencana/kondisi membahayakan manusia (mis. orang tenggelam).
6. Balas HANYA dengan JSON valid (tanpa penjelasan, tanpa markdown fence) dengan skema:
{"incidentType":"ACCIDENT|DISASTER","caseTitle":"...","fields":[{"key":"...","label":"...","value":"...","unit":null}],"questions":[{"key":"opDay","question":"Apa hari operasi (HARI KE-...)?"}]}

DAFTAR KUNCI FAKTA YANG VALID:
${defs}

SOAL KASUS:
"""
${rawText}
"""`;
}

/** Bentuk pertanyaan yang diharapkan dari LLM: string bebas atau {key, question}. */
export type RawQuestion = string | { key?: unknown; question?: unknown };

/**
 * Ubah daftar pertanyaan hasil LLM menjadi field PENDING pada Bank Data.
 * Pertanyaan dengan kunci kanonik → placeholder PENDING ber-kunci kanonik,
 * sehingga jawaban pengguna langsung mengisi field tersebut (bukan kunci acak).
 * Pertanyaan tanpa kunci yang cocok → field q_ bebas (jawaban disimpan sebagai catatan).
 * Field kanonik yang sudah READY tidak ditimpa placeholder PENDING.
 */
export function questionsToPending(
  rawQuestions: RawQuestion[],
  existing: DataBankField[],
): DataBankField[] {
  const nowIso = new Date().toISOString();
  const out: DataBankField[] = [];
  for (const rq of rawQuestions) {
    let key = '';
    let question = '';
    if (typeof rq === 'string') {
      question = rq.trim();
    } else if (rq && typeof rq === 'object') {
      key = typeof rq.key === 'string' ? rq.key.trim() : '';
      question = typeof rq.question === 'string' ? rq.question.trim() : '';
    }
    if (!question) continue;
    const def = key ? CASE_FACT_MAP[key] : undefined;
    if (def) {
      if (existing.some((f) => f.key === key && f.status === 'READY')) continue; // sudah terisi
      if (out.some((f) => f.key === key)) continue; // duplikat pertanyaan
      out.push({
        key,
        label: def.label,
        value: null,
        sourceType: 'unknown',
        status: 'PENDING',
        question,
        plannedActual: def.plannedActual,
        updatedAt: nowIso,
      });
    } else {
      out.push({
        key: `q_${Date.now().toString(36)}_${out.length}`,
        label: 'Pertanyaan AI',
        value: null,
        sourceType: 'unknown',
        status: 'PENDING',
        question,
        updatedAt: nowIso,
      });
    }
  }
  return out;
}
