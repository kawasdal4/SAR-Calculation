/**
 * VALIDATOR RENCANA (Fase 2 AI Copilot) — `validate_plan`: pemeriksaan
 * konsistensi data kasus SEBELUM worksheet diisi/dijalankan (Fase 0 §4).
 *
 * Bekerja LANGSUNG di atas snapshot state worksheet (bentuk buildState) —
 * tanpa rumus, tanpa perubahan angka: hanya deteksi inkonsistensi:
 * koordinat, rentang sudut 0–360, satuan/rentang wajar (kecepatan, arus,
 * ketinggian, gelombang), waktu, kapasitas life raft vs POB, kategori leeway,
 * kelengkapan minimal lembar WS 2/WS 8.
 *
 * KELAS issue:
 * - 'error'   : data kontradiktif/invalid — worksheet akan menolak/hasil salah.
 * - 'warning' : tidak pasti salah tetapi lazimnya perlu dikonfirmasi planner.
 * - 'info'    : catatan kelengkapan (data wajib belum ada).
 */

import { LEEWAY_OBJECT_TYPES } from './sarCalculations';

export interface PlanIssue {
  level: 'error' | 'warning' | 'info';
  field: string;
  message: string;
}

export interface PlanValidationResult {
  ok: boolean;                 // ok = tidak ada issue 'error'
  issues: PlanIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

// ── Helper defensif (snapshot lintas versi) ──────────────────────────────────

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

function checkCoord(
  issues: PlanIssue[],
  field: string,
  value: unknown,
): { lat: number; lng: number } | undefined {
  const record = asRecord(value);
  const lat = num(record?.lat);
  const lng = num(record?.lng);
  if (lat === undefined || lng === undefined) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    issues.push({ level: 'error', field, message: `Koordinat di luar rentang (lat ${lat}, lng ${lng}) — desimal bertanda: S/W negatif, N/E positif.` });
    return undefined;
  }
  if (lat === 0 && lng === 0) {
    issues.push({ level: 'warning', field, message: 'Koordinat (0,0) — kemungkinan belum diisi (titik nol di laut tengah). Periksa.' });
  }
  return { lat, lng };
}

function checkAngle(issues: PlanIssue[], field: string, value: number | undefined, context: string): void {
  if (value === undefined) return;
  if (value < 0 || value > 360) {
    issues.push({ level: 'error', field, message: `Sudut ${value}° di luar rentang 0–360° (${context}).` });
  }
}

// ── Pemeriksaan utama ────────────────────────────────────────────────────────

