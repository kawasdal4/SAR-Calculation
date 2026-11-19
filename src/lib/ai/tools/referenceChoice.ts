/**
 * REFERENCE CHOICE (Fase E) — sistem INTERAKTIF pemilihan parameter dari
 * Appendix/Table / katalog referensi resmi aplikasi langsung di kolom chat.
 *
 * ATURAN MUTLAK (spesifikasi Fase E + arahan planner):
 * 1. SEMUA pilihan berasal dari data referensi resmi yang sudah ada di aplikasi
 *    (LEEWAY_OBJECT_TYPES Tabel I-1/I-2, dsb.) — DILARANG hardcoded/mengarang.
 * 2. AI memberi SATU rekomendasi utama bila dasar pemilihan cukup (dari
 *    karakteristik objek di soal via resolver keyword resmi), dengan alasan +
 *    sumber tabel, PLUS alternatif. Bila data tidak cukup → tanpa rekomendasi,
 *    tampilkan opsi dan minta keputusan planner (needsUserDecision).
 * 3. **AUTO-APPLY bila AI yakin** (arahan planner): rekomendasi dengan skor
 *    kata kunci kuat (confident) → kartu langsung MENERAPKAN reference ID ke
 *    worksheet lewat set_fields (satu batch → change-log + Undo tetap jalan)
 *    dan status menjadi USER_CONFIRMED_REFERENCE. Planner tetap bisa mengganti
 *    lewat "Pilih kategori lainnya" atau Undo. Bila TIDAK yakin → kartu
 *    menunggu keputusan planner (konfirmasi klik).
 * 4. Reference ID (bukan label) yang disimpan, disertai sumber Appendix/Table.
 * 5. REUSABLE: registry fieldPath → konfigurasi sumber; menambah parameter
 *    baru = menambah entri registry, bukan menulis jalur khusus.
 */

import { LEEWAY_OBJECT_TYPES, resolveLeewayObjectFromDescription } from '../../sar/sarCalculations';
import { getReferenceTableInfo } from '../../sar/referenceTables';

// ── Registry field yang membutuhkan pemilihan referensi ─────────────────────

export interface ReferenceFieldConfig {
  /** Path field worksheet tujuan (format set_fields registry). */
  fieldPath: string;
  /** Worksheet tujuan (format SET_FIELDS_WORKSHEETS). */
  worksheet: string;
  /** Sumber tabel resmi (id di referenceTables). */
  refId: string;
  /** Pertanyaan untuk planner. */
  question: string;
  /** Keterangan worksheet yang membutuhkan. */
  consumerWorksheetLabel: string;
  /** Resolver rekomendasi dari deskripsi objek (dari soal). */
  recommend: (contextText: string) => ReferenceRecommendation | null;
  /** Daftar pilihan resmi (untuk UI "Pilih kategori lainnya"). */
  alternatives: () => Array<{ id: string; label: string; description?: string; group?: string }>;
  /** Versi/sumber referensi untuk audit. */
  version: string;
}

export interface ReferenceRecommendation {
  referenceId: string;
  label: string;
  description: string;
  reason: string;
  /** True bila dasar rekomendasi kuat → kartu auto-apply (arahan planner). */
  confident: boolean;
  /** Skor mentah resolver (total panjang kata kunci cocok) untuk audit. */
  score: number;
}

/** Grup tampilan kategori leeway (dipakai UI untuk daftar panjang I-1/I-2). */
function leewayGroupOf(id: string): string {
  if (/^piw|deceased|scuba/.test(id)) return 'Orang di air (PIW)';
  if (/^raft|dinghy|capsule|uscg|evac/.test(id)) return 'Rakit/dinghy/kapsul';
  if (/^sailboat|surf|windsurfer|kayak/.test(id)) return 'Perahu layar/papan';
  if (/^skiff|sport|small-fishing|fishing|commercial|longliner|junk|gill|sampans/.test(id)) return 'Perahu nelayan/kapal kecil';
  if (/^merchant/.test(id)) return 'Kapal niaga';
  if (/^deep-ballast/.test(id)) return 'Rakit ballast dalam';
  return 'Lainnya';
}

function leewayEntryDescription(label: string, rate: number, modifier?: number, divergence?: number): string {
  return `${label} — leeway ${(rate * 100).toFixed(0)}% kecepatan angin${modifier ? ` + ${modifier} kt` : ''}, divergensi ±${divergence ?? 0}°.`;
}

/** Registry: field yang dikontrol sistem interaktif (reusable — tambah entri
 *  baru di sini untuk parameter referensi lain). */
