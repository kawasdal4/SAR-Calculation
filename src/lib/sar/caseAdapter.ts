/**
 * CASE ADAPTER (Fase 1 AI Copilot) — jembatan SATU ARAH dari `SarCaseSchema`
 * ke data awal (seed) worksheet aplikasi.
 *
 * Prinsip (keputusan implementasi no. 5):
 * - HANYA field yang dikenali worksheet yang dipetakan — tidak ada JSON bebas.
 * - Semua default/planner-choice DETERMINISTIK dan dicatat sebagai asumsi
 *   (dikembalikan pada `assumptions`), tidak ada nilai yang dikarang.
 * - Bentuk seed identik dengan payload handler apply di page.tsx
 *   (handleApplyASW/AWA/AeroDrift/Datum/WS2/WS8/...) sehingga Fase 3 bisa
 *   menerapkan kasus lewat SATU mekanisme update yang sudah ada.
 * - Tidak mengubah worksheet apa pun di file ini: murni transformasi data.
 */

import {
  type SarCaseSchema,
  type CaseSru,
  type SurfaceWindEntry,
  type WindLayer,
} from './caseSchema';
import { buildAswObservationsFromCase, type AswCaseWindEntry } from './aswTime';
import { normalizeTafCondition, type SruAssetInput, type SruType } from './assetAllocation';
import {
  type W2Target,
  type W8Target,
  type SearchNumber,
} from './wscPodTables';
import { type SearchPatternType } from './searchPatterns';
import type { AWAObservation } from './sarCalculations';
import type { ASWObservation } from './sarCalculations';
import type { LatLng } from './sarCalculations';

// Re-export tipe seed worksheet (type-only — tanpa dependensi runtime ke UI).
export type { AWAObservation, ASWObservation, LatLng };

/** Input planner (pilihan manusia) yang tidak ada di soal — WAJIB dicatat sbg asumsi. */
export interface CasePlannerInputs {
  /** Kategori leeway Tabel I-1/I-2 (wajib untuk Datum WS 1). */
  leewayObjectId?: string;
  /** Safety factor lingkaran (default worksheet 1.1). */
  fs?: number;
  /** Nomor pencarian 1..5 (default 1). */
  searchNumber?: number;
  /** Galat posisi distress craft x (NM, Tabel J-1) — default 0 bila tidak diketahui. */
  xNm?: number;
  /** Galat navigasi SRU y (NM) — default 0 bila tidak diketahui. */
  yNm?: number;
  /** Kondisi fatigue observer (default 'No' — soal umumnya tidak menyebut). */
  fatigue?: 'Yes' | 'No';
  /** Ketinggian terpilih WS 2 (default 1000 ft — konvensi app). */
  ws2SelectedHeight?: 500 | 1000 | 1500 | 2000;
  patternType?: SearchPatternType;
  /** ── Pencarian darat WS 3/WS 4 (Fase 5b) ── */
  /** Fix error dasar x₀ (Tabel J-2): GPS 5 NM / non-GPS 10 NM — pilihan planner. */
  landX0Nm?: number;
  /** Galat navigasi SRU y (Tabel J-1) — default GPS 0.1 NM. */
  landYNm?: number;
}

/** Asumsi/catatan hasil pemetaan (audit trail Fase 1; menjadi change-log Fase 2). */
export interface CaseAssumptionNote {
  field: string;
  value?: string;
  reason: string;
}

/** Seed worksheet — bentuk structurally-compatible dengan initialState tiap
 *  worksheet & payload handler apply di page.tsx. */
export interface CaseWorksheetSeeds {
  caseTitle?: string;
  /** AWA: {distressAltFt, observations: {altObs, windDirFrom, windSpeed}[], caseTitle} */
  awa?: {
    distressAltFt: number;
    observations: Array<{ altObs: string; windDirFrom: number; windSpeed: number }>;
    caseTitle?: string;
  };
  /** ASW: payload handleApplyASW (waktu dikonversi Basarnas oleh handler). */
  asw?: {
    distressTime: string;
    datumTime: string;
    intervalMode: '6h' | '3h';
    windData: AswCaseWindEntry[];
    caseTitle?: string;
  };
  /** ADW: AeroDriftInitialState (Partial) — AWA diisi pipeline/handler. */
  aero?: Record<string, unknown>;
  /** Datum WS 1: DatumInitialState + konteks LKP/fs. */
  datum?: {
    latitude?: number;
    driftInterval?: number;
    seaCurrentDir?: number;
    seaCurrentSpeed?: number;
    seaCurrentErr?: number;
    leewayObjectId?: string;
    X?: number;
    Y?: number;
    useWindCurrent?: boolean;
    lkp?: LatLng;
    lkpSource?: 'explicit' | 'adw-landing';
    fs?: number;
  };
  lkp?: LatLng;
  /** 1 SRU udara = 1 lembar WS 2 (kasus laut). */
  ws2Sheets: Array<{ sruName?: string; data: Record<string, unknown> }>;
  /** 1 SRU laut = 1 lembar WS 8. */
  ws8Sheets: Array<{ sruName?: string; data: Record<string, unknown> }>;
  /** Lembar pencarian darat (WS 3) — kasus darat: 1 SRU udara = 1 lembar WS 3. */
  ws3Sheets: Array<{ sruName?: string; data: Record<string, unknown> }>;
  /** Aset Alokasi (1 alut = 1 unit); sweepWidthNm=0 diisi pipeline dari S. */
  assets: SruAssetInput[];
  pattern?: {
    patternType: SearchPatternType;
    orientationDeg: number;
    turnDirection: 'right' | 'left';
  };
}

