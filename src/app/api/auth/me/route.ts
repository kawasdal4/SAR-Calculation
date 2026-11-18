import { NextRequest } from 'next/server';
import { getSession, unauthorized } from '@/lib/auth';

/**
 * GET /api/auth/me — identitas sesi saat ini (u = identifier, r = role).
 * Dipakai client (header app, halaman /akun) untuk mengetahui role.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return unauthorized();
  return Response.json({ u: session.u, r: session.r });
}
