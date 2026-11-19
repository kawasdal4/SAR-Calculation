/**
 * SAR WORKFLOW MEMORY & CONTEXT MANAGER (lib inti)
 * =================================================
 * Konteks pekerjaan SAR per workspace (= SarCase existing — bukan entitas baru).
 * Semua relasi antar-entry diambil dari dependency metadata SAR Capability
 * Registry (graph aktual), BUKAN tebakan nama worksheet.
 *
 * Aturan memori (bab 11 permintaan fitur) yang di-enforce di lib ini:
 * 1. Workspace aktif = konteks utama (semua entry menyandung caseId).
 * 2. Isolasi antar workspace via caseId (retrieval selalu filter).
 * 3-4. Nilai kalkulasi resmi hanya dari entry calculation/map (source engine),
 *      percakapan TIDAK pernah menjadi sumber nilai (category 'conversation').
 * 5-6. Hanya entry CURRENT yang authoritative; STALE diberi peringatan eksplisit.
 * 7. Data tidak tersedia → `available: false` (AI tidak mengarang).
 * 10. Semua entry punya source/capability/timestamp/version/dependencies —
 *      jawaban AI dapat ditelusuri (traceability).
 */

import { SAR_CAPABILITY_REGISTRY, getCapability } from './capabilityRegistry';

// ============================================================================
// Tipe
// ============================================================================

export type ContextCategory = 'scenario' | 'calculation' | 'map' | 'operational' | 'conversation';
export type ContextStatus = 'CURRENT' | 'STALE' | 'PENDING' | 'NEEDS_REVIEW' | 'INVALID' | 'ARCHIVED';

export interface ContextEntry {
  id: string;
  caseId: string;                     // workspace (= SarCase.id)
  entryKey: string;                   // slot stabil: 'calc:awa', 'map:lkp', 'conv:<ts>'…
  category: ContextCategory;
  capabilityId?: string;              // id di SAR Capability Registry
  calculationId?: string;             // referensi hasil (id pola, id dokumen, …)
  source: 'user-input' | 'ai-extraction' | 'worksheet' | 'map' | 'document' | 'conversation';
  data: Record<string, unknown>;      // snapshot nilai
  summary: string;                    // satu baris untuk retrieval AI
  status: ContextStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  inputsHash?: string;
  dependencies: string[];             // entryKey yang dibutuhkan (relasi aktual)
  supersededBy?: string;              // entryKey versi terbaru (histori append-only)
}

// ============================================================================
// Mapping slot ↔ capability (semua id diverifikasi terhadap registry)
// ============================================================================

export interface ContextSlot {
  entryKey: string;
  capabilityId: string;
  category: ContextCategory;
  /** Kunci state aplikasi (payload buildState) sumber data entry. */
  stateKey: string;
  label: string;
  /** Cek kelengkapan minimal — false → status PENDING (data belum cukup). */
  isSufficient: (data: Record<string, unknown>) => boolean;
}

const hasItems = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
const hasVal = (v: unknown): boolean => v !== undefined && v !== null && v !== '';
/** Slot berbasis extras (state tidak di buildState): cukup bila datanya tidak kosong. */
const nonEmpty = (d: Record<string, unknown>): boolean => Object.keys(d).length > 0;