// ---------------------------------------------------------------------------
// Aturan pemetaan deterministik (semua tercatat sebagai asumsi bila dipakai)
// ---------------------------------------------------------------------------

/** Indeks kolom visibility Tabel I-5/I-6 (W2) dari km: ambil ambang terbesar ≤ km. */
export function w2VisibilityIndexForKm(km?: number): number {
  const thresholds = [2, 5, 10, 20, 30]; // label terakhir '>40'
  if (km === undefined || !Number.isFinite(km) || km <= 0) return -1;
  let index = 0;
  for (let i = 0; i < thresholds.length; i += 1) {
    if (km >= thresholds[i]) index = i;
  }
  // km > 30 → kolom '>40' bila km ≥ 40, selain itu kolom '30' (ambang terbesar ≤ km).
  if (km >= 40) index = 5;
  return index;
}

/** Label kolom visibility Tabel I-3/I-4 (W8) dari km: label ambang terbesar ≤ km. */
export function w8VisibilityLabelForKm(km?: number): string {
  const labels = ['2', '5', '10', '15', '20', '>25'];
  if (km === undefined || !Number.isFinite(km) || km <= 0) return '';
  let index = 0;
  const thresholds = [2, 5, 10, 15, 20];
  for (let i = 0; i < thresholds.length; i += 1) {
    if (km >= thresholds[i]) index = i;
  }
  if (km > 25) index = 5;
  return labels[index];
}

/** Target pencarian udara (W2Target) dari kapasitas life raft soal. */
export function w2TargetFromRaftCapacity(capacity?: number, pob?: number): W2Target {
  if (capacity === undefined && pob === undefined) return 'raft6';
  const size = capacity ?? pob ?? 6;
  const ladder: Array<[number, W2Target]> = [
    [1, 'raft1'], [4, 'raft4'], [6, 'raft6'], [8, 'raft8'], [10, 'raft10'],
    [15, 'raft15'], [20, 'raft20'], [25, 'raft25'],
  ];
  for (const [threshold, id] of ladder) {
    if (size <= threshold) return id;
  }
  return 'raft25';
}

/** Target pencarian laut (W8Target) dari kapasitas life raft soal. */
export function w8TargetFromRaftCapacity(capacity?: number, pob?: number): W8Target {
  if (capacity === undefined && pob === undefined) return 'person';
  const size = capacity ?? pob ?? 6;
  const ladder: Array<[number, W8Target]> = [
    [1, 'raft1'], [4, 'raft4'], [6, 'raft6'], [8, 'raft8'], [10, 'raft10'],
    [15, 'raft15'], [20, 'raft20'], [25, 'raft25'],
  ];
  for (const [threshold, id] of ladder) {
    if (size <= threshold) return id;
  }
  return 'raft25';
}

/** Jenis SRU alokasi aset dari data soal. */
export function sruTypeFromCase(sru: CaseSru): SruType {
  if (sru.kind === 'helicopter') return 'helicopter';
  if (sru.kind === 'fixed-wing') return 'fixed-wing-aircraft';
  const model = (sru.model ?? '').toLowerCase();
  if (model.includes('rib')) return 'rib';
  if (model.includes('patroli') || model.includes('patrol')) return 'patrol-boat';
  return 'rescue-vessel';
}

/** Tinggi mata (WS 8) — konvensi app: kapal patroli/rescue '14', RIB/perahu kecil '8',
 *  MERSHIP untuk kapal besar (≥ 50 m bila diketahui panjangnya di nama model). */
export function eyeHeightForVessel(sru: CaseSru): '8' | '14' | 'MERSHIP' {
  const model = `${sru.model ?? ''} ${sru.callsign}`.toLowerCase();
  const lengthMatch = model.match(/(\d{2,3})\s*m\b/);
  if (lengthMatch) {
    const lengthM = Number(lengthMatch[1]);
    if (Number.isFinite(lengthM) && lengthM >= 50) return 'MERSHIP';
  }
  const type = sruTypeFromCase(sru);
  return type === 'rib' || type === 'sea-rider' ? '8' : '14';
}

