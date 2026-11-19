/**
 * FILL FORM (Fase 4 AI Copilot) — bungkus generator dokumen resmi
 * `buildDocument()` (dataBank.ts, deterministik — angka dari snapshot state,
 * BUKAN LLM) sebagai bahan tool `fill_form`, lalu petakan field dokumen yang
 * READY ke form aplikasi (Briefing/Renops) lewat MEKANISME set_fields yang
 * sudah ada (keputusan no.5: satu mekanisme update — pratinjau → konfirmasi).
 *
 * ATURAN:
 * - HANYA field berstatus READY yang dipetakan — PENDING/ACTUAL_REQUIRED/
 *   CONFLICT dibiarkan untuk diisi manual (jangan menyalin rencana sebagai
 *   fakta aktual; keputusan no.6 & Panduan Agent).
 * - Nilai angka TIDAK pernah dihitung di sini: semua dari GeneratedDocument
 *   hasil buildDocument (yang membaca snapshot worksheet/peta/Bank Data).
 * - Dokumen hasil AI tetap DRAFT sampai disetujui pihak berwenang
 *   (keputusan no.12 — approval di DocumentWorkbench / API draft).
 * - Murni + deterministik; TIDAK pernah melempar.
 */

import {
  type DocumentSnapshot,
  type GeneratedDocument,
  type ResolvedField,
  PENDING_TEXT,
} from './dataBank';
import type { SetFieldsApplied, SetFieldsWorksheet } from '../ai/tools/setFields';

// ── Snapshot dokumen (SATU sumber untuk Workbench & tool fill_form) ─────────

export interface DocumentSnapshotInput {
  lkp: { lat: number; lng: number };
  isLkpSet: boolean;
  datumResults: {
    datumLeft: { lat: number; lng: number };
    datumRight: { lat: number; lng: number };
    driftDistance?: number;
    E?: number;
  } | null;
  searchResults: {
    searchAreaCenter: { lat: number; lng: number };
    searchAreaLength: number;
    searchAreaWidth: number;
    orientationDeg: number;
    Ao: number;
    trackSpacing?: number;
    fs?: number;
    POD?: number;
  } | null;
  asw: { aswDirFrom: number; aswSpeed: number };
  awa: { aswDirFrom: number; aswSpeed: number; isValid?: boolean };
  ws2TrackSpacingNm: number | null;
  ws3TrackSpacingNm: number | null;
  ws8TrackSpacingNm: number | null;
  pattern: {
    type: string;
    orientation: string;
    environment: '' | 'water' | 'land';
    worksheetSource: '' | 'ws2' | 'ws3' | 'ws8';
    trackLineLengthText?: string;
  };
  worksheet1Fs?: number;
  assets: Array<{
    id: string;
    name: string;
    type: string;
    homeBaseName?: string;
    transitSpeedKts?: number;
    searchSpeedKts?: number;
    enduranceHours?: number;
    sweepWidthNm?: number;
    assignedSubArea?: string;
  }>;
}

/** Bangun DocumentSnapshot dari state halaman — dipakai DocumentWorkbench dan
 *  panel AI (tool fill_form) sehingga dokumen AI identik dengan dokumen UI. */
export function buildDocumentSnapshot(input: DocumentSnapshotInput): DocumentSnapshot {
  return {
    lkp: input.isLkpSet ? input.lkp : null,
    lkpSet: input.isLkpSet,
    datum: input.datumResults ? {
      datumLeft: input.datumResults.datumLeft,
      datumRight: input.datumResults.datumRight,
      driftDistanceNm: input.datumResults.driftDistance,
      totalDriftErrorNm: input.datumResults.E,
    } : null,
    searchArea: input.searchResults ? {
      center: input.searchResults.searchAreaCenter,
      lengthNm: input.searchResults.searchAreaLength,
      widthNm: input.searchResults.searchAreaWidth,
      orientationDeg: input.searchResults.orientationDeg,
      areaSqNm: input.searchResults.Ao,
      trackSpacingNm: input.searchResults.trackSpacing,
      safetyFactor: input.searchResults.fs,
      podPercent: input.searchResults.POD,
    } : null,
    asw: input.asw.aswSpeed ? { dirFrom: input.asw.aswDirFrom, speedKts: input.asw.aswSpeed } : null,
    awa: input.awa.isValid ? { dirFrom: input.awa.aswDirFrom, speedKts: input.awa.aswSpeed } : null,
    trackSpacing: {
      ws2Nm: input.ws2TrackSpacingNm,
      ws3Nm: input.ws3TrackSpacingNm,
      ws8Nm: input.ws8TrackSpacingNm,
    },
    pattern: input.pattern,
    assets: input.assets.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      homeBaseName: a.homeBaseName,
      transitSpeedKts: a.transitSpeedKts,
      searchSpeedKts: a.searchSpeedKts,
      enduranceHours: a.enduranceHours,
      sweepWidthNm: a.sweepWidthNm,
      assignedSubArea: a.assignedSubArea,
    })),
    mapPoints: [],
  };
}

