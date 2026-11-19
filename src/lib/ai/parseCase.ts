/**
 * PARSE CASE (Fase 3 AI Copilot) — alur "Ekstrak → Konfirmasi → Terapkan →
 * Hitung → Review" dari satu soal kasus (teks/PDF/gambar).
 *
 * PRINSIP (spesifikasi + keputusan no.5 & 6):
 * - Satu panggilan LLM TANPA tools; keluaran dipaksa JSON (structured output)
 *   dengan schema yang berasal dari `sarCaseSchema` (Fase 1) — bukan skema
 *   liar model. Revalidasi ZOD selalu dijalankan di server.
 * - DILARANG mengarang nilai: field tidak tertulis di soal → meta.missingFields;
 *   tafsiran model → meta.assumptions + status UNVERIFIED di meta.fieldSources.
 *   Hanya nilai yang tertulis eksplisit boleh VERIFIED (keputusan no.6).
 * - Semua angka yang masuk worksheet berasal dari `buildCaseWorksheetSeeds()`
 *   (Fase 1) — satu mekanisme pemetaan yang sama dengan tool set_*_case.
 * - Apply plan deterministik: daftar langkah berurutan (ASW → AWA → ADW →
 *   Datum → WS 2/WS 8 per SRU → Aset) yang payload-nya PERSIS bentuk handler
 *   apply di page.tsx (handleApplyASW/...); penerapan tetap lewat handler
 *   tersebut (keputusan no.5: satu mekanisme update, bukan dua).
 * - Modul ini MURNI (tanpa dependensi runtime UI/server) supaya bisa dipakai
 *   route `/api/ai/parse-case`, panel chat, dan test.
 */

import {
  sarCaseSchema,
  type SarCaseSchema,
} from '../sar/caseSchema';
import {
  buildCaseWorksheetSeeds,
  checkCaseCompleteness,
  type CaseCompleteness,
  type CasePlannerInputs,
} from '../sar/caseAdapter';
import { buildAswObservationsFromCase, toBasarnasTimeFormat } from '../sar/aswTime';
import { computeASW } from '../sar/sarCalculations';
import { parseCoordinate } from '../sar/coordFormat';
import type { AssetAllocationCaseInput } from '../sar/assetAllocation';

// ── JSON Schema ekstraksi (Interactions API: tipe lowercase) ────────────────

/** Koordinat: desimal bertanda + DMS asli (cermin coordSchema). */
const COORD_SCHEMA = {
  type: 'object',
  properties: {
    lat: { type: 'number' },
    lng: { type: 'number' },
    dmsLat: { type: 'string' },
    dmsLng: { type: 'string' },
  },
  required: ['lat', 'lng'],
};

/** Skema JSON keluaran model — cermin permisif `sarCaseSchema` + meta
 *  provenance. `required` seminimal mungkin (incident.type) agar soal
 *  parsial tetap terekstrak; kelengkapan diperiksa checkCaseCompleteness. */
