import { afterEach, describe, expect, it } from 'vitest';
import { createAccessKey, withSystem } from '@makas/core';
import { setup } from './helpers';

// Recovery with a new access key ends every session that existed before it: whoever held the old tokens is
// out, and only the new password signs in. Audit 2026-10-22, F05.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('recovery with an access key', () => {
  it('revokes the old refresh and access tokens and the other unused keys', async () => {
    const t = await setup('2026-10-22T16:00:00Z');
    close = t.close;
    const s = await t.registerShop('Oak Barbers');
    expect((await t.call('GET', '/clients', { token: s.token })).status).toBe(200);

    const newKey = (tx: any, u: string) => createAccessKey(tx, s.shopId, u, t.clock.now);
    const ownerId = await withSystem(t.db, async (tx) => (await tx.query(`select id from users where shop_id = $1 and role = 'owner'`, [s.shopId])).rows[0].id as string);
    const [first, second] = await withSystem(t.db, async (tx) => [await newKey(tx, ownerId), await newKey(tx, ownerId)]);

    t.clock.now = new Date('2026-10-22T16:05:00Z');
    const r = await t.call('POST', '/auth/key', { body: { key: first, password: 'a-new-password-for-oak' } });
    expect(r.status).toBe(200);

    // The session from before recovery is over, both halves of it.
    expect((await t.call('POST', '/auth/refresh', { body: { refresh_token: s.refresh } })).status).toBe(401);
    expect((await t.call('GET', '/clients', { token: s.token })).status).toBe(401);
    // A second key mailed earlier no longer works either.
    expect((await t.call('POST', '/auth/key', { body: { key: second, password: 'someone-elses-password' } })).status).toBe(401);
    // The new session works, and the new password signs in.
    expect((await t.call('GET', '/clients', { token: r.body.access_token })).status).toBe(200);
    expect((await t.call('POST', '/auth/refresh', { body: { refresh_token: r.body.refresh_token } })).status).toBe(200);
    const email = r.body.user.email;
    expect((await t.call('POST', '/auth/login', { body: { email, password: 'a-new-password-for-oak' } })).status).toBe(200);
  });
});
