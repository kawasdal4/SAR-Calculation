/**
 * PHASE 5 — Kontrak preview/konfirmasi seragam untuk tool-call AI chat.
 * =====================================================================
 * Melanjutkan kontrak MapPreviewContract (PHASE 4) ke alur AI assistant:
 * setiap tool-call yang mengubah state/peta/dokumen WAJIB menghasilkan
 * kontrak preview yang ditampilkan ke pengguna SEBELUM applyFunctionCalls
 * dieksekusi. Tanpa ini, data AI diterapkan diam-diam (auto-apply).
 *
 * Mapping tool → capability registry sebagai sumber kebenaran operasi.
 */

import { getCapability, type MapPreviewContract } from './capabilityRegistry';

export interface ChatToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Tool chat → id capability registry (sumber kebenaran operasi). */
export const CHAT_TOOL_TO_CAPABILITY: Record<string, string> = {
  set_asw_case: 'env-asw',
  set_awa_case: 'env-awa',
  set_aero_drift_case: 'env-adw',
  set_intercept_case: 'intercept-calculate',
  set_datum_case: 'ws1-datum',
  set_ws4_case: 'ws4-land-radius',
  set_ws3_case: 'ws3-land-wsc-pod',
  set_ws2_case: 'ws2-maritime-wsc-pod',
  set_search_pattern_case: 'pattern-generate',
  set_ws8_case: 'ws8-vessel-wsc-pod',
  set_lkp: 'map-sea-lkp-pick',
  save_case_data_bank: 'doc-bank-data',
};

/** Tool yang tidak mengubah apa pun (hanya meminta data) — tanpa preview. */
export const CHAT_NON_MUTATING_TOOLS = new Set<string>(['ask_for_case_data', 'clarify_datum_time', 'clarify_incident_time']);

const TOOL_LABELS: Record<string, string> = {
  set_asw_case: 'Worksheet ASW (maritime surface)',
  set_awa_case: 'Worksheet AWA (air)',
  set_aero_drift_case: 'Aero Drift Worksheet (ADW)',
  set_intercept_case: 'Tab Intercept',
  set_datum_case: 'Worksheet 1 — Datum & total drift',
  set_ws4_case: 'Worksheet 4 — radius pencarian darat',
  set_ws3_case: 'Worksheet 3 — WSC darat',
  set_ws2_case: 'Worksheet 2 — WSC maritime',
  set_search_pattern_case: 'Search pattern (PS/CS/SS/VS/TS)',
  set_ws8_case: 'Worksheet 8 — WSC vessel',
  set_lkp: 'LKP — titik awal kasus',
  save_case_data_bank: 'Bank Data kasus',
};

const numArg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const fmtCoord = (lat: unknown, lng: unknown): string => {
  const latS = numArg(lat) ? lat.toFixed(4) : '?';
  const lngS = numArg(lng) ? lng.toFixed(4) : '?';
  return `${latS}, ${lngS}`;
};

/**
 * Bangun kontrak preview untuk satu tool-call. Kontrak yang sama bentuknya
 * dengan MapPreviewContract (PHASE 4) sehingga UI bisa merender seragam.
 */
export function buildChatPreviewContract(call: ChatToolCall): MapPreviewContract | null {
  if (CHAT_NON_MUTATING_TOOLS.has(call.name)) return null;
  const capabilityId = CHAT_TOOL_TO_CAPABILITY[call.name];
  const label = TOOL_LABELS[call.name] ?? call.name;
  const nFields = Object.keys(call.args ?? {}).length;

  // set_lkp menyentuh peta — target sea-map + koordinat eksplisit di summary.
  if (call.name === 'set_lkp') {
    const lat = (call.args as { lat?: unknown }).lat;
    const lng = (call.args as { lng?: unknown }).lng;
    return {
      operation: capabilityId ?? call.name,
      summary: `Menempatkan/memperbarui marker LKP di Peta Laut pada ${fmtCoord(lat, lng)} (WGS84).`,
      target: 'sea-map',
      features: [
        {
          kind: 'marker',
          label: 'LKP',
          coord: numArg(lat) && numArg(lng) ? { lat: lat as number, lng: lng as number } : undefined,
        },
      ],
      requiresUserConfirmation: true,
      reversible: true,
      warnings: ['Koordinat berasal dari ekstraksi dokumen AI — verifikasi sebelum konfirmasi.'],
    };
  }

  // Ekstraksi menyimpan record Bank Data (dokumen/state data bank).
  if (call.name === 'save_case_data_bank') {
    return {
      operation: capabilityId ?? call.name,
      summary: `Menyimpan hasil ekstraksi ke Bank Data kasus (${nFields} field).`,
      target: 'document',
      features: [],
      requiresUserConfirmation: true,
      reversible: true,
    };
  }

  // Pengisian worksheet/state aplikasi.
  const warnings: string[] = [];
  if (call.name === 'set_intercept_case') {
    warnings.push('Data Intercept dihitung ulang dan diplot ulang di tab Intercept setelah diterapkan.');
  }
  if (call.name === 'set_aero_drift_case') {
    warnings.push('Rantai vektor ADW akan dirender ulang di UPS Plotter (lihat kontrak map-ups-plot).');
  }
  return {
    operation: capabilityId ?? call.name,
    summary: `Mengisi ${label} dengan data ekstraksi AI (${nFields} field).`,
    target: 'state',
    features: [],
    requiresUserConfirmation: true,
    reversible: true,
    warnings: warnings.length ? warnings : undefined,
  };
}

/** Kontrak untuk seluruh tool-call sebuah pesan (tool non-mutating diskip). */
export function buildChatPreviewContracts(calls: ChatToolCall[] | null | undefined): MapPreviewContract[] {
  if (!Array.isArray(calls)) return [];
  return calls
    .map((c) => buildChatPreviewContract(c))
    .filter((c): c is MapPreviewContract => c !== null);
}

/** Label target kontrak untuk pesan UI (ringkas, bahasa Indonesia). */
export const TARGET_LABELS: Record<MapPreviewContract['target'], string> = {
  'sea-map': 'Peta Laut',
  'onc-map': 'Peta ONC',
  'ups-plotter': 'UPS Plotter',
  document: 'Dokumen',
  state: 'Worksheet',
};

/** Semua tool chat bermutasi harus punya mapping ke capability yang ADA di registry. */
export function validateChatToolMapping(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const [tool, capId] of Object.entries(CHAT_TOOL_TO_CAPABILITY)) {
    if (!getCapability(capId)) missing.push(`${tool} → ${capId}`);
  }
  return { ok: missing.length === 0, missing };
}
