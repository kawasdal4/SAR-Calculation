/**
 * Rantai worksheet soal kasus — helper murni (tanpa dependensi server) untuk
 * jaring pengaman kedua di /api/chat. Forced retry menangani kasus NOL
 * panggilan worksheet; helper ini menangani kasus PARSIAL: model berhenti
 * setelah satu/dua tool padahal bagian "WORKSHEET YANG HARUS DIPAKAI" pada
 * jawabannya sendiri mendaftar lebih banyak worksheet (kasus EXE FAKFAK 2026:
 * 6 worksheet dianalisis, hanya AWA yang diterapkan).
 */

export const WORKSHEET_CHAIN_ORDER = [
  'set_asw_case',
  'set_awa_case',
  'set_aero_drift_case',
  'set_datum_case',
  'set_ws2_case',
  'set_ws3_case',
  'set_ws4_case',
  'set_ws8_case',
  'set_search_pattern_case',
  'set_intercept_case',
] as const;

export type WorksheetToolName = (typeof WORKSHEET_CHAIN_ORDER)[number];

/**
 * Pemetaan butir daftar "WORKSHEET YANG HARUS DIPAKAI" → nama tool.
 * set_lkp sengaja TIDAK dipetakan: pada kasus ADW, LKP otomatis dari posisi
 * ditching (lkpSource "adw-landing"); pada kasus maritim biasa koordinat LKP
 * dikirim langsung lewat set_datum_case, jadi set_lkp selalu opsional.
 */
const ITEM_TOOL_MATCHERS: Array<{ re: RegExp; tool: WorksheetToolName }> = [
  { re: /\bAWA\b|AVERAGE\s+WIND\s+ALOFT/i, tool: 'set_awa_case' },
  { re: /\bADW\b|AERO(?:NAUTICAL)?\s+DRIFT/i, tool: 'set_aero_drift_case' },
  { re: /\bASW\b|AVERAGE\s+SURFACE\s+WIND/i, tool: 'set_asw_case' },
  { re: /\bDATUM\b|WS\s*1\b|WORKSHEET\s*1\b/i, tool: 'set_datum_case' },
  { re: /WS\s*2\b|WORKSHEET\s*2\b|MARITIME\s+SEARCH\s+PLANNING/i, tool: 'set_ws2_case' },
  { re: /WS\s*3\b|WORKSHEET\s*3\b/i, tool: 'set_ws3_case' },
  { re: /WS\s*4\b|WORKSHEET\s*4\b/i, tool: 'set_ws4_case' },
  { re: /WS\s*8\b|WORKSHEET\s*8\b|SEARCH\s+FACILITY/i, tool: 'set_ws8_case' },
  { re: /POLA\s+PENCARIAN|SEARCH\s+PATTERN/i, tool: 'set_search_pattern_case' },
  { re: /\bINTERCEPT\b|INTERSEP|PINTASAN/i, tool: 'set_intercept_case' },
];

/**
 * Parse bagian "WORKSHEET YANG HARUS DIPAKAI" dari jawaban model (format wajib
 * di system prompt: daftar bernomor, tiap butir menyebut nama worksheet, dengan
 * sub-butir bullet keterangan). Hanya butir bernomor yang dipetakan; sub-butir
 * dan teks prosa diabaikan. Urutan hasil mengikuti rantai hulu → hilir.
 */
export function parseDeclaredWorksheetTools(answerText: string): WorksheetToolName[] {
  if (!answerText) return [];
  const lines = answerText.split(/\r?\n/);
  const headerIdx = lines.findIndex((line) => /WORKSHEET\s+YANG\s+HARUS\s+DIPAKAI/i.test(line));
  if (headerIdx < 0) return [];
  const declared = new Set<WorksheetToolName>();
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (/^\d{1,2}[.)]\s+/.test(trimmed)) {
      for (const matcher of ITEM_TOOL_MATCHERS) {
        if (matcher.re.test(trimmed)) declared.add(matcher.tool);
      }
      continue;
    }
    // Sub-butir bullet keterangan tiap worksheet (boleh menyebut nama worksheet
    // lain — jangan ikut dipetakan). Prosa baru setelah daftar = selesai.
    if (/^[-*•]/.test(trimmed)) continue;
    break;
  }
  return WORKSHEET_CHAIN_ORDER.filter((tool) => declared.has(tool));
}

