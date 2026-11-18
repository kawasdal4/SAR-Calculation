import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  COOKIE_NAME,
  createSessionToken,
  safeCompare,
  verifyPassword,
} from '@/lib/auth';

/**
 * POST /api/auth/login — autentikasi portal.
 * Urutan validasi:
 *   1. Akun dari database (identifier = Email ATAU NIP, password hash scrypt).
 *   2. Fallback akun developer dari .env (SAR_AUTH_USER / EMAIL / PASSWORD).
 * Sukses → cookie sesi `sar_session` (HMAC-SHA256, HttpOnly).
 */

export async function POST(req: NextRequest) {
  const ttl = Number(process.env.SAR_SESSION_TTL) || 28800;

  let body: { identifier?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 });
  }

  const identifier = (body.identifier ?? '').trim();
  const pass = body.password ?? '';
  if (!identifier || !pass) {
    return NextResponse.json(
      { error: 'Username/Email dan password wajib diisi.' },
      { status: 400 },
    );
  }

  // 1. Akun dari database (Email / NIP)
  const account = await db.account.findUnique({
    where: { identifier },
  });
  if (account && verifyPassword(pass, account.passwordHash)) {
    const res = NextResponse.json({ ok: true, role: account.role });
    res.cookies.set(COOKIE_NAME, createSessionToken(account.identifier, account.role, ttl), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: ttl,
    });
    return res;
  }

  // 2. Fallback akun developer dari .env
  const user = process.env.SAR_AUTH_USER ?? '';
  const email = process.env.SAR_AUTH_EMAIL ?? '';
  const password = process.env.SAR_AUTH_PASSWORD ?? '';
  if (user && email && password) {
    const idOk = safeCompare(identifier, user) || safeCompare(identifier, email);
    const passOk = safeCompare(pass, password);
    if (idOk && passOk) {
      const res = NextResponse.json({ ok: true, role: 'developer' });
      res.cookies.set(COOKIE_NAME, createSessionToken(user, 'developer', ttl), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: ttl,
      });
      return res;
    }
  }

  return NextResponse.json(
    { error: 'Username/Email/NIP atau password salah.' },
    { status: 401 },
  );
}
