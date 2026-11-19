/**
 * POST /api/documents/drafts/[id]/approve (Fase 4) — persetujuan draft dokumen
 * resmi (keputusan implementasi no.12): dokumen hasil generator/AI tetap
 * berstatus DRAFT sampai disetujui pihak berwenang (role developer/admin
 * sesuai pembagian hak akses). Menyetujui bukan mengubah isi — payload tidak
 * pernah dimodifikasi di sini.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, unauthorized } from '@/lib/auth';

/** Role yang boleh menyetujui dokumen (keputusan no.12: Developer/Admin). */
const APPROVER_ROLES = new Set(['developer', 'admin']);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = getSession(req);
  if (!session) return unauthorized();
  if (!APPROVER_ROLES.has(session.r)) {
    return NextResponse.json(
      { error: 'Menyetujui dokumen hanya untuk role Developer/Admin — dokumen tetap DRAFT.' },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: 'Id draft tidak valid.' }, { status: 400 });
  }

  try {
    const existing = await db.documentDraft.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Draft tidak ditemukan.' }, { status: 404 });
    }
    if (existing.status === 'APPROVED') {
      return NextResponse.json({
        draft: { id: existing.id, status: existing.status, approvedBy: existing.approvedBy, approvedAt: existing.approvedAt },
        alreadyApproved: true,
      });
    }
    const updated = await db.documentDraft.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: session.u,
        approvedAt: new Date(),
      },
      select: { id: true, status: true, docType: true, approvedBy: true, approvedAt: true },
    });
    return NextResponse.json({ draft: updated });
  } catch (error) {
    // Serverless read-only (Vercel): DB tidak dapat ditulis — approval lokal
    // tidak mungkin; laporkan jelas, jangan diam-diam dianggap disetujui.
    return NextResponse.json(
      { error: `Database tidak dapat ditulis — draft tetap DRAFT: ${(error as Error).message}` },
      { status: 503 },
    );
  }
}
