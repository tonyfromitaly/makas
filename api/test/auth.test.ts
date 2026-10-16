import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from './helpers';

describe('auth', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => (t = await setup()));
  afterAll(() => t.close());

  it('stores argon2id hashes, never the password', async () => {
    const s = await t.registerShop('Hash');
    const row = (await t.db.query('select password_hash from users where lower(email) = $1', [s.email])).rows[0];
    expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row.password_hash).not.toContain('correct-horse-battery');
  });

  it('login works, wrong password is a generic 401', async () => {
    const s = await t.registerShop('Login');
    const bad = await t.call('POST', '/auth/login', { body: { email: s.email, password: 'nope-nope-nope' } });
    expect(bad.status).toBe(401);
    const unknown = await t.call('POST', '/auth/login', { body: { email: 'ghost@example.com', password: 'nope-nope-nope' } });
    expect(unknown.body.error.code).toBe(bad.body.error.code);
    const good = await t.call('POST', '/auth/login', { body: { email: s.email.toUpperCase(), password: 'correct-horse-battery' } });
    expect(good.status).toBe(200);
    expect(good.body.access_token).toBeTruthy();
  });

  it('refresh rotates; reusing an old refresh token kills the family; logout revokes', async () => {
    const s = await t.registerShop('Rotate');
    const r1 = await t.call('POST', '/auth/refresh', { body: { refresh_token: s.refresh } });
    expect(r1.status).toBe(200);
    expect(r1.body.refresh_token).not.toBe(s.refresh);
    const reuse = await t.call('POST', '/auth/refresh', { body: { refresh_token: s.refresh } });
    expect(reuse.body.error.code).toBe('TOKEN_REUSED');
    // The stolen-token alarm also ended the legit new token.
    expect((await t.call('POST', '/auth/refresh', { body: { refresh_token: r1.body.refresh_token } })).status).toBe(401);

    const login = await t.call('POST', '/auth/login', { body: { email: s.email, password: 'correct-horse-battery' } });
    expect((await t.call('POST', '/auth/logout', { body: { refresh_token: login.body.refresh_token } })).status).toBe(204);
    expect((await t.call('POST', '/auth/refresh', { body: { refresh_token: login.body.refresh_token } })).status).toBe(401);
  });

  it('access tokens are short-lived', async () => {
    const s = await t.registerShop('Expire');
    expect((await t.call('GET', '/shops/me', { token: s.token })).status).toBe(200);
    t.clock.now = new Date(t.clock.now.getTime() + 16 * 60_000);
    expect((await t.call('GET', '/shops/me', { token: s.token })).status).toBe(401);
    t.clock.now = new Date(t.clock.now.getTime() - 16 * 60_000);
  });

  it('tampered tokens and missing tokens are rejected', async () => {
    const s = await t.registerShop('Tamper');
    const [h, p, sig] = s.token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), shop: '00000000-0000-0000-0000-000000000000' })).toString('base64url');
    expect((await t.call('GET', '/clients', { token: `${h}.${forged}.${sig}` })).status).toBe(401);
    expect((await t.call('GET', '/clients')).status).toBe(401);
  });

  it('rate-limits auth endpoints', async () => {
    const { buildServer, argon2Deps } = await import('../src/server');
    const { loadConfig } = await import('../src/config');
    const app = await buildServer({ db: t.db, config: loadConfig(), deps: argon2Deps, authRateLimit: 3 });
    const codes = [];
    for (let i = 0; i < 5; i++)
      codes.push((await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x@y.co', password: 'x' } })).statusCode);
    expect(codes.slice(-1)[0]).toBe(429);
    await app.close();
  });
});
