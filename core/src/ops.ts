import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { ApiError, Res, errorBody, ok, type Config, type Route } from './http';
import { safeEqual, sha256 } from './auth';
import type { Queryable } from './db';

// The operator panel (our side: support threads, applications, invites). Signing in takes the admin key
// and, when ADMIN_TOTP_SECRET is set, a 6-digit code from an authenticator app (multi-factor, as the FTC
// Safeguards Rule and Plaid expect for anyone who can reach customer data). The result is a 30-minute
// session token. Every admin request, and every failed sign-in, is written to operator_log.

export const OPS_TTL_SEC = 30 * 60;
const LOCK_AFTER = 5;
const LOCK_WINDOW_MS = 15 * 60_000;
const AUD = 'monacount-ops';

/** RFC 4648 base32 (what authenticator apps use) to bytes. */
export function base32(s: string) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = abc.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** RFC 6238 TOTP: HMAC-SHA1, 30-second steps, 6 digits. */
export async function totp(secret: string, at: Date, step = 0) {
  const counter = Math.floor(at.getTime() / 30_000) + step;
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setUint32(4, counter >>> 0);
  new DataView(msg.buffer).setUint32(0, Math.floor(counter / 2 ** 32));
  const key = await crypto.subtle.importKey('raw', base32(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** The code now, or one step either side (phone clocks drift). */
export async function verifyTotp(secret: string, code: string, at: Date) {
  if (!/^\d{6}$/.test(code)) return false;
  for (const step of [0, -1, 1]) if (await safeEqual(await totp(secret, at, step), code)) return true;
  return false;
}

// Rotating the admin key ends every open session: the token carries a fingerprint of the key.
const fingerprint = async (config: Config) => (await sha256(`ops:${config.adminApiKey}`)).slice(0, 16);
const jwtKey = (config: Config) => new TextEncoder().encode(config.jwtSecret);

export async function signOps(config: Config) {
  const now = Math.floor(config.now().getTime() / 1000);
  return new SignJWT({ k: await fingerprint(config) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('operator')
    .setIssuedAt(now)
    .setExpirationTime(now + OPS_TTL_SEC)
    .setAudience(AUD)
    .sign(jwtKey(config));
}

export async function verifyOps(config: Config, token: string) {
  try {
    const { payload } = await jwtVerify(token, jwtKey(config), { algorithms: ['HS256'], audience: AUD, currentDate: config.now() });
    return payload.sub === 'operator' && payload.k === (await fingerprint(config));
  } catch {
    return false;
  }
}

export async function logOperator(db: Queryable, e: { action: string; target?: string | null; ip?: string | null; ok: boolean; at: Date }) {
  await db.query('insert into operator_log (action, target, ip, ok, at) values ($1, $2, $3, $4, $5)', [
    e.action.slice(0, 120),
    e.target?.slice(0, 120) ?? null,
    e.ip?.slice(0, 64) ?? null,
    e.ok,
    e.at,
  ]);
}

export const opsRoutes: Route[] = [
  {
    // Sign in to the operator panel. Five wrong tries from one address lock it for 15 minutes.
    method: 'POST',
    path: '/admin/session',
    auth: 'public',
    body: z.object({ key: z.string().min(1).max(200), code: z.string().trim().max(10).optional() }),
    async handler(ctx, { body, ip }) {
      const failures = (
        await ctx.db.query(`select count(*)::int as n from operator_log where action = 'session' and not ok and ip = $1 and at > $2`, [
          ip ?? '',
          new Date(ctx.now.getTime() - LOCK_WINDOW_MS),
        ])
      ).rows[0].n;
      if (failures >= LOCK_AFTER) throw new ApiError(429, 'LOCKED', 'Too many failed sign-ins. Try again in 15 minutes.');
      const mfa = !!ctx.config.adminTotpSecret;
      const good = (await safeEqual(body.key, ctx.config.adminApiKey)) && (!mfa || (await verifyTotp(ctx.config.adminTotpSecret!, body.code ?? '', ctx.now)));
      await logOperator(ctx.db, { action: 'session', ip, ok: good, at: ctx.now });
      // Returned, not thrown: a thrown error would roll back the log row that counts toward the lock.
      if (!good) return new Res(401, errorBody('UNAUTHORIZED', mfa ? 'Wrong key or code' : 'Wrong key'));
      return ok({ token: await signOps(ctx.config), expires_in: OPS_TTL_SEC, mfa });
    },
  },
  {
    // Who did what in the panel, newest first.
    method: 'GET',
    path: '/admin/log',
    auth: 'admin',
    async handler(ctx) {
      const { rows } = await ctx.db.query('select action, target, ip, ok, at from operator_log order by at desc limit 200');
      return { data: rows };
    },
  },
];
