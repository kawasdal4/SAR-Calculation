# AI SAR Copilot — Arsitektur & Panduan Pengembangan

Status: **Fase 0–6 selesai** (rencana `docs/AI_COPILOT_FASE0.md`, keputusan resmi
`docs/AI_COPILOT_KEPUTUSAN.md`). Dokumen ini referensi teknis harian: peta modul,
konfigurasi, alur data, dan cara menambah tool/worksheet/jenis insiden/golden case.

---

## 1. Ringkasan

AI Copilot berdiri DI ATAS mesin kalkulasi SAR yang sudah berjalan — AI tidak pernah
menghitung ulang atau mengubah angka. Dua kemampuan terintegrasi:

- **A. Case Analysis to SAR Operation** — teks/PDF soal kasus → ekstraksi
  (`parse_case`) → konfirmasi per-field → terapkan ke worksheet → jalankan
  pipeline kalkulasi resmi → review. Angka SELALU dari fungsi deterministik.
- **B. SAR Training Scenario Generator** — generator soal ber-seed (5 jenis
  kejadian, knob kesulitan, gaya bahasa), kunci jawaban dari `run_pipeline`,
  rubrik + bank soal + ekspor PDF/JSON.

## 2. Peta modul

| Modul | Peran |
|---|---|
| `src/lib/sar/caseSchema.ts` | `SarCaseSchema` (Zod) — single source of truth data soal, konvensi eksplisit di header |
| `src/lib/sar/caseAdapter.ts` | Konversi dua arah `CaseSchema` ↔ snapshot `buildState`/`applyState`; `checkCaseCompleteness` |
| `src/lib/sar/stateToCase.ts` / `casePipeline.ts` | Snapshot → kasus → orchestrator pipeline headless (ADW→ASW→Datum→W/S/C/POD→Alokasi→CSP) |
| `src/lib/sar/validatePlan.ts` | Validator konsistensi (koordinat, waktu, endurance, satuan) |
| `src/lib/sar/capabilityRegistry.ts` | ±50 kapabilitas `execute()` headless + graph dependensi (dasar `run_worksheet`) |
| `src/lib/ai/tools/*` | Tool server: `serverTools.ts` (get_state/run_worksheet/run_pipeline/lookup_table/…), `setFields.ts` (set_fields generik), `lookupTable.ts` |
| `src/lib/ai/parseCase.ts` | Skema JSON ekstraksi + system instruction + Zod revalidasi + `buildApplyPlan` |
| `src/app/api/ai/parse-case/route.ts` | Endpoint ekstraksi (1 panggilan tanpa tools, response_format JSON, retry validasi ≤2×/model) |
| `src/lib/ai/geminiClient.ts` / `config.ts` | Interactions API (`store:false`), retry/backoff, key server-only `GEMINI_API_KEY` |
| `src/lib/ai/changeLog.ts` | `CaseChangeLog` per-batch (before/after, undo) + badge "diisi AI" |
| `src/lib/sar/fillForm.ts` | `fill_form` RENOPS/Briefing/De-briefing (deterministik dari state + narasi LLM) |
| `src/lib/sar/scenarioBank.ts` | Bank lokasi/aset/kejadian untuk generator (import `src/data/*.json`) |
| `src/lib/sar/caseGenerator.ts` / `caseNarrative.ts` / `caseNaskah.ts` | Generator ber-seed, knob kesulitan, narasi, template naskah PK-TAL |
| `src/lib/sar/caseAnswerKey.ts` | Kunci jawaban = `run_pipeline` dari kasus |
| `src/lib/ai/evalGolden.ts` | Comparator akurasi per field (golden set vs hasil ekstraksi) — pure |
| `scripts/evalParseCase.ts` | Runner eval (`bun run eval:ai`) |
| `src/lib/sar/kansarBoundaries.ts` / `transportFacilities.ts` | Data referensi peta (43 batas KANSAR, 170 fasilitas, 44 posisi kantor SAR) |

## 3. Konfigurasi environment (semua server-side)

