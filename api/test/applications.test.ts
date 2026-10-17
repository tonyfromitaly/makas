import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@makas/core';
import { openDatabase } from '../src/db';
import { loadConfig } from '../src/config';
import { argon2Deps, buildServer } from '../src/server';
import type { Mail } from '../src/email';

// While payments are off: the website takes applications, the operator approves, the owner gets the key by e-mail.
describe('applications (payments off)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let db: Awaited<ReturnType<typeof openDatabase>>;
  const mails: Mail[] = [];
  const ADMIN = 'test-admin-key';
  const call = async (method: string, url: string, opts: { token?: string; body?: unknown } = {}) => {
    const r = await app.inject({ method: method as any, url, headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}, payload: opts.body as any });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
  };
  const apply = (email: string) =>
    call('POST', '/api/billing/checkout', {
      body: { shop_name: 'Berber Selim', owner_name: 'Selim Usta', email, country: 'TR', timezone: 'Europe/Istanbul', language: 'tr' },
    });

  beforeAll(async () => {
    db = await openDatabase('pglite:memory');
    await migrate(db);
    app = await buildServer({
      db,
      config: loadConfig({ jwtSecret: 'test-jwt-secret-that-is-long-enough-123', allowSignup: false, publicUrl: 'https://fade.test' }),
      deps: argon2Deps,
      prefix: '/api',
      payments: null,
      mailer: { send: async (m) => void mails.push(m) },
      publicUrl: 'https://fade.test',
    });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('the website form becomes an application; sending it twice keeps one', async () => {
    expect((await call('GET', '/api/billing/plan')).body).toEqual({ enabled: false, applications: true });
    expect((await apply('selim@example.com')).body).toEqual({ applied: true });
    expect((await apply('Selim@Example.com')).body).toEqual({ applied: true });
    const list = await call('GET', '/api/admin/signups', { token: ADMIN });
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ email: 'selim@example.com', shop_name: 'Berber Selim', status: 'pending' });
    expect(mails).toHaveLength(0);
  });

  it('only the operator sees and approves applications', async () => {
    expect((await call('GET', '/api/admin/signups')).status).toBe(401);
    expect((await call('GET', '/api/admin/signups', { token: 'wrong' })).status).toBe(401);
  });

  it('approving opens the shop on a trial and e-mails the link and key', async () => {
    const id = (await call('GET', '/api/admin/signups', { token: ADMIN })).body.data[0].id;
    const r = await call('POST', `/api/admin/signups/${id}/approve`, { token: ADMIN, body: { status: 'trial', days: 30 } });
    expect(r.body.emailed).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('selim@example.com');
    expect(mails[0].text).toContain('30 günlük deneme');
    const key = mails[0].text.match(/FADE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)![0];
    expect(mails[0].text).toContain(`https://fade.test/app/#key=${key}`);
    expect((await call('POST', `/api/admin/signups/${id}/approve`, { token: ADMIN, body: {} })).body.error.code).toBe('NOT_PENDING');

    const k = await call('POST', '/api/auth/key', { body: { key, password: 'selim-secret-1' } });
    const me = await call('GET', '/api/shops/me', { token: k.body.access_token });
    expect(me.body.shop.name).toBe('Berber Selim');
    expect(me.body.subscription.status).toBe('trial');
    expect(me.body.locked).toBe(false);
  });

  it('rejecting closes an application without opening a shop', async () => {
    await apply('other@example.com');
    const pending = (await call('GET', '/api/admin/signups', { token: ADMIN })).body.data;
    expect((await call('POST', `/api/admin/signups/${pending[0].id}/reject`, { token: ADMIN })).body.rejected).toBe(true);
    expect((await call('GET', '/api/admin/signups', { token: ADMIN })).body.data).toHaveLength(0);
    expect(mails).toHaveLength(1);
  });

  it('field sales: the operator invites a salon directly; it starts with the salon menu', async () => {
    const r = await call('POST', '/api/admin/invites', {
      token: ADMIN,
      body: { shop_name: 'Salon Elif', owner_name: 'Elif Hanım', email: 'elif@example.com', country: 'TR', timezone: 'Europe/Istanbul', language: 'tr', business_type: 'salon', status: 'trial', days: 14 },
    });
    expect(r.body.emailed).toBe(true);
    const mail = mails[mails.length - 1];
    expect(mail.to).toBe('elif@example.com');
    const key = mail.text.match(/FADE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)![0];
    const k = await call('POST', '/api/auth/key', { body: { key, password: 'elif-secret-12' } });
    const me = await call('GET', '/api/shops/me', { token: k.body.access_token });
    expect(me.body.shop.business_type).toBe('salon');
    const services = (await call('GET', '/api/services', { token: k.body.access_token })).body.data.map((s: any) => s.name);
    expect(services).toEqual(expect.arrayContaining(['Kesim & fön', 'Boya', 'Röfle']));
    expect((await call('POST', '/api/admin/invites', { token: ADMIN, body: { shop_name: 'X', owner_name: 'X', email: 'elif@example.com', country: 'TR', timezone: 'UTC' } })).body.error.code).toBe('EMAIL_TAKEN');
    mails.pop();
  });

  it('the operator can e-mail a fresh key to an existing owner', async () => {
    const shop = (await db.query(`select id from shops where name = 'Berber Selim'`)).rows[0];
    expect((await call('POST', `/api/admin/shops/${shop.id}/invite`, { token: ADMIN })).body.emailed).toBe(true);
    expect(mails).toHaveLength(2);
  });
});
