# Log Keputusan Implementasi — AI SAR Copilot

Fase 0 disetujui pada 20 November 2026. Dokumen ini adalah referensi resmi keputusan
implementasi; setiap fase wajib mematuhi daftar ini. Laporan eksplorasi:
`docs/AI_COPILOT_FASE0.md`.

## Keputusan (13 poin)

1. **API Key** — Hanya via environment variable server-side (`GEMINI_API_KEY`). Input API key
   di sisi client dihapus. Key tidak boleh terekspos lewat browser, response API, log, atau
   variabel `NEXT_PUBLIC_*`.
2. **Model default** — AI Agent: `gemini-3.8-flash`; Data Extraction: `gemini-3.8-flash`.
   Keduanya diubah lewat env var. `gemini-4-hydrogen` disediakan sebagai opsi (bukan default)
   sampai kompatibilitas endpoint, akses model, konfigurasi cloud, dan biaya diverifikasi.
   Prioritas: layanan gratis selama memungkinkan.
3. **SDK** — Migrasi ke `@google/genai` versi yang sesuai. Seluruh fungsi lama, streaming,
   function calling, structured output, dan file extraction tetap berjalan setelah migrasi.
4. **Riwayat percakapan** — `previous_interaction_id` dikelola server-side (Interactions API);
   Supabase tetap sumber utama riwayat percakapan, data kasus, dan hasil kerja AI.
   Interaction ID disimpan di `AiSessionLog`; ada fallback membangun ulang konteks dari DB
   sendiri bila interaction ID kedaluwarsa.
5. **Tool worksheet** — 16 tool `set_*_case` dipertahankan. Ditambah tool generik `set_fields`:
   hanya boleh mengubah field terdaftar pada schema worksheet (tanpa JSON bebas/arbitrary
   path), validasi tipe/satuan/rentang/field wajib, satu mekanisme penyimpanan konsisten untuk
   semua tool (tidak boleh ada dua mekanisme update yang menghasilkan state berbeda), dukung
   pengisian lintas worksheet dengan dependensi jelas.
6. **Tabel referensi** — Dilarang mengarang angka/konstanta/nilai appendix tanpa sumber resmi.
   Kategori: `VERIFIED` (sumber resmi + tervalidasi), `UNVERIFIED` (belum dikonfirmasi),
   `MISSING` (tidak tersedia). `UNVERIFIED`/`MISSING` tidak boleh dianggap nilai resmi atau
   dipakai menyatakan hasil final. AI wajib meminta sumber/konfirmasi untuk nilai yang belum
   ada. Fixture pengembangan wajib berlabel `SIMULATION` dan tidak tercampur data resmi.
7. **Bank lokasi & aset** — Draft awal dibuat untuk dikoreksi. Setiap entri wajib: sumber,
   tanggal pembaruan, koordinat, satuan, status verifikasi. Dilarang menebak koordinat/spesifikasi.
   Data baru berstatus `DRAFT` sampai disetujui (→ `APPROVED`).
8. **Test** — Konvensi repo: `bun test` + `node --test`. Ditambah integration test alur lengkap:
   analisis kasus → pengisian worksheet → transfer antar-worksheet → pembuatan dokumen → undo.
   Final Test PK-TAL = fixture pengujian; hasil dibandingkan dengan referensi tervalidasi
   (nilai expected diisi instruktur — sampai itu ada, ditandai `TODO: expected values from
   instructor key`, tidak dikarang).
9. **Prisma model baru** — `CaseChangeLog` (before/after, batch ID, user, sumber perubahan,
   waktu, info undo), `AiSessionLog` (session, model, interaction ID, status, pemakaian token
   jika ada, aktivitas tool; tanpa API key/dokumen mentah), `CaseBankItem` (lokasi, aset,
   sumber, koordinat, spesifikasi, status verifikasi). Periksa schema existing agar tidak duplikat.
10. **Undo** — Per batch (tahap pertama). Setiap AI Apply: pratinjau sebelum diterapkan,
    persetujuan pengguna, transaksi DB atomic per batch, simpan nilai sebelum/sesudah,
    rollback aman, tidak menimpa perubahan manual yang terjadi setelah batch AI diterapkan.
11. **Ekspor soal** — Tahap pertama PDF + JSON via pipeline existing; arsitektur generator
    harus siap menambah DOCX kemudian tanpa refactor besar (DOCX penting untuk instruktur).
12. **Hak akses** — Tidak terbatas ke developer. Developer/Admin: akses penuh + pengaturan AI +
    knowledge base + tabel referensi + bank lokasi/aset + persetujuan master data. Operator:
    analisis kasus, perhitungan, isi worksheet, draf Renops/briefing/de-briefing. Instruktur
    (bila role tersedia): membuat, menguji, mengekspor soal latihan. Dokumen buatan AI
    berstatus `DRAFT` sampai disetujui petugas berwenang.
