import { NextRequest, NextResponse } from 'next/server';
import { releaseTempMaps, sweepExpiredTempMaps } from '@/lib/sar/tempMapStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/maps/temp/release — hapus segera berkas peta sementara milik
 * sesi yang baru saja ditutup. Dipanggil lewat `navigator.sendBeacon` pada
 * event pagehide (refresh/tutup tab) sehingga berkas R2 terhapus saat itu
 * juga; pengaman kedua di client menyimpan daftar ID di sessionStorage dan
 * menuntaskan penghapusan pada load berikutnya bila beacon gagal.
 * Body: { ids: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids)
      ? body!.ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
    const deleted = await releaseTempMaps(ids);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** GET /api/maps/temp/release — jalankan sweep kedaluwarsa (6 jam) manual. */
export async function GET() {
  try {
    const swept = await sweepExpiredTempMaps();
    return NextResponse.json({ ok: true, swept });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
