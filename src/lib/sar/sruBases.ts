/**
 * PANGKALAN SRU BASARNAS — bank data + pencocokan nama pangkalan → koordinat
 * (permintaan pemilik: "lokasi SRU Kapal Basarnas" harus tampil di peta laut
 * & ONC, bersama fasilitas transportasi dan kantor SAR).
 *
 * Provenance:
 *  - `SRU_BASES` berasal dari preset pangkalan yang SUDAH ADA di aplikasi
 *    (`SRU_BASE_PRESETS` pada AssetAllocationWorksheet) — data pemilik,
 *    bukan koordinat yang dikarang. verification: VERIFIED (sumber internal),
 *    approval DRAFT.
 *  - `matchSruBaseFacility()` TIDAK mengarang koordinat: hanya memetakan nama
 *    pangkalan dari soal/AI (mis. "Pelabuhan Belawan", "Bandara Juanda",
 *    "Kantor SAR Jayapura") ke titik yang SUDAH ada di bank data
 *    (transportFacilities.json koordinat VERIFIED dari CSV pemilik, lalu
 *    sarOffices.json titik hasil audit pemilik, UNVERIFIED). Tanpa kecocokan → null,
 *    pemanggil kembali ke perilaku lama (koordinat manual/preset).
 */

import { SAR_OFFICES, TRANSPORT_FACILITIES, type TransportFacilityEntry, type SarOfficeEntry } from './transportFacilities';

export interface SruBaseEntry {
  id: string;
  kind: 'sru-base';
  name: string;
  lat: number;
  lng: number;
  /** Wilayah/kota — keterangan singkat di tooltip. */
  region: string;
  source: string;
  verification: 'VERIFIED' | 'UNVERIFIED';
}

/** Warna titik pangkalan SRU — oranye, kontras dari kantor SAR (merah). */
export const SRU_BASE_COLOR = '#ea580c';

/** Entri pangkalan sumber (dipakai ulang AssetAllocationWorksheet sebagai SRU_BASE_PRESETS). */
export const SRU_BASES: SruBaseEntry[] = [
  { id: 'sru-base-tanjung-priok', name: 'Pangkalan Tanjung Priok (Jakarta)', region: 'Jakarta', lat: -6.095, lng: 106.885 },
  { id: 'sru-base-muara-baru', name: 'Pangkalan Muara Baru (Jakarta)', region: 'Jakarta', lat: -6.115, lng: 106.802 },
  { id: 'sru-base-merak', name: 'Pangkalan Merak (Banten)', region: 'Banten', lat: -5.932, lng: 105.996 },
  { id: 'sru-base-benoa', name: 'Pangkalan Benoa (Bali)', region: 'Bali', lat: -8.752, lng: 115.215 },
  { id: 'sru-base-makassar', name: 'Pangkalan Makassar (Sulsel)', region: 'Sulawesi Selatan', lat: -5.122, lng: 119.412 },
  { id: 'sru-base-sorong', name: 'Pangkalan Sorong (Papua)', region: 'Papua Barat Daya', lat: -0.875, lng: 131.255 },
].map((base) => ({
  ...base,
  kind: 'sru-base' as const,
  source: 'Preset pangkalan SRU aplikasi (AssetAllocationWorksheet SRU_BASE_PRESETS)',
  verification: 'VERIFIED' as const,
}));

/** Tooltip ringkas untuk marker pangkalan SRU. */
export function sruBaseTooltip(entry: SruBaseEntry): string {
  return `${entry.name} — Pangkalan SRU Basarnas (${entry.verification.toLowerCase()}: preset aplikasi)`;
}

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Kata yang tidak menambah keunikan pencocokan nama pangkalan. */
const STOP_TOKENS = new Set([
  'bandara', 'airport', 'international', 'pelabuhan', 'port', 'terminal',
  'dermaga', 'pangkalan', 'kantor', 'sar', 'basarnas', 'tni', 'al', 'udara',
  'the', 'of',
]);

interface MatchablePoint {
  entry: TransportFacilityEntry | SarOfficeEntry;
  nameNorm: string;
  tokens: Set<string>;
  cityNorm: string;
  verified: boolean;
}

