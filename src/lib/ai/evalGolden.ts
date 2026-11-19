/**
 * EVAL GOLDEN SET (Fase 6 AI Copilot) — comparator akurasi per field antara
 * kasus hasil ekstraksi (parse_case) dan fixture golden terverifikasi.
 *
 * DESAIN:
 * - PURE (tanpa DOM/network) — dipakai `scripts/evalParseCase.ts` (bun run
 *   eval:ai) dan diuji offline di tests/evalGolden.test.ts.
 * - flatten pohon kasus → path → nilai leaf; array kunci khusus:
 *   windLayers (altitudeFt), surfaceWindSeries (obsTime), sru (callsign) —
 *   urutan tidak menaikan penalty; tasksRequested dibandingkan sebagai SET.
 * - Normalisasi string: trim, collapse spasi, unicode prime (′″) → ASCII,
 *   lowercase — variasi DMS/quote model vs golden tetap cocok.
 * - Angka: toleransi absolut (default 1e-6) untuk round-off geodesi.
 * - Status row: MATCH / MISMATCH / MISSING (di golden, hilang di hasil) /
 *   EXTRA (dihasilkan model tapi tidak di golden — tidak menurunkan akurasi,
 *   dilaporkan terpisah sebagai sinyal over-extraction).
 * - meta proses (assumptions/missingFields/fieldSources/extractedAt/approval/
 *   seed/modelVersion) DIKECUALIKAN — bukan data soal; meta.source dihitung.
 */

export type GoldenEvalRowStatus = 'MATCH' | 'MISMATCH' | 'MISSING' | 'EXTRA';

export interface GoldenEvalRow {
  path: string;
  section: string;
  status: GoldenEvalRowStatus;
  expected?: string;
  actual?: string;
}

export interface GoldenEvalSection {
  section: string;
  total: number;
  matched: number;
  accuracyPct: number;
}

export interface GoldenEvalSummary {
  total: number;
  matched: number;
  mismatch: number;
  missing: number;
  extra: number;
  accuracyPct: number;
}

export interface GoldenEvalReport {
  rows: GoldenEvalRow[];
  sections: GoldenEvalSection[];
  summary: GoldenEvalSummary;
}

export interface GoldenEvalOptions {
  /** Toleransi absolut angka (default 1e-6). */
  numericTolerance?: number;
  /** Path tambahan yang dikecualikan (ditambah default meta proses). */
  excludePaths?: string[];
}

const DEFAULT_EXCLUDE = [
  'meta.assumptions',
  'meta.missingFields',
  'meta.fieldSources',
  'meta.extractedAt',
  'meta.modelVersion',
  'meta.seed',
  'meta.approval',
];

const KEYED_ARRAYS: Record<string, string> = {
  'aeroDrift.windLayers': 'altitudeFt',
  'sea.surfaceWindSeries': 'obsTime',
  'sru': 'callsign',
};

const SECTION_ORDER = [
  'caseTitle',
  'examHeader',
  'incident',
  'target',
  'sarOffice',
  'lkp',
  'aeroDrift.windLayers',
  'aeroDrift',
  'sea.surfaceWindSeries',
  'sea',
  'search',
  'sru',
  'tasksRequested',
  'meta',
  'other',
] as const;

/** Path array berindeks (bukan keyed) di bawah prefix tertentu. */
function arrayKeyFor(path: string): string | undefined {
  for (const [prefix, key] of Object.entries(KEYED_ARRAYS)) {
    if (path === prefix || path.startsWith(`${prefix}.`)) return key;
  }
  return undefined;
}

function sectionFor(path: string): string {
  for (const section of SECTION_ORDER) {
    if (section === 'other') continue;
    if (path === section || path.startsWith(`${section}.`)) return section;
  }
  return 'other';
}

