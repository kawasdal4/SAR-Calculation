# Fase 0 — Laporan Eksplorasi "AI SAR Copilot" (Google Gemini)

Tanggal: 20 November 2026 · Status: **MENUNGGU PERSETUJUAN** (belum ada kode yang diubah)

Laporan ini meringkas hasil eksplorasi repo SAR Calculator (`/home/z/my-project`), memeriksa
dokumentasi resmi Gemini (ai.google.dev / aistudio.google.com/docs, dicek 20 Nov 2026), dan
mengusulkan rencana implementasi per fase beserta daftar pertanyaan yang perlu Anda putuskan.

---

## 1. Ringkasan eksekutif

Fondasi app sudah jauh lebih kuat daripada yang diasumsikan spesifikasi:

1. **Kalkulasi hampir seluruhnya pure functions** di `src/lib/sar/` (±20 modul): AWA, ASW,
   Aeronautical Drift, Datum WS1, W/S/C/POD, Alokasi Aset, Search Pattern, Intercept, WS4 darat.
2. **Tabel referensi IAMSAR/AUS SAR sudah terdigitisasi** (I-1 s.d. I-10, J-1..J-3, N-13, N-14,
   kurva POD dari POD.xls), dengan beberapa celah (lihat §2.5).
3. **Sudah ada `capabilityRegistry.ts`** (±50 kapabilitas dengan `execute()` headless dan graph
   dependensi) — ini adalah dasar alami untuk tool layer `run_worksheet`/`run_pipeline`.
4. **AI asisten sudah agentic** di `/api/chat` (1.653 baris): 16 function declaration worksheet,
   `caseToolNormalize.ts` (normalisasi argumen model), kontrak pratinjau/konfirmasi, chain
   completion pass, retry/backoff kuota, model chain + discovery dinamis.
5. Endpoint yang dipakai **sudah benar**: Gemini **Interactions API** (`POST /v1beta/interactions`)
   yang sejak Juni 2026 menjadi interface default Gemini API — tetapi dipanggil via `fetch()`
   mentah dan SDK `@google/generative-ai` yang deprecated hanya untuk tipe/skema.

Gap utama terhadap arsitektur target: **tidak ada `CaseSchema` tunggal**, tidak ada tool
`get_state`/`run_pipeline`/`lookup_table`/`validate_plan`/`fill_form`/`generate_case`/`undo`,
API key dibawa dari client (localStorage), riwayat `functionCall`/`functionResponse` **tidak**
dipertahankan antar-giliran, tidak ada validator konsistensi, tidak ada bank lokasi/katalog
aset, dan tidak ada generator soal/kunci/rubrik/bank soal.

---

## 2. Temuan eksplorasi

### 2.1 Stack & infrastruktur

| Aspek | Temuan |
|---|---|
| Framework | Next.js 16.1.1 (App Router), React 19, TypeScript 5, Tailwind 4, shadcn/ui di atas Radix (±30 paket) |
| State | **Tidak memakai zustand/redux** — semua state di `src/app/page.tsx` (3.444 baris, ±80 `useState`) |
| DB | Prisma 6.11.1; `prisma/schema.prisma` = PostgreSQL (Vercel/Supabase), `prisma/schema.sqlite.prisma` = SQLite (dev). Model: `SarCase`, `CaseDataBank`, `DocumentDraft`, `WorkspaceContext`, `Account` |
| Validasi | zod 4.0.2, react-hook-form (siap untuk CaseSchema) |
| AI SDK | `@google/generative-ai` **0.24.1 (deprecated)** — hanya untuk tipe `FunctionDeclaration`/`SchemaType`; panggilan jaringan = `fetch()` mentah; `z-ai-web-dev-sdk` sebagai fallback route `/api/data-bank` |
| Ekspor | jspdf + autotable (PDF L-23), xlsx SheetJS, pipeline cetak A3/A4; dokumen RENOPS/Briefing = HTML print (belum docx/pdf) |
| Peta | leaflet/react-leaflet, maplibre-gl, geotiff; proxy GEBCO depth & OpenAIP tiles |
| Catatan kualitas | `next.config.ts` → `typescript.ignoreBuildErrors: true` (menyembunyikan bug nyata, lihat §2.6) |