/**
 * Petakan teks bebas (mis. argumen worksheet pada ask_for_case_data: "WS 2",
 * "worksheet ASW", "Datum") ke daftar tool worksheet yang disebut. Berbeda
 * dengan parseDeclaredWorksheetTools yang mensyaratkan struktur daftar
 * bernomor di bawah header "WORKSHEET YANG HARUS DIPAKAI" — model cadangan
 * kerap menjawab tanpa teks sama sekali, sehingga jaring pengaman parsial
 * perlu di-seed dari argumen tool klarifikasi.
 */
export function matchWorksheetToolNames(text: string): WorksheetToolName[] {
  if (!text) return [];
  const matched = new Set<WorksheetToolName>();
  for (const matcher of ITEM_TOOL_MATCHERS) {
    if (matcher.re.test(text)) matched.add(matcher.tool);
  }
  return WORKSHEET_CHAIN_ORDER.filter((tool) => matched.has(tool));
}

/**
 * Worksheet yang DINYATAKAN model tetapi tool-nya BELUM dipanggil, urut sesuai
 * rantai hulu → hilir.
 */
export function computeMissingWorksheetTools(
  declaredTools: ReadonlyArray<WorksheetToolName>,
  emittedToolNames: ReadonlyArray<string>,
): WorksheetToolName[] {
  const emitted = new Set(emittedToolNames);
  return WORKSHEET_CHAIN_ORDER.filter(
    (tool) => declaredTools.includes(tool) && !emitted.has(tool),
  );
}

/**
 * Instruksi pass penyambung: menamai tool yang hilang secara eksplisit,
 * mengulang default pilihan planner, dan menjaga rantai ADW → Datum
 * (lkpSource "adw-landing") agar kasus ditching tidak berhenti di AWA.
 */
export function buildChainCompletionInstruction(
  missingTools: ReadonlyArray<WorksheetToolName>,
  appliedNames: ReadonlyArray<string>,
): string {
  const appliedText = appliedNames.length > 0
    ? `kamu sudah memanggil ${appliedNames.join(', ')}`
    : 'belum ada tool worksheet yang dipanggil';
  return `LENGKAPI WORKSHEET KASUS: pada respons sebelumnya ${appliedText}, dan analisismu sendiri mendaftar worksheet berikut sebagai bagian kasus tetapi tool-nya BELUM dipanggil: ${missingTools.join(', ')}. Panggil SEMUA tool yang hilang itu SEKARANG pada respons ini dengan data dari soal — SEMUA, bukan hanya satu, dalam urutan rantai hulu→hilir, dan JANGAN menutup respons sebelum semuanya dipanggil. JANGAN menulis ulang analisis atau ringkasan — respons ini boleh berisi panggilan tool saja. Default pilihan planner tanpa bertanya: intervalMode ASW dari jam observasi (hanya 00/06/12/18 → "6h"; ada 03/09/15/21 → "3h"), WS2 selectedHeight 1000 ft bila soal tidak menyebut, WS8 eyeHeight "14" untuk kapal patroli/rescue vessel, "8" untuk perahu kecil/RIB, "MERSHIP" untuk kapal besar, searchNumber 1, dan kasus ditching di laut memakai Altmin = 0 ft (permukaan laut). Rantai hulu→hilir: bila menghitung ADW maka set_datum_case WAJIB menyusul dengan lkpSource "adw-landing" TANPA koordinat lkp/latitude — aplikasi otomatis memakai posisi ditching hasil ADW sebagai LKP; konversi haluan turun Magnetic → True (Variation EAST ditambah, WEST dikurangi) sebelum mengirim aircraftDescentHeadingDeg; angin AWA diambil otomatis dari worksheet AWA — jangan mengarang angka angin. HANYA bila FAKTA soal yang wajib untuk sebuah tool benar-benar tidak ada di soal, biarkan tool itu dan panggil ask_for_case_data untuk fakta tersebut — tetapi tetap panggil semua tool lain yang datanya lengkap. JANGAN memanggil ulang tool yang sudah dipanggil pada respons sebelumnya.`;
}