function normalizeString(value: string): string {
  return value
    .replace(/[\u2032\u2019']/g, "'")
    .replace(/[\u2033\u201D"]/g, '"')
    .replace(/[\u00B0]/g, '°')
    .trim()
    .replace(/\s+/g, '') // spasi dihapus — variasi DMS/kutip model vs golden tetap cocok
    .toLowerCase();
}

function valuesEqual(a: unknown, b: unknown, tolerance: number): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= tolerance;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  return normalizeString(String(a)) === normalizeString(String(b));
}

function render(value: unknown): string {
  if (value === undefined) return '(tidak ada)';
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

type LeafMap = Map<string, unknown>;

function flatten(value: unknown, prefix: string, out: LeafMap): void {
  if (value === null || value === undefined || typeof value !== 'object') {
    if (prefix) out.set(prefix, value);
    return;
  }
  if (Array.isArray(value)) {
    if (prefix === 'tasksRequested') {
      out.set(prefix, value); // SET — dibandingkan utuh (urutan bebas)
      return;
    }
    const keyField = arrayKeyFor(prefix);
    if (keyField) {
      value.forEach((item, index) => {
        if (item && typeof item === 'object') {
          const keyValue = (item as Record<string, unknown>)[keyField];
          const label = keyValue !== undefined && keyValue !== null ? String(keyValue) : `#${index}`;
          flatten(item, `${prefix}[${normalizeString(label)}]`, out);
        } else {
          flatten(item, `${prefix}[${index}]`, out);
        }
      });
      return;
    }
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
}

function setEquals(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const normA = a.map((item) => normalizeString(String(item))).sort();
  const normB = b.map((item) => normalizeString(String(item))).sort();
  return normA.every((item, index) => item === normB[index]);
}

/** Exclude berlaku prefix: 'meta.assumptions' juga menonaktifkan
 *  'meta.assumptions[0].field'. */
function isExcluded(path: string, exclude: Set<string>): boolean {
  if (exclude.has(path)) return true;
  for (const prefix of exclude) {
    if (path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)) return true;
  }
  return false;
}

/** Bandingkan kasus hasil ekstraksi vs golden — laporan akurasi per bagian. */
export function compareGoldenCases(
  expected: unknown,
  actual: unknown,
  options: GoldenEvalOptions = {},
): GoldenEvalReport {
  const tolerance = options.numericTolerance ?? 1e-6;
  const exclude = new Set([...DEFAULT_EXCLUDE, ...(options.excludePaths ?? [])]);

  const expectedMap: LeafMap = new Map();
  const actualMap: LeafMap = new Map();
  flatten(expected, '', expectedMap);
  flatten(actual, '', actualMap);

  const rows: GoldenEvalRow[] = [];
  const allPaths = new Set<string>([...expectedMap.keys(), ...actualMap.keys()]);

  for (const path of allPaths) {
    if (isExcluded(path, exclude)) continue;
    const section = sectionFor(path);
    const inExpected = expectedMap.has(path);
    const inActual = actualMap.has(path);

    if (inExpected && !inActual) {
      rows.push({ path, section, status: 'MISSING', expected: render(expectedMap.get(path)) });
      continue;
    }
    if (!inExpected && inActual) {
      rows.push({ path, section, status: 'EXTRA', actual: render(actualMap.get(path)) });
      continue;
    }

    const expectedValue = expectedMap.get(path);
    const actualValue = actualMap.get(path);
    if (path === 'tasksRequested' && Array.isArray(expectedValue) && Array.isArray(actualValue)) {
      const equal = setEquals(expectedValue, actualValue);
      rows.push({
        path, section,
        status: equal ? 'MATCH' : 'MISMATCH',
        expected: `[${expectedValue.length} tugas]`,
        actual: `[${actualValue.length} tugas]`,
      });
      continue;
    }
    const equal = valuesEqual(expectedValue, actualValue, tolerance);
    rows.push({
      path, section,
      status: equal ? 'MATCH' : 'MISMATCH',
      expected: render(expectedValue),
      actual: render(actualValue),
    });
  }

  rows.sort((a, b) => {
    const sa = SECTION_ORDER.indexOf(a.section as typeof SECTION_ORDER[number]);
    const sb = SECTION_ORDER.indexOf(b.section as typeof SECTION_ORDER[number]);
    if (sa !== sb) return sa - sb;
    return a.path.localeCompare(b.path, 'id-ID');
  });

  const sections: GoldenEvalSection[] = [];
  for (const section of SECTION_ORDER) {
    const sectionRows = rows.filter((row) => row.section === section);
    const scored = sectionRows.filter((row) => row.status !== 'EXTRA');
    if (sectionRows.length === 0) continue;
    const matched = scored.filter((row) => row.status === 'MATCH').length;
    sections.push({
      section,
      total: scored.length,
      matched,
      accuracyPct: scored.length > 0 ? Math.round((matched / scored.length) * 1000) / 10 : 100,
    });
  }

  const scored = rows.filter((row) => row.status !== 'EXTRA');
  const matched = scored.filter((row) => row.status === 'MATCH').length;
  const summary: GoldenEvalSummary = {
    total: scored.length,
    matched,
    mismatch: scored.filter((row) => row.status === 'MISMATCH').length,
    missing: scored.filter((row) => row.status === 'MISSING').length,
    extra: rows.filter((row) => row.status === 'EXTRA').length,
    accuracyPct: scored.length > 0 ? Math.round((matched / scored.length) * 1000) / 10 : 100,
  };

  return { rows, sections, summary };
}

/** Format laporan plain-text (console) — Bahasa Indonesia, kolom rapi. */
export function formatGoldenEvalReport(report: GoldenEvalReport, maxRows = 40): string {
  const lines: string[] = [];
  lines.push('═══ EVAL GOLDEN SET — akurasi per bagian ═══');
  for (const section of report.sections) {
    const pct = section.accuracyPct.toFixed(1).padStart(6);
    lines.push(`${section.section.padEnd(24)} ${pct}%  (${section.matched}/${section.total})`);
  }
  const s = report.summary;
  lines.push('─'.repeat(48));
  lines.push(`TOTAL: ${s.accuracyPct.toFixed(1)}%  (${s.matched}/${s.total})`);
  lines.push(`  cocok ${s.matched} · beda ${s.mismatch} · hilang ${s.missing} · extra ${s.extra}`);

  const problems = report.rows.filter((row) => row.status !== 'MATCH');
  if (problems.length > 0) {
    lines.push('');
    lines.push(`── Detail ${Math.min(problems.length, maxRows)} dari ${problems.length} baris bermasalah ──`);
    for (const row of problems.slice(0, maxRows)) {
      if (row.status === 'EXTRA') {
        lines.push(`[EXTRA]    ${row.path} = ${row.actual}`);
      } else {
        lines.push(`[${row.status.padEnd(8)}] ${row.path}`);
        lines.push(`           golden : ${row.expected}`);
        lines.push(`           hasil  : ${row.actual}`);
      }
    }
  }
  return lines.join('\n');
}