export const CONTEXT_SLOTS: ContextSlot[] = [
  { entryKey: 'scenario:info', capabilityId: 'doc-bank-data', category: 'scenario', stateKey: 'scenario',
    label: 'Informasi skenario',
    isSufficient: (d) => hasVal(d.title) || hasVal(d.caseTitle) },
  { entryKey: 'calc:awa', capabilityId: 'env-awa', category: 'calculation', stateKey: 'awa',
    label: 'Worksheet AWA (angin ketinggian)',
    isSufficient: (d) => hasItems(d.observations) },
  { entryKey: 'calc:asw', capabilityId: 'env-asw', category: 'calculation', stateKey: 'asw',
    label: 'Worksheet ASW (drift permukaan)',
    isSufficient: (d) => hasItems(d.observations) },
  { entryKey: 'calc:aero', capabilityId: 'env-adw', category: 'calculation', stateKey: 'aero',
    label: 'Aero Drift Worksheet (ADW)',
    isSufficient: (d) => hasVal((d as { incidentPos?: unknown }).incidentPos) },
  { entryKey: 'calc:datum', capabilityId: 'ws1-datum', category: 'calculation', stateKey: 'datum',
    label: 'Worksheet 1 — datum & total drift',
    isSufficient: (d) => hasVal(d.driftInterval) || hasVal(d.lkp) },
  { entryKey: 'calc:search-area', capabilityId: 'ws1-search-area', category: 'calculation', stateKey: 'searchArea',
    label: 'Worksheet 1 — search area',
    isSufficient: nonEmpty },
  { entryKey: 'calc:search', capabilityId: 'ws-search-plan', category: 'calculation', stateKey: 'search',
    label: 'Search plan worksheet',
    isSufficient: (d) => hasVal(d.sweep) || hasVal(d.datumType) || hasItems(d.facilities) },
  { entryKey: 'calc:ws2', capabilityId: 'ws2-maritime-wsc-pod', category: 'calculation', stateKey: 'ws2',
    label: 'Worksheet 2 — WSC maritime',
    isSufficient: nonEmpty },
  { entryKey: 'calc:ws3', capabilityId: 'ws3-land-wsc-pod', category: 'calculation', stateKey: 'ws3',
    label: 'Worksheet 3 — WSC darat',
    isSufficient: nonEmpty },
  { entryKey: 'calc:ws8', capabilityId: 'ws8-vessel-wsc-pod', category: 'calculation', stateKey: 'ws8',
    label: 'Worksheet 8 — WSC vessel',
    isSufficient: nonEmpty },
  { entryKey: 'calc:ws4', capabilityId: 'ws4-land-radius', category: 'calculation', stateKey: 'ws4',
    label: 'Worksheet 4 — radius pencarian darat',
    isSufficient: nonEmpty },
  { entryKey: 'calc:pattern', capabilityId: 'pattern-generate', category: 'calculation', stateKey: 'pattern',
    label: 'Search pattern (PS/CS/SS/VS/TS)',
    isSufficient: (d) => hasVal(d.patternType) },
  { entryKey: 'calc:assets', capabilityId: 'asset-allocate', category: 'calculation', stateKey: 'assets',
    label: 'Alokasi aset SRU',
    isSufficient: (d) => Array.isArray(d) && d.length > 0 },
  { entryKey: 'calc:transit-go', capabilityId: 'transit-go', category: 'calculation', stateKey: 'transitGo',
    label: 'Transit Go (SRU ke datum)',
    isSufficient: nonEmpty },
  { entryKey: 'calc:transit-back', capabilityId: 'transit-back', category: 'calculation', stateKey: 'transitBack',
    label: 'Transit Back (SRU kembali)',
    isSufficient: nonEmpty },
  { entryKey: 'calc:intercept', capabilityId: 'intercept-calculate', category: 'calculation', stateKey: 'intercept',
    label: 'Intercept',
    isSufficient: nonEmpty },
  { entryKey: 'map:lkp', capabilityId: 'map-sea-lkp-pick', category: 'map', stateKey: 'lkp',
    label: 'Peta Laut — LKP',
    isSufficient: (d) => hasVal(d.lat) && hasVal(d.lng) },
  { entryKey: 'map:features', capabilityId: 'map-sea-render', category: 'map', stateKey: 'mapFeatures',
    label: 'Peta Laut — fitur (marker/garis/poligon/lingkaran)',
    isSufficient: (d) => hasItems(d.features) },
  { entryKey: 'map:onc-ws4', capabilityId: 'map-ws4-plot', category: 'map', stateKey: 'mapOnc',
    label: 'Peta ONC — plotting Worksheet 4',
    isSufficient: nonEmpty },
  { entryKey: 'map:ups', capabilityId: 'map-ups-plot', category: 'map', stateKey: 'mapUps',
    label: 'UPS Plotter — sheet VP-OS',
    isSufficient: nonEmpty },
  { entryKey: 'doc:renops', capabilityId: 'doc-renops', category: 'operational', stateKey: 'docRenops',
    label: 'Rencana Operasi SAR',
    isSufficient: (d) => hasVal(d.docId) || hasVal(d.status) },
  { entryKey: 'doc:briefing', capabilityId: 'doc-briefing', category: 'operational', stateKey: 'docBriefing',
    label: 'Form Briefing',
    isSufficient: (d) => hasVal(d.docId) || hasVal(d.status) },
  { entryKey: 'doc:debriefing', capabilityId: 'doc-debriefing', category: 'operational', stateKey: 'docDebriefing',
    label: 'Form De-Briefing',
    isSufficient: (d) => hasVal(d.docId) || hasVal(d.status) },
];

