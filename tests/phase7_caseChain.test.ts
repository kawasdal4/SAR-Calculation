/**
 * PHASE 7 — Jaring pengaman rantai worksheet kasus (caseChain.ts).
 * Kasus lapiran: soal EXE FAKFAK 2026 — model menganalisis 6 worksheet
 * (AWA, ADW, ASW, WS1, WS2, WS8) tetapi hanya set_awa_case yang dipanggil;
 * lima lainnya tidak pernah diterapkan tanpa jejak apa pun.
 * Jalankan: bun test tests/phase7_caseChain.test.ts
 */
import { test, expect } from 'bun:test';
import {
  parseDeclaredWorksheetTools,
  computeMissingWorksheetTools,
  buildChainCompletionInstruction,
} from '../src/lib/sar/caseChain';

// ---------------------------------------------------------------------------
// parseDeclaredWorksheetTools — daftar "WORKSHEET YANG HARUS DIPAKAI"
// ---------------------------------------------------------------------------

// Teks persis seperti jawaban model pada kasus EXE FAKFAK 2026 (disarikan,
// struktur bernomor + sub-butir bullet dipertahankan).
const FAKFAK_ANSWER = `**WORKSHEET YANG HARUS DIPAKAI**

1. **AWA (Average Wind Aloft)**
   * **Kegunaan:** Menghitung rata-rata angin atas dari ketinggian maksimum FL120 hingga permukaan untuk segmen penerbangan pesawat PK-XYZ sebelum ditching.
   * **Data yang tersedia:** Tabel angin atas (Surface s.d. 24.000 ft), distress altitude FL120 (12.000 ft).
   * **Data kurang:** Nihil.

2. **ADW (Aeronautical Drift Worksheet)**
   * **Kegunaan:** Menghitung titik ditching/landing pesawat (LKP drift).
   * **Data yang tersedia:** Koordinat Lost Contact 04°03'00"S – 132°03'00"E, waktu insiden 17 Nov 2026 07.00 UTC (15.56 WIT).
   * **Data kurang:** Nihil.

3. **ASW (Average Surface Wind)**
   * **Kegunaan:** Menghitung rata-rata angin permukaan dari waktu ditching hingga waktu pencarian berikutnya.
   * **Data yang tersedia:** Data observasi angin permukaan per 6 jam (0000Z, 0600Z, 1200Z, 1800Z) tanggal 17–18 November 2026.
   * **Data kurang:** Nihil (intervalMode disimpulkan 6h dari data observasi).

4. **Datum Worksheet (WS 1)**
   * **Kegunaan:** Menghitung posisi datum, total error of position (R), dan luas area pencarian maritim setelah liferaft mengalami drift.
   * **Data yang tersedia:** Arus laut 52° / 46,3 cm/s (0,9 kts), objek life raft kapasitas 6 orang, fix error GPS (0,1 NM).
   * **Data kurang:** Nihil (posisi LKP otomatis diambil dari hasil akhir ADW / \`adw-landing\`).

5. **Maritime Search Planning (WS 2)**
   * **Kegunaan:** Menghitung lebar sapuan (W), jarak antar jalur (S), kecepatan pencarian (V), dan probabilitas deteksi (POD) untuk SRU udara.
   * **Data yang tersedia:** Platform udara, TAS di area pencarian (120 kts & 90 kts), visibilitas 20 km & 10 km, status observer fresh, objek life raft.
   * **Data kurang:** Nihil (tinggi pencarian menggunakan default 1000 ft sebagai asumsi).

6. **Search Facility (WS 8)**
   * **Kegunaan:** Menghitung parameter pencarian untuk SRU laut (KN SAR Baladewa / Rescue Boat 40 m).
   * **Data yang tersedia:** Jenis SRU rescue-vessel, kecepatan 12 kts, visibilitas 10 km, status observer fresh, objek life raft.
   * **Data kurang:** Nihil (eye height menggunakan default 14 ft untuk kapal rescue).

Setelah itu ringkasan data yang diekstrak dan pertanyaan data yang kurang.`;

test('FAKFAK: 6 worksheet dideklarasikan → 6 tool, urut rantai hulu→hilir', () => {
  const declared = parseDeclaredWorksheetTools(FAKFAK_ANSWER);
  expect(declared).toEqual([
    'set_asw_case',
    'set_awa_case',
    'set_aero_drift_case',
    'set_datum_case',
    'set_ws2_case',
    'set_ws8_case',
  ]);
});

