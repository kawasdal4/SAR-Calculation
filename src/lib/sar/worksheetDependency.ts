/**
 * WORKSHEET DEPENDENCY GRAPH (Fase D) — graf dependency antar-worksheet yang
 * dibangun DARI IMPLEMENTASI AKTUAL aplikasi:
 * - `SAR_CAPABILITY_REGISTRY.dependencies` (capabilityRegistry.ts) untuk edge
 *   antar capability.
 * - Kontrak input/output worksheet (datumWs1, aeroDriftCalculations, aswTime,
 *   wscPodTables, assetAllocation) untuk daftar field yang diproduksi/dibutuhkan.
 *
 * ATURAN (spesifikasi Fase D):
 * 1. AI TIDAK BOLEH meminta pengguna memasukkan output worksheet yang belum
 *    dijalankan — worksheet sumber dulu, output aktual dipakai sebagai input
 *    worksheet penerima (status DERIVED).
 * 2. Urutan eksekusi = topological order dari `dependencies` (workSheet yang
 *    sama-sama mandiri boleh paralel; urutan penyajian mengikuti WORKSHEET_CHAIN).
 * 3. Modul MURNI — dipakai fieldStatus, parse-case completeness, system prompt
 *    agent, dan test regresi.
 */

import { SAR_CAPABILITY_REGISTRY } from './capabilityRegistry';

/** Field yang DIPRODUKSI tiap worksheet (kontrak output aktual aplikasi). */
export const WORKSHEET_OUTPUT_FIELDS: Record<string, string[]> = {
  'env-asw': ['aswDirFrom', 'aswSpeed', 'totalHours', 'aswdve'],
  'env-awa': ['awaDirFrom', 'awaSpeed', 'awaGlideDirFrom', 'awaGlideSpeedKts'],
  'env-adw': ['landingPos', 'glideDistanceNm', 'glideTimeMin', 'driftErrorDeNm', 'searchRadiusRNm'],
  'ws1-datum': ['datumA', 'datumB', 'datumLeft', 'datumRight', 'driftDistance', 'De', 'E', 'R'],
  'ws1-search-area': ['E', 'R', 'Ao'],
  'ws2-maritime-wsc-pod': ['Wu', 'fw', 'fs', 'ff', 'W(S)', 'C', 'POD', 'T'],
  'ws3-land-wsc-pod': ['Wu', 'Fv', 'W(S)', 'C', 'POD', 'T'],
  'ws4-land-radius': ['radiusPerPoint', 'trapesiumArea', 'totalArea'],
  'ws8-vessel-wsc-pod': ['Wu', 'fw', 'ff', 'W(S)', 'C', 'POD', 'T'],
  'ws-search-plan': ['effort', 'Zta', 'fs', 'Ro', 'Ao', 'C', 'POD'],
  'asset-allocation': ['EST', 'A', 'coverage', 'deficit'],
};

/** Label tampilan worksheet (untuk prompt AI dan UI). */
export const WORKSHEET_LABELS: Record<string, string> = {
  'env-asw': 'ASW (Average Surface Wind, K-19)',
  'env-awa': 'AWA (Aeronautical Wind Analysis)',
  'env-adw': 'ADW (Aeronautical Drift)',
  'ws1-datum': 'Datum WS 1 (Sea Drift)',
  'ws1-search-area': 'WS 1 — Search Area (E, R, Ao)',
  'ws2-maritime-wsc-pod': 'WS 2 (udara — WSC & POD)',
  'ws3-land-wsc-pod': 'WS 3 (darat — WSC & POD)',
  'ws4-land-radius': 'WS 4 (radius pencarian darat)',
  'ws8-vessel-wsc-pod': 'WS 8 (laut — WSC & POD)',
  'ws-search-plan': 'Search Plan (effort/Zta)',
  'asset-allocation': 'Alokasi Aset SRU & EST',
  'pattern': 'Search Pattern (CSP)',
  'documents': 'Dokumen Rencana Operasi / Briefing / De-briefing',
};