export const CASE_EXTRACTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer' },
    caseTitle: { type: 'string' },
    examHeader: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        trainingName: { type: 'string' },
        angkatan: { type: 'string' },
        year: { type: 'integer' },
        durationMinutes: { type: 'integer' },
        isOpenBook: { type: 'boolean' },
        examDate: { type: 'string' },
      },
    },
    incident: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['aircraft-ditching', 'aircraft-land-crash', 'vessel-sinking', 'person-overboard', 'other'] },
        callsign: { type: 'string' },
        craftType: { type: 'string' },
        pob: { type: 'integer' },
        lifeRaftCount: { type: 'integer' },
        lifeRaftCapacityPerRaft: { type: 'integer' },
        otherSafetyEquipment: { type: 'string' },
        infoSource: { type: 'string' },
        reportTime: { type: 'string' },
        lastContactTime: { type: 'string' },
        checkpoint: { type: 'string' },
        flightLevelFt: { type: 'number' },
        altitudeFt: { type: 'number' },
        headingDeg: { type: 'number' },
        headingReference: { type: 'string', enum: ['true', 'magnetic', 'compass'] },
        damageDescription: { type: 'string' },
        ditchingIndication: { type: 'string' },
      },
      required: ['type'],
    },
    target: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['aircraft', 'vessel', 'liferaft', 'person', 'other'] },
        name: { type: 'string' },
        flag: { type: 'string' },
        lengthM: { type: 'number' },
        wingspanM: { type: 'number' },
        heightM: { type: 'number' },
        wingAreaM2: { type: 'number' },
        cabinHeightM: { type: 'number' },
        cabinWidthM: { type: 'number' },
        cruiseSpeedKts: { type: 'number' },
        cruiseSpeedKmh: { type: 'number' },
        stallSpeedKts: { type: 'number' },
        rangeNm: { type: 'number' },
        serviceCeilingFt: { type: 'number' },
        rateOfClimbFpm: { type: 'number' },
        wingLoadingKgM2: { type: 'number' },
        frequencies: { type: 'array', items: { type: 'string' } },
        payload: { type: 'string' },
        navigation: { type: 'array', items: { type: 'string' } },
        leewayObjectId: { type: 'string' },
      },
    },
    sarOffice: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        coord: COORD_SCHEMA,
        radialDegToLkp: { type: 'number' },
        transitHoursToLkp: { type: 'number' },
      },
    },
    lkp: {
      type: 'object',
      properties: {
        coord: COORD_SCHEMA,
        source: { type: 'string', enum: ['explicit', 'adw-landing'] },
      },
    },
    aeroDrift: {
      type: 'object',
      properties: {
        glideSpeedKts: { type: 'number' },
        glideRatio: { type: 'number' },
        variationDeg: { type: 'number' },
        variationDirection: { type: 'string', enum: ['E', 'W'] },
        deviationDeg: { type: 'number' },
        deviationDirection: { type: 'string', enum: ['E', 'W'] },
        windLayers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              altitudeFt: { type: 'number' },
              altitudeLabel: { type: 'string' },
              windDirFrom: { type: 'number' },
              windSpeedKts: { type: 'number' },
            },
            required: ['altitudeFt', 'windDirFrom', 'windSpeedKts'],
          },
        },
        parachute: {
          type: 'object',
          properties: {
            present: { type: 'boolean' },
            type: { type: 'string', enum: ['steerable', 'round-zero-glide'] },
            altMaxFt: { type: 'number' },
            rateOfDescentFtMin: { type: 'number' },
            glideRatio: { type: 'number' },
          },
          required: ['present'],
        },
      },
    },
    sea: {
      type: 'object',
      properties: {
        current: {
          type: 'object',
          properties: {
            dirToDeg: { type: 'number' },
            speedKts: { type: 'number' },
          },
          required: ['dirToDeg', 'speedKts'],
        },
        surfaceWindSeries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              obsTime: { type: 'string' },
              windDirFrom: { type: 'number' },
              windSpeedKts: { type: 'number' },
            },
            required: ['obsTime', 'windDirFrom', 'windSpeedKts'],
          },
        },
        waveHeightM: { type: 'number' },
      },
    },
    search: {
      type: 'object',
      properties: {
        datumTime: { type: 'string' },
        stagesDone: {
          type: 'array',
          items: {
            type: 'object',
            properties: { stage: { type: 'integer' }, result: { type: 'string' } },
            required: ['stage'],
          },
        },
        visibilityKm: { type: 'number' },
        weatherNotes: { type: 'string' },
        searchNumber: { type: 'integer' },
      },
    },
    sru: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          callsign: { type: 'string' },
          kind: { type: 'string', enum: ['helicopter', 'fixed-wing', 'vessel'] },
          model: { type: 'string' },
          coord: COORD_SCHEMA,
          engine: { type: 'string', enum: ['turbine', 'piston'] },
          enduranceHours: { type: 'number' },
          enduranceMinutes: { type: 'number' },
          tasMaxKts: { type: 'number' },
          tasSearchKts: { type: 'number' },
          visibilityKm: { type: 'number' },
          windDirFrom: { type: 'number' },
          windSpeedKts: { type: 'number' },
          observerCondition: { type: 'string' },
          taf: { type: 'string' },
          frequencies: { type: 'array', items: { type: 'string' } },
          captain: { type: 'string' },
          phoneSatellite: { type: 'string' },
          navigation: { type: 'array', items: { type: 'string' } },
        },
        required: ['callsign', 'kind'],
      },
    },
    tasksRequested: { type: 'array', items: { type: 'string' } },
    meta: {
      type: 'object',
      properties: {
        assumptions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { field: { type: 'string' }, value: { type: 'string' }, reason: { type: 'string' } },
            required: ['field', 'reason'],
          },
        },
        missingFields: {
          type: 'array',
          items: {
            type: 'object',
            properties: { field: { type: 'string' }, reason: { type: 'string' } },
            required: ['field', 'reason'],
          },
        },
        fieldSources: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              source: { type: 'string' },
              status: { type: 'string', enum: ['VERIFIED', 'UNVERIFIED'] },
            },
            required: ['field', 'source', 'status'],
          },
        },
        source: { type: 'string', enum: ['pdf', 'text', 'generator', 'manual', 'unknown'] },
      },
    },
  },
  required: ['incident'],
};