### 2.2 State management & pola data

- Semua state worksheet diangkat ke `page.tsx`; worksheet melapor ke atas via
  `onDataChange`/`onStateChange`; halaman menyimpan "mirror" dengan guard deep-equality
  (`src/lib/sar/stateSync.ts`) untuk mencegah loop render.
- Karena Radix `TabsContent` meng-unmount tab non-aktif, halaman memelihara derived memo
  yang selalu segar: `awaComputed`, `ws1Computed`, ASW dari mirror — aliran data antar
  worksheet tetap hidup meski tab ditutup.
- **Snapshot lengkap sudah ada**: `buildState()` (page.tsx:500–561) dan `applyState()`
  (564–692) men-serialisasi/mengembalikan seluruh input worksheet — ini pintu masuk alami
  untuk `get_state` dan `CaseSchema`.
- Multi-SRU: `WorksheetSheet<T> {key, label, assetId, data}` — **1 SRU = 1 lembar** untuk
  WS2/WS3/WS8; Alokasi Aset pakai `SruAssetInput[]`.
- Penyimpanan kasus: `SarCase.state` (JSON snapshot penuh) via `/api/sar-cases`; riwayat keputusan
  append-only di `WorkspaceContext` (versioned, CURRENT/STALE/ARCHIVED).
- **Belum ada**: provenance per-field ("diisi AI"), change-log terstruktur, undo.

### 2.3 Inventaris worksheet (singkat)

| Sheet | Kegunaan | Sumber kalkulasi |
|---|---|---|
| AWA (K-10) | rata-rata vektor angin per ketinggian | `computeAWA` (pure) |
| ADW (K-6) | glide pesawat + parasut → titik ditching/LKP | `calculateAeroDrift` (pure) |
| ASW (K-19) | rata-rata angin permukaan berbobot waktu | math **duplikat di ASWWorksheet.tsx** + `computeASW` |
| WS1 Datum laut | arus → wind current → leeway → Datum L/R, De, E, R, Ao | `computeDatumWs1` + `computeWs1SearchArea` (pure) + De override terukur di komponen |
| WS2 (udara) / WS8 (laut) / WS3 (darat) | W, S, C, POD per SRU | `computeW2Row`/`computeW8Row`/landSearchTables (pure) |
| WS4 darat | radius pencarian darat | `landSearchRadius.mjs` (pure) |
| Alokasi Aset | transit/TSF/TAF/EST/sweep area vs Ao | `assetAllocation.ts` (pure) |
| Search Pattern/CSP | PS/CS/SS/VS/TS + CSP + clip area | `searchPatterns.ts` (pure) |
| Intercept | geometri intersep | `interceptCalculations.ts` (pure) |
| RenopsForm / BriefingForm | draf dokumen operasi | `buildDocument` deterministik + `/api/documents/generate` |

Worksheet **5/6/7** di `src/components/sar/worksheets/` adalah **orphan** (tidak dipakai di tab)
dan berisi math yang belum diekstrak ke lib — diputuskan di Fase 1 (ekstrak atau hentikan).

### 2.4 Mesin kalkulasi — penilaian "pure vs UI-coupled"

**Pure (aman dipanggil tool):** `sarCalculations.ts` (1.573 baris: AWA, ASW, WC/LW/TWC, E,
datum, effort allocation, leeway 51 objek, tabel J), `aeroDriftCalculations.ts` (konversi
magnetik→true: **variation E ditambah, W dikurangi**), `datumWs1.ts` (483 baris, rantai datum
lengkap + warnings/assumptions), `aswTime.ts` (761 baris: format Basarnas `MMDD.HHMM Z`, zona
WIB/WITA/WIT), `wscPodTables.ts` (I-3..I-8 + POD polinomial), `assetAllocation.ts`,
`searchPatterns.ts`, `interceptCalculations.ts`, `landSearchTables.ts`, `landSearchRadius.mjs`,
`tableN13.mjs`, `basicCalculations.ts`, `upsGeodesic.ts` (Vincenty), `coordFormat.ts`
(DMS↔desimal, terima "06°30′S" maupun "-6,5").