test('sub-butir bullet TIDAK dipetakan walau menyebut nama worksheet lain', () => {
  const text = `WORKSHEET YANG HARUS DIPAKAI
1. **Datum Worksheet (WS 1)**
   * **Data kurang:** Nihil (posisi LKP otomatis diambil dari hasil akhir ADW / Worksheet 1 / WS 2).
Setelah itu ringkasan data.`;
  const declared = parseDeclaredWorksheetTools(text);
  expect(declared).toEqual(['set_datum_case']);
});

test('prosa setelah daftar mengakhiri parsing', () => {
  const text = `WORKSHEET YANG HARUS DIPAKAI
1. **AWA (Average Wind Aloft)** — data lengkap.

Ringkasan: berikut hasil ekstraksi. Worksheet 2 dan Worksheet 8 juga relevan untuk soal ini.`;
  const declared = parseDeclaredWorksheetTools(text);
  expect(declared).toEqual(['set_awa_case']);
});

test('tanpa header bagian → kosong (perilaku lama tetap berlaku)', () => {
  expect(parseDeclaredWorksheetTools('Jawaban biasa tanpa daftar.')).toEqual([]);
  expect(parseDeclaredWorksheetTools('')).toEqual([]);
});

test('pemetaan lengkap: WS 3, WS 4, Intercept, pola pencarian', () => {
  const text = `**WORKSHEET YANG HARUS DIPAKAI**
1. **ASW (Average Surface Wind)**
2. **Worksheet 3 (Land)** — pencarian darat
3. **Worksheet 4** — search radius
4. **Search Pattern / pola pencarian** — PS dengan heading 090
5. **Intercept Calculator** — pintasan`;
  const declared = parseDeclaredWorksheetTools(text);
  expect(declared).toEqual([
    'set_asw_case',
    'set_ws3_case',
    'set_ws4_case',
    'set_search_pattern_case',
    'set_intercept_case',
  ]);
});

// ---------------------------------------------------------------------------
// computeMissingWorksheetTools — inti bug: dideklarasikan 6, dipanggil 1
// ---------------------------------------------------------------------------

test('FAKFAK parsial: hanya set_awa_case dipanggil → 5 tool hilang, urut rantai', () => {
  const declared = parseDeclaredWorksheetTools(FAKFAK_ANSWER);
  const missing = computeMissingWorksheetTools(declared, ['set_awa_case']);
  expect(missing).toEqual([
    'set_asw_case',
    'set_aero_drift_case',
    'set_datum_case',
    'set_ws2_case',
    'set_ws8_case',
  ]);
});

test('dideklarasikan ⊆ dipanggil → tidak ada yang hilang', () => {
  const missing = computeMissingWorksheetTools(
    ['set_awa_case', 'set_aero_drift_case', 'set_datum_case'],
    ['set_asw_case', 'set_awa_case', 'set_aero_drift_case', 'set_datum_case', 'set_lkp'],
  );
  expect(missing).toEqual([]);
});

test('kasus nol panggilan tetap terdeteksi (dipakai bersama forced retry)', () => {
  const missing = computeMissingWorksheetTools(
    ['set_datum_case', 'set_ws2_case'],
    [],
  );
  expect(missing).toEqual(['set_datum_case', 'set_ws2_case']);
});

// ---------------------------------------------------------------------------
// buildChainCompletionInstruction — instruksi pass penyambung
// ---------------------------------------------------------------------------

test('instruksi menyebut tool hilang, default planner, dan rantai ADW→Datum', () => {
  const instruction = buildChainCompletionInstruction(
    ['set_aero_drift_case', 'set_datum_case', 'set_ws2_case'],
    ['set_awa_case'],
  );
  expect(instruction).toContain('set_aero_drift_case');
  expect(instruction).toContain('set_datum_case');
  expect(instruction).toContain('set_ws2_case');
  expect(instruction).toContain('set_awa_case'); // konteks: sudah dipanggil
  expect(instruction).toContain('adw-landing');
  expect(instruction).toContain('1000 ft'); // default WS2 selectedHeight
  expect(instruction).toContain('searchNumber 1');
  expect(instruction).toContain('ask_for_case_data'); // jalan keluar bila fakta wajib nihil
  expect(instruction).toContain('JANGAN memanggil ulang');
});
