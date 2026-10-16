import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { fromPGlite, migrate, withTenant, type Database } from '@makas/core';
import { loadConfig } from '../src/config';
import { argon2Deps, buildServer } from '../src/server';

// Managed Postgres (Render, Heroku, Supabase...) gives a database owner that is NOT a superuser and
// may not create roles. Migrations must still apply, and FORCE'd row-level security must still isolate shops.
describe('non-superuser database owner', () => {
  let lite: PGlite;
  let db: Database;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const call = async (method: string, url: string, token?: string, body?: unknown) => {
    const r = await app.inject({ method: method as any, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body as any });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
  };

  beforeAll(async () => {
    lite = await PGlite.create({ extensions: { btree_gist }, parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) } });
    await lite.exec(`
      create role app_owner login nosuperuser nocreaterole;
      grant create on database postgres to app_owner;
      grant all on schema public to app_owner;
      set role app_owner;`);
    const who = await lite.query<{ su: boolean }>(`select rolsuper as su from pg_roles where rolname = current_user`);
    expect(who.rows[0].su).toBe(false);
    db = fromPGlite(lite as any);
    await migrate(db);
    app = await buildServer({ db, config: loadConfig({ jwtSecret: 'test-jwt-secret-that-is-long-enough-123' }), deps: argon2Deps, authRateLimit: 1000 });
  });
  afterAll(async () => {
    await app.close();
    await lite.close();
  });

  it('applies every migration without superuser or CREATEROLE', async () => {
    const r = await db.query<{ n: number }>('select count(*)::int as n from schema_migrations');
    expect(r.rows[0].n).toBeGreaterThanOrEqual(4);
  });

  it('isolates shops through FORCE row-level security on the owner connection', async () => {
    const reg = async (n: string) =>
      (
        await call('POST', '/auth/register', undefined, {
          shop_name: n, owner_name: n, email: `${n}@example.com`, password: 'correct-horse-battery', country: 'US', timezone: 'UTC', language: 'en',
        })
      ).body;
    const a = await reg('alpha');
    const b = await reg('bravo');
    const cb = await call('POST', '/clients', b.access_token, { name: 'Bravo Client', phone_e164: '+14155550101', consent: true });
    expect(cb.status).toBe(201);
    expect((await call('GET', `/clients/${cb.body.id}`, a.access_token)).status).toBe(404);
    expect((await call('GET', '/clients', a.access_token)).body.data).toHaveLength(0);
    const raw = await withTenant(db, a.shop.id, async (tx) => (await tx.query('select id from clients')).rows);
    expect(raw).toHaveLength(0);
    // Without btree_gist the API still refuses a double booking.
    const svc = await call('POST', '/services', a.access_token, { name: 'Cut', price_cents: 3000, duration_min: 30 });
    const ca = await call('POST', '/clients', a.access_token, { name: 'Alpha Client', phone_e164: '+14155550102', consent: true });
    const first = await call('POST', '/appointments', a.access_token, { client_id: ca.body.id, service_id: svc.body.id, starts_at: '2030-01-01T10:00:00Z' });
    expect(first.status).toBe(201);
    const clash = await call('POST', '/appointments', a.access_token, { client_id: ca.body.id, service_id: svc.body.id, starts_at: '2030-01-01T10:15:00Z' });
    expect(clash.body.error.code).toBe('SLOT_TAKEN');
    // Logging in (system path) still works.
    expect((await call('POST', '/auth/login', undefined, { email: 'alpha@example.com', password: 'correct-horse-battery' })).status).toBe(200);
  });
});