/** Hasil pencocokan nama pangkalan → titik bank data. */
export interface SruBaseFacilityMatch {
  entry: TransportFacilityEntry | SarOfficeEntry;
  /** Skor 0..1 — fraksi token query yang terpetakan. */
  score: number;
}

let matchableCache: MatchablePoint[] | null = null;

function getMatchablePoints(): MatchablePoint[] {
  if (matchableCache) return matchableCache;
  matchableCache = [...TRANSPORT_FACILITIES, ...SAR_OFFICES].map((entry) => {
    const nameNorm = normalizeText(entry.name);
    const code = (entry as TransportFacilityEntry).specs?.code ?? '';
    const secondaryCode = (entry as TransportFacilityEntry).specs?.secondaryCode ?? '';
    const cityRegion = (entry as TransportFacilityEntry).specs?.cityRegion
      ?? (entry as SarOfficeEntry).specs?.address ?? '';
    return {
      entry,
      nameNorm,
      tokens: new Set([
        ...nameNorm.split(' '),
        ...normalizeText(code).split(' '),
        ...normalizeText(secondaryCode).split(' '),
      ].filter((t) => t !== '')),
      cityNorm: normalizeText(cityRegion),
      verified: entry.verification === 'VERIFIED',
    };
  });
  return matchableCache;
}

/**
 * Petakan nama pangkalan SRU (bebas dari soal/AI) → titik bank data.
 *
 * Aturan konservatif: skor = token query bermakna yang muncul di nama/kode
 * dibagi jumlah token bermakna; konteks "kantor/KANSAR" memberi bonus ke titik
 * kantor SAR, konteks "pelabuhan/dermaga/terminal/bandara" memberi bonus ke
 * fasilitas; kota menambah +0.1 bila juga cocok. Terima hanya skor ≥ 0.5 —
 * supaya nama yang tidak cocok ("Dermaga Benoa") tidak jatuh ke titik yang
 * salah. Fasilitas koordinat VERIFIED diprioritaskan di atas kantor
 * (representatif) saat skor sama.
 */
export function matchSruBaseFacility(rawName: string): SruBaseFacilityMatch | null {
  const query = normalizeText(rawName);
  if (query === '') return null;
  // Token ≥ 3 huruf: kode IATA bandara 3 huruf (SUB, CGK, DPS) ikut dicocokkan.
  const meaningful = query.split(' ').filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
  if (meaningful.length === 0) return null;
  const wantsOffice = /\b(kantor|kansar)\b/.test(query);
  const wantsFacility = /\b(pelabuhan|dermaga|terminal|bandara|port|airport|lanud)\b/.test(query);

  let best: SruBaseFacilityMatch | null = null;
  let bestScore = 0;
  let bestVerified = false;
  for (const candidate of getMatchablePoints()) {
    let hits = 0;
    for (const token of meaningful) {
      if (candidate.tokens.has(token) || candidate.nameNorm.includes(token)) hits += 1;
    }
    if (hits === 0) continue;
    let score = hits / meaningful.length;
    if (wantsOffice && candidate.entry.kind === 'sar-office') score += 0.3;
    if (wantsFacility && candidate.entry.kind === 'transport-facility') score += 0.15;
    if (meaningful.some((t) => candidate.cityNorm.includes(t))) score += 0.1;
    // Wajib minimal satu token yang cocok sebagai kata/kode utuh, bukan hanya
    // potongan nama — menjaga token pendek (3 huruf) tidak serampangan.
    const exactTokenHit = meaningful.some((t) => candidate.tokens.has(t));
    const longTokenHit = meaningful.some((t) => t.length >= 4 && candidate.nameNorm.includes(t));
    if (!exactTokenHit && !longTokenHit) continue;
    const verified = candidate.verified;
    const better =
      score > bestScore + 1e-9
      || (Math.abs(score - bestScore) <= 1e-9 && verified && !bestVerified);
    if (better) {
      best = { entry: candidate.entry, score };
      bestScore = score;
      bestVerified = verified;
    }
  }
  if (!best || bestScore < 0.5) return null;
  return best;
}