/** Instruksi sistem ekstraksi (Bahasa Indonesia; satu panggilan tanpa tools). */
export const EXTRACTION_SYSTEM_INSTRUCTION = `Anda adalah mesin EKSTRAKSI DATA soal kasus SAR. Tugas Anda SATU: mengubah teks soal (dan/atau lampiran PDF/gambar) menjadi JSON sesuai skema yang diberikan. JANGAN menjelaskan, JANGAN menghitung, JANGAN menasihati — keluarkan HANYA JSON.

ATURAN MUTLAK (pelanggaran = jawaban ditolak):
1. KELUARAN HANYA JSON valid persis sesuai skema — tanpa markdown, tanpa teks pembuka/penutup.
2. DILARANG MENGARANG nilai. Field yang tidak tertulis di soal DIBIARKAN kosong (tidak ada di JSON) dan dicatat di meta.missingFields {field, reason}.
3. HANYA nilai yang tertulis EKSPLISIT di soal berstatus VERIFIED di meta.fieldSources (sertakan kutipan teks sumbernya). Nilai hasil tafsiran/penurunan/konversi Anda WAJIB UNVERIFIED dan juga dicatat di meta.assumptions {field, value, reason}.
4. KONVENSI WAJIB:
   - ANGIN: arah DARI mana angin bertiup (windDirFrom, 0-360, knots) — "wind from 045" berarti windDirFrom 45.
   - ARUS/DRIFT: arah KE mana air bergerak (dirToDeg) — "current setting 090" berarti dirToDeg 90.
   - TRUE = magnetic + variation (E ditambah, W dikurangi). Simpan nilai soal apa adanya; heading soal biasanya magnetic (headingReference "magnetic").
   - WAKTU: string APA ADANYA dari soal (mis. "18 November 2026 13.50 WIB"); lastContactTime = waktu MAYDAY/kontak terakhir; search.datumTime = Datum Time soal.
   - KOORDINAT: derajat desimal bertanda — S negatif, W negatif (mis. "06°52'46\\"S" → lat -6.879). dmsLat/dmsLng diisi string aslinya.
   - SATUAN: jarak NM, kecepatan knots, ketinggian feet, gelombang meter, visibility kilometer. FL200 → flightLevelFt 200 (bukan 20000; kaki dihitung aplikasi).
   - ANGKA Indonesia: "1.000" = 1000; "1,5" = 1.5.
5. Tabel angin per ketinggian soal → aeroDrift.windLayers (altitudeFt 0 = Surface, sertakan altitudeLabel asli). Deret angin permukaan berwaktu → sea.surfaceWindSeries (obsTime string asli).
6. Setiap SRU/alut di tabel data soal → satu entri sru (callsign WAJIB; kind: helicopter/fixed-wing/vessel; endurance "2j 45m" → enduranceHours 2 + enduranceMinutes 45).
7. meta.source: "pdf" bila sumber lampiran PDF/gambar, "text" bila teks ditempel pengguna.
8. Jangan mengisi field hasil perhitungan (ASW/AWA/datum/luas area/POD) — skema tidak memilikinya; hanya INPUT worksheet.`;

// ── Ekstraksi JSON dari teks model ──────────────────────────────────────────

export interface JsonCandidateResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Ambil kandidat JSON dari teks model: buang code fence, cari kurung kurawal
 *  berpasangan dari '{' pertama. TIDAK pernah melempar. */
export function extractJsonCandidate(text: string): JsonCandidateResult {
  const raw = (text ?? '').trim();
  if (!raw) return { ok: false, error: 'Respons model kosong.' };
  // Buang fence ```json ... ``` bila ada (ambil isinya).
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf('{');
  if (start === -1) return { ok: false, error: 'Tidak ada objek JSON di respons model.' };
  // Cari kurung penutup yang berpasangan (abaikan yang di dalam string).
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = body.slice(start, i + 1);
        try {
          return { ok: true, data: JSON.parse(candidate) };
        } catch (err) {
          return { ok: false, error: `JSON tidak valid: ${err instanceof Error ? err.message.slice(0, 160) : 'parse gagal'}` };
        }
      }
    }
  }
  return { ok: false, error: 'Objek JSON tidak tertutup (kurung kurawal berpasangan tidak ditemukan).' };
}

// ── Baris pratinjau per-field ───────────────────────────────────────────────

export type FieldRowStatus = 'OK' | 'DIASUMSIKAN' | 'HILANG';

export interface ExtractionFieldRow {
  /** Path JSON kasus (mis. incident.pob, sru[BASAL 142].visibilityKm). */
  field: string;
  /** Blok worksheet tujuan (label UI). */
  worksheet: string;
  /** Nilai terformat singkat untuk pratinjau. */
  value: string;
  status: FieldRowStatus;
  /** Kutipan sumber di soal (bila ada dari meta.fieldSources). */
  source?: string;
}

const WORKSHEET_OF_FIELD: Array<{ test: RegExp; worksheet: string }> = [
  { test: /^examHeader|^caseTitle/, worksheet: 'Identitas Kasus' },
  { test: /^incident\./, worksheet: 'Insiden' },
  { test: /^target\./, worksheet: 'Target/Data Pesawat' },
  { test: /^sarOffice\./, worksheet: 'Kantor SAR' },
  { test: /^lkp\./, worksheet: 'LKP / ADW' },
  { test: /^aeroDrift\.windLayers/, worksheet: 'AWA' },
  { test: /^aeroDrift\./, worksheet: 'ADW (Aero Drift)' },
  { test: /^sea\.surfaceWindSeries/, worksheet: 'ASW' },
  { test: /^sea\./, worksheet: 'Datum WS 1 (arus/gelombang)' },
  { test: /^search\./, worksheet: 'Pencarian' },
  { test: /^sru\[/, worksheet: 'Lembar WS 2/WS 8 & Aset' },
  { test: /^datum\./, worksheet: 'Datum WS 1' },
];

function worksheetLabelOf(field: string): string {
  return WORKSHEET_OF_FIELD.find((entry) => entry.test.test(field))?.worksheet ?? 'Lainnya';
}

/** Format nilai ringkas untuk pratinjau (tanpa JSON dump panjang). */
function formatFieldValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'object' && item !== null)) return `${value.length} baris`;
    return value.slice(0, 4).map((item) => formatFieldValue(item)).join(', ') + (value.length > 4 ? `, +${value.length - 4}` : '');
  }
  return `${countLeaves(value as Record<string, unknown>)} field`;
}

function countLeaves(record: Record<string, unknown>): number {
  let count = 0;
  for (const value of Object.values(record)) {
    if (value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)) count += countLeaves(value as Record<string, unknown>);
    else if (value !== undefined && value !== null) count += 1;
  }
  return count;
}