**Perlu refactor kecil di Fase 1 (hasil harus identik, dibuktikan test regresi):**
1. `ASWWorksheet.tsx:143–219` — duplikat math ASW di komponen (lib sudah punya `computeASW`).
2. `Worksheet1.tsx:165–230` — De override jarak terukur peta (logic UI-coupled).
3. `Worksheet5.tsx` (fs=1.3, `POD=1−e^(−C)`) & `Worksheet6.tsx` (OSE/EST) — math inline di komponen orphan.
4. `SearchPlanWorksheet.tsx:150` — referensi `conditions` yang tidak terdefinisi di dependency
   array `useEffect` (ter-mask oleh `ignoreBuildErrors`).

**Orkestrasi pipeline:** tidak ada satu fungsi `run_pipeline`; alur dijaga oleh
(a) dataflow React di page.tsx, (b) konvensi rantai AI `WORKSHEET_CHAIN_ORDER`
(`caseChain.ts`: ASW→AWA→ADW→Datum→WS2→WS3→WS4→WS8→pattern→intercept), dan
(c) `capabilityRegistry.ts` yang mendeklarasikan dependensi (`env-asw` → `ws1-datum` →
`ws1-search-area` → …) dan menyediakan `execute()` headless untuk sebagian kapabilitas.
**Fase 2/3 cukup melengkapi registry + menulis orchestrator pipeline** — bukan menulis ulang rumus.

### 2.5 Tabel referensi

**Sudah terdigitisasi:** I-1/I-2 leeway (51 objek + keyword Indonesia), I-3/I-4 (Wu kapal per
eye-height/visibility), I-5/I-6 (Wu udara per altitude/visibility), I-7 koreksi cuaca,
I-8 koreksi kecepatan, I-9/I-10 darat, J-1/J-2/J-3 nav fix error, kurva POD Figure I-12
(polinomial derajat-6 hasil fit POD.xls), N-13 ROD parasut, N-14 drift parasut, tangga Fs
(1.1/1.6/2.0/2.3/2.5; darat 1.1/1.8/2.0/2.3/2.6). Mirror tampilan di `manualTables.ts`.

**Celah (logika app mengharapkan tapi belum ada tabelnya):**
1. **N-4..N-8** uncorrected sweep width — `SearchPlanWorksheet` memakai matrix ad-hoc 5 fasilitas × 8 objek di `sarCalculations.ts:1296–1350` tanpa provenance appendix.
2. **Figure I-1** wind-current — dipakai konstanta `0.036` (beranotasi "needs confirmation").
3. **N-10** POD kurva fixed pattern — Worksheet5 memakai rumus random search sebagai gantinya.
4. **Fatigue factor** — konstanta 0.9/1.0 hardcoded, tanpa tabel.
5. **Dua implementasi koreksi cuaca berbeda** (`weatherCorrection()` private di `sarCalculations.ts` vs `lookupFwByRow` Table I-7) — jalur `SearchPlanWorksheet` vs WS2/WS8 bisa memberi angka berbeda.

Untuk tool `lookup_table`, tabel yang ada langsung bisa diekspos; celah di atas perlu keputusan
Anda (pakai nilai ad-hoc existing + flag "unverified", atau Anda sediakan nilai resmi).

### 2.6 AI asisten saat ini (`/api/chat`)

- **Panggilan**: `POST https://generativelanguage.googleapis.com/v1beta/interactions` dengan
  `store:false`, `system_instruction` (±150 baris Bahasa Indonesia), `generation_config`
  (`max_output_tokens: 32768`, `thinking_level` per model), `tools` (16 function), `tool_choice`
  string `'any'` untuk pass paksa. Respon dibaca dari `payload.steps` (`function_call`).