13. **Template naskah** — PDF Final Test PK-TAL jadi acuan struktur/susunan/tabel/tata letak
    (hal. 1: identitas + kronologi + instruksi; hal. 2: data pesawat + Aeronautical Drift;
    hal. 3: arus, deret angin, tabel SRU). Template dinamis untuk pesawat/kapal/darat/jenis
    operasi lain; nilai PK-TAL tidak boleh di-hardcode untuk kasus baru.

## Dua kemampuan terintegrasi (tujuan akhir)

- **A. Case Analysis to SAR Operation**: teks/PDF/dokumen → ekstraksi → cek kelengkapan →
  tentukan worksheet → jalankan fungsi perhitungan resmi aplikasi → hubungkan output antar
  worksheet → terapkan ke worksheet + Rencops/briefing/de-briefing. AI tidak mengarang rumus
  dan tidak menghitung ulang bila fungsi resmi tersedia.
- **B. SAR Training Scenario Generator**: soal baru per jenis kejadian + worksheet target,
  narasi + seluruh data input, diuji dengan SAR Calculation Engine; wajib: data wajib lengkap,
  tiap worksheet bisa dijalankan, tidak ada konflik data, semua hasil bisa dihasilkan fungsi
  aplikasi, ada kunci jawaban + tahapan penyelesaian, sumber nilai referensi dapat ditelusuri.
  Data tidak diketahui → bertanya, bukan menebak.

## Batasan mutlak (PENTING dari pemilik)

- JANGAN mengubah/menghapus rumus perhitungan, appendix, tabel resmi, atau fungsi worksheet
  yang sudah berjalan hanya demi integrasi AI. Pertahankan seluruh fitur existing.
- Implementasi bertahap; test setelah tiap tahap; tanpa regresi pada worksheet/fitur existing.
- Refactor hanya "ekstraksi pure function tanpa mengubah hasil", dibuktikan test regresi.
- Konvensi data: angin arah **DARI**; arus & drift arah **KE**; true = magnetic + variation E
  (− variation W); waktu disimpan dengan zona (WIB = UTC+7); koordinat desimal bertanda
  (S/W negatif) + simpan string DMS asli bila ada.

## Status per fase

| Fase | Ruang lingkup | Status |
|---|---|---|
| 0 | Eksplorasi + laporan + keputusan | SELESAI (laporan disetujui) |
| 1 | `CaseSchema` + adapter + pipeline headless + fixture PK-TAL + test regresi (aditif) | SELESAI — `caseSchema.ts`, `caseAdapter.ts`, `casePipeline.ts`, `referenceTables.ts`, `tests/golden/pk-tal.case.json`, 48 test baru (bun test 408 lulus, lint bersih, build sukses) |
| 2 | SDK `@google/genai` + env key + tool layer (`get_state`, `set_fields`, `run_worksheet`, `run_pipeline`, `lookup_table`, `validate_plan`, `undo`) + `CaseChangeLog`/`AiSessionLog` + riwayat interaction | SELESAI — (1) model Prisma 3 model; (2) SDK `@google/genai` 3.6.1 + key env-only + AiSessionLog + `previous_interaction_id` (fallback rebuild); (3) tool `set_fields` (registry + applier satu mekanisme); (4) tool server-side `get_state`/`lookup_table`/`run_worksheet`/`run_pipeline`/`validate_plan` (loop `function_result` + state snapshot client via `stateToCase` + `sru.sheet` verbatim, status VERIFIED/UNVERIFIED/MISSING); (5) `CaseChangeLog` API `/api/ai/change-log` (POST transaksi atomic per batch + GET ringkasan), diff field terdaftar di client (`changeLog.ts`), Undo per-batch dengan guard perubahan manual (field yang nilainya sudah berubah TIDAK ditimpa), restore lewat jalur set_fields (satu mekanisme), badge "diisi AI" per tab worksheet. bun test 518 pass, build sukses |
| 3 | `parse_case` + panel pratinjau per-field + auto-fill + validator | MENUNGGU |
| 4 | fill_form Rencops/Briefing/De-briefing + POD kumulatif | MENUNGGU |
| 5a | Bank lokasi + katalog aset + generator parameter + template naskah + completeness check | MENUNGGU |
| 5b | Narasi LLM + kunci + solvability + rubrik + bank soal + ekspor + UI | MENUNGGU |
| 6 | Golden set + eval:ai + `docs/AI_COPILOT.md` + `GEMINI.md` | MENUNGGU |

Catatan desain Fase 1: karena kalkulator repo sudah ±90% pure functions (lihat laporan Fase 0
§2.4), Fase 1 bersifat **aditif penuh** — tidak ada perubahan pada komponen/rumus existing.
Deduplikasi math ASW di komponen dan penyeragaman koreksi cuaca ditunda ke fase pembersihan
tersendiri dengan test regresi eksplisit, sesuai batasan "jangan ubah yang sudah jalan".
Bug `SearchPlanWorksheet.tsx` (referensi `conditions` yang tidak terdefinisi) diverifikasi
dulu sebelum disentuh.
