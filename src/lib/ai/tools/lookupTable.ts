/**
 * TOOL `lookup_table` (Fase 2 AI Copilot) — akses TERTATBIB ke tabel referensi
 * resmi yang sudah terdigitisasi (keputusan implementasi no. 6).
 *
 * ATURAN MUTLAK:
 * 1. AI DILARANG mengarang nilai tabel appendix (leeway, Wu, Fw, Fs, ROD N-13,
 *    galat J, dsb.) — semua nilai tabel WAJIB lewat tool ini.
 * 2. Setiap jawaban menyertakan STATUS VERIFIKASI (VERIFIED/UNVERIFIED/MISSING/
 *    SIMULATION) + sumber. Nilai UNVERIFIED/MISSING TIDAK BOLEH diperlakukan
 *    sebagai nilai resmi dan tidak boleh dipakai menyatakan hasil final.
 * 3. Tool ini hanya MEMBACA — tidak pernah menulis state.
 */

import { LEEWAY_OBJECT_TYPES, TABLE_J1_NAV_ERRORS, TABLE_J2_NAV_ERRORS, TABLE_J3_DR_ERRORS, resolveLeewayObjectFromDescription } from '../../sar/sarCalculations';
import {
  lookupW2Wu,
  lookupW8Wu,
  lookupFwByRow,
  fwRowFromWind,
  fwRowFromWave,
  lookupFs,
  computePOD,
  W2_VISIBILITY_LABELS,
  W8_VISIBILITY_LABELS,
  type W2Target,
  type W8Target,
  type FwRow,
} from '../../sar/wscPodTables';
import { lookupLandWu, lookupLandFv, LAND_SEARCH_TARGETS, type LandSearchTarget, type LandVegetation } from '../../sar/landSearchTables';
import { WS1_FS_TABLE, WS1_WC_COEF, WS1_DE_PERCENT_DEFAULT } from '../../sar/datumWs1';
import { getReferenceTableInfo, summarizeReferenceTables } from '../../sar/referenceTables';
// Modul .mjs dengan deklarasi .d.mts (Table N-13/N-14 IAMSAR).
import { N13_PARACHUTES, n13RateOfDescent, n14DriftDistanceMiles, N14_OPENING_ALTS_FT, N14_WINDS_KT } from '../../sar/tableN13.mjs';

export const LOOKUP_TABLE_NAMES = [
  'leeway',
  'wu-air',
  'wu-sea',
  'fw-weather',
  'fs-speed',
  'fs-search',
  'land-wu',
  'land-fv',
  'nav-error',
  'n13-parachute',
  'n14-drift',
  'pod-curve',
  'wind-current-fig-i1',
  'sweep-width-n4-n8',
] as const;
export type LookupTableName = (typeof LOOKUP_TABLE_NAMES)[number];

export interface LookupToolResult {
  ok: boolean;
  /** Ringkasan satu baris untuk tampilan/log. */
  summary: string;
  /** JSON result untuk dikirim kembali ke model (function_result). */
  json: string;
}