- **Model**: chain default `['gemini-4-hydrogen','gemini-3.8-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3.6-flash']`, dapat dioverride via env `GEMINI_MODEL_FALLBACKS` + discovery dinamis `GET /v1beta/models` (cache 5 menit).
- **API key**: **dibawa dari client** — disimpan di `localStorage['sar-ai-api-key']`, dikirim di body setiap POST, dipakai server sebagai header `x-goog-api-key`. Tidak ada env key server. (Masih "backend-only" saat pemakaian, tapi key tinggal di browser & lewat body.)
- **Tool (16)**: `set_asw_case, set_awa_case, set_aero_drift_case, set_intercept_case, set_datum_case, ask_for_case_data, clarify_datum_time, clarify_incident_time, save_case_data_bank, set_ws4_case, set_ws3_case, set_ws2_case, set_search_pattern_case, set_ws8_case, set_asset_allocation_case, set_lkp` — parameter ber-`description` Indonesia, nama/target di-snap ke enum tabel oleh `caseToolNormalize.ts` (773 baris: `coerceNumber` memahami "1.000 ft"/"1,5"/"kts", alias enum, resolver target bebas "life raft 6 person" → id katalog).
- **Alur apply** (sudah diperbaiki commit `7a4b41a`): pratinjau per-tool → tombol "Konfirmasi & Terapkan" → `applyFunctionCalls` (gate dua tingkat: fakta inti wajib, pilihan planner boleh parsial) → 12 handler `handleApply*` di `page.tsx` menulis mirror + `loadedInitialState` + bump `caseVersion`. Normalisasi dijalankan dua kali (idempoten) di pratinjau dan apply.
- **Riwayat**: hanya teks 12 pesan terakhir (masing-masing dipangkas 6.000 karakter) di-flatten jadi satu blok teks. **`functionCall`/`functionResponse` TIDAK dipertahankan** antar-giliran — klarifikasi dikirim sebagai pesan user baru berisi instruksi ulang. Ini deviasi langsung dari spesifikasi §2.3 Anda dan salah satu penyebab perilaku tidak stabil.
- **Ketahanan**: retry per model dengan backoff eksponensial + `RetryInfo`, timeout per attempt
  & anggaran total (Vercel 300 s), dua jaring pengaman server (`runForcedWorksheetRetry`,
  `runChainCompletionPass` ≤3 pass), auto-retry client 3× dengan countdown.
- **Keamanan**: tanpa rate limiting; logging hanya metadata (model/status/durasi), isi prompt tidak dicatat; konten lampiran diperlakukan sebagai data (system prompt melarang mengikuti instruksi di lampiran).
- **`/api/data-bank`**: ekstraksi soal → 35 kunci fakta kanonik (`CASE_FACT_MAP`), fallback `z-ai-web-dev-sdk`; prompt JSON dipaksa via teks (bukan structured output resmi).

### 2.7 Dokumentasi resmi Gemini yang dicek (20 Nov 2026)

| Topik | Hasil cek |
|---|---|
| Interface | **Interactions API adalah interface default sejak Juni 2026** (`POST /v1beta/interactions`); `generateContent` masih didukung tapi legacy. Kode repo sudah di jalur yang benar. |
| SDK resmi JS | `@google/genai` (Google Gen AI SDK) — dukungan Interactions API sejak **v2.3.0+**; `@google/generative-ai` deprecated. SDK menangani **thought signature otomatis** untuk seri Gemini 3+. |
| Function calling | Respon berisi langkah `function_call` (dengan `call_id`); lanjutan dikirim sebagai input `[{type:"function_result", name, call_id, result:[…]}]` + `previous_interaction_id` (stateful) atau input lengkap (stateless). |
| Tool choice | `generation_config.tool_choice` → `{allowed_tools:{mode:"auto"|"any"|"none"|"validated", tools:[names]}}` — repo saat ini memakai bentuk string `'any'` (berfungsi, tapi bentuk objek lebih eksplisit untuk `allowedFunctionNames`). |
| Structured output | `response_format:{type:"text", mime_type:"application/json", schema:<JSON Schema>}`; **bisa digabung dengan function calling** pada Gemini 4 & 3.8 series (gemini-4-carbon/argon/hydrogen, gemini-3.8-flash) — cocok dengan rencana mode `parse_case`. Zod di JS via `z.fromJSONSchema`. |
| Thinking | `generation_config.thinking_level`: `minimal/low/medium/high/xhigh` (xhigh hanya gemini-4-hydrogen). Default: 3.5-flash-lite=minimal, 3.8-flash=medium, 4-hydrogen=high. |
| File/PDF | File kecil: inline part; Files API untuk total request besar (PDF ≤50 MB per file via Files API, ≤2 GB, disimpan 48 jam): part `{type:"file", uri, mimeType}`. Soal kasus umumnya kecil → inline cukup. |
| State server | `store:true` (default) menyimpan interaction di server Google + `previous_interaction_id`; `store:false` = stateless penuh. Untuk privasi soal ujian, **disarankan tetap `store:false`** dan riwayat dikelola sendiri. |