// ── Pemetaan field dokumen → form aplikasi (deterministik) ──────────────────

/** BRIEFING (Lampiran II B) → key BriefingForm. */
const BRIEFING_FIELD_MAP: Record<string, string> = {
  briefDate: 'date',
  sruName: 'sruName',
  pilotName: 'captainPilot',
  incidentBrief: 'accidentDetails',
  searchObjectBrief: 'targetDetails',
  pobBrief: 'pobCount',
  freqBrief: 'targetFrequencies',
  areaBrief: 'searchAreaDesc',
  patternBrief: 'searchPattern',
  altitudeBrief: 'aircraftAltitude',
  weatherBrief: 'weatherData',
  cspBrief: 'cspCoords',
  commsBrief: 'commsFreqs',
};

/** DE-BRIEFING (Lampiran II C, field AKTUAL) → key section de-briefing BriefingForm. */
const DEBRIEF_FIELD_MAP: Record<string, string> = {
  actualDeparturePoint: 'pointOfDeparture',
  actualLandingPoint: 'pointOfLanding',
  actualDepartureTime: 'depTime',
  actualArrivalTime: 'arrTime',
  actualConstraints: 'fieldObstacles',
  observerCount: 'observerCount',
  victimFound: 'victimFoundStatus',
  otherNotes: 'otherNotes',
};

/** RENOPS: field bernama → key RenopsForm. */
const RENOPS_FIELD_MAP: Record<string, string> = {
  previousEfforts2: 'effortsDone',
  previousEfforts: 'effortsDone',
  preparedSruAir: 'sruAir',
  preparedSruSea: 'sruSea',
  preparedSruLand: 'sruLand',
  preparedEquipment: 'equipment',
  logisticsDetail: 'logistics',
  smcName: 'smcName',
  oscName: 'oscName',
  commsPlan: 'commsFreqs',
  datumPos: 'datumPos',
  areaCoords: 'areaCoords',
  areaSize: 'searchAreaSize',
  taskNarrative: 'taskMission',
};

/** RENOPS_I: baris tabel SITUASI (fmt1_i, label di value teks soal?) — label
 *  tersimpan di field.label, nilai di field.value → petakan berdasar LABEL. */
const RENOPS_LABEL_MAP: Array<{ match: RegExp; formKey: string }> = [
  { match: /^NAMA KAPAL\/PESAWAT$/i, formKey: 'targetName' },
  { match: /^CALL SIGN/i, formKey: 'callSign' },
  { match: /^RUTE KAPAL\/PESAWAT$/i, formKey: 'route' },
  { match: /^WAKTU KEJADIAN/i, formKey: 'accidentTime' },
  { match: /^PENYEBAB KECELAKAAN$/i, formKey: 'cause' },
  { match: /^JUMLAH CREW$/i, formKey: 'pobCrew' },
  { match: /^JUMLAH PENUMPANG$/i, formKey: 'pobPassengers' },
  { match: /^JUMLAH POB$/i, formKey: 'pobCount' },
  { match: /^UPAYA YANG TELAH DILAKUKAN$/i, formKey: 'effortsDone' },
];

export interface FillFormPlan {
  ok: boolean;
  error?: string;
  /** Form tujuan (worksheet set_fields bebas-string). */
  worksheet: 'briefing' | 'renops' | null;
  docType: string;
  title?: string;
  /** Payload SetFieldsApplied-ready (values hanya dari field READY). */
  values: Record<string, string>;
  /** Field dokumen yang sengaja tidak dipetakan + alasannya. */
  skipped: Array<{ docKey: string; label: string; reason: string }>;
  /** Ringkasan validasi dokumen (READY/PENDING/dll). */
  summary?: { ready: number; pending: number; actualRequired: number; total: number };
}

const isFilledValue = (value: string | undefined): boolean =>
  typeof value === 'string' && value.trim() !== '' && value.trim() !== PENDING_TEXT
  && !/^(belum|mohon|menunggu|n\/a|-)$/i.test(value.trim());

/** Nilai field dokumen yang BOLEH dipakai (READY saja — jangan mengarang). */
function readyValue(field: ResolvedField): string | null {
  if (field.status !== 'READY') return null;
  return isFilledValue(field.value) ? field.value : null;
}

/** Susun rencana pengisian form dari dokumen hasil buildDocument.
 *  Payload `values` kompatibel dengan applier set_fields halaman (form bebas
 *  string briefing/renops) sehingga penerapan lewat SATU mekanisme. */
