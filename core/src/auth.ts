import { SignJWT, jwtVerify } from 'jose';
import type { Config } from './http';
import { unauthorized } from './http';
import type { Queryable } from './db';

export interface AccessClaims {
  sub: string;
  shop: string;
  role: 'owner' | 'barber';
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccess(config: Config, claims: AccessClaims) {
  return new SignJWT({ shop: claims.shop, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt(Math.floor(config.now().getTime() / 1000))
    .setExpirationTime(Math.floor(config.now().getTime() / 1000) + config.accessTtlSec)
    .setAudience('makas-app')
    .sign(key(config.jwtSecret));
}

export async function verifyAccess(config: Config, token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, key(config.jwtSecret), {
      algorithms: ['HS256'],
      audience: 'makas-app',
      currentDate: config.now(),
    });
    if (typeof payload.sub !== 'string' || typeof payload.shop !== 'string') throw new Error('claims');
    return { sub: payload.sub, shop: payload.shop as string, role: payload.role as AccessClaims['role'] };
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

export async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return b64url(new Uint8Array(d));
}

/** Constant-time comparison of two secrets (compares digests so lengths never leak). */
export async function safeEqual(a: string, b: string) {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Issues an access token plus a fresh refresh token in the given family (rotation). */
export async function issueTokens(
  db: Queryable,
  config: Config,
  user: { id: string; shop_id: string; role: 'owner' | 'barber' },
  familyId?: string,
) {
  const refresh = randomToken();
  const family = familyId ?? crypto.randomUUID();
  const expires = new Date(config.now().getTime() + config.refreshTtlSec * 1000);
  const { rows } = await db.query(
    `insert into refresh_tokens (shop_id, user_id, token_hash, family_id, expires_at)
     values ($1, $2, $3, $4, $5) returning id`,
    [user.shop_id, user.id, await sha256(refresh), family, expires],
  );
  const access = await signAccess(config, { sub: user.id, shop: user.shop_id, role: user.role });
  return {
    tokens: { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: config.accessTtlSec },
    refreshId: rows[0].id as string,
  };
}