/** Derive mode interval ASW dari jam observasi (aturan app: hanya 00/06/12/18 →
 *  '6h'; ada 03/09/15/21 → '3h'). Tanpa waktu sah → '6h' + catatan. */
export function deriveAswIntervalMode(entries?: ReadonlyArray<SurfaceWindEntry>): { mode: '6h' | '3h'; determined: boolean } {
  const hours = new Set<number>();
  for (const entry of entries ?? []) {
    const match = entry.obsTime?.match(/(?:^|\s)(\d{1,2})[.:](\d{2})/);
    if (match) {
      const hour = Number(match[1]);
      if (Number.isFinite(hour) && hour >= 0 && hour <= 23) hours.add(hour);
    }
  }
  if (hours.size === 0) return { mode: '6h', determined: false };
  for (const special of [3, 9, 15, 21]) {
    if (hours.has(special)) return { mode: '3h', determined: true };
  }
  return { mode: '6h', determined: true };
}

// ---------------------------------------------------------------------------
// Builder seed utama
// ---------------------------------------------------------------------------

/** Bangun seluruh seed worksheet dari CaseSchema + pilihan planner.
 *  Deterministik: input sama → seed sama. Semua default dicatat di assumptions. */
export function buildCaseWorksheetSeeds(
  sarCase: SarCaseSchema,
  planner: CasePlannerInputs = {},
): { seeds: CaseWorksheetSeeds; assumptions: CaseAssumptionNote[] } {
  const assumptions: CaseAssumptionNote[] = [];
  const seeds: CaseWorksheetSeeds = {
    caseTitle: sarCase.caseTitle,
    ws2Sheets: [],
    ws8Sheets: [],
    ws3Sheets: [],
    assets: [],
  };
  const incident = sarCase.incident;
  const isMaritime = incident.type === 'aircraft-ditching' || incident.type === 'vessel-sinking' || incident.type === 'person-overboard';

  // ── LKP ──────────────────────────────────────────────────────────────────
  const lkpCoord = sarCase.lkp?.coord;
  const lkpSource = sarCase.lkp?.source ?? (lkpCoord ? 'explicit' : 'adw-landing');
  if (lkpCoord) {
    seeds.lkp = { lat: lkpCoord.lat, lng: lkpCoord.lng };
  }

  // ── AWA (tabel angin per ketinggian → worksheet AWA) ─────────────────────
  const windLayers: WindLayer[] = sarCase.aeroDrift?.windLayers ?? [];
  if (windLayers.length > 0) {
    const distressAltFt = incident.flightLevelFt !== undefined
      ? incident.flightLevelFt * 100
      : incident.altitudeFt ?? 0;
    if (incident.flightLevelFt === undefined && incident.altitudeFt === undefined) {
      assumptions.push({ field: 'awa.distressAltFt', value: '0', reason: 'Ketinggian insiden (FL/alt) tidak disebut soal — AWA perlu target ketinggian.' });
    }
    seeds.awa = {
      distressAltFt,
      observations: windLayers.map((layer): AWAObservation => ({
        altObs: layer.altitudeLabel ?? (layer.altitudeFt === 0 ? 'Surface' : String(layer.altitudeFt)),
        windDirFrom: layer.windDirFrom,
        windSpeed: layer.windSpeedKts,
      })),
      caseTitle: sarCase.caseTitle,
    };
  }

  // ── ASW (deret angin permukaan berwaktu + distress/datum time) ───────────
  const surfaceWind = sarCase.sea?.surfaceWindSeries ?? [];
  if (incident.lastContactTime && sarCase.search?.datumTime && surfaceWind.length > 0) {
    const { mode, determined } = deriveAswIntervalMode(surfaceWind);
    if (!determined) {
      assumptions.push({ field: 'asw.intervalMode', value: '6h', reason: 'Jam observasi angin tidak terbaca — memakai mode 6 jam default.' });
    }
    const windData: AswCaseWindEntry[] = surfaceWind.map((entry) => ({
      obsTime: entry.obsTime,
      windDirFrom: entry.windDirFrom,
      windSpeed: entry.windSpeedKts,
    }));
    seeds.asw = {
      distressTime: incident.lastContactTime,
      datumTime: sarCase.search.datumTime as string,
      intervalMode: mode,
      windData,
      caseTitle: sarCase.caseTitle,
    };
  }

  // ── ADW (Aeronautical Drift) ─────────────────────────────────────────────
  const aero = sarCase.aeroDrift;
  if (aero?.glideSpeedKts && aero.glideRatio && lkpCoord) {
    const altMaxFt = incident.flightLevelFt !== undefined
      ? incident.flightLevelFt * 100
      : incident.altitudeFt ?? 0;
    if (isMaritime && incident.type === 'aircraft-ditching') {
      assumptions.push({ field: 'aero.aircraftAltMinFt', value: '0', reason: 'Ditching di laut — Altmin = 0 ft (permukaan laut) sebagai asumsi worksheet.' });
    }
    if (incident.headingReference === undefined && incident.headingDeg !== undefined) {
      assumptions.push({ field: 'aero.aircraftHeadingReference', value: 'magnetic', reason: 'Referensi heading tidak disebut; heading soal dengan variation umumnya magnetic.' });
    }
    if (!aero.variationDeg) {
      assumptions.push({ field: 'aero.variation', reason: 'Variation tidak disebut soal — konversi magnetic→true tidak dapat dilakukan.' });
    }
    seeds.aero = {
      caseTitle: sarCase.caseTitle ?? '',
      caseNumber: sarCase.incident.callsign ?? '',
      date: sarCase.examHeader?.examDate ?? '',
      plannerName: '',
      searchObject: [incident.craftType, incident.callsign].filter(Boolean).join(' '),
      incidentPos: { lat: lkpCoord.lat, lng: lkpCoord.lng },
      incidentTime: incident.lastContactTime ?? '',
      useAircraftGlide: true,
      aircraftAltMaxFt: altMaxFt,
      aircraftAltMinFt: incident.type === 'aircraft-ditching' ? 0 : 0,
      aircraftGlideRatio: aero.glideRatio,
      aircraftTASgKts: aero.glideSpeedKts,
      aircraftDescentHeadingDeg: incident.headingDeg,
      aircraftHeadingReference: incident.headingReference ?? 'magnetic',
      magneticVariationDeg: aero.variationDeg ?? 0,
      magneticVariationDirection: aero.variationDirection ?? 'E',
      aircraftDeviationDeg: aero.deviationDeg ?? 0,
      aircraftDeviationDirection: aero.deviationDirection ?? 'E',
      parachuteDeviationDeg: 0,
      parachuteDeviationDirection: 'E',
      useParachute: aero.parachute?.present ?? false,
      ...(aero.parachute?.present ? {
        parachuteType: aero.parachute.type ?? 'round-zero-glide',
        parachuteAltMaxFt: aero.parachute.altMaxFt ?? 0,
        parachuteTerrainAltFt: 0,
        parachuteRateOfDescentFtMin: aero.parachute.rateOfDescentFtMin ?? 0,
        parachuteGlideRatio: aero.parachute.glideRatio,
      } : {}),
      parachuteHeadingReference: 'true',
      fixErrorXNm: 0,
      safetyFactorFs: planner.fs ?? 1.1,
    };
    if (planner.fs === undefined) {
      assumptions.push({ field: 'aero.safetyFactorFs', value: '1.1', reason: 'Fs tidak disebut soal — default worksheet pencarian ke-1 (1.1).' });
    }
  }

  // ── Datum WS 1 ───────────────────────────────────────────────────────────
  const current = sarCase.sea?.current;
  const leewayObjectId = planner.leewayObjectId ?? sarCase.target?.leewayObjectId;
  if (current || leewayObjectId) {
    if (lkpCoord) {
      assumptions.push({ field: 'datum.latitude', value: String(Math.abs(lkpCoord.lat)), reason: 'Latitude datum = |lat| LKP (aturan worksheet).' });
    }
    seeds.datum = {
      latitude: lkpCoord ? Math.abs(lkpCoord.lat) : undefined,
      seaCurrentDir: current?.dirToDeg,
      seaCurrentSpeed: current?.speedKts,
      seaCurrentErr: 0,
      ...(leewayObjectId ? { leewayObjectId } : {}),
      X: planner.xNm ?? 0,
      Y: planner.yNm ?? 0,
      useWindCurrent: true,
      lkp: seeds.lkp,
      lkpSource,
      fs: planner.fs,
    };
    if (planner.xNm === undefined || planner.yNm === undefined) {
      assumptions.push({ field: 'datum.X/Y', value: '0', reason: 'Galat posisi x/y (Tabel J-1) tidak diketahui dari soal — default 0 NM (aturan handleApplyDatum).' });
    }
    if (!leewayObjectId) {
      assumptions.push({ field: 'datum.leewayObjectId', reason: 'Kategori leeway (Tabel I-1/I-2) belum dipilih planner — Datum tidak bisa dihitung sampai dipilih.' });
    }
  }

  // ── Lembar WS 2 (udara-laut) / WS 3 (udara-darat) / WS 8 (laut) per SRU ──
  const raftCapacity = incident.lifeRaftCapacityPerRaft ?? incident.pob;
  const fatigue: 'Yes' | 'No' = planner.fatigue ?? 'No';
  if (planner.fatigue === undefined) {
    assumptions.push({ field: 'ws2/ws8.isFatigue', value: 'No', reason: 'Kondisi fatigue observer tidak disebut soal — default tidak fatigue.' });
  }
  const selectedHeight = planner.ws2SelectedHeight ?? 1000;
  if (planner.ws2SelectedHeight === undefined) {
    assumptions.push({ field: 'ws2.selectedHeight', value: '1000', reason: 'Ketinggian pencarian WS 2 tidak disebut — default konvensi app 1000 ft.' });
  }
  const searchNumber: SearchNumber = ((planner.searchNumber ?? sarCase.search?.searchNumber ?? 1) as SearchNumber);
  // Analisa darat/laut: insiden darat (pesawat jatuh di darat / orang hilang di
  // darat) + SRU udara → Worksheet 3 (Land), BUKAN WS 2 yang khusus laut.
  const isLandCase = incident.type === 'aircraft-land-crash' || incident.type === 'missing-person-land';
  const landTarget: 'person' | 'aircraft-under-5700' | 'aircraft-over-5700' = incident.type === 'missing-person-land'
    ? 'person'
    : 'aircraft-under-5700';
  const landVisibilityKm = sarCase.search?.visibilityKm;
  const landVisibility = typeof landVisibilityKm === 'number' && [5, 10, 20, 30, 40].includes(landVisibilityKm)
    ? landVisibilityKm
    : undefined;
  if (isLandCase && landVisibility === undefined) {
    assumptions.push({ field: 'ws3.visibilityKm', reason: 'Visibility pencarian darat tidak disebut / di luar Tabel I-9 (5-40 km) — lembar belum siap dihitung.' });
  }
  const landVegetation = sarCase.search?.terrainVegetation;
  if (isLandCase && landVegetation === undefined) {
    assumptions.push({ field: 'ws3.vegetationType', reason: 'Vegetasi Tabel I-10 tidak disebut soal — lembar belum siap dihitung (MISSING).' });
  }
  for (const sru of sarCase.sru ?? []) {
    const caseWind = sru.windSpeedKts !== undefined ? {
      caseWindDirFrom: sru.windDirFrom,
      caseWindSpeed: sru.windSpeedKts,
    } : {};
    if (sru.kind === 'helicopter' || sru.kind === 'fixed-wing') {
      // Kasus darat: SRU udara (fixed-wing/helikopter) diarahkan ke Worksheet 3
      // (Land) — sesuai panduan pencarian darat Tabel I-9/I-10.
      if (isLandCase) {
        seeds.ws3Sheets.push({
          sruName: sru.callsign,
          data: {
            caseTitle: sarCase.caseTitle,
            sruName: sru.callsign,
            searchPlatform: sru.kind === 'helicopter' ? 'helicopter' : 'fixed-wing',
            searchObject: landTarget,
            visibilityKm: landVisibility,
            vegetationType: landVegetation,
            isFatigue: fatigue === 'Yes',
            searchNumber,
            searchSpeedKts: sru.tasSearchKts ?? sru.tasMaxKts,
            hoursAvailable: sru.sheet?.hoursAvailable,
          },
        });
        continue;
      }
      const visibilityIndex = w2VisibilityIndexForKm(sru.visibilityKm);
      const target = incident.type === 'person-overboard'
        ? 'piw' as W2Target
        : w2TargetFromRaftCapacity(incident.lifeRaftCapacityPerRaft, incident.pob);
      if (sru.visibilityKm === undefined && sru.sheet?.visibilityIndex === undefined) {
        assumptions.push({ field: `ws2[${sru.callsign}].visibilityIndex`, reason: 'Visibility SRU tidak disebut — lembar belum siap dihitung (MISSING).' });
      }
      // Fase 2: data lembar live (sru.sheet) MENANG atas derivation — input
      // worksheet persis seperti tampil di aplikasi (stateToCase). Tanpa
      // sheet, derivation lama dipakai apa adanya (fixture Fase 1 tak berubah).
      const sheet = sru.sheet;
      seeds.ws2Sheets.push({
        sruName: sru.callsign,
        data: {
          caseTitle: sarCase.caseTitle,
          sruName: sru.callsign,
          searchPlatform: sheet?.searchPlatform ?? (sru.kind === 'helicopter' ? 'helicopter' : 'fixed-wing'),
          searchTas: sru.tasSearchKts ?? sru.tasMaxKts,
          searchObject: sheet?.searchObject ?? target,
          visibilityIndex: sheet?.visibilityIndex ?? visibilityIndex,
          isFatigue: sheet?.isFatigue ?? fatigue,
          piwFlotationKnown: sheet?.piwFlotationKnown ?? false,
          searchNumber: sheet?.searchNumber ?? searchNumber,
          selectedHeight: (sheet?.selectedHeightFt as 500 | 1000 | 1500 | 2000 | undefined) ?? selectedHeight,
          hoursAvailable: sheet?.hoursAvailable,
          caseWindDirFrom: sheet?.caseWindDirFrom ?? caseWind.caseWindDirFrom,
          caseWindSpeed: sheet?.caseWindSpeed ?? caseWind.caseWindSpeed,
          ...(sheet?.caseWaveHeightM !== undefined || sarCase.sea?.waveHeightM !== undefined
            ? { caseWaveHeightM: sheet?.caseWaveHeightM ?? sarCase.sea?.waveHeightM }
            : {}),
          ...(sheet?.fwOverride !== undefined ? { fwOverride: sheet.fwOverride } : {}),
          ...(sheet?.fsOverride !== undefined ? { fsOverride: sheet.fsOverride } : {}),
        },
      });
    } else {
      const visibilityKm = w8VisibilityLabelForKm(sru.visibilityKm);
      const target = incident.type === 'person-overboard'
        ? 'person' as W8Target
        : w8TargetFromRaftCapacity(incident.lifeRaftCapacityPerRaft, incident.pob);
      if (sru.visibilityKm === undefined && sru.sheet?.visibilityKm === undefined) {
        assumptions.push({ field: `ws8[${sru.callsign}].visibilityKm`, reason: 'Visibility SRU tidak disebut — lembar belum siap dihitung (MISSING).' });
      }
      const sheet = sru.sheet;
      seeds.ws8Sheets.push({
        sruName: sru.callsign,
        data: {
          caseTitle: sarCase.caseTitle,
          sruName: sru.callsign,
          sruType: sheet?.sruType ?? sruTypeFromCase(sru),
          eyeHeight: sheet?.eyeHeight ?? eyeHeightForVessel(sru),
          searchObject: sheet?.searchObject ?? target,
          visibilityKm: sheet?.visibilityKm ?? visibilityKm,
          isFatigue: sheet?.isFatigue ?? fatigue,
          searchNumber: sheet?.searchNumber ?? searchNumber,
          vesselSpeedKts: sheet?.vesselSpeedKts ?? (sru.tasSearchKts ?? sru.tasMaxKts),
          hoursAvailable: sheet?.hoursAvailable,
          caseWindDirFrom: sheet?.caseWindDirFrom ?? caseWind.caseWindDirFrom,
          caseWindSpeed: sheet?.caseWindSpeed ?? caseWind.caseWindSpeed,
          ...(sheet?.caseWaveHeightM !== undefined || sarCase.sea?.waveHeightM !== undefined
            ? { caseWaveHeightM: sheet?.caseWaveHeightM ?? sarCase.sea?.waveHeightM }
            : {}),
          ...(sheet?.fwOverride !== undefined ? { fwOverride: sheet.fwOverride } : {}),
        },
      });
    }

    // Aset Alokasi: pangkalan = koordinat lokasi aset (soal memberi lokasi aset,
    // bukan pangkalan — keputusan eksplisit fixture PK-TAL).
    const enduranceHours = (sru.enduranceHours ?? 0) + (sru.enduranceMinutes ?? 0) / 60;
    if (sru.coord) {
      seeds.assets.push({
        id: `asset-${seeds.assets.length + 1}`,
        name: sru.callsign,
        type: sruTypeFromCase(sru),
        homeBaseName: `Lokasi aset ${sru.callsign}`,
        homeBasePos: { lat: sru.coord.lat, lng: sru.coord.lng },
        transitSpeedKts: sru.tasMaxKts ?? sru.tasSearchKts ?? 0,
        searchSpeedKts: sru.tasSearchKts ?? sru.tasMaxKts ?? 0,
        enduranceHours,
        sweepWidthNm: 0, // diisi pipeline dari track spacing lembar WS 2/8
        airEngineType: sru.engine,
        tafCondition: normalizeTafCondition(sru.taf),
      });
      if (sru.taf && normalizeTafCondition(sru.taf) === undefined) {
        assumptions.push({ field: `asset[${sru.callsign}].tafCondition`, reason: `TAF "${sru.taf}" tidak dikenali (cerah/inter/tempo) — tidak diisi.` });
      }
      if (sru.enduranceHours === undefined) {
        assumptions.push({ field: `asset[${sru.callsign}].enduranceHours`, value: '0', reason: 'Endurance SRU tidak disebut — diisi 0 (MISSING).' });
      }
    }
  }
  if (seeds.assets.length === 0 && (sarCase.sru?.length ?? 0) > 0) {
    assumptions.push({ field: 'assets', reason: 'Koordinat lokasi aset tidak ada — Alokasi Aset tidak bisa dijalankan untuk SRU tersebut.' });
  }

  // ── Search Pattern (PS default; orientasi diisi pipeline dari bearing) ───
  seeds.pattern = {
    patternType: planner.patternType ?? 'PS',
    orientationDeg: 0, // dihitung pipeline: bearing LKP → Datum
    turnDirection: 'right',
  };

  void isMaritime; // (dipakai di fase lanjut untuk blok data kapal/darat)
  void raftCapacity; // (dipakai lewat w2/w8TargetFromRaftCapacity)

  return { seeds, assumptions };
}