/** Validasi snapshot state worksheet. TIDAK pernah melempar. */
export function validatePlanSnapshot(snapshot: Record<string, unknown> | undefined | null): PlanValidationResult {
  const issues: PlanIssue[] = [];
  if (!snapshot) {
    return {
      ok: true,
      issues: [{ level: 'info', field: 'state', message: 'Snapshot state tidak tersedia — tidak ada yang bisa diperiksa.' }],
      errorCount: 0,
      warningCount: 0,
      infoCount: 1,
    };
  }

  const asw = asRecord(snapshot.asw);
  const datum = asRecord(snapshot.datum);
  const lkp = checkCoord(issues, 'lkp', snapshot.lkp);

  // ── LKP/arus: konvensi & rentang ──────────────────────────────────────────
  const currentDir = num(datum?.seaCurrentDir);
  const currentSpeed = num(datum?.seaCurrentSpeed);
  checkAngle(issues, 'datum.seaCurrentDir', currentDir, 'arus laut — arah KE (°T)');
  if (currentSpeed !== undefined && currentSpeed < 0) {
    issues.push({ level: 'error', field: 'datum.seaCurrentSpeed', message: 'Kecepatan arus negatif — harus ≥ 0 knot.' });
  } else if (currentSpeed !== undefined && currentSpeed > 6) {
    issues.push({ level: 'warning', field: 'datum.seaCurrentSpeed', message: `Kecepatan arus ${currentSpeed} knot — tidak lazim (>6 kn); periksa satuan/sumber.` });
  }
  const currentErr = num(datum?.seaCurrentErr);
  if (currentErr !== undefined && currentErr < 0) {
    issues.push({ level: 'error', field: 'datum.seaCurrentErr', message: 'Galat arus negatif — harus ≥ 0 knot.' });
  }

  // ── Kategori leeway: harus terdaftar di Tabel I-1/I-2 ─────────────────────
  const leewayObjectId = str(datum?.leewayObjectId);
  if (leewayObjectId && !LEEWAY_OBJECT_TYPES.some((entry) => entry.id === leewayObjectId)) {
    issues.push({ level: 'error', field: 'datum.leewayObjectId', message: `Kategori leeway "${leewayObjectId}" tidak ada di Tabel I-1/I-2 — pilih id kategori yang terdaftar.` });
  }

  // ── Waktu ASW: ada distressTime → harus ada datumTime (dan sebaliknya) ────
  const distressTime = str(asw?.distressTime);
  const datumTime = str(asw?.datumTime);
  if ((distressTime && !datumTime) || (!distressTime && datumTime)) {
    issues.push({ level: 'warning', field: 'asw.distressTime/datumTime', message: 'Hanya satu dari distress time / datum time yang terisi — ASW butuh keduanya untuk memilih baris angin.' });
  }

  // ── Lembar WS 2 (udara): rentang input ────────────────────────────────────
  for (const raw of asArray(snapshot.ws2Sheets)) {
    const data = asRecord(asRecord(raw)?.data);
    const sruName = str(data?.sruName) ?? '(tanpa nama)';
    const field = `ws2[${sruName}]`;
    const tas = num(data?.searchTas);
    if (tas !== undefined && (tas <= 0 || tas > 500)) {
      issues.push({ level: 'error', field: `${field}.searchTas`, message: `TAS pencarian ${tas} kts di luar rentang wajar (0–500 kts).` });
    }
    const height = num(data?.selectedHeight);
    if (height !== undefined && ![500, 1000, 1500, 2000].includes(height)) {
      issues.push({ level: 'error', field: `${field}.selectedHeight`, message: `Ketinggian pencarian ${height} ft bukan pilihan worksheet (500/1000/1500/2000 ft).` });
    }
    const visIndex = num(data?.visibilityIndex);
    if (visIndex !== undefined && (visIndex < 0 || visIndex > 5)) {
      issues.push({ level: 'error', field: `${field}.visibilityIndex`, message: `Indeks visibility ${visIndex} di luar 0–5 (kolom Tabel I-5/I-6).` });
    }
    const caseWindDir = num(data?.caseWindDirFrom);
    checkAngle(issues, `${field}.caseWindDirFrom`, caseWindDir, 'angin kasus — arah DARI (°T)');
    const caseWindSpeed = num(data?.caseWindSpeed);
    if (caseWindSpeed !== undefined && caseWindSpeed < 0) {
      issues.push({ level: 'error', field: `${field}.caseWindSpeed`, message: 'Angin kasus negatif — arah DARI, kecepatan ≥ 0 knot.' });
    }
    const wave = num(data?.caseWaveHeightM);
    if (wave !== undefined && (wave < 0 || wave > 30)) {
      issues.push({ level: 'warning', field: `${field}.caseWaveHeightM`, message: `Tinggi gelombang ${wave} m di luar rentang lazim (0–30 m) — periksa satuan (meter).` });
    }
    const fw = num(data?.fwOverride);
    if (fw !== undefined && fw < 0) {
      issues.push({ level: 'error', field: `${field}.fwOverride`, message: 'Override Fw negatif (0 berarti kembali ke tabel).' });
    }
    if (visIndex === undefined && caseWindDir === undefined) {
      issues.push({ level: 'info', field: `${field}.visibilityIndex`, message: 'Visibility lembar belum ada — W/S/C/POD belum siap dihitung.' });
    }
  }

  // ── Lembar WS 8 (laut) ────────────────────────────────────────────────────
  for (const raw of asArray(snapshot.ws8Sheets)) {
    const data = asRecord(asRecord(raw)?.data);
    const sruName = str(data?.sruName) ?? '(tanpa nama)';
    const field = `ws8[${sruName}]`;
    const eyeHeight = str(data?.eyeHeight);
    if (eyeHeight && !['8', '14', 'MERSHIP'].includes(eyeHeight)) {
      issues.push({ level: 'error', field: `${field}.eyeHeight`, message: `Eye height "${eyeHeight}" bukan pilihan worksheet ("8"|"14"|"MERSHIP").` });
    }
    const speed = num(data?.vesselSpeedKts);
    if (speed !== undefined && (speed <= 0 || speed > 60)) {
      issues.push({ level: 'warning', field: `${field}.vesselSpeedKts`, message: `Kecepatan kapal ${speed} kts di luar rentang lazim (0–60 kts).` });
    }
    const caseWindDir = num(data?.caseWindDirFrom);
    checkAngle(issues, `${field}.caseWindDirFrom`, caseWindDir, 'angin kasus — arah DARI (°T)');
    const wave = num(data?.caseWaveHeightM);
    if (wave !== undefined && (wave < 0 || wave > 30)) {
      issues.push({ level: 'warning', field: `${field}.caseWaveHeightM`, message: `Tinggi gelombang ${wave} m di luar rentang lazim (0–30 m) — periksa satuan (meter).` });
    }
    if (str(data?.visibilityKm) === undefined) {
      issues.push({ level: 'info', field: `${field}.visibilityKm`, message: 'Visibility lembar belum ada — W/S/C/POD belum siap dihitung.' });
    }
  }

  // ── ADW: ketinggian & glide ───────────────────────────────────────────────
  const aero = asRecord(snapshot.aero);
  if (aero) {
    const altMax = num(aero.aircraftAltMaxFt);
    const altMin = num(aero.aircraftAltMinFt);
    if (altMax !== undefined && (altMax < 0 || altMax > 60000)) {
      issues.push({ level: 'warning', field: 'aero.aircraftAltMaxFt', message: `Altmax ${altMax} ft di luar rentang lazim (0–60.000 ft).` });
    }
    if (altMax !== undefined && altMin !== undefined && altMin > altMax) {
      issues.push({ level: 'error', field: 'aero.altitudeLoss', message: `Altmin (${altMin}) > Altmax (${altMax}) — Altitude Loss negatif, tidak valid.` });
    }
    const glideRatio = num(aero.aircraftGlideRatio);
    if (bool(aero.useAircraftGlide) === true && (glideRatio === undefined || glideRatio <= 0)) {
      issues.push({ level: 'error', field: 'aero.aircraftGlideRatio', message: 'Segmen glide pesawat aktif tetapi glide ratio belum diisi (>0).' });
    }
    const tasg = num(aero.aircraftTASgKts);
    if (bool(aero.useAircraftGlide) === true && (tasg === undefined || tasg <= 0 || tasg > 500)) {
      issues.push({ level: 'error', field: 'aero.aircraftTASgKts', message: `TASg ${tasg ?? '(kosong)'} kts di luar rentang wajar (0–500 kts).` });
    }
    const heading = num(aero.aircraftDescentHeadingDeg);
    checkAngle(issues, 'aero.aircraftDescentHeadingDeg', heading, 'heading turun');
    const variationDeg = num(aero.magneticVariationDeg);
    if (variationDeg !== undefined && (variationDeg < 0 || variationDeg >= 180)) {
      issues.push({ level: 'error', field: 'aero.magneticVariationDeg', message: `Variation ${variationDeg}° tidak valid (0–179.9; arah dipisah di E/W).` });
    }
  }

  // ── Aset alokasi: endurance/transit & koordinat pangkalan ─────────────────
  for (const raw of asArray(snapshot.assets)) {
    const asset = asRecord(raw);
    const name = str(asset?.name) ?? '(tanpa nama)';
    const field = `assets[${name}]`;
    const homePos = checkCoord(issues, `${field}.homeBasePos`, asset?.homeBasePos);
    if (!homePos) {
      issues.push({ level: 'info', field: `${field}.homeBasePos`, message: 'Koordinat pangkalan/lokasi aset belum ada — transit/TSF tidak bisa dihitung.' });
    }
    const endurance = num(asset?.enduranceHours);
    if (endurance !== undefined && (endurance < 0 || endurance > 48)) {
      issues.push({ level: 'warning', field: `${field}.enduranceHours`, message: `Endurance ${endurance} jam di luar rentang lazim (0–48 jam) — periksa satuan.` });
    }
    const transit = num(asset?.transitSpeedKts);
    if (transit !== undefined && (transit < 0 || transit > 500)) {
      issues.push({ level: 'error', field: `${field}.transitSpeedKts`, message: `Kecepatan transit ${transit} kts di luar rentang wajar (0–500 kts).` });
    }
    const searchSpeed = num(asset?.searchSpeedKts);
    if (searchSpeed !== undefined && (searchSpeed < 0 || searchSpeed > 500)) {
      issues.push({ level: 'error', field: `${field}.searchSpeedKts`, message: `Kecepatan pencarian ${searchSpeed} kts di luar rentang wajar (0–500 kts).` });
    }
    if (searchSpeed !== undefined && transit !== undefined && searchSpeed > transit) {
      issues.push({ level: 'warning', field: `${field}.searchSpeedKts`, message: `Kecepatan pencarian (${searchSpeed}) > kecepatan transit (${transit}) — lazimnya sebaliknya; periksa.` });
    }
  }

  // ── Intercept: haluan/kecepatan ───────────────────────────────────────────
  const intercept = asRecord(snapshot.intercept);
  if (intercept) {
    const targetHeading = num(intercept.targetHeadingDeg) ?? num(intercept.targetCourseDeg);
    checkAngle(issues, 'intercept.targetHeadingDeg', targetHeading, 'haluan target');
    const sruSpeed = num(intercept.sruSpeedKts);
    if (sruSpeed !== undefined && (sruSpeed <= 0 || sruSpeed > 500)) {
      issues.push({ level: 'error', field: 'intercept.sruSpeedKts', message: `Kecepatan SRU ${sruSpeed} kts di luar rentang wajar.` });
    }
    const targetSpeed = num(intercept.targetSpeedKts);
    if (targetSpeed !== undefined && (targetSpeed < 0 || targetSpeed > 500)) {
      issues.push({ level: 'error', field: 'intercept.targetSpeedKts', message: `Kecepatan target ${targetSpeed} kts di luar rentang wajar.` });
    }
  }

  // ── Pola pencarian: orientasi & track spacing ─────────────────────────────
  const orientationText = str(snapshot.patternOrientationText);
  if (orientationText) {
    const parsed = parseFloat(orientationText.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 360) {
      issues.push({ level: 'error', field: 'pattern.orientation', message: `Orientasi pola "${orientationText}" tidak dapat dibaca sebagai derajat 0–360.` });
    }
  }
  for (const [key, spacings] of [['ws2TrackSpacings', snapshot.ws2TrackSpacings], ['ws8TrackSpacings', snapshot.ws8TrackSpacings]] as const) {
    for (const raw of Object.values(asRecord(spacings) ?? {})) {
      const spacing = num(asRecord(raw)?.spacingNm);
      if (spacing !== undefined && (spacing < 0 || spacing > 20)) {
        issues.push({ level: 'warning', field: `${key}.spacingNm`, message: `Track spacing override ${spacing} NM di luar rentang lazim (0–20 NM) — periksa.` });
      }
    }
  }

  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  const warningCount = issues.filter((issue) => issue.level === 'warning').length;
  const infoCount = issues.filter((issue) => issue.level === 'info').length;
  return { ok: errorCount === 0, issues, errorCount, warningCount, infoCount };
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