export const SLOT_BY_KEY = new Map(CONTEXT_SLOTS.map((s) => [s.entryKey, s]));

/** Validasi: setiap slot harus menunjuk capability yang ADA di registry. */
export function validateContextSlots(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const s of CONTEXT_SLOTS) {
    if (!getCapability(s.capabilityId)) missing.push(`${s.entryKey} → ${s.capabilityId}`);
  }
  return { ok: missing.length === 0, missing };
}

// ============================================================================
// Hash & scrubbing
// ============================================================================

/** Stringify stabil (keys terurut) — dasar hash deterministik. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** FNV-1a 32-bit — deterministik, cukup untuk deteksi perubahan input. */
export function hashInputs(value: unknown): string {
  const s = stableStringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Bab 10: jangan simpan API key/secret ke context memory. Pertahankan bentuk array. */
const SENSITIVE_KEY = /(api[_-]?key|token|secret|password|credential|authorization)/i;
export function scrubSensitive<T>(data: T): T {
  if (Array.isArray(data)) return data.map((v) => scrubSensitive(v)) as unknown as T;
  if (data !== null && typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (SENSITIVE_KEY.test(k)) { out[k] = '[REDACTED]'; continue; }
      out[k] = v !== null && typeof v === 'object' ? scrubSensitive(v) : v;
    }
    return out as unknown as T;
  }
  return data;
}

// ============================================================================
// Dependency graph aktual — dibangun dari metadata registry (bukan tebakan)
// ============================================================================

/**
 * Edge parent→child antar slot: capability C memiliki dependencies D di
 * registry → slot(D) → slot(C). Hanya edge yang BENAR-BENAR ada di registry.
 */
export function buildChildEdges(): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  const slotByCapability = new Map(CONTEXT_SLOTS.map((s) => [s.capabilityId, s.entryKey]));
  for (const cap of SAR_CAPABILITY_REGISTRY) {
    const childKey = slotByCapability.get(cap.id);
    if (!childKey) continue;
    for (const dep of cap.dependencies ?? []) {
      const parentKey = slotByCapability.get(dep);
      if (!parentKey || parentKey === childKey) continue;
      const list = edges.get(parentKey) ?? [];
      if (!list.includes(childKey)) list.push(childKey);
      edges.set(parentKey, list);
    }
  }
  return edges;
}

/** Kebalikan child edges: slot → entryKey parent yang ia butuhkan (untuk entry.dependencies). */
export function buildParentEdges(): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  const slotByCapability = new Map(CONTEXT_SLOTS.map((s) => [s.capabilityId, s.entryKey]));
  for (const cap of SAR_CAPABILITY_REGISTRY) {
    const childKey = slotByCapability.get(cap.id);
    if (!childKey) continue;
    for (const dep of cap.dependencies ?? []) {
      const parentKey = slotByCapability.get(dep);
      if (!parentKey || parentKey === childKey) continue;
      const list = parents.get(childKey) ?? [];
      if (!list.includes(parentKey)) list.push(parentKey);
      parents.set(childKey, list);
    }
  }
  return parents;
}

// ============================================================================
// Snapshot & versioning
// ============================================================================