/** Input wajib tiap worksheet yang berasal dari worksheet LAIN (edge data).
 *  Disusun dari kontrak input aktual (Ws1DatumInput, AeroDriftInput, dsb.). */
export const WORKSHEET_DATA_EDGES: Array<{
  /** Worksheet penerima. */
  consumer: string;
  /** Worksheet penghasil. */
  producer: string;
  /** Field penerima (path worksheet state). */
  fields: string[];
  /** Keterangan aliran data. */
  note: string;
}> = [
  { consumer: 'env-adw', producer: 'env-awa', fields: ['awaGlideDirFrom', 'awaGlideSpeedKts', 'awaIsValid'], note: 'Angin glide (arah/kecepatan) hasil AWA dipakai ADW untuk drift angin.' },
  { consumer: 'env-adw', producer: 'env-adw', fields: ['lkp (adw-landing)'], note: 'landingPos ADW menjadi LKP baru (lkpSource adw-landing) — worksheet hilir memakai posisi ditching.' },
  { consumer: 'ws1-datum', producer: 'env-asw', fields: ['driftInterval (hours of drift = totalHours ASW)'], note: 'Interval drift Datum = total hours ASW (aturan resmi).' },
  { consumer: 'ws1-datum', producer: 'ws1-datum', fields: ['leewayRate', 'leewayModifier', 'leewayDivergenceDeg'], note: 'Parameter leeway dari kategori Tabel I-1/I-2 yang dipilih planner (referenceId).' },
  { consumer: 'ws1-search-area', producer: 'ws1-datum', fields: ['De', 'E (dari De,X,Y)'], note: 'Search area memakai De hasil Datum WS 1.' },
  { consumer: 'ws2-maritime-wsc-pod', producer: 'ws1-search-area', fields: ['Ao (sisi persegi √Ao, T=Ao/V×S)'], note: 'Luas area Ao dari WS 1 dipakai WS 2 (T dan sisi pola).' },
  { consumer: 'ws8-vessel-wsc-pod', producer: 'ws1-search-area', fields: ['Ao'], note: 'Luas area Ao dari WS 1 dipakai WS 8.' },
  { consumer: 'ws3-land-wsc-pod', producer: 'ws1-search-area', fields: ['Ao'], note: 'Luas area darat (WS 4 trapesium) dipakai WS 3.' },
  { consumer: 'ws-search-plan', producer: 'ws1-datum', fields: ['datumPos'], note: 'Search plan memakai titik Datum.' },
  { consumer: 'ws2-maritime-wsc-pod', producer: 'ws2-maritime-wsc-pod', fields: ['S (sweep width) → pola & alokasi'], note: 'S hasil WS 2 dipakai track spacing pola dan sweepWidth alokasi aset.' },
  { consumer: 'ws8-vessel-wsc-pod', producer: 'ws8-vessel-wsc-pod', fields: ['S (sweep width) → pola & alokasi'], note: 'S hasil WS 8 dipakai track spacing pola dan sweepWidth alokasi aset.' },
  { consumer: 'asset-allocation', producer: 'ws2/ws8', fields: ['sweepWidthNm'], note: 'S per lembar dipakai sebagai sweep width aset (casePipeline).' },
  { consumer: 'pattern', producer: 'ws1-datum', fields: ['orientationDeg = bearing LKP→Datum'], note: 'Orientasi pola dihitung pipeline setelah Datum.' },
  { consumer: 'documents', producer: '*', fields: ['seluruh hasil worksheet'], note: 'RENOPS/Briefing/De-briefing dirakit dari hasil worksheet (DocumentSnapshot).' },
];

/** Urutan eksekusi resmi (rantai tool worksheet + dependency capability). */
export const WORKSHEET_EXECUTION_ORDER: readonly string[] = [
  'env-asw',
  'env-awa',
  'env-adw',
  'ws1-datum',
  'ws1-search-area',
  'ws2-maritime-wsc-pod',
  'ws8-vessel-wsc-pod',
  'ws3-land-wsc-pod',
  'ws4-land-radius',
  'ws-search-plan',
  'asset-allocation',
  'pattern',
  'documents',
];