/** Pemetaan nama tool → metadata tabel (status verifikasi dari referenceTables). */
const TABLE_META: Record<LookupTableName, { refId: string; argsHint: string }> = {
  leeway: { refId: 'I-1/I-2', argsHint: 'q = kata kunci objek (mis. "raft canopy drogue", "piw", "kapal 15 m") — kosong = daftar ringkas' },
  'wu-air': { refId: 'I-5/I-6', argsHint: 'platform (fixed-wing|helicopter), target (id W2), altitudeFt (500|1000|1500|2000), visibilityColumn (0..5)' },
  'wu-sea': { refId: 'I-3/I-4', argsHint: 'target (id W8), eye ("8"|"14"|"MERSHIP"), visibility (label: 2|5|10|15|20|>25)' },
  'fw-weather': { refId: 'I-7', argsHint: 'windKts dan/atau waveHeightM, group (small|other)' },
  'fs-speed': { refId: 'I-8', argsHint: 'target (id W2), platform (fixed-wing|helicopter), tas (kts)' },
  'fs-search': { refId: 'FS-TABLE', argsHint: 'searchNumber (1..5) — fs lingkaran WS 1' },
  'land-wu': { refId: 'I-9', argsHint: 'target (person|vehicle|aircraft-under-5700|aircraft-over-5700), heightFt (500|1000|1500|2000), visibilityKm (5|10|20|30|40)' },
  'land-fv': { refId: 'I-10', argsHint: 'target (id darat), vegetation (under-15|15-60|60-85|over-85)' },
  'nav-error': { refId: 'J-1/J-2/J-3', argsHint: 'table (J-1|J-2|J-3), q = kata kunci alat (mis. "gps", "radar") — kosong = daftar' },
  'n13-parachute': { refId: 'N-13', argsHint: 'id (mis. c9-escape), openingAltFt (ft) — tanpa argumen = daftar parasut' },
  'n14-drift': { refId: 'N-14', argsHint: 'openingAltFt (ft), windKts' },
  'pod-curve': { refId: 'FIG-I-12', argsHint: 'coverage (0..~5), searchNumber (1..5)' },
  'wind-current-fig-i1': { refId: 'FIG-I-1', argsHint: 'windKts — koefisien arus angin' },
  'sweep-width-n4-n8': { refId: 'N-4..N-8', argsHint: '(belum terdigitisasi — selalu MISSING)' },
};

const LAND_VEGETATIONS: readonly LandVegetation[] = ['under-15', '15-60', '60-85', 'over-85'];

function isW2Target(value: string): value is W2Target {
  return /^(piw|raft\d+|boatSmall|boat\d+|sail\d+|ship\d+|shipOver91)$/.test(value);
}
function isW8Target(value: string): value is W8Target {
  return /^(person|raft\d+|boatUnder5|boat\d+to\d+|sail\d+|sail20to23|sail23to27)$/.test(value);
}