/** Baris pratinjau dari nilai kasus yang TERISI (berjalan rekursif pada JSON).
 *  Array of object: `sru` memakai kunci callsign (`sru[BASAL 142].visibilityKm`,
 *  mergeable oleh mergeUserFieldValue); array of object lain (windLayers,
 *  surfaceWindSeries) diringkas SATU baris "N baris". Array skalar → satu baris. */
function buildFilledRows(prefix: string, value: unknown, worksheetOverride?: string, out?: ExtractionFieldRow[]): ExtractionFieldRow[] {
  const rows = out ?? [];
  if (value === undefined || value === null) return rows;
  if (Array.isArray(value)) {
    const allObjects = value.length > 0 && value.every((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (allObjects) {
      if (prefix === 'sru') {
        value.forEach((item, index) => {
          const record = item as Record<string, unknown>;
          const key = typeof record['callsign'] === 'string' && record['callsign'].trim() !== ''
            ? `sru[${record['callsign'].trim()}]`
            : `sru[${index}]`;
          buildFilledRows(key, item, worksheetOverride, rows);
        });
        return rows;
      }
      rows.push({
        field: prefix,
        worksheet: worksheetOverride ?? worksheetLabelOf(prefix),
        value: `${value.length} baris`,
        status: 'OK',
      });
      return rows;
    }
    rows.push({
      field: prefix,
      worksheet: worksheetOverride ?? worksheetLabelOf(prefix),
      value: formatFieldValue(value),
      status: 'OK',
    });
    return rows;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      buildFilledRows(prefix ? `${prefix}.${key}` : key, child, worksheetOverride, rows);
    }
    return rows;
  }
  rows.push({
    field: prefix,
    worksheet: worksheetOverride ?? worksheetLabelOf(prefix),
    value: formatFieldValue(value),
    status: 'OK',
  });
  return rows;
}

/** Susun baris pratinjau per-field dari kasus hasil ekstraksi + planner.
 *  Status: OK (nilai terisi/terverifikasi soal), DIASUMSIKAN (tafsiran model
 *  /default planner), HILANG (wajib tapi tidak ada). Deterministik. */
export function deriveExtractionFieldRows(
  sarCase: SarCaseSchema,
  planner: CasePlannerInputs = {},
): ExtractionFieldRow[] {
  const rows = new Map<string, ExtractionFieldRow>();

  // 1) Nilai terisi (berjalan pada JSON kasus, meta ikut).
  const filled = buildFilledRows('', sarCase, undefined);
  for (const row of filled) {
    if (row.field === 'schemaVersion') continue;
    if (row.field.startsWith('meta.')) {
      row.worksheet = 'Catatan Ekstraksi';
      // meta.fieldSources: naikkan sumber ke baris field terkait.
      continue;
    }
    if (!rows.has(row.field)) rows.set(row.field, row);
  }

  // 2) Provenance dari meta.fieldSources (VERIFIED/UNVERIFIED + kutipan soal).
  for (const source of sarCase.meta?.fieldSources ?? []) {
    const existing = rows.get(source.field);
    if (existing) {
      existing.source = source.source;
      if (source.status === 'UNVERIFIED') existing.status = 'DIASUMSIKAN';
    } else {
      rows.set(source.field, {
        field: source.field,
        worksheet: worksheetLabelOf(source.field),
        value: '(dirujuk di soal)',
        status: source.status === 'UNVERIFIED' ? 'DIASUMSIKAN' : 'OK',
        source: source.source,
      });
    }
  }

  // 3) Asumsi model (meta.assumptions) + asumsi pemetaan seed (planner defaults).
  const notes: Array<{ field: string; value?: string; reason: string }> = [
    ...(sarCase.meta?.assumptions ?? []),
  ];
  const { assumptions: seedAssumptions } = buildCaseWorksheetSeeds(sarCase, planner);
  notes.push(...seedAssumptions.map((note) => ({ field: note.field, value: note.value, reason: note.reason })));
  for (const note of notes) {
    const existing = rows.get(note.field);
    if (existing) {
      if (existing.status === 'OK') existing.status = 'DIASUMSIKAN';
      existing.source = existing.source ?? note.reason;
    } else {
      rows.set(note.field, {
        field: note.field,
        worksheet: worksheetLabelOf(note.field),
        value: note.value ?? '(asumsi)',
        status: 'DIASUMSIKAN',
        source: note.reason,
      });
    }
  }

  // 4) MISSING: meta.missingFields + checkCaseCompleteness (aturan worksheet).
  for (const missing of sarCase.meta?.missingFields ?? []) {
    const existing = rows.get(missing.field);
    // Entri missingFields yang field-nya SUDAH bernilai konkret dianggap basi
    // (model menyebut hilang tapi tetap mengisi nilai) — nilai yang ada menang.
    if (existing && existing.value !== '' && !existing.value.startsWith('(')) continue;
    if (existing) {
      existing.status = 'HILANG';
      existing.source = missing.reason;
      existing.value = '';
    } else {
      rows.set(missing.field, {
        field: missing.field,
        worksheet: worksheetLabelOf(missing.field),
        value: '',
        status: 'HILANG',
        source: missing.reason,
      });
    }
  }
  const completeness = checkCaseCompleteness(sarCase, planner);
  for (const issue of completeness.issues) {
    const existing = rows.get(issue.field);
    // Nilai konkret yang sudah ada = kebenaran lapangan; issue MISSING yang
    // datang untuk field bernilai (mis. re-emit meta.missingFields) basi.
    const hasConcreteValue = Boolean(existing && existing.value !== '' && !existing.value.startsWith('('));
    if (existing) {
      if (issue.status === 'MISSING') {
        if (hasConcreteValue) continue;
        existing.status = 'HILANG';
        existing.value = '';
        if (!existing.source) existing.source = issue.reason;
      } else if (existing.status === 'OK') {
        existing.status = 'DIASUMSIKAN';
        if (!existing.source) existing.source = issue.reason;
      }
    } else {
      rows.set(issue.field, {
        field: issue.field,
        worksheet: issue.worksheet,
        value: '',
        status: issue.status === 'MISSING' ? 'HILANG' : 'DIASUMSIKAN',
        source: issue.reason,
      });
    }
  }

  rows.delete('meta.source');
  return [...rows.values()].sort((a, b) => {
    if (a.worksheet !== b.worksheet) return a.worksheet.localeCompare(b.worksheet, 'id');
    return a.field.localeCompare(b.field, 'id');
  });
}

// ── Merge nilai yang diisi pengguna ke kasus (pratinjau → perbaikan) ────────

export interface MergeFieldResult {
  ok: boolean;
  error?: string;
  /** Catatan asumsi untuk meta.assumptions bila nilai diisi pengguna. */
  assumption?: { field: string; value: string; reason: string };
}

/** Parse teks pengguna sesuai tipe leaf pada path. Mendukung angka (format
 *  Indonesia), koordinat DMS/desimal, boolean, dan string. TIDAK mengarang
 *  satuan — nilai dianggap sudah dalam satuan worksheet. */
function coerceUserValue(path: string, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'Nilai kosong.' };
  if (/lat|lng$/.test(path) || /coord/.test(path)) {
    const axis = /lat$|dmsLat$/.test(path) ? 'lat' : 'lng';
    const parsed = parseCoordinate(text, axis);
    if (parsed === null) return { ok: false, error: `Koordinat "${text}" tidak terbaca (mis. 06°52'46"S atau -6.879).` };
    return { ok: true, value: Math.round(parsed * 1e6) / 1e6 };
  }
  if (/^(incident\.pob|incident\.lifeRaftCount|incident\.lifeRaftCapacityPerRaft|.*searchNumber|.*flightLevelFt|.*altitudeFt)$/.test(path)) {
    const num = parseLooseNumber(text);
    if (num === null || !Number.isInteger(num) || num < 0) return { ok: false, error: `Harus bilangan bulat ≥ 0 (diterima: "${text}").` };
    return { ok: true, value: num };
  }
  if (/^(searchNumber|schemaVersion)$/.test(path)) {
    const num = parseLooseNumber(text);
    if (num === null || !Number.isInteger(num)) return { ok: false, error: 'Harus bilangan bulat.' };
    return { ok: true, value: num };
  }
  // Angka umum (kts/ft/m/NM/jam/menit/derajat): terima "1.000", "1,5", "12 kts",
  // "15 kM" — teks di luar angka + satuan umum → string biasa (waktu, nama).
  const num = parseLooseNumber(text);
  if (num !== null && /^[+-]?[\d.,\s]+(?:\s*(?:ft|feet|kts|knot|knots|kt|nm|m|km|deg|°|menit|min|jam|j|h|hours?))?\.?$/i.test(text)) {
    return { ok: true, value: num };
  }
  return { ok: true, value: text };
}

