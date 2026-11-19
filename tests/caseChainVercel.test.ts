/**
 * Uji jaring pengaman chain completion terhadap kasus nyata Vercel:
 * "Analisis Kasus Latihan SAR Planning XL Tahun 2026 (Pesawat PK-XYZ)" —
 * model menganalisis 4 worksheet (AWA, ADW, ASW, Datum WS 1) tetapi hanya
 * memanggil set_awa_case. Parser harus mendeteksi 3 tool yang hilang sehingga
 * pass penyambung dipanggil dengan tool_choice paksa.
 */
import { describe, test, expect } from 'bun:test';
import {
  parseDeclaredWorksheetTools,
  computeMissingWorksheetTools,
  buildChainCompletionInstruction,
} from '../src/lib/sar/caseChain';

const USER_CASE_ANSWER = `# Analisis Kasus Latihan SAR Planning XL Tahun 2026 (Pesawat PK-XYZ)

## 1. WORKSHEET YANG HARUS DIPAKAI
1. **AWA (Average Wind Aloft)** — Menghitung rata-rata angin atas untuk segmen aeronautika (Flight Level 120 ke permukaan).
   - *Data tersedia:* Data angin permukaan (0 ft) hingga 24.000 ft dari tabel latihan.
   - *Data kurang:* Tidak ada.
2. **ADW (Aeronautical Drift Worksheet)** — Menghitung posisi dan waktu insiden / titik *ditching*.
   - *Data kurang:* Tidak ada.
3. **ASW (Average Surface Wind)** — Menghitung rata-rata angin permukaan selama periode *drift* maritim.
   - *Data kurang:* Tidak ada.
4. **Datum Worksheet (WS 1)** — Menghitung posisi *Datum Point*, *Total Probable Error* ($R$), dan batas area pencarian ($A, B, C, D$).
   - *Data kurang:* Tidak ada.

---

## Ringkasan Data yang Diekstrak
- **Waktu Insiden:** 17 Nov 2026 15.56 WIT (07.00 UTC)
`;

describe('Kasus Vercel PK-XYZ: hanya AWA dipanggil', () => {
  const declared = parseDeclaredWorksheetTools(USER_CASE_ANSWER);
  const emitted = ['set_awa_case'];
  const missing = computeMissingWorksheetTools(declared, emitted);

  test('parser mendeteksi 4 worksheet yang dinyatakan', () => {
    expect(declared).toEqual(['set_asw_case', 'set_awa_case', 'set_aero_drift_case', 'set_datum_case']);
  });

  test('3 tool hilang: set_asw_case, set_aero_drift_case, set_datum_case', () => {
    expect(missing).toEqual(['set_asw_case', 'set_aero_drift_case', 'set_datum_case']);
  });

  test('tool_choice pass penyambung = missing + ask_for_case_data', () => {
    // Mirip logika call site di route.ts: [...missingTools, 'ask_for_case_data']
    const allowed = [...missing, 'ask_for_case_data'];
    expect(allowed).toEqual(['set_asw_case', 'set_aero_drift_case', 'set_datum_case', 'ask_for_case_data']);
    expect(allowed).not.toContain('set_lkp'); // kasus ditching: LKP dari ADW, bukan set_lkp
    expect(allowed).not.toContain('set_awa_case'); // jangan memanggil ulang yang sudah ada
  });

  test('instruksi menyebut ketiga tool yang hilang', () => {
    const instruction = buildChainCompletionInstruction(missing, emitted);
    for (const tool of missing) expect(instruction).toContain(tool);
    expect(instruction).toContain('lkpSource "adw-landing"');
  });

  test('varian tanpa markdown bold tetap terdeteksi (teks polos dari model lain)', () => {
    const plain = `WORKSHEET YANG HARUS DIPAKAI
1. AWA (Average Wind Aloft) — angin atas
2. ADW (Aeronautical Drift Worksheet) — ditching
3. ASW (Average Surface Wind) — angin permukaan
4. Datum Worksheet (WS 1) — area pencarian`;
    const d = parseDeclaredWorksheetTools(plain);
    expect(d).toEqual(['set_asw_case', 'set_awa_case', 'set_aero_drift_case', 'set_datum_case']);
  });
});