| Variabel | Kegunaan |
|---|---|
| `GEMINI_API_KEY` | Wajib untuk fitur AI (agent + parse-case + narasi generator). Tidak ada key client. |
| `GEMINI_MODEL_AGENT` / `GEMINI_MODEL_EXTRACTION` | Override model per alur (default `gemini-3.8-flash`). |
| `GEMINI_MODEL_FALLBACKS` | Daftar fallback dipisah koma; default tanpa `gemini-4-*`. |
| `DATABASE_URL` | Prisma (Postgres prod; SQLite dev via `prisma/schema.sqlite.prisma`). |
| `NEXT_PUBLIC_ONC_SCAN_TILE_URL` | Tile scan ONC opsional di Worksheet 4. |

Model Prisma AI: `CaseChangeLog`, `AiSessionLog` (metadata saja — tanpa isi
prompt/secret), `CaseBankItem`.

## 4. Alur "Ekstrak → Konfirmasi → Terapkan → Hitung → Review"

1. Pengguna menempel teks/mengunggah PDF soal → `/api/ai/parse-case` →
   structured output JSON (`CASE_EXTRACTION_JSON_SCHEMA`), Zod revalidasi,
   retry dengan pesan error validasi.
2. Panel pratinjau per-field (`CaseExtractionCard.tsx`): nilai, sumber,
   status OK/DIASUMSIKAN/HILANG. Field `missing` wajib diisi/disetujui.
3. "Konfirmasi & Terapkan" → `buildApplyPlan` (deterministik) → handler apply
   halaman yang SAMA dengan tool `set_*_case` → `CaseChangeLog` per-batch (undo).
4. `run_pipeline` menjalankan kalkulasi resmi; AI hanya memberi catatan review.

## 5. Golden set & eval

- `tests/golden/pk-tal.case.json` — fixture input soal PK-TAL (Final Test Diklat
  SAR Planning Angk. XL 2026), diekstrak dari PDF resmi, asumsi dicatat di
  `meta.assumptions`. **Kunci jawaban (nilai expected) diisi instruktur** via
  `pk-tal.expected.json` — sampai itu ada tidak ada angka yang dikarang
  (keputusan no. 8).
- `bun run eval:ai` — menjalankan `parse_case` pada golden set lalu membandingkan
  hasil ekstraksi dengan fixture per field:

  ```bash
  GEMINI_API_KEY=... bun run eval:ai            # laporan console + JSON
  bun run eval:ai -- --strict --min-accuracy 90 # exit 1 bila di bawah ambang
  ```

  Khusus `aeroDrift.windLayers` (per `altitudeFt`), `sea.surfaceWindSeries`
  (per `obsTime`), dan `sru` (per `callsign`) — urutan tidak menghukum; angka
  toleransi 1e-6; `tasksRequested` dibandingkan sebagai set; meta proses
  (`assumptions`/`missingFields`/`fieldSources`/`extractedAt`) dikecualikan.
- Tanpa `GEMINI_API_KEY`, eval SKIP (exit 0) — aman untuk CI.
- Laporan JSON ditulis ke `tests/golden/eval-report.json` (gitignored).

## 6. Cara menambah…

### Tool baru (dipakai agent chat)
1. Definisikan logika murni di `src/lib/ai/tools/` (atau lib sar yang sudah ada).
2. Tambahkan `FunctionDeclaration` di daftar tool `/api/chat` + handler apply
   di `page.tsx` melalui MEKANISME apply yang sama (keputusan no. 5 — dilarang
   dua mekanisme update yang berbeda).
3. Normalisasi argumen bebas di `caseToolNormalize.ts` bila input model tak ketat.
4. Test: `tests/serverTools.test.ts` / `tests/caseToolNormalize.test.ts`.

### Worksheet baru
1. Math = pure function di `src/lib/sar/` (dilarang inline di komponen).
2. Daftarkan kapabilitas + dependensi di `capabilityRegistry.ts`.
3. Tambah field ke `caseSchema.ts` (permisif) + adapter (`caseAdapter.ts`).
4. Tool `set_*_case` hanya bila AI perlu mengisinya; masukkan ke chain
   (`caseChain.ts` WORKSHEET_CHAIN_ORDER).
5. Test regresi: nilai sebelum/sesudah refactor HARUS identik.