/** "1.000" → 1000; "1,5" → 1.5; "12 kts" → 12; selain itu null. */
function parseLooseNumber(text: string): number | null {
  const cleaned = text.trim().replace(/^([+-]?[\d.,\s]+)(?:\s*\w+)*$/, '$1').replace(/\s/g, '');
  if (!/^([+-]?)(\d{1,9}(?:[.,]\d{1,6})?)$/.test(cleaned)) return null;
  let normalized = cleaned;
  // Format Indonesia: titik ribuan + koma desimal.
  if (/,\d{1,6}$/.test(normalized)) normalized = normalized.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) normalized = normalized.replace(/\./g, '');
  else normalized = normalized.replace(',', '.');
  const value = parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Resolve path berbentuk `sru[BASAL 142].visibilityKm` → array sru milik
 *  callsign tersebut; path biasa `sea.current.speedKts` → nested object. */
function resolvePathContainer(sarCase: SarCaseSchema, path: string): { container: Record<string, unknown> | unknown[]; key: string } | { error: string } {
  const match = path.match(/^(\w+)\[([^\]]+)\]\.?(.*)$/);
  if (match) {
    const [, arrayName, arrayKey, rest] = match;
    const list = (sarCase as unknown as Record<string, unknown>)[arrayName];
    if (!Array.isArray(list)) {
      return { error: `SRU "${arrayKey}" tidak ditemukan — daftar "${arrayName}" kosong/tidak ada di kasus.` };
    }
    const index = list.findIndex((item) => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return typeof record['callsign'] === 'string' && record['callsign'].trim().toLowerCase() === arrayKey.trim().toLowerCase();
    });
    if (index === -1) return { error: `SRU "${arrayKey}" tidak ditemukan.` };
    const item = list[index] as Record<string, unknown>;
    if (!rest) return { container: item, key: rest };
    const parts = rest.split('.');
    let cursor: Record<string, unknown> = item;
    for (const part of parts.slice(0, -1)) {
      const child = cursor[part];
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        const created: Record<string, unknown> = {};
        cursor[part] = created;
        cursor = created;
      } else {
        cursor = child as Record<string, unknown>;
      }
    }
    return { container: cursor, key: parts[parts.length - 1] };
  }
  const parts = path.split('.');
  let cursor: Record<string, unknown> = sarCase as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part];
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      const created: Record<string, unknown> = {};
      cursor[part] = created;
      cursor = created;
    } else {
      cursor = child as Record<string, unknown>;
    }
  }
  return { container: cursor, key: parts[parts.length - 1] };
}

