# Golden Set — Kasus Referensi

Folder ini menyimpan kasus + jawaban referensi untuk test regresi & eval AI
(keputusan implementasi no. 8).

## pk-tal.case.json

Fixture **Final Test PK-TAL** (Diklat SAR Tingkat Spesialis SAR Planning Angk. XL
Tahun 2026) — diekstrak dari PDF resmi soal (`upload/Pusat Final Test XL 2026
_1711_1200_rev kapten psw.pdf`). Semua angka di fixture berasal dari soal;
interpretasi/asumsi dan field yang hilang dicatat di `meta.assumptions` /
`meta.missingFields`.

**Kunci jawaban (nilai expected): belum diisi.**
Sesuai keputusan implementasi, nilai expected diisi pemilik dari kunci jawaban
resmi instruktur. Sampai itu terjadi test TIDAK mengarang angka expected —
test hanya memverifikasi determinisme, alur, dan rentang kewajaran (sanity),
dengan penanda `TODO: expected values from instructor key`.

Cara menambahkan kunci: buat `pk-tal.expected.json` berisi hasil resmi
(datum, A-B-C-D, ASW, W/S/C/POD per SRU, alokasi, CSP) lalu hubungkan ke
`tests/casePipeline.test.ts`.

## Eval AI (`bun run eval:ai`)

Menjalankan `parse_case` pada soal PK-TAL lalu membandingkan hasil ekstraksi
dengan fixture ini per field — akurasi per bagian (comparator:
`src/lib/ai/evalGolden.ts`; runner: `scripts/evalParseCase.ts`).

```bash
GEMINI_API_KEY=... bun run eval:ai             # laporan console + JSON
bun run eval:ai -- --strict --min-accuracy 90  # exit 1 bila di bawah ambang
```

- Tanpa `GEMINI_API_KEY` → SKIP (exit 0) — aman untuk CI.
- Khusus `aeroDrift.windLayers` (per `altitudeFt`), `sea.surfaceWindSeries`
  (per `obsTime`), dan `sru` (per `callsign`) urutan entri tidak menghukum;
  `tasksRequested` dibandingkan sebagai set; meta proses dikecualikan.
- Laporan JSON → `tests/golden/eval-report.json` (gitignored).
- Ini mengukur **ketepatan ekstraksi soal**, bukan kunci jawaban perhitungan.