// ---------------------------------------------------------------------------
// Completeness check (keputusan no. 6: MISSING/ASSUMED tidak dianggap final)
// ---------------------------------------------------------------------------

export interface CompletenessIssue {
  field: string;
  worksheet: string;
  status: 'MISSING' | 'ASSUMED';
  reason: string;
}

export interface CaseCompleteness {
  complete: boolean;
  issues: CompletenessIssue[];
  missingCount: number;
  assumedCount: number;
}

/**
 * Field yang DISENGAJA dari daftar kelengkapan ekstraksi (checkCaseCompleteness
 * dan jalur meta.missingFields di parseCase) karena nilainya BUKAN data soal —
 * nilainya dihasilkan/dipilih di worksheet hilir, jadi tidak boleh masuk daftar
 * "data hilang" yang mengunci penerapan:
 * - `aeroDrift.glideRatio` — nilai worksheet ADW (state aircraftGlideRatio,
 *   fallback 0; baru wajib bila useAircraftGlide aktif — validatePlan).
 *   Hasil rantai AWA → ADW di worksheet, bukan input ekstraksi soal.
 * - `sea.waveHeightM` — bila gelombang tidak disebut, baris Fw Table I-7
 *   dihitung dari angin (lookupTable: windKts dan/atau waveHeightM) — bukan
 *   kekurangan data.
 * - `datum.leewayObjectId` — kategori leeway (Tabel I-1/I-2) dipilih planner di
 *   Datum WS 1 (picker LEWAY_OBJECT_TYPES dengan default terpilih).
 * - `lkp.coord` — alur resmi kasus ditching (keputusan pengguna): LKP untuk
 *   Datum dihasilkan rantai AWA → ADW (posisi ditching hasil ADW menjadi LKP,
 *   lkpSource "adw-landing"). Koordinat soal ("Koordinat Lost Contact") tetap
 *   dipakai apa adanya bila terekstrak (titik awal drift ADW), tetapi ketidakan-
 *   nya TIDAK memblokir penerapan — pengguna mengisi posisi insiden langsung
 *   di worksheet ADW. Klaim "missing" dari model untuk field ini diabaikan.
 */