/** Masukkan nilai yang diisi pengguna ke kasus (mutasi in-place pada salinan
 *  pemanggil). Koordinat `lkp.coord.lat/lng` → juga set lkp.source explicit.
 *  Nilai tercatat sebagai asumsi "diisi pengguna" (keputusan no.6). */
export function mergeUserFieldValue(sarCase: SarCaseSchema, path: string, rawValue: string): MergeFieldResult {
  const coerced = coerceUserValue(path, rawValue);
  if (!coerced.ok) return { ok: false, error: coerced.error };
  const target = resolvePathContainer(sarCase, path);
  if ('error' in target) return { ok: false, error: target.error };
  const { container, key } = target;
  if (!key) return { ok: false, error: 'Path tidak menunjuk field mana pun.' };
  (container as Record<string, unknown>)[key] = coerced.value;
  if (path === 'lkp.coord.lat' || path === 'lkp.coord.lng') {
    (sarCase as unknown as Record<string, unknown>).lkp = {
      ...((sarCase as unknown as Record<string, unknown>).lkp as Record<string, unknown>),
      source: 'explicit',
    };
  }
  return {
    ok: true,
    assumption: { field: path, value: rawValue.trim(), reason: 'Diisi pengguna pada panel pratinjau ekstraksi (bukan dari teks soal).' },
  };
}

// ── Apply plan: kasus → langkah apply handler (SATU mekanisme) ──────────────

export type CaseApplyWorksheet = 'asw' | 'awa' | 'aero' | 'datum' | 'ws2' | 'ws8' | 'assets';

export interface CaseApplyStep {
  id: string;
  worksheet: CaseApplyWorksheet;
  /** Label baris pratinjau (mis. "WS 2 — BASAL 142"). */
  label: string;
  /** Payload PERSIS bentuk handler apply di page.tsx (handleApply*). */
  payload: Record<string, unknown>;
}

export interface CaseApplyPlan {
  steps: CaseApplyStep[];
  /** Langkah yang sengaja tidak dibuat + alasannya (mis. pola pencarian
   *  menunggu Datum; SRU tanpa koordinat tidak masuk Alokasi Aset). */
  skipped: Array<{ worksheet: CaseApplyWorksheet | 'pattern'; reason: string }>;
}

const W2_PLATFORMS = new Set(['fixed-wing', 'helicopter']);

/** Gate ringan payload lembar WS 2 (fakta inti; pilihan planner boleh parsial —
 *  kontrak dua tingkat yang sama dengan applyFunctionCalls). */
function ws2PayloadReady(payload: Record<string, unknown>): boolean {
  const platform = payload['searchPlatform'];
  const object = payload['searchObject'];
  return typeof platform === 'string' && W2_PLATFORMS.has(platform)
    && typeof object === 'string' && object.length > 0;
}

function ws8PayloadReady(payload: Record<string, unknown>): boolean {
  const object = payload['searchObject'];
  const eyeHeight = payload['eyeHeight'];
  return typeof object === 'string' && object.length > 0
    && typeof eyeHeight === 'string' && eyeHeight.length > 0;
}

/** Hitung hours of drift (a) DARI FUNGSI RESMI: rantai yang sama dengan
 *  worksheet (handleApplyASW: konversi Basarnas → buildAswObservationsFromCase
 *  → computeASW.totalHours). Aturan rantai: "hours of drift = total hours ASW". */
function computeDriftIntervalFromAsw(aswSeed: NonNullable<CaseApplySources['asw']>): number | undefined {
  const distressBasarnas = toBasarnasTimeFormat(aswSeed.distressTime);
  const datumBasarnas = toBasarnasTimeFormat(aswSeed.datumTime);
  const distressTime = distressBasarnas ? `${distressBasarnas} Z` : aswSeed.distressTime;
  const datumTime = datumBasarnas ? `${datumBasarnas} Z` : aswSeed.datumTime;
  const observations = buildAswObservationsFromCase(distressTime, datumTime, aswSeed.intervalMode, aswSeed.windData);
  if (observations.length === 0) return undefined;
  const result = computeASW(observations);
  return result.totalHours > 0 ? Math.round(result.totalHours * 100) / 100 : undefined;
}

