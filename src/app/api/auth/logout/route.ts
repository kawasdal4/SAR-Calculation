import { NextResponse } from 'next/server';

/**
 * POST /api/auth/logout — hapus cookie sesi `sar_session`.
 */
const COOKIE_NAME = 'sar_session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
