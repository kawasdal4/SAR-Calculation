import { createHmac, createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

/**
 * Utilitas auth untuk API routes (Node runtime).
 * Format token sesi: base64url(payload).base64url(HMAC-SHA256) —
 * harus identik dengan verifikasi Web Crypto di src/proxy.ts.
 */

export const COOKIE_NAME = 'sar_session';

export interface SessionPayload {
  u: string;
  r: string;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Buat token sesi bertanda tangan untuk payload {u, r, exp}. */
export function createSessionToken(
  u: string,
  r: string,
  ttlSeconds: number,
): string {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ u, r, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
    ),
  );
  const secret = process.env.SAR_AUTH_SECRET ?? '';
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Verifikasi token sesi (HMAC + masa berlaku). Null jika tidak valid. */
export function verifySessionToken(
  token: string | undefined | null,
): SessionPayload | null {
  const secret = process.env.SAR_AUTH_SECRET;
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = b64urlDecode(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const data = JSON.parse(
      b64urlDecode(payload).toString('utf8'),
    ) as SessionPayload;
    if (!data.exp || Date.now() >= data.exp * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

/** Ambil sesi dari cookie permintaan. */
export function getSession(req: NextRequest): SessionPayload | null {
  return verifySessionToken(req.cookies.get(COOKIE_NAME)?.value);
}

/** Respon 401 standar untuk akses tanpa/tidak sesuai sesi. */
export function unauthorized(message = 'Unauthorized') {
  return Response.json({ error: message }, { status: 401 });
}

/** Guard API khusus role developer. Kembalikan sesi atau error 401. */
export function requireDeveloper(req: NextRequest): {
  session: SessionPayload | null;
  error: Response | null;
} {
  const session = getSession(req);
  if (!session) return { session: null, error: unauthorized() };
  if (session.r !== 'developer') {
    return { session: null, error: unauthorized('Hanya role developer.') };
  }
  return { session, error: null };
}

// ===== Password hashing (scrypt, format "salt:hash" hex) =====

/** Hash password dengan scrypt + salt acak. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** Verifikasi password terhadap hash scrypt (tahan-timing). */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const given = scryptSync(password, salt, expected.length);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Perbandingan string tahan-timing via SHA-256 (panjang disamakan). */
export function safeCompare(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