/** Bahan internal — bentuk seeds dari caseAdapter (hindari import tipe UI). */
interface CaseApplySources {
  asw?: { distressTime: string; datumTime: string; intervalMode: '6h' | '3h'; windData: Array<{ obsTime?: string; windDirFrom: number; windSpeed: number }> };
  awa?: Record<string, unknown>;
  aero?: Record<string, unknown>;
  datum?: Record<string, unknown>;
  lkp?: { lat: number; lng: number };
  ws2Sheets: Array<{ sruName?: string; data: Record<string, unknown> }>;
  ws8Sheets: Array<{ sruName?: string; data: Record<string, unknown> }>;
  assets: Array<Record<string, unknown>>;
}

/** Susun rencana penerapan kasus ke worksheet. MURNI + deterministik: payload
 *  tiap langkah = bentuk handler apply halaman; urutan mengikuti rantai
 *  worksheet (ASW → AWA → ADW → Datum → lembar per SRU → Alokasi Aset).
 *  Langkah dengan fakta inti belum lengkap TIDAK dibuat (dilaporkan skipped)
 *  supaya penerapan tidak menulis angka setengah jadi. */
export function buildApplyPlan(
  sarCase: SarCaseSchema,
  planner: CasePlannerInputs = {},
): CaseApplyPlan {
  const { seeds } = buildCaseWorksheetSeeds(sarCase, planner);
  const steps: CaseApplyStep[] = [];
  const skipped: CaseApplyPlan['skipped'] = [];

  const sources: CaseApplySources = {
    asw: seeds.asw,
    awa: seeds.awa as unknown as Record<string, unknown>,
    aero: seeds.aero,
    datum: seeds.datum as unknown as Record<string, unknown>,
    lkp: seeds.lkp,
    ws2Sheets: seeds.ws2Sheets as unknown as Array<{ sruName?: string; data: Record<string, unknown> }>,
    ws8Sheets: seeds.ws8Sheets as unknown as Array<{ sruName?: string; data: Record<string, unknown> }>,
    assets: seeds.assets as unknown as Array<Record<string, unknown>>,
  };

  // 1. ASW
  if (sources.asw && sources.asw.windData.length > 0 && sources.asw.distressTime && sources.asw.datumTime) {
    steps.push({ id: 'asw', worksheet: 'asw', label: 'Worksheet ASW (deret angin permukaan)', payload: { ...sources.asw } });
  }

  // 2. AWA
  if (sources.awa && Array.isArray(sources.awa['observations']) && (sources.awa['observations'] as unknown[]).length > 0) {
    steps.push({ id: 'awa', worksheet: 'awa', label: 'Worksheet AWA (angin per ketinggian)', payload: { ...sources.awa } });
  }

  // 3. ADW (butuh LKP + glide)
  if (sources.aero && sources.lkp && sources.aero['aircraftGlideRatio'] && sources.aero['aircraftTASgKts']) {
    steps.push({ id: 'aero', worksheet: 'aero', label: 'Aero Drift (ADW) — ditching', payload: { ...sources.aero } });
  }

  // 4. Datum WS 1 — driftInterval dihitung fungsi resmi (total hours ASW).
  if (!sources.datum) {
    // Kasus maritim tanpa arus & tanpa pilihan leeway: Datum tidak disiapkan
    // (bukan menulis input bohongan) — dilaporkan agar planner melengkapi.
    const maritimeCase = sarCase.incident.type === 'aircraft-ditching'
      || sarCase.incident.type === 'vessel-sinking'
      || sarCase.incident.type === 'person-overboard';
    if (maritimeCase) {
      skipped.push({
        worksheet: 'datum',
        reason: 'Arus laut dan/atau kategori leeway (Tabel I-1/I-2) belum ada — Datum WS 1 tidak bisa disiapkan. Lengkapi di worksheet atau pilih kategori leeway.',
      });
    }
  } else {
    const payload: Record<string, unknown> = { ...sources.datum };
    if (sources.asw) {
      const driftInterval = computeDriftIntervalFromAsw(sources.asw);
      if (driftInterval !== undefined) payload['driftInterval'] = driftInterval;
    }
    const hasCurrent = typeof payload['seaCurrentDir'] === 'number' && typeof payload['seaCurrentSpeed'] === 'number';
    const hasLeeway = typeof payload['leewayObjectId'] === 'string' && payload['leewayObjectId'].length > 0;
    if ((hasCurrent || hasLeeway) && (typeof payload['driftInterval'] === 'number')) {
      steps.push({ id: 'datum', worksheet: 'datum', label: 'Datum WS 1 (arus, leeway, drift)', payload });
    } else {
      skipped.push({
        worksheet: 'datum',
        reason: !sources.asw
          ? 'Menunggu ASW (waktu distress/datum tidak lengkap) — drift interval tidak bisa dihitung.'
          : 'Arus laut dan/atau kategori leeway belum ada — lengkapi sebelum Datum dihitung.',
      });
    }
  }

  // 5. Lembar WS 2 (udara) per SRU.
  for (const sheet of sources.ws2Sheets) {
    const ready = ws2PayloadReady(sheet.data);
    if (ready) {
      steps.push({
        id: `ws2:${sheet.sruName ?? sheet.data['sruName'] ?? 'SRU'}`,
        worksheet: 'ws2',
        label: `WS 2 (udara) — ${sheet.sruName ?? sheet.data['sruName'] ?? 'SRU'}`,
        payload: { ...sheet.data },
      });
    } else {
      skipped.push({ worksheet: 'ws2', reason: `Lembar WS 2 ${sheet.sruName ?? ''} belum siap (platform/objek pencarian kurang).` });
    }
  }

  // 6. Lembar WS 8 (laut) per SRU.
  for (const sheet of sources.ws8Sheets) {
    const ready = ws8PayloadReady(sheet.data);
    if (ready) {
      steps.push({
        id: `ws8:${sheet.sruName ?? sheet.data['sruName'] ?? 'SRU'}`,
        worksheet: 'ws8',
        label: `WS 8 (laut) — ${sheet.sruName ?? sheet.data['sruName'] ?? 'SRU'}`,
        payload: { ...sheet.data },
      });
    } else {
      skipped.push({ worksheet: 'ws8', reason: `Lembar WS 8 ${sheet.sruName ?? ''} belum siap (objek/mata pandang kurang).` });
    }
  }

  // 7. Alokasi Aset — konversi SruAssetInput → AssetAllocationCaseInput
  //    (bentuk handler handleApplyAssetAllocation; satu mekanisme update).
  if (sources.assets.length === 0 && (sarCase.sru?.length ?? 0) > 0) {
    skipped.push({ worksheet: 'assets', reason: 'Koordinat lokasi aset tidak ada di soal — Alokasi Aset tidak bisa diisi.' });
  }
  for (const asset of sources.assets) {
    const name = typeof asset['name'] === 'string' ? asset['name'] : 'SRU';
    const pos = asset['homeBasePos'] as { lat?: number; lng?: number } | undefined;
    const type = asset['type'];
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lng !== 'number') {
      skipped.push({ worksheet: 'assets', reason: `Aset ${name} tanpa koordinat — dilewati.` });
      continue;
    }
    const payload: AssetAllocationCaseInput & Record<string, unknown> = {
      caseTitle: sarCase.caseTitle,
      sruName: name,
      sruType: type as AssetAllocationCaseInput['sruType'],
      homeBaseName: typeof asset['homeBaseName'] === 'string' ? asset['homeBaseName'] : `Lokasi aset ${name}`,
      homeBaseLat: pos.lat,
      homeBaseLng: pos.lng,
      transitSpeedKts: asset['transitSpeedKts'] as number | undefined,
      searchSpeedKts: asset['searchSpeedKts'] as number | undefined,
      enduranceHours: asset['enduranceHours'] as number | undefined,
      sweepWidthNm: asset['sweepWidthNm'] as number | undefined,
      airEngineType: asset['airEngineType'] as AssetAllocationCaseInput['airEngineType'],
      tafCondition: asset['tafCondition'] as AssetAllocationCaseInput['tafCondition'],
    };
    steps.push({ id: `assets:${name}`, worksheet: 'assets', label: `Alokasi Aset — ${name}`, payload });
  }

  // 8. Search pattern TIDAK dibuat di sini: orientasi = bearing LKP → Datum
  //    (aturan worksheet) — dihitung aplikasi setelah Datum & lembar WS siap.
  skipped.push({ worksheet: 'pattern', reason: 'Pola pencarian dihitung otomatis aplikasi setelah Datum dan lembar WS 2/WS 8 terisi (orientasi = bearing LKP → Datum).' });

  return { steps, skipped };
}