### Jenis insiden baru (generator soal)
1. Tambahkan enum `INCIDENT_TYPES` di `caseSchema.ts`.
2. Bank kejadian + template di `scenarioBank.ts` / `caseNaskah.ts`
   (keputusan no. 13: nilai PK-TAL tidak di-hardcode).
3. Lengkapkan `checkCaseCompleteness` + generator knobs (`caseGenerator.ts`).
4. `caseAnswerKey.ts` memastikan seluruh worksheet target bisa dijalankan.

### Golden case baru
1. Buat `tests/golden/<nama>.case.json` (input soal saja; sumber dicatat).
2. Asumsi/interpretasi → `meta.assumptions`; field hilang → `meta.missingFields`.
3. Kunci resmi instruktur → `<nama>.expected.json` (jangan digabung).
4. Nilai `SIMULATION`/`UNVERIFIED` dilabel eksplisit (keputusan no. 6).

## 7. Bank data & layer peta

| Data | Isi | Status |
|---|---|---|
| `src/data/locations.json` | 75 lokasi latihan (kantor SAR, bandara, pelabuhan, titik referensi) | DRAFT |
| `src/data/transportFacilities.json` | 170 fasilitas dari CSV pemilik: 132 bandara (IATA+ICAO), 19 pelabuhan (UN/LOCODE), 19 terminal/dermaga (SMDG) — koordinat eksplisit | VERIFIED, DRAFT |
| `src/data/sarOffices.json` | 43 KANSAR (titik representatif = centroid wilayah kerja dari KMZ batas) + Kantor Pusat Basarnas (geocode jalan alamat resmi) | UNVERIFIED, DRAFT |
| `src/data/kansarBoundaries.json` | GeoJSON 43 batas wilayah KANSAR (KMZ 9 Okt 2021) | Referensi latihan |

- Regenerasi: `python3 scripts/build_transport_facilities.py` dan
  `python3 scripts/build_sar_offices.py` (deterministik; CSV/KMZ dari pemilik).
- Layer peta: toggle **"Fasilitas transportasi & Kantor SAR (214)"** di
  `SeaMap.tsx` (peta laut) dan `Worksheet4MapLibre.tsx` (ONC) — warna per
  kategori (bandara biru, pelabuhan teal, terminal ungu, KANSAR merah, pusat
  cokelat). Posisi kantor = representatif/indikatif, BUKAN alamat gedung.
- Aturan provenance (keputusan no. 6/7): setiap entri membawa `source`,
  `updatedRef`, `units`, `verification` (VERIFIED/UNVERIFIED/MISSING/SIMULATION),
  `approval` (DRAFT→APPROVED oleh admin). Dilarang menebak koordinat/spesifikasi.

## 8. Testing & konvensi

- Konvensi repo: `bun test` (±50 file `.test.ts`) + `node --test` (8 file `.mjs`).
  Kelompok: `test:case`, `test:generator`, `test:eval`, `test:registry`, dst.
- `scripts/gen_case_baseline.ts` mencetak baseline perilaku — hasil refactor
  harus identik; `tests/regressionBaseline.test.ts` menjaganya.
- Setiap akhir fase: `bun test` + `bun run lint` + build; commit per fase.
- Text UI & prompt Bahasa Indonesia; angka SELALU dari kode deterministik.

## 9. Status fase

| Fase | Isi | Status |
|---|---|---|
| 1 | CaseSchema + adapter + regresi | ✅ |
| 2 | Backend proxy `@google/genai`, tool layer, CaseChangeLog/AiSessionLog | ✅ |
| 3 | `parse_case` + alur Ekstrak→Konfirmasi→Terapkan→Hitung→Review | ✅ |
| 4 | `fill_form` RENOPS/Briefing/De-briefing + POD kumulatif | ✅ |
| 5a | Generator parameter (bank lokasi/aset/kejadian, seed, knob) | ✅ |
| 5b | Narasi LLM + kunci jawaban + rubrik + bank soal + batas KANSAR | ✅ |
| 6 | Golden set, `eval:ai`, dokumentasi (`AI_COPILOT.md`, `GEMINI.md`) | ✅ |