### 2.8 Form Rencana Operasi / Briefing / De-briefing

- `RenopsForm.tsx` (Perban 3/2020): blok A SITUASI, B TUGAS, C PELAKSANAAN (luas area, datum,
  koordinat A/B/C/D terisi otomatis dari hasil worksheet), D LOGISTIK, E KOMANDO.
- `BriefingForm.tsx`: briefing + de-briefing (sortie: departure/landing, waktu, temuan).
- `DocumentWorkbench.tsx` + `CaseDataBank` + `buildDocument()` (deterministik — angka dari
  snapshot, bukan LLM) + `/api/documents/generate`; keluaran HTML print (belum berkas docx/pdf).
- Ini berarti `fill_form` Fase 4 sebagian besar **membungkus `buildDocument` yang sudah ada**
  dan menambahkan penyusunan narasi (LLM hanya menulis kalimat, angka dari state).

### 2.9 Testing & ekspor

- **28 file test sudah ada**: 20 × `bun:test` (`.test.ts`) + 8 × `node --test` (`.test.mjs`),
  termasuk acceptance test rantai datum, tabel leeway, POD polinomial, caseToolNormalize,
  chatPreview, stateSync, capabilityRegistry. Tanpa jest/vitest — konvensi repo = bun test.
- Ekspor: PDF L-23 (jspdf), Excel multi-sheet (SheetJS), cetak A3/A4 semua sheet + peta;
  dokumen RENOPS/Briefing = HTML print. Belum ada ekspor DOCX.
- Soal PK-TAL (PDF terlampir) sudah terbaca lengkap — siap menjadi golden case Fase 6.

### 2.10 Bank lokasi & katalog aset

- Hanya ada `SRU_BASE_PRESETS` (6 pangkalan: Tanjung Priok, Muara Baru, Merak, Benoa,
  Makassar, Sorong) di `AssetAllocationWorksheet.tsx:31`.
- **Tidak ada** katalog aset (AS-365 N3+, Bell 505, kapal 40 m, HR-3604, KN SAR Drupada tidak
  ada di repo) dan **tidak ada** daftar Kantor SAR/bandara/pelabuhan berkoordinat.
- → Fase 5a harus membangun `bank lokasi` + `katalog aset` sebagai JSON; data awal bisa diambil
  dari soal PK-TAL + 6 preset + draft yang saya usulkan (Anda koreksi).

---

## 3. Jawaban atas poin yang diminta eksplisit di Fase 0

1. **SDK Gemini yang dipakai**: panggilan jaringan = raw `fetch()` ke Interactions API
   (`/v1beta/interactions`); dependensi `@google/generative-ai@0.24.1` (deprecated) hanya untuk
   tipe `FunctionDeclaration`/`SchemaType`. Saran: migrasi ke `@google/genai` v2.3.0+ di Fase 2
   (thought signature otomatis, structured output, Files API resmi), pertahankan lapisan
   retry/model chain yang sudah terbukti.
2. **AI Studio vs Vertex AI**: yang dipakai = **Gemini API / AI Studio** (endpoint
   `generativelanguage.googleapis.com`, header `x-goog-api-key`). Tidak ada jejak Vertex AI.
   Spesifikasi Anda (env `GEMINI_API_KEY`, `GEMINI_MODEL`) cocok dengan jalur ini — tidak perlu
   pindah ke Vertex.