// ── Respons ekstraksi end-to-end ────────────────────────────────────────────

export interface CaseExtractionSuccess {
  ok: true;
  case: SarCaseSchema;
  completeness: CaseCompleteness;
  fieldRows: ExtractionFieldRow[];
  applyPlan: CaseApplyPlan;
  assumptions: Array<{ field: string; value?: string; reason: string }>;
  model: string;
  attempts: number;
}

export interface CaseExtractionFailure {
  ok: false;
  error: string;
  detail?: string[];
  attempts: number;
}

export type CaseExtractionResult = CaseExtractionSuccess | CaseExtractionFailure;

/** Revalidasi Zod + susun seluruh bahan pratinjau (dipakai route & test).
 *  TIDAK pernah melempar. */
export function buildCaseExtractionResult(
  rawCase: unknown,
  planner: CasePlannerInputs = {},
  meta?: { model?: string; attempts?: number },
): CaseExtractionResult {
  const parsed = sarCaseSchema.safeParse(rawCase);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) =>
      `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`);
    return { ok: false, error: 'Kasus hasil ekstraksi tidak valid terhadap skema.', detail: issues.slice(0, 20), attempts: meta?.attempts ?? 1 };
  }
  const sarCase = parsed.data;
  const plannerInputs = { ...planner };
  // Kategori leeway dari target soal dipakai bila planner belum memilih.
  if (!plannerInputs.leewayObjectId && sarCase.target?.leewayObjectId) {
    plannerInputs.leewayObjectId = sarCase.target.leewayObjectId;
  }
  const { assumptions } = buildCaseWorksheetSeeds(sarCase, plannerInputs);
  const completeness = checkCaseCompleteness(sarCase, plannerInputs);
  return {
    ok: true,
    case: sarCase,
    completeness,
    fieldRows: deriveExtractionFieldRows(sarCase, plannerInputs),
    applyPlan: buildApplyPlan(sarCase, plannerInputs),
    assumptions: [
      ...assumptions.map((note) => ({ field: note.field, value: note.value, reason: note.reason })),
      ...(sarCase.meta?.assumptions ?? []),
    ],
    model: meta?.model ?? '',
    attempts: meta?.attempts ?? 1,
  };
}
