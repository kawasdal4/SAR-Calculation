# SAR Calculation — IAMSAR Mission Co-ordinator Workbench

Web app interaktif untuk menghitung worksheet SAR dari IAMSAR Manual Volume II (2016) dan menampilkan hasilnya di peta laut online dengan batimetetri.

## Fitur

- **4 tab worksheet SAR**: AWA (Average Wind Aloft), ASW (Average Surface Wind), Datum (Wind Current + Leeway + Total Water Current + Datum Position + Total Probable Error), Search Plan (Sweep Width + Effort Allocation + POD)
- **Peta laut interaktif** dengan layer:
  - OpenStreetMap (base)
  - OpenSeaMap (seamark/bathymetri overlay)
  - GEBCO bathymetry (coloured depth, toggle + opacity slider)
  - Lat/Lon grid (degree-minute labels, zoom-aware)
- **Click-to-depth**: klik peta untuk lihat kedalaman titik via GEBCO WMS GetFeatureInfo
- **Distance measure**: klik 2+ titik untuk ukur jarak dalam NM + km
- **Cursor coordinate readout** dalam format degrees-minutes-seconds
- **Scale control** metric + nautical
- **Data cuaca real-time**:
  - **BMKG** (default untuk perairan Indonesia) — `maritim.bmkg.go.id`
  - **Open-Meteo** (fallback untuk perairan global) — `api.open-meteo.com`
- **Save/Open Case** ke database (SQLite lokal / Postgres di Vercel / in-memory fallback)
- **Export PDF + Excel** — Search Action Plan format IAMSAR Appendix L-23
- **Interactive charts**: POD vs Coverage (figure N-10), POSc vs Cumulative Effort (N-11/N-12), Leeway graphs (N-2/N-3), Point Datum Probability Map (figure 4-10)
- **Compare Scenarios** — bandingkan multiple what-if scenarios side-by-side
- **Pick LKP on map** — klik peta untuk set Last Known Position

## Tech Stack

- Next.js 16 (App Router) + React 19 + TypeScript 5
- Tailwind CSS 4 + shadcn/ui
- Leaflet + react-leaflet 5
- Recharts (interactive charts)
- Prisma ORM + SQLite (dev) / Postgres (prod)
- jsPDF + SheetJS (export)

## Local Development

```bash
bun install
bun run db:push    # create SQLite database
bun run dev        # start dev server at http://localhost:3000
```

## Deploy to Vercel

1. Push repo to GitHub
2. Buka https://vercel.com → **Add New** → **Project**
3. Import repo `SAR-Calculation`
4. Vercel auto-detect Next.js — klik **Deploy**

**Tanpa konfigurasi tambahan**, app akan berjalan dengan in-memory store (Save/Open Case bekerja selama sesi aktif).

### Untuk persistent storage (opsional)

1. Buat database di Vercel dashboard → **Storage** → **Create Database** (pilih Postgres)
2. Set environment variable di Vercel project settings:
   ```
   DATABASE_URL=postgres://...  # dari Vercel Storage dashboard
   ```
3. Update `prisma/schema.prisma` — ganti `provider = "sqlite"` dengan `provider = "postgresql"`
4. Push commit baru — Vercel auto-redeploy
5. (Sekali) Run `prisma db push` via Vercel CLI atau lokal dengan DATABASE_URL production

## Sumber Data (semua gratis, tanpa API key)

| Sumber | URL | Penggunaan |
|---|---|---|
| OpenStreetMap | `tile.openstreetmap.org` | Base map |
| OpenSeaMap | `tiles.openseamap.org` | Seamark overlay |
| GEBCO WMS | `wms.gebco.net` | Batimetetri + depth query |
| BMKG Maritim | `maritim.bmkg.go.id` | Data cuaca perairan Indonesia |
| Open-Meteo | `api.open-meteo.com` | Data cuaca global |

## Disclaimer

⚠ **Bukan untuk navigasi pelayaran; akurasi tidak dijamin.** Aplikasi ini untuk tujuan perencanaan SAR dan pelatihan. Selalu rujuk publikasi navigasi resmi untuk navigasi pelayaran.

## License

Code: MIT
Data: CC BY 4.0 (GEBCO, OpenStreetMap, OpenSeaMap), public domain (BMKG)
