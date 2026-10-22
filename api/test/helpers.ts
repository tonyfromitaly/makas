import { migrate } from '@makas/core';
import { openDatabase } from '../src/db';
import { loadConfig } from '../src/config';
import { argon2Deps, buildServer } from '../src/server';

export const SERVICE_KEY = 'test-service-key-0123456789abcdef';
export const ADMIN_KEY = 'test-admin-key-0123456789abcdef';

/** Fresh in-memory Postgres (PGlite) + the real Fastify server, with a clock the test controls. */
export async function setup(start = '2026-10-15T09:00:00Z', extraDeps: Record<string, unknown> = {}, configOverrides: Record<string, unknown> = {}) {
  const db = await openDatabase('pglite:memory');
  await migrate(db);
  const clock = { now: new Date(start) };
  const config = loadConfig({
    jwtSecret: 'test-jwt-secret-that-is-long-enough-123',
    serviceApiKey: SERVICE_KEY,
    adminApiKey: ADMIN_KEY,
    now: () => clock.now,
    ...configOverrides,
  });
  const deps = { ...argon2Deps, ...extraDeps };
  const app = await buildServer({ db, config, deps, authRateLimit: 1000, rateLimit: 100_000, assistantRateLimit: 100_000, publicRateLimit: 100_000 });

  async function call(method: string, url: string, opts: { token?: string; body?: unknown } = {}) {
    const res = await app.inject({
      method: method as any,
      url,
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      payload: opts.body as any,
    });
    const body = res.body ? JSON.parse(res.body) : undefined;
    return { status: res.statusCode, body };
  }

  let n = 0;
  async function registerShop(name = 'Shop', overrides: Record<string, unknown> = {}) {
    n++;
    const res = await call('POST', '/auth/register', {
      body: {
        shop_name: name,
        owner_name: `${name} Owner`,
        email: `owner${n}-${Date.now()}@example.com`,
        password: 'correct-horse-battery',
        country: 'US',
        timezone: 'America/New_York',
        language: 'en',
        currency: 'USD',
        ...overrides,
      },
    });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    const token: string = res.body.access_token;
    const svc = await call('POST', '/services', { token, body: { name: 'Haircut', price_cents: 3000, duration_min: 30 } });
    const client = await call('POST', '/clients', {
      token,
      body: { name: 'Jane Client', phone_e164: '+1415555' + String(1000 + n).slice(-4), consent: true },
    });
    return { token, refresh: res.body.refresh_token as string, shopId: res.body.shop.id as string, service: svc.body, client: client.body, email: res.body.user.email as string };
  }

  return { app, db, clock, call, registerShop, close: async () => { await app.close(); await db.close(); } };
}
