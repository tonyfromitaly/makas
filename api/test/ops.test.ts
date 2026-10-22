import { afterEach, describe, expect, it } from 'vitest';
import { totp } from '@makas/core';
import { ADMIN_KEY, setup } from './helpers';

// The operator panel: admin key plus an authenticator code, a short session, a lock after five misses,
// and a log of every admin request.

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890", the RFC 6238 test key
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

describe('authenticator codes', () => {
  it('match the RFC 6238 test vectors', async () => {
    expect(await totp(SECRET, new Date(59_000))).toBe('287082');
    expect(await totp(SECRET, new Date(1_111_111_109_000))).toBe('081804');
    expect(await totp(SECRET, new Date(2_000_000_000_000))).toBe('279037');
  });
});

describe('operator sign-in', () => {
  it('needs the key and the code; the session opens the panel; the raw key only reaches machine routes', async () => {
    const t = await setup('2026-10-15T09:00:00Z', {}, { adminTotpSecret: SECRET });
    closers.push(t.close);
    const code = await totp(SECRET, t.clock.now);

    expect((await t.call('POST', '/admin/session', { body: { key: ADMIN_KEY } })).status).toBe(401);
    expect((await t.call('POST', '/admin/session', { body: { key: 'wrong', code } })).status).toBe(401);
    const s = await t.call('POST', '/admin/session', { body: { key: ADMIN_KEY, code } });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ expires_in: 1800, mfa: true });

    expect((await t.call('GET', '/admin/support', { token: s.body.token })).status).toBe(200);
    expect((await t.call('GET', '/admin/support', { token: ADMIN_KEY })).status).toBe(401);
    expect((await t.call('GET', '/admin/health', { token: ADMIN_KEY })).status).toBe(200);

    // Thirty minutes later the session is over.
    t.clock.now = new Date(t.clock.now.getTime() + 31 * 60_000);
    expect((await t.call('GET', '/admin/support', { token: s.body.token })).status).toBe(401);

    const log = await t.call('POST', '/admin/session', { body: { key: ADMIN_KEY, code: await totp(SECRET, t.clock.now) } });
    const entries = (await t.call('GET', '/admin/log', { token: log.body.token })).body.data;
    expect(entries.some((e: any) => e.action === 'GET /admin/support' && e.ok)).toBe(true);
    expect(entries.some((e: any) => e.action === 'GET /admin/support' && !e.ok)).toBe(true);
    expect(entries.filter((e: any) => e.action === 'session' && !e.ok)).toHaveLength(2);
  });

  it('locks an address for 15 minutes after five failed sign-ins', async () => {
    const t = await setup('2026-10-15T09:00:00Z', {}, { adminTotpSecret: SECRET });
    closers.push(t.close);
    for (let i = 0; i < 5; i++) expect((await t.call('POST', '/admin/session', { body: { key: ADMIN_KEY, code: '000000' } })).status).toBe(401);
    const right = { key: ADMIN_KEY, code: await totp(SECRET, t.clock.now) };
    expect((await t.call('POST', '/admin/session', { body: right })).status).toBe(429);
    t.clock.now = new Date(t.clock.now.getTime() + 16 * 60_000);
    expect((await t.call('POST', '/admin/session', { body: { ...right, code: await totp(SECRET, t.clock.now) } })).status).toBe(200);
  });

  it('without a TOTP secret (local work, the demo) the key alone still works', async () => {
    const t = await setup();
    closers.push(t.close);
    expect((await t.call('GET', '/admin/support', { token: ADMIN_KEY })).status).toBe(200);
    expect((await t.call('POST', '/admin/session', { body: { key: ADMIN_KEY } })).body.mfa).toBe(false);
  });
});
