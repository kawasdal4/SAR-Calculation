import { NextRequest, NextResponse } from 'next/server';
import {
  ALLOWED_MIME_TYPES,
  TEMP_MAP_MAX_BYTES,
  createTempMapUpload,
} from '@/lib/sar/tempMapStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/maps/temp — upload peta hasil scan (PNG/JPEG/WEBP/PDF) ke
 * penyimpanan SEMENTARA (R2 bila dikonfigurasi, atau disk lokal).
 * Berkas otomatis terhapus saat browser di-refresh/tutup (beacon release)
 * atau maksimum 6 jam. File asli disimpan TANPA perubahan; khusus PDF
 * ditambahkan raster PNG halaman pertama hanya untuk tampilan/cetak.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Field "file" (multipart) wajib ada.' }, { status: 400 });
    }
    const mimeType = (file.type || '').toLowerCase();
    const name = file.name || 'peta';
    const extMime = name.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : name.toLowerCase().endsWith('.png')
        ? 'image/png'
        : name.toLowerCase().match(/\.(jpe?g)$/)
          ? 'image/jpeg'
          : name.toLowerCase().endsWith('.webp')
            ? 'image/webp'
            : '';
    const resolvedMime = ALLOWED_MIME_TYPES.includes(mimeType as (typeof ALLOWED_MIME_TYPES)[number])
      ? mimeType
      : extMime;
    if (!resolvedMime || !ALLOWED_MIME_TYPES.includes(resolvedMime as (typeof ALLOWED_MIME_TYPES)[number])) {
      return NextResponse.json(
        { error: 'Format tidak didukung. Gunakan PNG, JPEG, WEBP, atau PDF.' },
        { status: 415 },
      );
    }
    if (file.size > TEMP_MAP_MAX_BYTES) {
      return NextResponse.json(
        { error: `Ukuran maksimum ${(TEMP_MAP_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB.` },
        { status: 413 },
      );
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const info = await createTempMapUpload({ fileName: name, mimeType: resolvedMime, bytes });
    return NextResponse.json({ map: info }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: `Upload gagal: ${(error as Error).message}`.slice(0, 300) },
      { status: 500 },
    );
  }
}