/** Pencarian teks longgar (lowercase, subset kata). */
function looseMatch(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Eksekusi tool lookup_table. TIDAK pernah melempar. */
export function executeLookupTable(args: Record<string, unknown>): LookupToolResult {
  const build = (ok: boolean, payload: Record<string, unknown>, summary: string): LookupToolResult => ({
    ok,
    summary,
    json: JSON.stringify({ ok, ...payload }),
  });

  // Tanpa nama tabel: kembalikan katalog (id, label, status) agar model tahu
  // tabel apa saja yang bisa ditanya.
  const tableRaw = typeof args.table === 'string' ? args.table.trim().toLowerCase() : '';
  if (!tableRaw) {
    return build(true, { tables: summarizeReferenceTables(), argsHint: TABLE_META }, 'Katalog tabel referensi (status verifikasi disertakan).');
  }
  const table = (LOOKUP_TABLE_NAMES as readonly string[]).includes(tableRaw) ? (tableRaw as LookupTableName) : null;
  if (!table) {
    return build(false, {
      error: `Tabel "${tableRaw}" tidak dikenal.`,
      tables: summarizeReferenceTables(),
    }, `Tabel "${tableRaw}" tidak dikenal (katalog dikirim).`);
  }

  const meta = TABLE_META[table];
  const info = getReferenceTableInfo(meta.refId);
  const head = {
    table,
    refId: meta.refId,
    status: info?.status ?? 'MISSING',
    source: info?.source ?? 'Tidak terdigitisasi.',
    ...(info?.note ? { note: info.note } : {}),
    argsHint: meta.argsHint,
  };

  const q = typeof args.q === 'string' ? args.q.trim() : '';

  switch (table) {
    case 'leeway': {
      // q dicocokkan ke id/label + resolver deskripsi bebas (keyword Indonesia,
      // sama dengan jalur set_datum_case di caseToolNormalize).
      const descriptionMatch = q ? resolveLeewayObjectFromDescription(q) : undefined;
      const rows = LEEWAY_OBJECT_TYPES
        .filter((entry) => !q || looseMatch(entry.id, q) || looseMatch(entry.label, q)
          || (descriptionMatch !== undefined && descriptionMatch.object.id === entry.id))
        .slice(0, 15)
        .map((entry) => ({
          id: entry.id,
          label: entry.label,
          leewayRate: entry.leewayRate,
          leewayModifier: entry.leewayModifier ?? 0,
          divergenceAngle: entry.divergenceAngle,
        }));
      return build(rows.length > 0, {
        ...head,
        rows,
        ...(rows.length === 0 ? { error: `Tidak ada kategori leeway yang cocok dengan "${q}".` } : {}),
        ...(LEEWAY_OBJECT_TYPES.length > 15 && !q ? { note: 'Dipotong 15 baris — gunakan q untuk mencari.' } : {}),
      }, `Leeway I-1/I-2: ${rows.length} kategori${q ? ` (q="${q}")` : ''} — status ${head.status}.`);
    }
    case 'wu-air': {
      const platform = typeof args.platform === 'string' && args.platform === 'helicopter' ? 'helicopter' : 'fixed-wing';
      const target = typeof args.target === 'string' ? args.target : '';
      const altitudeFt = typeof args.altitudeFt === 'number' ? args.altitudeFt : NaN;
      const visibilityColumn = typeof args.visibilityColumn === 'number' ? args.visibilityColumn : NaN;
      if (!isW2Target(target) || ![500, 1000, 1500, 2000].includes(altitudeFt) || !(visibilityColumn >= 0 && visibilityColumn <= 5)) {
        return build(false, { ...head, error: 'Argumen wajib: platform (fixed-wing|helicopter), target (id W2), altitudeFt (500|1000|1500|2000), visibilityColumn (0..5).', visibilityLabels: W2_VISIBILITY_LABELS }, 'Wu udara: argumen tidak lengkap/tidak valid.');
      }
      const wu = lookupW2Wu(platform, target, altitudeFt as 500 | 1000 | 1500 | 2000, visibilityColumn);
      return build(wu !== null, {
        ...head,
        query: { platform, target, altitudeFt, visibilityColumn },
        ...(wu !== null ? { wuNm: wu } : { error: 'Kombinasi tidak ada di Tabel I-5/I-6.' }),
      }, `Wu udara ${platform}/${target}/${altitudeFt}ft/vis-${visibilityColumn} → ${wu ?? 'tidak ada'}`);
    }
    case 'wu-sea': {
      const target = typeof args.target === 'string' ? args.target : '';
      const eye = typeof args.eye === 'string' ? args.eye : '';
      const visibility = typeof args.visibility === 'string' ? args.visibility : '';
      if (!isW8Target(target) || !['8', '14', 'MERSHIP'].includes(eye) || !visibility) {
        return build(false, { ...head, error: 'Argumen wajib: target (id W8), eye ("8"|"14"|"MERSHIP"), visibility (label 2|5|10|15|20|>25).', visibilityLabels: W8_VISIBILITY_LABELS }, 'Wu laut: argumen tidak lengkap/tidak valid.');
      }
      const wu = lookupW8Wu(target, eye as '8' | '14' | 'MERSHIP', visibility);
      return build(wu !== null, {
        ...head,
        query: { target, eye, visibility },
        ...(wu !== null ? { wuNm: wu } : { error: 'Kombinasi tidak ada di Tabel I-3/I-4.' }),
      }, `Wu laut ${target}/${eye}/vis-${visibility} → ${wu ?? 'tidak ada'}`);
    }
    case 'fw-weather': {
      const windKts = typeof args.windKts === 'number' ? args.windKts : undefined;
      const waveHeightM = typeof args.waveHeightM === 'number' ? args.waveHeightM : undefined;
      const group = typeof args.group === 'string' && args.group === 'other' ? 'other' : 'small';
      if (windKts === undefined && waveHeightM === undefined) {
        return build(false, { ...head, error: 'Argumen wajib: windKts dan/atau waveHeightM, group (small|other).' }, 'Fw I-7: argumen tidak lengkap.');
      }
      const windRow = windKts !== undefined && windKts > 0 ? fwRowFromWind(windKts) : null;
      const waveRow = waveHeightM !== undefined && waveHeightM > 0 ? fwRowFromWave(waveHeightM) : null;
      const row = windRow !== null && waveRow !== null ? (Math.max(windRow, waveRow) as FwRow) : (windRow ?? waveRow);
      if (row === null) {
        return build(true, { ...head, query: { windKts, waveHeightM }, fw: null, note: 'Angin/gelombang 0 — baris Fw tidak ditentukan.' }, 'Fw I-7: kondisi tenang (tanpa baris).');
      }
      return build(true, {
        ...head,
        query: { windKts, waveHeightM, group },
        fwRow: row,
        fw: lookupFwByRow(row, group),
        note: 'Angin dan gelombang keduanya ada → baris terburuk (paling konservatif).',
      }, `Fw I-7 (group ${group}, baris ${row}) → ${lookupFwByRow(row, group)}`);
    }
    case 'fs-speed': {
      const target = typeof args.target === 'string' ? args.target : '';
      const platform = typeof args.platform === 'string' && args.platform === 'helicopter' ? 'helicopter' as const : 'fixed-wing' as const;
      const tas = typeof args.tas === 'number' ? args.tas : NaN;
      if (!isW2Target(target) || !Number.isFinite(tas)) {
        return build(false, { ...head, error: 'Argumen wajib: target (id W2), platform (fixed-wing|helicopter), tas (kts).', tasColumns: platform === 'fixed-wing' ? [150, 180, 210] : [60, 90, 120, 140] }, 'Fs I-8: argumen tidak lengkap.');
      }
      const fs = lookupFs(target, platform, tas);
      return build(fs !== null, {
        ...head,
        query: { target, platform, tas },
        ...(fs !== null ? { fs } : { error: 'Kombinasi tidak ada di Tabel I-8 (tas di luar kolom?).' }),
      }, `Fs I-8 ${platform}/${target}/${tas}kts → ${fs ?? 'tidak ada'}`);
    }
    case 'fs-search': {
      const searchNumber = typeof args.searchNumber === 'number' ? Math.round(args.searchNumber) : NaN;
      if (!(searchNumber >= 1 && searchNumber <= 5)) {
        return build(false, { ...head, error: 'Argumen wajib: searchNumber (1..5).', tableValues: { udara: WS1_FS_TABLE, darat: [1.1, 1.8, 2.0, 2.3, 2.6] } }, 'fs pencarian: argumen tidak lengkap.');
      }
      return build(true, {
        ...head,
        searchNumber,
        fs: WS1_FS_TABLE[searchNumber - 1],
        note: 'fs darat pencarian ke-4/5 = 2.3/2.6 (Panduan WS 3).',
      }, `fs pencarian ke-${searchNumber} → ${WS1_FS_TABLE[searchNumber - 1]}`);
    }
    case 'land-wu': {
      const target = typeof args.target === 'string' ? args.target : '';
      const heightFt = typeof args.heightFt === 'number' ? args.heightFt : NaN;
      const visibilityKm = typeof args.visibilityKm === 'number' ? args.visibilityKm : NaN;
      if (!LAND_SEARCH_TARGETS.some((entry) => entry.id === target) || ![500, 1000, 1500, 2000].includes(heightFt) || ![5, 10, 20, 30, 40].includes(visibilityKm)) {
        return build(false, { ...head, error: 'Argumen wajib: target (person|vehicle|aircraft-under-5700|aircraft-over-5700), heightFt (500|1000|1500|2000), visibilityKm (5|10|20|30|40).', targets: LAND_SEARCH_TARGETS }, 'Wu darat I-9: argumen tidak lengkap.');
      }
      const wu = lookupLandWu(target as LandSearchTarget, heightFt as 500 | 1000 | 1500 | 2000, visibilityKm);
      return build(wu !== null, {
        ...head,
        query: { target, heightFt, visibilityKm },
        ...(wu !== null ? { wuNm: wu } : { error: 'Kombinasi tidak ada di Tabel I-9.' }),
      }, `Wu darat ${target}/${heightFt}ft/${visibilityKm}km → ${wu ?? 'tidak ada'}`);
    }
    case 'land-fv': {
      const target = typeof args.target === 'string' ? args.target : '';
      const vegetation = typeof args.vegetation === 'string' ? args.vegetation : '';
      if (!LAND_SEARCH_TARGETS.some((entry) => entry.id === target) || !LAND_VEGETATIONS.includes(vegetation as LandVegetation)) {
        return build(false, { ...head, error: 'Argumen wajib: target (id darat), vegetation (under-15|15-60|60-85|over-85).', targets: LAND_SEARCH_TARGETS }, 'Fv darat I-10: argumen tidak lengkap.');
      }
      const fv = lookupLandFv(target as LandSearchTarget, vegetation as LandVegetation);
      return build(fv !== null, {
        ...head,
        query: { target, vegetation },
        ...(fv !== null ? { fv } : { error: 'Kombinasi tidak ada di Tabel I-10.' }),
      }, `Fv darat ${target}/${vegetation} → ${fv ?? 'tidak ada'}`);
    }
    case 'nav-error': {
      const tableName = typeof args.table === 'string' ? args.table.trim().toUpperCase() : 'J-1';
      const rows = (tableName === 'J-2' ? TABLE_J2_NAV_ERRORS : tableName === 'J-3' ? TABLE_J3_DR_ERRORS : TABLE_J1_NAV_ERRORS)
        .filter((entry) => !q || looseMatch(entry.id, q) || looseMatch(entry.label, q))
        .slice(0, 20)
        .map((entry) => ({ id: entry.id, label: entry.label, errorNm: entry.errorNm }));
      return build(rows.length > 0, {
        ...head,
        table: tableName,
        rows,
        ...(rows.length === 0 ? { error: `Tidak ada entri ${tableName} yang cocok dengan "${q}".` } : {}),
      }, `Galat navigasi ${tableName}: ${rows.length} entri${q ? ` (q="${q}")` : ''}`);
    }
    case 'n13-parachute': {
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      const openingAltFt = typeof args.openingAltFt === 'number' ? args.openingAltFt : undefined;
      if (!id) {
        return build(true, {
          ...head,
          rows: N13_PARACHUTES.slice(0, 20).map((row) => ({
            id: row.id,
            label: row.label,
            rodSeaLevelFtMin: row.rodSeaLevelFtMin,
            rod7000FtMin: row.rod7000FtMin,
            glideRatio: row.glideRatio,
            experimental: row.experimental,
          })),
          note: 'Pilih kolom TANPA interpolasi: buka ≤ 3.500 ft → sea level; > 3.500 ft → 7.000 ft bila ada. Jenis eksperimental: ROD ditetapkan planner.',
        }, `Daftar parasut N-13: ${Math.min(N13_PARACHUTES.length, 20)} jenis.`);
      }
      const selection = openingAltFt !== undefined
        ? n13RateOfDescent(id, openingAltFt)
        : null;
      return build(true, {
        ...head,
        query: { id, openingAltFt },
        ...(selection ? { selection } : { error: 'Id parasut tidak dikenal (lihat daftar).' }),
      }, `N-13 ${id}${openingAltFt !== undefined ? ` @${openingAltFt}ft` : ''} → ${selection?.rodFtMin ?? '?'}`);
    }
    case 'n14-drift': {
      const openingAltFt = typeof args.openingAltFt === 'number' ? args.openingAltFt : NaN;
      const windKts = typeof args.windKts === 'number' ? args.windKts : NaN;
      if (!Number.isFinite(openingAltFt) || !Number.isFinite(windKts)) {
        return build(false, { ...head, error: 'Argumen wajib: openingAltFt (ft), windKts.', openingAltsFt: N14_OPENING_ALTS_FT, windsKt: N14_WINDS_KT }, 'Drift parasut N-14: argumen tidak lengkap.');
      }
      const selection = n14DriftDistanceMiles(openingAltFt, windKts);
      const miles = selection && typeof selection === 'object' && Number.isFinite(selection.miles) ? selection.miles : null;
      return build(miles !== null, {
        ...head,
        query: { openingAltFt, windKts },
        ...(miles !== null && selection ? {
          driftNm: miles,
          altRowFt: selection.altRowFt,
          windColKt: selection.windColKt,
          note: 'Baris/kolom tabel tanpa interpolasi (baris terdekat yang tercantum).',
        } : { error: 'Kombinasi di luar tabel N-14 (lihat openingAltsFt/windsKt).' }),
      }, `N-14 drift @${openingAltFt}ft/${windKts}kts → ${miles ?? 'tidak ada'} NM`);
    }
    case 'pod-curve': {
      const coverage = typeof args.coverage === 'number' ? args.coverage : NaN;
      const searchNumber = typeof args.searchNumber === 'number' ? Math.round(args.searchNumber) as 1 | 2 | 3 | 4 | 5 : 1;
      if (!Number.isFinite(coverage) || coverage < 0 || !(searchNumber >= 1 && searchNumber <= 5)) {
        return build(false, { ...head, error: 'Argumen wajib: coverage (≥0), searchNumber (1..5).' }, 'POD Figure I-12: argumen tidak lengkap.');
      }
      const podFraction = computePOD(coverage, searchNumber);
      return build(true, { ...head, coverage, searchNumber, podFraction: round(podFraction, 4), podPercent: round(podFraction * 100, 1) }, `POD (C=${coverage}, pencarian ke-${searchNumber}) → ${(podFraction * 100).toFixed(1)}%`);
    }
    case 'wind-current-fig-i1': {
      const windKts = typeof args.windKts === 'number' ? args.windKts : NaN;
      if (!Number.isFinite(windKts) || windKts < 0) {
        return build(false, { ...head, error: 'Argumen wajib: windKts (≥0).', coefficient: WS1_WC_COEF, dePercentDefault: WS1_DE_PERCENT_DEFAULT }, 'Fig I-1: argumen tidak lengkap.');
      }
      return build(true, {
        ...head,
        query: { windKts },
        windCurrentKts: windKts * WS1_WC_COEF,
        formula: `${WS1_WC_COEF} × windKts (pendekatan garis lurus Fig. I-1)`,
        warning: 'STATUS UNVERIFIED — hasil drift arus angin TIDAK FINAL sebelum dikonfirmasi; jangan dinyatakan sebagai hasil resmi.',
      }, `Arus angin Fig I-1 @${windKts}kts → ${(windKts * WS1_WC_COEF).toFixed(3)} kts (UNVERIFIED)`);
    }
    case 'sweep-width-n4-n8': {
      return build(false, {
        ...head,
        error: 'Tabel N-4..N-8 BELUM TERDIGITISASI (status MISSING) — tidak ada nilai yang bisa diberikan. Jangan mengarang uncorrected sweep width; minta planner memilih nilai atau sediakan nilai resmi.',
      }, 'N-4..N-8: MISSING — tidak tersedia (dilarang mengarang).');
    }
    default: {
      return build(false, { error: `Tabel "${table}" tidak dikenal.` }, `Tabel "${table}" tidak dikenal.`);
    }
  }
}

/** Pembulatan desimal sederhana (tanpa lib). */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
