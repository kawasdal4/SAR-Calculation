/**
 * FASILITAS TRANSPORTASI & KANTOR SAR — bank data + metadata layer peta
 * (permintaan pemilik: koordinat bandara/pelabuhan/dermaga + posisi seluruh
 * kantor SAR & Kantor Pusat Basarnas sebagai layer peta laut & ONC).
 *
 * Sumber (lihat masing-masing file untuk provenance per entri):
 *  - `src/data/transportFacilities.json` : 170 fasilitas dari CSV pemilik
 *    (bandara Navo24/OurAirports, pelabuhan ListBase/OpenTravelData, terminal
 *    SMDG). Koordinat eksplisit → verification VERIFIED, approval DRAFT.
 *  - `src/data/sarOffices.json` : 44 lokasi kantor SAR hasil AUDIT pemilik
 *    (Audit_Verifikasi_Koordinat_44_Lokasi_Basarnas.csv — 43 KANSAR + Kantor
 *    Pusat). Titik = kolom "Latitude/Longitude dipakai" (H13/EST/GMAP-USER/
 *    MAP-OLC/JDIH), lolos mask darat-laut; BUKAN hasil survei GNSS bangunan →
 *    verification UNVERIFIED, approval DRAFT.
 *
 * Data di-bundle lewat import JSON (`resolveJsonModule`) — total ±220 titik,
 * ringan untuk layer peta. Prisma `CaseBankItem` tetap jalur penyimpanan
 * master data yang disetujui (keputusan no. 7).
 */

import facilitiesData from '../../data/transportFacilities.json';
import officesData from '../../data/sarOffices.json';

export type FacilityCategory = 'bandara' | 'pelabuhan' | 'terminal-dermaga';
export type SarOfficeCategory = 'kantor-sar' | 'kantor-pusat';

export interface TransportFacilityEntry {
  id: string;
  kind: 'transport-facility';
  name: string;
  category: FacilityCategory;
  lat: number;
  lng: number;
  specs: {
    cityRegion?: string;
    code?: string;
    secondaryCode?: string;
    sizeClass?: string;
  };
  mapUrl?: string;
  source: string;
  updatedRef: string | null;
  units: string;
  verification: 'VERIFIED' | 'UNVERIFIED' | 'MISSING' | 'SIMULATION';
  approval: 'DRAFT' | 'APPROVED';
}

export interface SarOfficeEntry {
  id: string;
  kind: 'sar-office';
  name: string;
  category: SarOfficeCategory;
  lat: number;
  lng: number;
  specs: {
    kansar?: string;
    address?: string;
    positionBasis?: string;
  };
  source: string;
  /** Tautan Google Maps rujukan audit (provenance; belum dipakai UI). */
  mapUrl?: string;
  updatedRef: string;
  units: string;
  verification: 'VERIFIED' | 'UNVERIFIED' | 'MISSING' | 'SIMULATION';
  approval: 'DRAFT' | 'APPROVED';
}

/** 170 fasilitas transportasi (bandara 132, pelabuhan 19, terminal/dermaga 19). */
export const TRANSPORT_FACILITIES = facilitiesData as TransportFacilityEntry[];

/** 44 lokasi kantor SAR hasil audit pemilik (43 KANSAR + Kantor Pusat). */
export const SAR_OFFICES = officesData as SarOfficeEntry[];

/** Warna titik per kategori — dipakai konsisten di peta laut (leaflet) & ONC (maplibre). */
export const FACILITY_LAYER_COLORS: Record<FacilityCategory | SarOfficeCategory, string> = {
  'bandara': '#2563eb',        // biru
  'pelabuhan': '#0d9488',      // teal
  'terminal-dermaga': '#7c3aed', // ungu
  'kantor-sar': '#dc2626',     // merah
  'kantor-pusat': '#b45309',   // cokelat kemerahan (kontras dari merah KANSAR)
};

export const FACILITY_LAYER_LABELS: Record<FacilityCategory | SarOfficeCategory, string> = {
  'bandara': 'Bandara',
  'pelabuhan': 'Pelabuhan',
  'terminal-dermaga': 'Terminal / dermaga',
  'kantor-sar': 'Kantor SAR (KANSAR)',
  'kantor-pusat': 'Kantor Pusat Basarnas',
};

/** Tooltip ringkas untuk marker peta — name + kode + catatan provenance. */
export function facilityTooltip(entry: TransportFacilityEntry | SarOfficeEntry): string {
  const code = 'specs' in entry
    ? (entry as TransportFacilityEntry).specs.code || ''
    : '';
  const base = code ? `${entry.name} (${code})` : entry.name;
  if (entry.kind === 'sar-office') {
    const basis = (entry as SarOfficeEntry).specs.positionBasis;
    return `${base} — hasil audit pemilik: ${basis ?? 'UNVERIFIED, bukan GNSS bangunan'}`;
  }
  return `${base} — ${entry.verification.toLowerCase()} (${entry.source})`;
}

/** Daftar semua titik untuk layer peta (fasilitas + kantor SAR + pusat). */
export function allFacilityPoints(): Array<TransportFacilityEntry | SarOfficeEntry> {
  return [...TRANSPORT_FACILITIES, ...SAR_OFFICES];
}

/** Filter per kategori (dipakai bila peta ingin memecah toggle). */
export function pointsByCategory(category: FacilityCategory | SarOfficeCategory): Array<TransportFacilityEntry | SarOfficeEntry> {
  return allFacilityPoints().filter((e) => e.category === category);
}