/** Topological order sederhana dari dependencies registry — dipakai sebagai
 *  sanity check bahwa WORKSHEET_EXECUTION_ORDER tidak melanggar dependency. */
export function dependencyRespectingOrder(): string[] {
  const depsOf = new Map<string, string[]>();
  for (const capability of SAR_CAPABILITY_REGISTRY) {
    if (capability.category !== 'WORKSHEET_CALCULATION') continue;
    depsOf.set(capability.id, [...(capability.dependencies ?? [])]);
  }
  const ordered: string[] = [];
  const placed = new Set<string>();
  const pending = [...depsOf.keys()];
  let guard = 0;
  while (pending.length > 0 && guard < 100) {
    guard += 1;
    const next = pending.find((id) => (depsOf.get(id) ?? []).every((dep) => placed.has(dep) || !depsOf.has(dep)));
    if (next === undefined) break; // siklus (tidak ada di registry aktual)
    ordered.push(next);
    placed.add(next);
    pending.splice(pending.indexOf(next), 1);
  }
  return ordered;
}

/** Cari worksheet penghasil untuk sebuah field (path kasus/worksheet). */
export function producerWorksheetOfField(fieldPath: string): { worksheetId: string; label: string } | null {
  const path = fieldPath.toLowerCase();
  if (/awaglide(dirfrom|speedkts)|^aero\.awa/.test(path)) return { worksheetId: 'env-awa', label: WORKSHEET_LABELS['env-awa'] };
  if (/driftinterval|hoursofdrift/.test(path)) return { worksheetId: 'env-asw', label: WORKSHEET_LABELS['env-asw'] };
  if (/sweepwidth|sweptwidth/.test(path)) return { worksheetId: 'ws2/ws8', label: 'WS 2 / WS 8' };
  if (/pattern.*orientation|orientationdeg/.test(path)) return { worksheetId: 'ws1-datum', label: WORKSHEET_LABELS['ws1-datum'] };
  if (/glideratio/.test(path)) return { worksheetId: 'env-adw', label: WORKSHEET_LABELS['env-adw'] };
  return null;
}

/** Ringkasan graf dependency untuk system prompt AI (kompak, bahasa Indonesia). */
export function describeDependencyGraph(): string {
  const lines: string[] = [];
  lines.push('=== DEPENDENCY GRAPH WORKSHEET (urutan kerja resmi) ===');
  lines.push('1. Input kasus (ekstraksi soal) → ASW & AWA (mandiri, bisa paralel)');
  lines.push('2. AWA → ADW (angin glide + konversi heading; ADW menghasilkan landingPos → LKP bila lkpSource adw-landing)');
  lines.push('3. ASW → Datum WS 1 (hours of drift = total hours ASW; datum.latitude = |lat| LKP; leeway = kategori Tabel I-1/I-2 pilihan planner/referensi)');
  lines.push('4. Datum → WS 1 Search Area (De, X, Y → E, R=⌈E×fs⌉, Ao=4R²)');
  lines.push('5. Ao → WS 2 (udara)/WS 8 (laut)/WS 3 (darat) + S → track spacing & alokasi aset');
  lines.push('6. Datum + Ao → Search Plan (effort/Zta) & Search Pattern (orientasi = bearing LKP→Datum)');
  lines.push('7. Hasil semua worksheet → Dokumen (RENOPS/Briefing/De-briefing)');
  lines.push('ATURAN: jangan minta pengguna mengisi output worksheet yang belum dijalankan — jalankan worksheet sumber dulu, ambil output aktual, statusnya DERIVED. Field yang menunggu output = PENDING_DEPENDENCY, BUKAN data hilang.');
  return lines.join('\n');
}