3. **Ketersediaan tabel referensi**: ±90% sudah terdigitisasi (lihat §2.5); celah: N-4..N-8,
   Figure I-1, N-10, fatigue, dan dua implementasi koreksi cuaca yang perlu disatukan.
4. **Data lokasi/aset**: belum ada — perlu dibangun di Fase 5a (bank lokasi JSON + katalog
   aset JSON), data awal dari PK-TAL + preset pangkalan + draft usulan.

---

## 4. Gap analysis — tool target vs kondisi repo

| Tool target | Status saat ini | Rencana |
|---|---|---|
| `parse_case` | Belum ada (ekstraksi lewat chat + data-bank 35 kunci) | Fase 3: endpoint khusus, structured output + responseSchema dari `CaseSchema`, Zod revalidasi, retry 2× |
| `get_state` | Belum ada; bahan baku = `buildState()` | Fase 2: serialisasi ringkas per worksheet |
| `set_field`/`set_fields` | **Ada** dalam bentuk 16 tool `set_*_case` per worksheet + normalisasi | Fase 2: dipertahankan (terbukti) + ditambah `set_fields` generik bila perlu; enum sheet/field digenerate dari registry |
| `run_worksheet` | Parsial: `capabilityRegistry.execute()` headless untuk beberapa kapabilitas | Fase 2: lengkapi execute() semua worksheet + expose sebagai tool |
| `run_pipeline` | Tidak ada satu fungsi; alur via dataflow React + `WORKSHEET_CHAIN_ORDER` | Fase 3: orchestrator headless (ADW→ditching→Leeway/Sea→Datum→Search Area→ASW→W/S/C/POD→Alokasi→CSP) |
| `lookup_table` | Data tabel ada; belum diekspos sebagai tool | Fase 2: tool lookup ke `manualTables`/modul tabel |
| `validate_plan` | Tidak ada | Fase 3: validator konsistensi (koordinat, waktu, endurance+reserve, luas area, life raft vs POB, satuan, sudut 0–360) |
| `fill_form` | `buildDocument()` deterministik sudah ada | Fase 4: bungkus sebagai tool + narasi LLM (angka dari state) |
| `generate_case` | Tidak ada (hanya QUICK_PROMPTS chat) | Fase 5a/5b: generator parameter seeded + narasi LLM + kunci + rubrik + bank soal |
| `undo_last_ai_change` | Tidak ada (ada WorkspaceContext append-only) | Fase 2: `CaseChangeLog` (Prisma) + undo per-batch apply |
| `CaseSchema` | Tidak ada (snapshot `buildState` + 80 useState) | Fase 1: Zod schema 1:1 input worksheet + adapter |
| Change-log / badge "diisi AI" | Belum ada | Fase 2: per-batch + per-worksheet badge |
| API key backend-only | Key dari client (localStorage→body) | Fase 2: `GEMINI_API_KEY` env; input client dihapus/fallback |
| Riwayat functionCall dipertahankan | Tidak dipertahankan (teks 12 pesan) | Fase 2: simpan langkah interaction & kirim ulang utuh (lihat Pertanyaan #4) |

---

## 5. Rencana implementasi per fase (usulan)

Semua fase: jalankan `bun test` + `bun run lint` + build tiap akhir fase; commit per fase
dengan pesan jelas; teks UI & prompt Bahasa Indonesia; angka SELALU dari kode deterministik.

**Fase 1 — Fondasi data & regresi kalkulator**
- `src/lib/sar/caseSchema.ts`: Zod `CaseSchema` (exam_header, incident, target, sar_office, lkp,
  aero_drift, sea, search, sru[], tasks_requested, meta) + komentar konvensi (angin DARI,
  arus/drift KE, true = magnetic + var E, waktu WIB/UTC, satuan).
- `src/lib/sar/caseAdapter.ts`: konversi dua arah `CaseSchema` ↔ snapshot `buildState`/`applyState`
  ↔ initial state per worksheet.
- Refactor murni: satukan math ASW duplikat ke lib; ekstrak math Worksheet5/6 (atau tandai
  orphan); perbaiki `SearchPlanWorksheet.tsx:150`; satukan koreksi cuaca ke Table I-7.
- Test regresi: baseline nilai dari kode saat ini (harus identik sebelum/sesudah refactor) +
  unit test DMS↔desimal, variation E/W, konvensi arah, zona waktu.

**Fase 2 — Backend proxy & tool layer + agent loop**
- Migrasi ke `@google/genai` (interactions), buang `@google/generative-ai`; wrapper
  `src/lib/ai/geminiClient.ts` (retry/backoff/model chain dipertahankan); key via
  `GEMINI_API_KEY` env; model via `GEMINI_MODEL` (+ `GEMINI_MODEL_FALLBACKS` tetap).
- Tool baru: `get_state, run_worksheet, run_pipeline, lookup_table, validate_plan, fill_form,
  generate_case, undo_last_ai_change` + pertahankan `set_*_case` & clarify tools; enum
  sheet/field dari registry; hasil tool = JSON ringkas.
- `CaseChangeLog` (Prisma, Postgres+SQLite) + undo per-batch + badge "diisi AI" per worksheet;
  `AiSessionLog` (prompt/functionCall/functionResponse/model) untuk debugging/eval.
- Riwayat: simpan langkah interaction (termasuk functionCall/functionResponse) dan kirim ulang
  utuh; pangkas hanya di batas turn selesai.
- Split `/api/chat` menjadi modul `src/lib/ai/tools/*` (route tetap satu pintu).

**Fase 3 — `parse_case` + alur Ekstrak→Konfirmasi→Terapkan→Hitung→Review**
- `/api/ai/parse-case`: satu panggilan tanpa tools, `response_format` JSON + schema `CaseSchema`,
  temperature 0–0.2, PDF inline/Files API; Zod revalidasi + retry 2× dengan pesan error validasi.
- Panel pratinjau per-field (nilai, sumber di soal, status ok/diasumsikan/hilang) — menggantikan
  pratinjau tool-by-tool untuk alur soal kasus; field `missing` wajib diisi/disetujui sebagai
  asumsi sebelum lanjut; toggle "otomatis penuh" vs "konfirmasi tiap langkah".
- `run_pipeline` + `validate_plan` aktif; AI mereview hasil (catatan/peringatan, tanpa mengubah angka).

**Fase 4 — Rencana Operasi, Briefing, De-briefing**
- `fill_form` dari state; draf tetap editable manual; de-briefing: input hasil sortie →
  POD kumulatif/POS via kalkulator existing → usulan stage berikutnya.

**Fase 5a — Generator soal: parameter & template**
- `data/locations.json` (kantor SAR, bandara, pelabuhan/helipad berkoordinat) +
  `data/assets.json` (katalog SRU: AS-365 N3+, Bell 505, kapal 40 m, dst.); editor UI.
- `src/lib/sar/caseGenerator.ts`: PRNG ber-seed (deterministik), tingkat kesulitan
  (mudah/sedang/sulit), jebakan terkontrol, deret angin/arus yang wajar per wilayah.
- Template naskah meniru format PK-TAL (kop, narasi, tabel data, perintah); tabel referensi
  TIDAK dicetak ke soal; `case_completeness_check` (setiap field input worksheet muncul di naskah).

**Fase 5b — Narasi LLM + kunci jawaban + rubrik + bank soal**
- LLM hanya menulis paragraf narasi (angka divalidasi cocok dengan JSON); kunci jawaban =
  `run_pipeline` dari `CaseSchema`; uji solvability (parse ulang naskah → pipeline → hasil
  identik); rubrik bobot + toleransi (konfigurabel); Prisma `CaseBankItem` + UI (duplikat,
  ubah parameter, acak ulang) + ekspor PDF (pipeline jspdf/print yang ada) & JSON; DOCX opsional
  (butuh dependensi baru `docx` — Pertanyaan #11).

**Fase 6 — Golden set, eval, dokumentasi**
- `tests/golden/pk-tal.json` (fixture dari PDF terlampir; nilai expected ditandai
  `TODO: expected values from instructor key` — tidak dikarang).
- `bun run eval:ai`: jalankan `parse_case` pada golden set, akurasi per field (khusus tabel
  angin per ketinggian & data SRU).
- `docs/AI_COPILOT.md` (arsitektur, cara menambah tool/worksheet/jenis insiden/golden case) +
  `GEMINI.md` di root (aturan mutlak §1 & §4 spesifikasi Anda).

Estimasi relatif: F1 S/M · F2 M/L · F3 M · F4 S · F5a M · F5b L · F6 S.

---

## 6. Risiko & catatan

1. `page.tsx` (3.444 baris, ±80 useState) adalah titik gagal tunggal — refactor dilakukan
   minimal-invasif dan selalu diawali test regresi; tidak ada migrasi state manager besar
   sebelum fitur tuntas.
2. `ignoreBuildErrors: true` menyembunyikan error TS — perbaikan bug ter-mask masuk Fase 1;
   menonaktifkan flag sepenuhnya dilakukan bertahap.
3. Dua implementasi koreksi cuaca & math ASW duplikat = risiko angka berbeda antara jalur AI
   dan jalur manual — disatukan di Fase 1 dengan regresi.
4. Soal ujian bersifat sensitif: tetap `store:false` pada Interactions API agar tidak
   tersimpan di server Google; log sesi hanya di DB sendiri.
5. Kuota/biaya LLM: model chain + backoff sudah ada; `parse_case` (structured output) dan
   generator (narasi) dipisah agar panggilan murah tetap murah.
6. Ekspor DOCX butuh dependensi baru; PDF bisa dari pipeline cetak/jspdf yang sudah ada.

---

## 7. Pertanyaan untuk persetujuan

1. **API key**: migrasi ke `GEMINI_API_KEY` env (server-only) dan hapus input key di panel AI?
   Atau env utama + input client sebagai fallback? Saran: env-only.
2. **Model**: `GEMINI_MODEL` default apa? Saran: `gemini-4-hydrogen` untuk mode agent (thinking
   `high`), `gemini-3.8-flash` untuk `parse_case`/ekstraksi (thinking `low`) — semuanya
   overridable via env.
3. **SDK**: setuju migrasi `@google/generative-ai` (deprecated) → `@google/genai` v2.3.0+ di Fase 2?
4. **Riwayat**: dua opsi — (a) kirim ulang langkah interaction utuh setiap turn (stateless,
   `store:false`, paling deterministik & mudah di-debug — sesuai spesifikasi Anda), atau
   (b) pakai `previous_interaction_id` server-side (hemat token, tapi riwayat di server Google).
   Saran: (a).
5. **Tool design**: pertahankan 16 tool `set_*_case` yang sudah terbukti + tambah tool generik
   (`get_state`, `run_pipeline`, `lookup_table`, `validate_plan`, `fill_form`, `generate_case`,
   `undo_last_ai_change`) — setuju? Atau konsolidasi ke `set_fields` generik penuh?
6. **Tabel referensi yang hilang** (N-4..N-8, Figure I-1, fatigue, N-10): pakai nilai ad-hoc
   yang sekarang + flag "unverified" di `lookup_table`, atau Anda akan menyediakan nilai resmi?
7. **Bank lokasi & katalog aset**: saya buat draft awal (dari PK-TAL + 6 preset pangkalan +
   data publik umum) dan Anda koreksi, atau Anda berikan daftar resmi?
8. **Test runner**: mengikuti konvensi repo (bun test + node --test) — setuju?
9. **Model Prisma baru** (Postgres prod & SQLite dev sama): `CaseChangeLog`, `AiSessionLog`,
   `CaseBankItem` — setuju?
10. **Undo scope**: satu batch "Konfirmasi & Terapkan" AI = satu unit undo — cukup?
11. **Ekspor naskah soal**: PDF via pipeline jspdf/print existing + JSON; DOCX tambah
    dependensi `docx` — perlu atau tidak?
12. **Akses fitur copilot & generator soal**: untuk role `developer` saja atau juga `operator`?
13. **PDF PK-TAL** sebagai acuan tata letak template naskah (kop, urutan bagian, tabel SRU)
    — setuju dipakai sebagai template resmi generator?

**STOP — menunggu persetujuan Anda sebelum Fase 1 dimulai.**