const nowIso = () => new Date().toISOString();
let idCounter = 0;
const mkId = (caseId: string, entryKey: string) =>
  `ctx_${caseId.slice(0, 8) || 'ws'}_${entryKey.replace(/[^a-z0-9]/gi, '')}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/**
 * Bangun entry konteks dari satu slot. Versi naik hanya bila hash input
 * berubah; histori lama TIDAK dihapus (append-only, status jadi ARCHIVED).
 */
export function buildSlotEntry(
  slot: ContextSlot,
  caseId: string,
  data: Record<string, unknown>,
  prev?: ContextEntry,
): ContextEntry {
  const clean = scrubSensitive(data);
  const hash = hashInputs(clean);
  const ts = nowIso();
  const sufficient = slot.isSufficient(clean);
  let version = 1;
  let id = mkId(caseId, slot.entryKey);
  if (prev) {
    if (prev.inputsHash === hash && prev.status !== 'STALE' && prev.status !== 'ARCHIVED') {
      // Input tidak berubah — pakai entry existing (tanpa versi baru).
      return prev;
    }
    version = prev.version + 1;
  }
  const status: ContextStatus = sufficient ? 'CURRENT' : 'PENDING';
  return {
    id,
    caseId,
    entryKey: slot.entryKey,
    category: slot.category,
    capabilityId: slot.capabilityId,
    source: slot.category === 'map' ? 'map' : 'worksheet',
    data: clean,
    summary: `${slot.label}: ${sufficient ? 'tersimpan' : 'data belum lengkap'}`,
    status,
    version,
    createdAt: prev?.createdAt ?? ts,
    updatedAt: ts,
    inputsHash: hash,
    dependencies: [],
  };
}

/**
 * Snapshot konteks lengkap dari payload buildState aplikasi + dependensi
 * aktual antar slot (dari registry). Entry dependency diisi dengan entryKey
 * parent yang BENAR ada berdasarkan graph registry.
 */
export function buildWorkspaceSnapshot(
  caseId: string,
  state: Record<string, unknown>,
  prevEntries: ContextEntry[] = [],
  extras: Record<string, Record<string, unknown>> = {}, // slot tanpa stateKey (ws2/3/4/8, intercept, docs)
): { entries: ContextEntry[]; history: ContextEntry[] } {
  const entries: ContextEntry[] = [];
  const history: ContextEntry[] = [];

  for (const slot of CONTEXT_SLOTS) {
    const raw = state[slot.stateKey] ?? extras[slot.entryKey];
    if (raw === undefined || raw === null) continue;           // slot belum pernah dikerjakan
    const data = raw as Record<string, unknown>;
    const prev = prevEntries
      .filter((e) => e.entryKey === slot.entryKey)
      .sort((a, b) => b.version - a.version)[0];
    const entry = buildSlotEntry(slot, caseId, data, prev);
    // Dependency aktual: parent slot yang benar-benar ada di graph registry
    // DAN datanya benar-benar pernah ada (di state saat ini / histori).
    const parentEdges = buildParentEdges();
    entry.dependencies = (parentEdges.get(slot.entryKey) ?? []).filter((p) => {
      const parentSlot = SLOT_BY_KEY.get(p);
      const parentInState = parentSlot ? state[parentSlot.stateKey] !== undefined : false;
      return parentInState || prevEntries.some((e) => e.entryKey === p && e.status !== 'ARCHIVED');
    });
    entries.push(entry);
    if (prev && prev.id !== entry.id && prev.status !== 'ARCHIVED') {
      history.push({ ...prev, status: 'ARCHIVED', supersededBy: slot.entryKey, updatedAt: nowIso() });
    }
  }
  return { entries, history };
}

/** Entry percakapan (bab E) — TIDAK PERNAH jadi sumber nilai kalkulasi. */
export function buildConversationEntry(
  caseId: string,
  kind: 'decision' | 'correction' | 'pending-question' | 'approved-action' | 'note',
  text: string,
): ContextEntry {
  const ts = nowIso();
  return {
    id: mkId(caseId, `conv:${ts}`),
    caseId,
    entryKey: `conv:${Date.now().toString(36)}_${(idCounter++).toString(36)}`,
    category: 'conversation',
    source: 'conversation',
    data: { kind, text: String(text).slice(0, 500) },
    summary: `Percakapan (${kind}): ${String(text).slice(0, 120)}`,
    status: 'CURRENT',
    version: 1,
    createdAt: ts,
    updatedAt: ts,
    dependencies: [],
  };
}

// ============================================================================
// Invalidation (bab 6) — graph aktual, hanya turunan yang benar-benar terkait
// ============================================================================

/**
 * Tandai dependen tertransitif sebagai STALE (bila entry ada & CURRENT/
 * NEEDS_REVIEW). Slot yang berubah TIDAK ditandai — versi barunya memang baru
 * dihitung (CURRENT); yang STALE adalah hasil turunannya via graph.
 * Hasil lama tidak dihapus — histori dipertahankan. Entry yang tidak
 * terhubung di graph TIDAK disentuh.
 */
export function invalidateDependents(
  entries: ContextEntry[],
  changedEntryKeys: string[],
): ContextEntry[] {
  const edges = buildChildEdges();
  const staleKeys = new Set<string>();
  const queue = [...changedEntryKeys];
  const seen = new Set<string>();
  while (queue.length) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const child of edges.get(key) ?? []) {
      if (!staleKeys.has(child) && !changedEntryKeys.includes(child)) {
        staleKeys.add(child);
        queue.push(child);
      }
    }
  }

  return entries.map((e) => {
    if (e.status === 'ARCHIVED' || e.status === 'INVALID') return e;
    if (staleKeys.has(e.entryKey)) {
      // Percakapan tidak ikut STALE — hanya data kalkulasi/peta/dokumen.
      if (e.category === 'conversation') return e;
      if (e.status === 'CURRENT') {
        return { ...e, status: (e.category === 'operational' ? 'NEEDS_REVIEW' : 'STALE') as ContextStatus, updatedAt: nowIso() };
      }
    }
    return e;
  });
}

/** Hitung ulang satu slot: versi baru + status CURRENT (setelah persetujuan). */
export function recomputeEntry(slotKey: string, caseId: string, data: Record<string, unknown>, prevEntries: ContextEntry[]): ContextEntry {
  const slot = SLOT_BY_KEY.get(slotKey);
  if (!slot) throw new Error(`Slot tidak dikenal: ${slotKey}`);
  return buildSlotEntry(slot, caseId, data, prevEntries.filter((e) => e.entryKey === slotKey).sort((a, b) => b.version - a.version)[0]);
}

// ============================================================================
// Selective retrieval (bab 5) — jangan kirim seluruh DB ke model
// ============================================================================

export interface RetrievalResult {
  block: string;                       // teks ringkas untuk system prompt AI
  used: ContextEntry[];
  staleWarnings: string[];
}

/**
 * Retrieval selektif: prioritas entry terstruktur CURRENT (kalkulasi/peta/
 * dokumen) > scenario > percakapan terbatas; STALE hanya sebagai peringatan.
 * Isolasi workspace: hanya entry dengan caseId yang cocok.
 */
export function selectiveWorkspaceContext(
  entries: ContextEntry[],
  caseId: string,
  opts: { maxChars?: number; conversationLimit?: number } = {},
): RetrievalResult {
  const maxChars = opts.maxChars ?? 4000;
  const convLimit = opts.conversationLimit ?? 3;
  const mine = entries.filter((e) => e.caseId === caseId);

  const latestByKey = new Map<string, ContextEntry>();
  for (const e of mine) {
    const cur = latestByKey.get(e.entryKey);
    if (!cur || e.version > cur.version) latestByKey.set(e.entryKey, e);
  }
  const latest = [...latestByKey.values()];

  const fresh = latest.filter((e) => e.status === 'CURRENT' && e.category !== 'conversation');
  const stale = latest.filter((e) => e.status === 'STALE' || e.status === 'NEEDS_REVIEW');
  const pending = latest.filter((e) => e.status === 'PENDING');
  const convs = latest
    .filter((e) => e.category === 'conversation')
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, convLimit);

  const used: ContextEntry[] = [];
  const staleWarnings: string[] = [];
  const lines: string[] = [];

  const pushEntry = (e: ContextEntry, prefix = '') => {
    const src = `${e.capabilityId ?? e.source} v${e.version}`;
    const line = `${prefix}[${e.entryKey}] (${src}) ${e.summary}`;
    if (lines.join('\n').length + line.length > maxChars) return false;
    lines.push(line);
    used.push(e);
    return true;
  };

  const scenario = fresh.find((e) => e.category === 'scenario');
  if (scenario) pushEntry(scenario, 'SCENARIO: ');
  for (const e of fresh.filter((x) => x.category === 'calculation')) {
    if (!pushEntry(e, 'KALKULASI: ')) break;
  }
  for (const e of fresh.filter((x) => x.category === 'map')) {
    if (!pushEntry(e, 'PETA: ')) break;
  }
  for (const e of fresh.filter((x) => x.category === 'operational')) {
    if (!pushEntry(e, 'DOKUMEN: ')) break;
  }
  for (const c of convs) {
    if (!pushEntry(c, 'KONTEKS PERCAKAPAN: ')) break;
  }
  for (const e of stale) {
    const w = `⚠ ${e.entryKey} berstatus ${e.status} — JANGAN pakai sebagai hasil terbaru; minta pengguna menghitung ulang.`;
    staleWarnings.push(w);
    if (lines.join('\n').length + w.length <= maxChars) lines.push(w);
  }
  for (const e of pending.slice(0, 5)) {
    const w = `◻ ${e.entryKey}: data belum lengkap (PENDING).`;
    if (lines.join('\n').length + w.length <= maxChars) lines.push(w);
  }

  const header = `=== KONTEKS WORKSPACE SAR (caseId: ${caseId}) — hanya data workspace aktif ===`;
  return { block: [header, ...lines].join('\n'), used, staleWarnings };
}

// ============================================================================
// Lookup hasil (bab 7) — AI tidak mengarang data yang tidak ada
// ============================================================================

const QUERY_SLOT_HINTS: Array<{ slotKey: string; patterns: RegExp }> = [
  { slotKey: 'calc:intercept', patterns: /intercept|intersep|pintasan/i },
  { slotKey: 'calc:transit-go', patterns: /transit (go|ke|menuju|pergi)|waktu (berangkat|menuju datum)/i },
  { slotKey: 'calc:transit-back', patterns: /transit (back|balik|kembali)/i },
  { slotKey: 'calc:pattern', patterns: /pola|pattern|track ?spacing|csp/i },
  { slotKey: 'calc:assets', patterns: /aset|sru|alokasi|asset/i },
  { slotKey: 'calc:datum', patterns: /datum|total drift|ws ?1/i },
  { slotKey: 'calc:awa', patterns: /\bawa\b|angin (atas|ketinggian)/i },
  { slotKey: 'calc:asw', patterns: /\basw\b|drift permukaan|mobo/i },
  { slotKey: 'calc:aero', patterns: /\badw\b|aero|drift (udara|pesawat)|glide/i },
  { slotKey: 'calc:search-area', patterns: /search area|area pencarian/i },
  { slotKey: 'calc:search', patterns: /search plan|rencana pencarian|sweep|trapesium/i },
  { slotKey: 'calc:ws4', patterns: /ws ?4|radius (pencarian )?darat/i },
  { slotKey: 'map:lkp', patterns: /koordinat|lkp|posisi (insiden|awal)/i },
  { slotKey: 'map:features', patterns: /fitur peta|marker|poligon|lingkaran di peta/i },
  { slotKey: 'doc:renops', patterns: /renops|rencana operasi/i },
  { slotKey: 'doc:briefing', patterns: /briefing/i },
  { slotKey: 'doc:debriefing', patterns: /de-?briefing/i },
];

export interface WorkspaceLookup {
  found: boolean;
  available: boolean;                  // false → AI harus bilang "belum tersedia"
  message: string;
  matches: ContextEntry[];             // >1 → AI tanyakan mana yang dimaksud
}

/** Cari hasil di workspace aktif; TIDAK PERNAH mengarang. */
export function lookupWorkspaceResult(entries: ContextEntry[], caseId: string, query: string): WorkspaceLookup {
  const mine = entries.filter((e) => e.caseId === caseId);
  const latestByKey = new Map<string, ContextEntry>();
  for (const e of mine) {
    const cur = latestByKey.get(e.entryKey);
    if (!cur || e.version > cur.version) latestByKey.set(e.entryKey, e);
  }

  const hintKeys = QUERY_SLOT_HINTS.filter((h) => h.patterns.test(query)).map((h) => h.slotKey);
  // Tanpa hint yang cocok → jujur: tidak ada kandidat (JANGAN menebak/fallback luas).
  const candidates = hintKeys.length
    ? hintKeys.map((k) => latestByKey.get(k)).filter((e): e is ContextEntry => !!e)
    : [];

  if (candidates.length === 0) {
    return {
      found: false,
      available: false,
      message: `Tidak ada data di workspace untuk "${query}". Hasil belum pernah dihitung — jangan menyajikan angka dari ingatan.`,
      matches: [],
    };
  }

  const current = candidates.filter((e) => e.status === 'CURRENT');
  if (current.length === 0) {
    const st = candidates[0].status;
    return {
      found: true,
      available: false,
      message: `Data ditemukan (${candidates.map((c) => c.entryKey).join(', ')}) tetapi berstatus ${st} — tidak boleh dipakai sebagai hasil terbaru. Hitung ulang terlebih dahulu.`,
      matches: candidates,
    };
  }
  if (current.length > 1) {
    return {
      found: true,
      available: true,
      message: `Beberapa hasil cocok: ${current.map((c) => c.entryKey).join(', ')}. Konfirmasi kepada pengguna mana yang dimaksud.`,
      matches: current,
    };
  }
  const e = current[0];
  return {
    found: true,
    available: true,
    message: `Ditemukan: [${e.entryKey}] v${e.version} (${e.capabilityId}, status CURRENT, diupdate ${e.updatedAt}).`,
    matches: [e],
  };
}

// ============================================================================
// Orchestration (bab 8) — daftar tahap berikutnya dari dependency graph
// ============================================================================

/**
 * Urutan tahapan alur SAR — dependsOn DIAMBIL dari metadata `dependencies`
 * registry (diterjemahkan capability→slot), BUKAN tebakan:
 *   env-awa:[] env-asw:[] env-adw:[env-awa] ws1-datum:[env-asw]
 *   ws1-search-area:[ws1-datum] ws-search-plan:[ws1-datum]
 *   ws2/ws8:[ws1-search-area, env-asw] ws3:[ws-search-plan, ws1-search-area]
 *   ws4-land-radius:[] pattern:[ws1-search-area, ws2, ws3, ws8]
 *   asset:[pattern, ws1-search-area] transit-go/back:[asset] intercept:[]
 *   doc-renops:[doc-bank-data, ws1-datum, ws1-search-area, pattern, asset]
 *   doc-briefing:[doc-bank-data, asset] doc-debriefing:[doc-bank-data]
 *   map-ws4-plot:[ws4-land-radius] map-ups-plot:[env-adw, ws1-datum]
 */
export const WORKFLOW_STAGES: Array<{ stage: string; slotKey: string; dependsOn: string[] }> = [
  { stage: 'Lingkungan angin (AWA)', slotKey: 'calc:awa', dependsOn: [] },
  { stage: 'Drift udara (ADW)', slotKey: 'calc:aero', dependsOn: ['calc:awa'] },
  { stage: 'Drift permukaan (ASW)', slotKey: 'calc:asw', dependsOn: [] },
  { stage: 'Datum & total drift (WS1)', slotKey: 'calc:datum', dependsOn: ['calc:asw'] },
  { stage: 'Search area (WS1)', slotKey: 'calc:search-area', dependsOn: ['calc:datum'] },
  { stage: 'Search plan (WS1)', slotKey: 'calc:search', dependsOn: ['calc:datum'] },
  { stage: 'WSC maritime (WS2)', slotKey: 'calc:ws2', dependsOn: ['calc:search-area', 'calc:asw'] },
  { stage: 'WSC darat (WS3)', slotKey: 'calc:ws3', dependsOn: ['calc:search', 'calc:search-area'] },
  { stage: 'WSC vessel (WS8)', slotKey: 'calc:ws8', dependsOn: ['calc:search-area', 'calc:asw'] },
  { stage: 'Radius pencarian darat (WS4)', slotKey: 'calc:ws4', dependsOn: [] },
  { stage: 'Search pattern', slotKey: 'calc:pattern', dependsOn: ['calc:search-area', 'calc:ws2', 'calc:ws3', 'calc:ws8'] },
  { stage: 'Alokasi aset', slotKey: 'calc:assets', dependsOn: ['calc:pattern', 'calc:search-area'] },
  { stage: 'Transit Go', slotKey: 'calc:transit-go', dependsOn: ['calc:assets'] },
  { stage: 'Transit Back', slotKey: 'calc:transit-back', dependsOn: ['calc:assets'] },
  { stage: 'Intercept', slotKey: 'calc:intercept', dependsOn: [] },
  { stage: 'Peta Laut — LKP', slotKey: 'map:lkp', dependsOn: [] },
  { stage: 'Peta ONC — plotting WS4', slotKey: 'map:onc-ws4', dependsOn: ['calc:ws4'] },
  { stage: 'UPS Plotter — sheet VP-OS', slotKey: 'map:ups', dependsOn: ['calc:aero', 'calc:datum'] },
  { stage: 'Rencana Operasi SAR', slotKey: 'doc:renops', dependsOn: ['scenario:info', 'calc:datum', 'calc:search-area', 'calc:pattern', 'calc:assets'] },
  { stage: 'Briefing', slotKey: 'doc:briefing', dependsOn: ['scenario:info', 'calc:assets'] },
  { stage: 'De-Briefing', slotKey: 'doc:debriefing', dependsOn: ['scenario:info'] },
];

export interface WorkflowStep {
  stage: string;
  slotKey: string;
  state: 'DONE' | 'READY' | 'STALE_INPUT' | 'BLOCKED' | 'PENDING_DATA';
  detail: string;
  missing: string[];
}

/**
 * Susun tahapan berikutnya berdasarkan state workspace (graph aktual).
 * BLOCKED menyebut data yang belum tersedia — AI menanyakan, bukan mengarang.
 */
export function nextWorkflowSteps(entries: ContextEntry[], caseId: string): WorkflowStep[] {
  const mine = entries.filter((e) => e.caseId === caseId);
  const latestByKey = new Map<string, ContextEntry>();
  for (const e of mine) {
    const cur = latestByKey.get(e.entryKey);
    if (!cur || e.version > cur.version) latestByKey.set(e.entryKey, e);
  }

  const label = (k: string) => SLOT_BY_KEY.get(k)?.label ?? k;
  return WORKFLOW_STAGES.map(({ stage, slotKey, dependsOn }) => {
    const entry = latestByKey.get(slotKey);
    if (entry?.status === 'CURRENT') {
      return { stage, slotKey, state: 'DONE' as const, detail: `${stage} — selesai (v${entry.version}).`, missing: [] };
    }
    const staleDeps = dependsOn.filter((d) => ['STALE', 'NEEDS_REVIEW'].includes(latestByKey.get(d)?.status ?? ''));
    const missingDeps = dependsOn.filter((d) => !latestByKey.has(d) || latestByKey.get(d)!.status === 'PENDING');
    if (staleDeps.length) {
      return {
        stage, slotKey, state: 'STALE_INPUT' as const,
        detail: `${stage} — input berubah (${staleDeps.map(label).join(', ')}); hitung ulang input sebelum lanjut.`,
        missing: staleDeps,
      };
    }
    if (missingDeps.length) {
      return {
        stage, slotKey, state: 'BLOCKED' as const,
        detail: `${stage} — menunggu ${missingDeps.map(label).join(', ')}.`,
        missing: missingDeps,
      };
    }
    if (entry?.status === 'PENDING') {
      return { stage, slotKey, state: 'PENDING_DATA' as const, detail: `${stage} — data belum lengkap; lengkapi input.`, missing: [] };
    }
    return { stage, slotKey, state: 'READY' as const, detail: `${stage} — siap dikerjakan (semua dependency terpenuhi).`, missing: [] };
  });
}

/** Ringkasan orchestration untuk prompt AI (teks pendek). */
export function workflowPlanText(entries: ContextEntry[], caseId: string): string {
  const steps = nextWorkflowSteps(entries, caseId);
  const lines = steps.map((s) => `- [${s.state}] ${s.detail}`);
  return ['=== RENCANA TAHAPAN WORKSPACE (graph dependency aktual) ===', ...lines].join('\n');
}

// ============================================================================
// Serialisasi DB (Prisma WorkspaceContext row ↔ ContextEntry)
// ============================================================================

export interface WorkspaceContextRowLike {
  id: string;
  caseId: string;
  entryKey: string;
  category: string;
  capabilityId: string | null;
  calculationId: string | null;
  source: string;
  data: string;
  status: string;
  version: number;
  inputsHash: string | null;
  dependencies: string;
  supersededBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  summary?: string | null;
}

export function entryToRow(e: ContextEntry): Omit<WorkspaceContextRowLike, 'createdAt' | 'updatedAt'> {
  return {
    id: e.id,
    caseId: e.caseId,
    entryKey: e.entryKey,
    category: e.category,
    capabilityId: e.capabilityId ?? null,
    calculationId: e.calculationId ?? null,
    source: e.source,
    data: JSON.stringify(e.data),
    status: e.status,
    version: e.version,
    inputsHash: e.inputsHash ?? null,
    dependencies: JSON.stringify(e.dependencies),
    supersededBy: e.supersededBy ?? null,
    summary: e.summary,
  };
}

export function rowToEntry(row: WorkspaceContextRowLike): ContextEntry {
  return {
    id: row.id,
    caseId: row.caseId,
    entryKey: row.entryKey,
    category: row.category as ContextCategory,
    capabilityId: row.capabilityId ?? undefined,
    calculationId: row.calculationId ?? undefined,
    source: row.source as ContextEntry['source'],
    data: JSON.parse(row.data) as Record<string, unknown>,
    summary: row.summary ?? `${row.entryKey}`,
    status: row.status as ContextStatus,
    version: row.version,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : row.updatedAt.toISOString(),
    inputsHash: row.inputsHash ?? undefined,
    dependencies: JSON.parse(row.dependencies || '[]') as string[],
    supersededBy: row.supersededBy ?? undefined,
  };
}
