import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireDeveloper } from '@/lib/auth';

/**
 * DELETE /api/accounts/[id] — hapus akun (khusus role developer).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = requireDeveloper(req);
  if (error) return error;

  const { id } = await params;
  const exists = await db.account.findUnique({ where: { id } });
  if (!exists) {
    return Response.json({ error: 'Akun tidak ditemukan.' }, { status: 404 });
  }

  await db.account.delete({ where: { id } });
  return Response.json({ ok: true });
}