export const DOWNSTREAM_FIELDS: ReadonlySet<string> = new Set([
  'aeroDrift.glideRatio',
  'sea.waveHeightM',
  'datum.leewayObjectId',
  'lkp.coord',
]);

/** True bila klaim "missing" untuk field ini sebenarnya nilai worksheet/planner.
 *  Selain set eksplisit, pola `datum.x/y*` (varian penamaan model untuk galat
 *  navigasi Tabel J-1 — default 0 NM, sudah dilaporkan ASSUMED datum.X/Y)
 *  juga dianggap klaim hilir. */
export function isDownstreamFieldClaim(field: string): boolean {
  return DOWNSTREAM_FIELDS.has(field) || /^datum\.x\/y/i.test(field);
}

/** Periksa kelengkapan data kasus terhadap kebutuhan worksheet laut (ditching).
 *  Jenis insiden lain (kapal/darat) menambahkan aturan sendiri di fase berikut. */
export function checkCaseCompleteness(
  sarCase: SarCaseSchema,
  planner: CasePlannerInputs = {},
): CaseCompleteness {
  const issues: CompletenessIssue[] = [];
  const push = (status: 'MISSING' | 'ASSUMED', field: string, worksheet: string, reason: string) =>
    issues.push({ status, field, worksheet, reason });

  const incident = sarCase.incident;
  const aero = sarCase.aeroDrift;

  // Sumber waktu ASW
  if (!incident.lastContactTime) push('MISSING', 'incident.lastContactTime', 'ASW/ADW', 'Waktu MAYDAY/kontak terakhir tidak ada di soal.');
  if (!sarCase.search?.datumTime) push('MISSING', 'search.datumTime', 'ASW/Datum', 'Datum Time tidak ada di soal.');

  // LKP — BUKAN prasyarat blokir: alur resmi AWA → ADW menghasilkan posisi
  // ditching yang menjadi LKP (lkpSource "adw-landing"); koordinat soal tetap
  // dipakai bila terekstrak. Ketiadaan koordinat hanya info (ASSUMED), bukan
  // pemblokir — pengguna mengisi posisi insiden langsung di worksheet ADW.
  if (!sarCase.lkp?.coord && sarCase.lkp?.source !== 'adw-landing') {
    push('ASSUMED', 'lkp.coord', 'ADW/Datum', 'Koordinat LKP tidak terekstrak dari soal — LKP dihasilkan rantai AWA → ADW (posisi ditching hasil ADW menjadi LKP) atau diisi langsung di worksheet ADW.');
  }

  // ADW
  if (!aero?.glideSpeedKts) push('MISSING', 'aeroDrift.glideSpeedKts', 'ADW', 'Glide speed tidak ada di soal.');
  // glideRatio sengaja tidak dicek: nilai worksheet ADW (lihat DOWNSTREAM_FIELDS).
  if (aero?.variationDeg === undefined) push('MISSING', 'aeroDrift.variation', 'ADW', 'Variation (E/W) tidak ada di soal.');
  if (incident.headingDeg === undefined) push('MISSING', 'incident.headingDeg', 'ADW', 'Heading tidak ada di soal.');
  if (incident.flightLevelFt === undefined && incident.altitudeFt === undefined) {
    push('MISSING', 'incident.flightLevelFt', 'AWA/ADW', 'Ketinggian (FL/ft) tidak ada di soal.');
  }

  // AWA: tabel angin + baris surface
  const windLayers = aero?.windLayers ?? [];
  if (windLayers.length === 0) {
    push('MISSING', 'aeroDrift.windLayers', 'AWA', 'Tabel angin per ketinggian tidak ada di soal.');
  } else if (!windLayers.some((layer) => layer.altitudeFt === 0)) {
    push('MISSING', 'aeroDrift.windLayers[surface]', 'AWA', 'Baris Surface (0 ft) tidak ada — AWA menuntut baris Surface.');
  }

  // Datum — leewayObjectId sengaja tidak dicek: dipilih planner di Datum WS 1
  // (lihat DOWNSTREAM_FIELDS), bukan data soal.
  if (!sarCase.sea?.current) push('MISSING', 'sea.current', 'Datum WS 1', 'Arus laut (arah KE / kecepatan) tidak ada di soal.');
  if (planner.xNm === undefined || planner.yNm === undefined) {
    push('ASSUMED', 'datum.X/Y', 'Datum WS 1', 'Galat x/y default 0 NM (aturan worksheet) — hasil tidak final sebelum dikonfirmasi.');
  }

  // ASW series
  if ((sarCase.sea?.surfaceWindSeries?.length ?? 0) === 0) {
    push('MISSING', 'sea.surfaceWindSeries', 'ASW', 'Deret angin permukaan berwaktu tidak ada di soal.');
  }

  // Lembar WS 2/WS 8 per SRU
  for (const sru of sarCase.sru ?? []) {
    if (sru.tasSearchKts === undefined && sru.tasMaxKts === undefined) {
      push('MISSING', `sru[${sru.callsign}].tasSearchKts`, sru.kind === 'vessel' ? 'WS 8' : 'WS 2', 'TAS/speed di area pencarian tidak ada di soal.');
    }
    if (sru.visibilityKm === undefined) {
      push('MISSING', `sru[${sru.callsign}].visibilityKm`, sru.kind === 'vessel' ? 'WS 8' : 'WS 2', 'Visibility SRU tidak ada di soal.');
    }
    if (sru.coord === undefined) {
      push('MISSING', `sru[${sru.callsign}].coord`, 'Alokasi Aset', 'Koordinat lokasi aset tidak ada di soal.');
    }
  }

  // waveHeightM sengaja tidak dicek: Fw Table I-7 dihitung dari angin bila
  // gelombang tidak disebut (lihat DOWNSTREAM_FIELDS).

  // Gabungkan missingFields dari meta ekstraksi — field hilir diabaikan agar
  // laporan ke agent/AI tidak mengklaim "data hilang" untuk nilai worksheet.
  for (const missing of sarCase.meta?.missingFields ?? []) {
    if (isDownstreamFieldClaim(missing.field)) continue;
    push('MISSING', missing.field, 'Soal', missing.reason);
  }

  const missingCount = issues.filter((issue) => issue.status === 'MISSING').length;
  const assumedCount = issues.filter((issue) => issue.status === 'ASSUMED').length;
  return { complete: missingCount === 0, issues, missingCount, assumedCount };
}
