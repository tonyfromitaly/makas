import { afterEach, describe, expect, it } from 'vitest';
import { purgeDeletedShops, withSystem } from '@makas/core';
import { setup, SERVICE_KEY } from './helpers';

// Deleting a shop is undoable for 30 days: suspended first (only restore, export, support and sign-out
// work, no reminders go out), restored exactly as it was, or purged for good once the 30 days pass.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function shop() {
  const t = await setup('2026-10-15T09:00:00Z');
  closers.push(t.close);
  const s = await t.registerShop('Shop');
  return { t, s };
}

describe('deleting a shop', () => {
  it('needs the password, then suspends the shop for 30 days instead of erasing it', async () => {
    const { t, s } = await shop();
    expect((await t.call('DELETE', '/shops/me', { token: s.token, body: { password: 'wrong-password' } })).status).toBe(401);
    const del = await t.call('DELETE', '/shops/me', { token: s.token, body: { password: 'correct-horse-battery' } });
    expect(del.status).toBe(200);
    expect(new Date(del.body.purge_after).toISOString()).toBe('2026-11-14T09:00:00.000Z');

    // What still works: seeing it, taking the data, talking to us.
    const me = await t.call('GET', '/shops/me', { token: s.token });
    expect(me.body.shop.deleted_at).toBeTruthy();
    expect((await t.call('GET', '/shops/me/export', { token: s.token })).status).toBe(200);
    expect((await t.call('POST', '/support', { token: s.token, body: { message: 'I deleted it by mistake' } })).status).toBe(201);
    // Everything else is closed.
    const blocked = await t.call('GET', '/clients', { token: s.token });
    expect(blocked.status).toBe(410);
    expect(blocked.body.error.code).toBe('SHOP_DELETED');
    expect((await t.call('POST', '/books', { token: s.token, body: { kind: 'income', category: 'service', amount_cents: 1000, entry_date: '2026-10-15' } })).status).toBe(410);
  });

  it('restore brings everything back as it was', async () => {
    const { t, s } = await shop();
    await t.call('DELETE', '/shops/me', { token: s.token, body: { password: 'correct-horse-battery' } });
    t.clock.now = new Date('2026-10-15T09:10:00Z');
    const r = await t.call('POST', '/shops/me/restore', { token: s.token });
    expect(r.body).toEqual({ restored: true });
    const clients = await t.call('GET', '/clients', { token: s.token });
    expect(clients.status).toBe(200);
    expect(clients.body.data.map((c: any) => c.id)).toContain(s.client.id);
    expect((await t.call('GET', '/shops/me', { token: s.token })).body.shop.deleted_at).toBeNull();
  });

  it('no reminder goes out for a suspended shop', async () => {
    const { t, s } = await shop();
    await t.call('POST', '/appointments', { token: s.token, body: { client_id: s.client.id, service_id: s.service.id, starts_local: '2026-10-16T10:00' } });
    await t.call('DELETE', '/shops/me', { token: s.token, body: { password: 'correct-horse-battery' } });
    const due = await t.call('GET', '/reminders/due?until=2026-10-16T23:00:00Z', { token: SERVICE_KEY });
    expect(due.body.data).toEqual([]);
    const rows = (await t.db.query(`select status, error from reminder_queue`)).rows;
    expect(rows.filter((r: any) => r.error === 'shop_deleted').length).toBeGreaterThan(0);
  });

  it('after 30 days the shop is purged for good; before, nothing is touched', async () => {
    const { t, s } = await shop();
    await t.call('DELETE', '/shops/me', { token: s.token, body: { password: 'correct-horse-battery' } });
    expect(await withSystem(t.db, (tx) => purgeDeletedShops(tx, new Date('2026-11-14T08:00:00Z')))).toBe(0);
    expect(await withSystem(t.db, (tx) => purgeDeletedShops(tx, new Date('2026-11-14T10:00:00Z')))).toBe(1);
    expect((await withSystem(t.db, (tx) => tx.query(`select count(*)::int as n from shops where id = $1`, [s.shopId]))).rows[0].n).toBe(0);
    expect((await withSystem(t.db, (tx) => tx.query(`select count(*)::int as n from clients where shop_id = $1`, [s.shopId]))).rows[0].n).toBe(0);
    expect((await t.call('POST', '/auth/login', { body: { email: s.email, password: 'correct-horse-battery' } })).status).toBe(401);
  });

  it('only the owner can delete or restore', async () => {
    const { t, s } = await shop();
    await t.db.query(`insert into users (shop_id, email, password_hash, role, name) values ($1, 'staff@example.com', $2, 'barber', 'Emre')`, [
      s.shopId,
      await (await import('../src/server')).argon2Deps.hashPassword('staff-password-123'),
    ]);
    const staff = (await t.call('POST', '/auth/login', { body: { email: 'staff@example.com', password: 'staff-password-123' } })).body.access_token;
    expect((await t.call('DELETE', '/shops/me', { token: staff, body: { password: 'staff-password-123' } })).status).toBe(403);
    await t.call('DELETE', '/shops/me', { token: s.token, body: { password: 'correct-horse-battery' } });
    expect((await t.call('POST', '/shops/me/restore', { token: staff })).status).toBe(403);
    expect((await t.call('GET', '/appointments?date=2026-10-15', { token: staff })).status).toBe(410);
  });
});
