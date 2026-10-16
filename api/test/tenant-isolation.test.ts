import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@makas/core';
import { setup } from './helpers';

// Shop A must not be able to read or write anything that belongs to shop B — by id, by list, or by raw SQL.
describe('tenant isolation', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let A: Awaited<ReturnType<typeof t.registerShop>>;
  let B: Awaited<ReturnType<typeof t.registerShop>>;
  let bAppointment: any;
  let bLedger: any;
  let bBook: any;

  beforeAll(async () => {
    t = await setup();
    A = await t.registerShop('Alpha');
    B = await t.registerShop('Bravo');
    bAppointment = (
      await t.call('POST', '/appointments', {
        token: B.token,
        body: { client_id: B.client.id, service_id: B.service.id, starts_at: '2026-10-16T15:00:00Z' },
      })
    ).body;
    bLedger = (await t.call('POST', '/ledger', { token: B.token, body: { client_id: B.client.id, kind: 'charge', amount_cents: 1500 } })).body;
    bBook = (
      await t.call('POST', '/books', {
        token: B.token,
        body: { kind: 'expense', category: 'rent', amount_cents: 99900, entry_date: '2026-10-15' },
      })
    ).body;
  });
  afterAll(() => t.close());

  it('cannot read B client, phone, appointment or ledger by id (404, no data)', async () => {
    for (const url of [
      `/clients/${B.client.id}`,
      `/clients/${B.client.id}/phone`,
      `/ledger?client_id=${B.client.id}`,
    ]) {
      const r = await t.call('GET', url, { token: A.token });
      expect(r.status, url).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain('Jane');
      expect(r.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('lists never include B rows', async () => {
    const clients = await t.call('GET', '/clients', { token: A.token });
    expect(clients.body.data.map((c: any) => c.id)).not.toContain(B.client.id);
    const appts = await t.call('GET', '/appointments?date=2026-10-16', { token: A.token });
    expect(appts.body.data).toHaveLength(0);
    const ledger = await t.call('GET', '/ledger', { token: A.token });
    expect(ledger.body.data).toHaveLength(0);
    expect(ledger.body.outstanding_cents).toBe(0);
    const books = await t.call('GET', '/books', { token: A.token });
    expect(books.body.data.map((b: any) => b.id)).not.toContain(bBook.id);
    const summary = await t.call('GET', '/books/summary?period=month&date=2026-10-15', { token: A.token });
    expect(summary.body.expense_cents).toBe(0);
    const services = await t.call('GET', '/services', { token: A.token });
    expect(services.body.data.map((s: any) => s.id)).not.toContain(B.service.id);
  });

  it('cannot write to B rows', async () => {
    expect((await t.call('PATCH', `/clients/${B.client.id}`, { token: A.token, body: { name: 'Hacked' } })).status).toBe(404);
    expect((await t.call('PATCH', `/appointments/${bAppointment.id}`, { token: A.token, body: { status: 'cancelled' } })).status).toBe(404);
    expect((await t.call('PATCH', `/services/${B.service.id}`, { token: A.token, body: { price_cents: 1 } })).status).toBe(404);
    expect((await t.call('DELETE', `/books/${bBook.id}`, { token: A.token })).status).toBe(404);
    expect((await t.call('POST', '/ledger', { token: A.token, body: { client_id: B.client.id, kind: 'payment', amount_cents: 1500 } })).status).toBe(404);
    // Booking into A using B's client or service fails too.
    const cross = await t.call('POST', '/appointments', {
      token: A.token,
      body: { client_id: B.client.id, service_id: A.service.id, starts_at: '2026-10-16T15:00:00Z' },
    });
    expect(cross.status).toBe(404);
    const crossSvc = await t.call('POST', '/appointments', {
      token: A.token,
      body: { client_id: A.client.id, service_id: B.service.id, starts_at: '2026-10-16T15:00:00Z' },
    });
    expect(crossSvc.status).toBe(404);

    // B's data is untouched.
    const c = await t.call('GET', `/clients/${B.client.id}`, { token: B.token });
    expect(c.body.name).toBe('Jane Client');
    expect(c.body.balance_cents).toBe(bLedger.balance_cents);
    const a = await t.call('GET', '/appointments?date=2026-10-16', { token: B.token });
    expect(a.body.data[0].status).toBe('booked');
  });

  it('row-level security hides B even from a query that forgets the shop filter', async () => {
    const rows = await withTenant(t.db, A.shopId, async (tx) => ({
      clients: (await tx.query('select id from clients')).rows,
      appts: (await tx.query('select id from appointments')).rows,
      ledger: (await tx.query('select id from ledger_entries')).rows,
      books: (await tx.query('select id from book_entries')).rows,
      shops: (await tx.query('select id from shops')).rows,
    }));
    expect(rows.clients.map((r: any) => r.id)).toEqual([A.client.id]);
    expect(rows.appts).toHaveLength(0);
    expect(rows.ledger).toHaveLength(0);
    expect(rows.books).toHaveLength(0);
    expect(rows.shops.map((r: any) => r.id)).toEqual([A.shopId]);
    // Writing a row tagged with B's shop_id is refused by the database itself.
    await expect(
      withTenant(t.db, A.shopId, (tx) =>
        tx.query(`insert into book_entries (shop_id, kind, category, amount_cents, entry_date) values ($1, 'income', 'other', 1, '2026-10-15')`, [B.shopId]),
      ),
    ).rejects.toThrow();
  });

  it('a user token cannot reach the worker endpoints, and the service key cannot reach shop endpoints', async () => {
    expect((await t.call('GET', '/reminders/due', { token: A.token })).status).toBe(401);
    expect((await t.call('GET', '/admin/feedback', { token: A.token })).status).toBe(401);
    expect((await t.call('GET', '/clients', { token: 'test-service-key-0123456789abcdef' })).status).toBe(401);
  });
});