export function buildFillFormPlan(document: GeneratedDocument): FillFormPlan {
  const plan: FillFormPlan = {
    ok: false,
    worksheet: null,
    docType: document.docType,
    values: {},
    skipped: [],
  };
  if (document.docType === 'BRIEFING') plan.worksheet = 'briefing';
  else if (document.docType === 'DEBRIEFING') plan.worksheet = 'briefing'; // section de-briefing dalam BriefingForm
  else if (document.docType === 'RENOPS_I' || document.docType === 'RENOPS_II') plan.worksheet = 'renops';
  else {
    plan.error = `Tipe dokumen tidak dikenal: ${String(document.docType)}`;
    return plan;
  }

  plan.title = document.title;
  plan.summary = {
    ready: document.validation.ready,
    pending: document.validation.pending,
    actualRequired: document.validation.actualRequired,
    total: document.validation.total,
  };

  const map = document.docType === 'BRIEFING' ? BRIEFING_FIELD_MAP
    : document.docType === 'DEBRIEFING' ? DEBRIEF_FIELD_MAP
    : RENOPS_FIELD_MAP;
  const seenFormKeys = new Set<string>();

  for (const section of document.sections) {
    // Narasi B. TUGAS → taskMission (RENOPS) — teks tersusun dari data kasus.
    if (section.id === 'tugas' && Array.isArray(section.narrative) && section.narrative.length > 0 && plan.worksheet === 'renops') {
      plan.values['taskMission'] = section.narrative[0];
      seenFormKeys.add('taskMission');
    }
    for (const docField of section.fields ?? []) {
      const value = readyValue(docField);
      if (value === null) {
        plan.skipped.push({
          docKey: docField.key,
          label: docField.label,
          reason: docField.status === 'ACTUAL_REQUIRED'
            ? 'Wajib data AKTUAL dari laporan sortie — tidak boleh diambil dari rencana.'
            : docField.status === 'CONFLICT' ? 'Sumber bertentangan — selesaikan manual.'
            : 'Data belum ada (PENDING) — diisi manual/lewat pertanyaan Bank Data.',
        });
        continue;
      }
      // 1) Map langsung berdasar key dokumen.
      let formKey: string | undefined = map[docField.key];
      // 2) RENOPS_I: baris positional fmt1_* → map berdasar LABEL.
      if (!formKey && /^fmt1_\d+$/.test(docField.key)) {
        formKey = RENOPS_LABEL_MAP.find((entry) => entry.match.test(docField.label.trim()))?.formKey;
      }
      if (!formKey) {
        plan.skipped.push({ docKey: docField.key, label: docField.label, reason: 'Tidak ada field padanan pada form aplikasi — tetap tersedia di dokumen.' });
        continue;
      }
      if (seenFormKeys.has(formKey)) continue; // pertama menang (deterministik)
      plan.values[formKey] = value;
      seenFormKeys.add(formKey);
    }
  }

  plan.ok = true;
  return plan;
}

/** Payload SetFieldsApplied siap apply (dipakai client setelah konfirmasi). */
export function fillFormPlanToSetFields(plan: FillFormPlan): SetFieldsApplied | null {
  if (!plan.ok || !plan.worksheet) return null;
  const applied: SetFieldsApplied = {
    worksheet: plan.worksheet as SetFieldsWorksheet,
    values: { ...plan.values },
  };
  return applied;
}

/** Ringkasan JSON dokumen untuk model (tool fill_form) — tanpa payload besar. */
export function compactFillFormResult(document: GeneratedDocument, plan: FillFormPlan): Record<string, unknown> {
  return {
    docType: document.docType,
    title: document.title,
    subtitle: document.subtitle,
    validation: document.validation,
    sections: document.sections.map((section) => ({
      id: section.id,
      title: section.title,
      fieldCount: section.fields?.length ?? 0,
      readyCount: (section.fields ?? []).filter((f) => f.status === 'READY').length,
      ...(section.narrative?.length ? { narrative: section.narrative.slice(0, 3) } : {}),
    })),
    questions: document.questions.slice(0, 10),
    fillPlan: {
      worksheet: plan.worksheet,
      appliedKeys: Object.keys(plan.values),
      values: plan.values,
      skippedCount: plan.skipped.length,
      skipped: plan.skipped.slice(0, 10),
    },
    note: 'Angka dokumen dari worksheet/peta/Bank Data (buildDocument deterministik). Dokumen resmi tetap DRAFT sampai disetujui SMC/pejabat berwenang (keputusan no.12). Pengisian form lewat set_fields — konfirmasi pengguna wajib.',
  };
}