export const REFERENCE_CHOICE_FIELDS: Record<string, ReferenceFieldConfig> = {
  'datum.leewayObjectId': {
    fieldPath: 'datum.leewayObjectId',
    worksheet: 'datum',
    refId: 'I-1/I-2',
    question: 'Kategori objek leeway (Tabel I-1/I-2 Appendix) untuk perhitungan Datum WS 1.',
    consumerWorksheetLabel: 'Datum WS 1 (Sea Drift)',
    version: 'Tabel I-1/I-2 IAMSAR Appendix (51 kategori, VERIFIED — referenceTables.ts)',
    recommend: (contextText) => {
      const match = resolveLeewayObjectFromDescription(contextText);
      if (!match) return null;
      const entry = match.object;
      return {
        referenceId: entry.id,
        label: entry.label,
        description: leewayEntryDescription(entry.label, entry.leewayRate, entry.leewayModifier, entry.divergenceAngle),
        reason: `Karakteristik objek pada soal cocok dengan kategori ini (kata kunci: ${match.matchedTerms.slice(0, 4).join(', ')}; skor ${match.score}). Parameter leeway mengikuti Tabel I-1/I-2: rate ×${entry.leewayRate}${entry.leewayModifier ? ` + ${entry.leewayModifier} kt` : ''}, divergensi ±${entry.divergenceAngle}°.`,
        confident: match.score >= 6,
        score: match.score,
      };
    },
    alternatives: () => LEEWAY_OBJECT_TYPES.map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: leewayEntryDescription(entry.label, entry.leewayRate, entry.leewayModifier, entry.divergenceAngle),
      group: leewayGroupOf(entry.id),
    })),
  },
};

export type ReferenceChoiceStatus =
  | 'AI_RECOMMENDED_PENDING_CONFIRMATION'
  | 'AI_RECOMMENDED_AUTO_APPLIED'
  | 'PLANNER_INPUT';

/** Payload kartu interaktif yang dikirim ke klien (bukan untuk model). */
export interface ReferenceChoicePayload {
  fieldPath: string;
  worksheet: string;
  consumerWorksheetLabel: string;
  question: string;
  sourceTable: { refId: string; label: string; status: string; source: string; version: string };
  recommendation: ReferenceRecommendation | null;
  alternatives: Array<{ id: string; label: string; description?: string; group?: string }>;
  status: ReferenceChoiceStatus;
  /** True bila AI tidak cukup yakin → planner memutuskan dari daftar. */
  needsUserDecision: boolean;
  /** True bila kartu boleh MENERAPKAN rekomendasi langsung ke worksheet saat
   *  muncul (AI yakin — arahan planner). Tetap tercatat change-log + Undo. */
  autoApply: boolean;
}

// ── Builder payload ─────────────────────────────────────────────────────────

export function buildReferenceChoice(fieldPath: string, contextText: string): ReferenceChoicePayload | null {
  const config = REFERENCE_CHOICE_FIELDS[fieldPath];
  if (!config) return null;
  const info = getReferenceTableInfo(config.refId);
  const recommendation = contextText.trim() ? config.recommend(contextText) : null;
  const alternatives = config.alternatives();
  return {
    fieldPath: config.fieldPath,
    worksheet: config.worksheet,
    consumerWorksheetLabel: config.consumerWorksheetLabel,
    question: config.question,
    sourceTable: {
      refId: config.refId,
      label: info?.label ?? config.refId,
      status: info?.status ?? 'UNVERIFIED',
      source: info?.source ?? '',
      version: config.version,
    },
    recommendation,
    alternatives,
    status: recommendation
      ? (recommendation.confident ? 'AI_RECOMMENDED_AUTO_APPLIED' : 'AI_RECOMMENDED_PENDING_CONFIRMATION')
      : 'PLANNER_INPUT',
    needsUserDecision: !recommendation,
    autoApply: Boolean(recommendation?.confident),
  };
}

/** Ringkasan pilihan untuk teks model (alternatif dipotong per grup). */
export function referenceChoiceForModel(payload: ReferenceChoicePayload): Record<string, unknown> {
  const grouped = new Map<string, Array<{ id: string; label: string }>>();
  for (const alt of payload.alternatives) {
    const key = alt.group ?? 'Lainnya';
    const list = grouped.get(key) ?? [];
    list.push({ id: alt.id, label: alt.label });
    grouped.set(key, list);
  }
  return {
    fieldPath: payload.fieldPath,
    worksheet: payload.worksheet,
    status: payload.status,
    autoApply: payload.autoApply,
    recommendation: payload.recommendation
      ? {
          ...payload.recommendation,
          status: payload.status,
          note: payload.autoApply
            ? 'Kartu SUDAH menerapkan rekomendasi ini ke worksheet otomatis (planner bisa mengganti lewat kartu/Undo) — jangan panggil set_fields lagi untuk field ini.'
            : 'Belum resmi sebelum pengguna mengonfirmasi di kartu — jangan panggil set_fields untuk field ini.',
        }
      : null,
    needsUserDecision: payload.needsUserDecision,
    alternativesByGroup: Object.fromEntries([...grouped.entries()].map(([group, list]) => [group, list.slice(0, 8).concat(list.length > 8 ? [{ id: '…', label: `+${list.length - 8} lainnya (kartu UI menampilkan semua)` }] : [])])),
    sourceTable: payload.sourceTable,
    instruction: 'Kartu interaktif sudah dirender ke pengguna. Bila autoApply false: tunggu konfirmasi pengguna sebelum set_fields. Bila autoApply true: rekomendasi sudah diterapkan otomatis; cukup jelaskan dasar pemilihannya.',
  };
}
