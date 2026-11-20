import { NextRequest, NextResponse } from 'next/server';
import { deleteTempMapById, loadTempMap } from '@/lib/sar/tempMapStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function asciiFallback(name: string): string {
  const ascii = name.replace(/[^\w.\- ]+/g, '_');
  return ascii || 'map';
}

/**
 * GET /api/maps/temp/[id]?variant=original|raster
 * — melayani berkas peta hasil scan yang masih berlaku (< 6 jam).
 * variant=raster hanya untuk upload PDF (PNG halaman pertama untuk tampilan);
 * variant=original (default) selalu berkas ASLI yang diunggah, tanpa perubahan.
 * Bila kedaluwarsa → 410 Gone dan objeknya dihapus.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const variant = new URL(_req.url).searchParams.get('variant') === 'raster' ? 'raster' : 'original';
    const loaded = await loadTempMap(id, variant);
    if (!loaded.ok) {
      const status = loaded.code === 'expired' ? 410 : 404;
      const message = loaded.code === 'expired'
        ? 'Peta sementara sudah kedaluwarsa (>6 jam) dan dihapus.'
        : 'Peta sementara tidak ditemukan (sudah dihapus saat refresh/browser ditutup, atau ID salah).';
      return NextResponse.json({ error: message }, { status });
    }
    const { fileName, mimeType, bytes } = loaded.data;
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename="${asciiFallback(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, max-age=600',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** DELETE /api/maps/temp/[id] — hapus langsung (tombol "Ganti peta"). */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const deleted = await deleteTempMapById(id);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
