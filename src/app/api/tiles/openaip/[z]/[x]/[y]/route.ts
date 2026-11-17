import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const CACHE_CONTROL = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tileError(status: number, message: string, retryAfter?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (retryAfter) headers.set('Retry-After', retryAfter);
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
): Promise<Response> {
  const { z: zText, x: xText, y: yText } = await params;
  const [z, x, y] = [zText, xText.replace(/\.pbf$/i, ''), yText.replace(/\.pbf$/i, '')].map(Number);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 14 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    return tileError(400, 'Koordinat tile OpenAIP tidak valid.');
  }

  const apiKey = process.env.OPENAIP_API_KEY;
  if (!apiKey) return tileError(503, 'OPENAIP_API_KEY belum dikonfigurasi pada backend.');

  const url = new URL(`https://api.tiles.openaip.net/api/data/openaip/${z}/${x}/${y}.pbf`);
  url.searchParams.set('apiKey', apiKey);

  let upstream: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      upstream = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    } catch {
      return tileError(502, 'Tidak dapat menghubungi layanan tile OpenAIP.');
    }
    if (upstream.status !== 429 || attempt === 2) break;
    const retryAfter = Number(upstream.headers.get('Retry-After'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 2500)
      : 300 * (2 ** attempt));
  }

  if (!upstream) return tileError(502, 'Layanan tile OpenAIP tidak mengembalikan respons.');
  if (!upstream.ok) {
    if (upstream.status === 429) return tileError(429, 'OpenAIP sedang membatasi permintaan. Coba lagi beberapa saat.', upstream.headers.get('Retry-After') ?? '5');
    return tileError(upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status,
      upstream.status === 401 || upstream.status === 403
        ? 'OpenAIP menolak API key. Periksa OPENAIP_API_KEY pada backend.'
        : `Layanan OpenAIP gagal memuat tile (HTTP ${upstream.status}).`);
  }

  const headers = new Headers({
    'Content-Type': upstream.headers.get('Content-Type') ?? 'application/x-protobuf',
    'Cache-Control': CACHE_CONTROL,
    'Access-Control-Allow-Origin': '*',
  });
  for (const name of ['ETag', 'Last-Modified', 'Expires']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(await upstream.arrayBuffer(), { status: 200, headers });
}
