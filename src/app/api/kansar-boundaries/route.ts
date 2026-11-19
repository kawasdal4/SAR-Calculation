import { NextResponse } from 'next/server';
import {
  KANSAR_BOUNDARIES_GEOJSON,
  KANSAR_NAMES,
} from '@/lib/sar/kansarBoundaries';

export const runtime = 'nodejs';

/** GET /api/kansar-boundaries — FeatureCollection batas wilayah 43 KANSAR
 *  untuk layer peta laut (Leaflet) & ONC (MapLibre). Sumber: upload KMZ batas
 *  KANSAR 9 Okt 2021 (referensi latihan/visualisasi). */
export async function GET() {
  const body = JSON.stringify(KANSAR_BOUNDARIES_GEOJSON);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/geo+json; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      'X-Kansar-Names': KANSAR_NAMES.length.toString(),
    },
  });
}
