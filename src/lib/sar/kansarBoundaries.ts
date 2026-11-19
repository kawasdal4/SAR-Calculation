/**
 * KANSAR BOUNDARIES (Fase 5b) — batas wilayah kerja 43 Kantor SAR Basarnas.
 *
 * Sumber: upload "BATAS WILAYAH KANSAR 9 OKT 21.kmz" (folder KANSAR BARU DAN
 * PERUBAHAN = revisi 2021; KANSAR LAMA = poligon dasar) yang diparsing ke
 * `src/data/kansarBoundaries.geojson` (disederhanakan Douglas-Peucker 0.004°
 * ≈ 450 m untuk layer tampilan — lihat scripts/build_basarnas_bank.py).
 *
 * ATURAN:
 *  - Data referensi latihan/visualisasi; BUKAN dokumen operasi resmi dan bukan
 *    pengganti batas yang ditetapkan kopal/makorsar.
 *  - `pointInKansarPolygon()` dipakai generator soal untuk menyebut Kantor SAR
 *    yang wilayahnya memuat LKP — pemeriksaan geometri deterministik, tanpa
 *    tebakan.
 */

import boundariesData from '../../data/kansarBoundaries.json';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export interface KansarBoundaryProperties {
  kansar: string;
  kansarId: string;
  sumber: string;
}

type KansarGeometry = MultiPolygon | Polygon;
export type KansarFeature = Feature<KansarGeometry, KansarBoundaryProperties>;

export const KANSAR_BOUNDARIES_GEOJSON = boundariesData as unknown as FeatureCollection<KansarGeometry, KansarBoundaryProperties>;

/** Daftar nama 43 KANSAR (urut abjad) — untuk lookup UI/generator. */
export const KANSAR_NAMES: string[] = KANSAR_BOUNDARIES_GEOJSON.features
  .map((f) => f.properties.kansar)
  .sort((a, b) => a.localeCompare(b, 'id-ID'));

export function findKansarFeature(name: string): KansarFeature | undefined {
  const key = name.trim().toLowerCase();
  return KANSAR_BOUNDARIES_GEOJSON.features.find((f) => f.properties.kansar.toLowerCase() === key);
}

function ringsOf(geometry: KansarGeometry): Array<Array<[number, number]>> {
  if (geometry.type === 'Polygon') return geometry.coordinates as Array<Array<[number, number]>>;
  return geometry.coordinates.flat() as Array<Array<[number, number]>>;
}

/** Ray casting titik-dalam-poligon untuk satu ring (lng, lat). */
function pointInRing(lng: number, lat: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Nama KANSAR yang wilayahnya memuat titik (dipakai generator: LKP → Kantor
 *  SAR). Ring luar dipakai saja (ring dalam/engsel jarang di data ini). */
export function pointInKansarPolygon(lng: number, lat: number): string | undefined {
  for (const f of KANSAR_BOUNDARIES_GEOJSON.features) {
    for (const ring of ringsOf(f.geometry)) {
      if (ring.length >= 4 && pointInRing(lng, lat, ring)) {
        return f.properties.kansar;
      }
    }
  }
  return undefined;
}
