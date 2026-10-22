import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_KEY, SERVICE_KEY, setup } from './helpers';

// The acceptance criteria from the brief, end to end through the HTTP API.
describe('acceptance', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let token: string;
  let shopId: string;
  let service: any;
  let client: any;
  const appts: any[] = [];

  beforeAll(async () => {
    t = await setup('2026-10-15T12:00:00Z'); // 08:00 in New York
  });
  afterAll(() => t.close());

  it('a new shop registers, adds a service and a client, books three appointments and sees the day', async () => {
    const reg = await t.call('POST', '/auth/register', {
      body: {
        shop_name: 'Fade Factory', owner_name: 'Rosa', email: 'rosa@fade.example', password: 'a-very-good-pass',
        country: 'US', timezone: 'America/New_York', language: 'es', currency: 'USD',
      },
    });
    expect(reg.status).toBe(201);
    token = reg.body.access_token;
    shopId = reg.body.shop.id;
    service = (await t.call('POST', '/services', { token, body: { name: 'Corte', price_cents: 3500, duration_min: 30 } })).body;
    client = (
      await t.call('POST', '/clients', { token, body: { name: 'Luis Gómez', phone_e164: '+1 (305) 555-0101', consent: true } })
    ).body;
    expect(client.phone_masked).toContain('••');
    expect(client).not.toHaveProperty('phone_e164');
    expect(client.language).toBe('es');
    for (const time of ['10:00', '11:00', '15:30']) {
      const r = await t.call('POST', '/appointments', {
        token,
        body: { client_id: client.id, service_id: service.id, starts_local: `2026-10-16T${time}` },
      });
      expect(r.status).toBe(201);
      appts.push(r.body);
    }
    const day = await t.call('GET', '/appointments?date=2026-10-16', { token });
    expect(day.body.data).toHaveLength(3);
    expect(day.body.summary.expected_cents).toBe(10500);
    expect(day.body.summary.done_cents).toBe(0);
    const earn = await t.call('GET', '/books/summary?period=day&date=2026-10-16', { token });
    expect(earn.body.income_cents).toBe(0);
  });

  it('double booking the same chair is refused', async () => {
    const r = await t.call('POST', '/appointments', {
      token,
      body: { client_id: client.id, service_id: service.id, starts_local: '2026-10-16T10:15' },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SLOT_TAKEN');
  });

  it('each appointment queues two reminders; the worker sees them with the service key and writes results', async () => {
    expect(appts[0].reminders.map((r: any) => r.template_key)).toEqual(['reminder_day_before', 'reminder_day_of']);
    // Day before at 18:00 New York = 22:00Z; day of 10:00 - 2h = 08:00 local = 12:00Z.
    expect(new Date(appts[0].reminders[0].scheduled_at).toISOString()).toBe('2026-10-15T22:00:00.000Z');
    expect(new Date(appts[0].reminders[1].scheduled_at).toISOString()).toBe('2026-10-16T12:00:00.000Z');

    const due = await t.call('GET', '/reminders/due?until=2026-10-15T23:00:00Z', { token: SERVICE_KEY });
    expect(due.status).toBe(200);
    expect(due.body.data).toHaveLength(3); // three day-before messages
    const first = due.body.data[0];
    expect(first.to).toBe('+13055550101');
    expect(first.message).toContain('STOP');
    expect(first.message).toContain('Fade Factory');
    expect(first.language).toBe('es');

    // Leased: an immediate second poll returns nothing, so nothing is sent twice.
    const again = await t.call('GET', '/reminders/due?until=2026-10-15T23:00:00Z', { token: SERVICE_KEY });
    expect(again.body.data).toHaveLength(0);

    const res = await t.call('POST', `/reminders/${first.id}/result`, {
      token: SERVICE_KEY,
      body: { status: 'sent', provider_ref: 'wamid.123' },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
    const twice = await t.call('POST', `/reminders/${first.id}/result`, { token: SERVICE_KEY, body: { status: 'sent' } });
    expect(twice.status).toBe(409);
    const failed = await t.call('POST', `/reminders/${due.body.data[1].id}/result`, {
      token: SERVICE_KEY,
      body: { status: 'failed', error: 'number not on WhatsApp' },
    });
    expect(failed.body.status).toBe('failed');
  });

  it('cancel drops unsent reminders; a time change re-queues them', async () => {
    const c = await t.call('PATCH', `/appointments/${appts[2].id}`, { token, body: { status: 'cancelled' } });
    expect(c.body.reminders.filter((r: any) => r.status === 'queued')).toHaveLength(0);
    const m = await t.call('PATCH', `/appointments/${appts[1].id}`, { token, body: { starts_local: '2026-10-17T13:00' } });
    const queued = m.body.reminders.filter((r: any) => r.status === 'queued');
    expect(queued).toHaveLength(2);
    expect(new Date(queued[1].scheduled_at).toISOString()).toBe('2026-10-17T15:00:00.000Z');
  });

  it('marking done raises the day earnings; a debt is written and closed by a payment', async () => {
    const done = await t.call('PATCH', `/appointments/${appts[0].id}`, { token, body: { status: 'done' } });
    expect(done.body.status).toBe('done');
    const day = await t.call('GET', '/books/summary?period=day&date=2026-10-16', { token });
    expect(day.body.income_cents).toBe(3500);
    // Undo: back to booked removes the income again (no double counting).
    await t.call('PATCH', `/appointments/${appts[0].id}`, { token, body: { status: 'booked', cancel_reason: 'wrong_entry' } });
    expect((await t.call('GET', '/books/summary?period=day&date=2026-10-16', { token })).body.income_cents).toBe(0);
    await t.call('PATCH', `/appointments/${appts[0].id}`, { token, body: { status: 'done' } });

    const charge = await t.call('POST', '/ledger', { token, body: { client_id: client.id, kind: 'charge', amount_cents: 3500, note: 'pagará el viernes' } });
    expect(charge.body.balance_cents).toBe(3500);
    expect((await t.call('GET', '/ledger', { token })).body.outstanding_cents).toBe(3500);
    const pay = await t.call('POST', '/ledger', { token, body: { client_id: client.id, kind: 'payment', amount_cents: 3500 } });
    expect(pay.body.balance_cents).toBe(0);
    expect((await t.call('GET', '/ledger', { token })).body.data).toHaveLength(0);
  });

  it('free notes become entries after confirmation; the summary equals the sum of the rows', async () => {
    const p1 = await t.call('POST', '/books/parse', { token, body: { text: 'bugün 500 kazandım', lang: 'tr' } });
    expect(p1.body.drafts[0]).toMatchObject({ kind: 'income', amount_cents: 50000, category: 'service', entry_date: '2026-10-15' });
    const p2 = await t.call('POST', '/books/parse', { token, body: { text: 'kira 1800 ödedim', lang: 'tr' } });
    expect(p2.body.drafts[0]).toMatchObject({ kind: 'expense', amount_cents: 180000, category: 'rent' });
    // Parsing saves nothing.
    expect((await t.call('GET', '/books?from=2026-10-15&to=2026-10-15', { token })).body.data).toHaveLength(0);
    for (const p of [p1, p2]) {
      const r = await t.call('POST', '/books', { token, body: { ...p.body.drafts[0], source: 'ai_note' } });
      expect(r.status).toBe(201);
      expect(r.body.raw_text).toBe(p.body.drafts[0].raw_text);
    }
    const s = await t.call('GET', '/books/summary?period=week&date=2026-10-15', { token });
    const rows = (await t.call('GET', `/books?from=${s.body.from}&to=${s.body.to}`, { token })).body.data;
    const sum = (k: string) => rows.filter((r: any) => r.kind === k).reduce((a: number, r: any) => a + r.amount_cents, 0);
    expect(s.body.income_cents).toBe(sum('income'));
    expect(s.body.expense_cents).toBe(sum('expense'));
    expect(s.body.net_cents).toBe(sum('income') - sum('expense'));
    expect(s.body.income_cents).toBe(50000 + 3500);
    expect(s.body.expense_cents).toBe(180000);
  });

  it('feedback is sent and readable by the operator', async () => {
    const f = await t.call('POST', '/feedback', { token, body: { message: 'Quiero exportar a Excel' } });
    expect(f.status).toBe(201);
    const list = await t.call('GET', '/admin/feedback', { token: ADMIN_KEY });
    expect(list.body.data[0]).toMatchObject({ message: 'Quiero exportar a Excel', shop_name: 'Fade Factory' });
  });

  it('a revoked client gets no reminders and STOP stops the queue', async () => {
    const quiet = (await t.call('POST', '/clients', { token, body: { name: 'No Msgs', phone_e164: '+13055550199', consent: false } })).body;
    const a = await t.call('POST', '/appointments', { token, body: { client_id: quiet.id, service_id: service.id, starts_local: '2026-10-20T10:00' } });
    expect(a.body.reminders).toHaveLength(0);

    const due = await t.call('GET', '/reminders/due?until=2026-10-18T00:00:00Z', { token: SERVICE_KEY });
    const r = due.body.data.find((d: any) => d.to === '+13055550101');
    const stop = await t.call('POST', '/reminders/optout', { token: SERVICE_KEY, body: { reminder_id: r.id } });
    expect(stop.body.revoked).toBe(1);
    const c = await t.call('GET', `/clients/${client.id}`, { token });
    expect(c.body.consent_status).toBe('revoked');
    t.clock.now = new Date('2026-10-15T12:10:00Z'); // lease expired
    const after = await t.call('GET', '/reminders/due?until=2026-10-30T00:00:00Z', { token: SERVICE_KEY });
    expect(after.body.data.filter((d: any) => d.to === '+13055550101')).toHaveLength(0);
  });

  it('reading the full phone number is audited', async () => {
    const r = await t.call('GET', `/clients/${client.id}/phone`, { token });
    expect(r.body.phone_e164).toBe('+13055550101');
    const exp = await t.call('GET', '/shops/me/export', { token });
    expect(exp.body.audit_log.map((a: any) => a.action)).toEqual(expect.arrayContaining(['client.phone_read', 'client.create', 'client.consent_revoked_stop']));
  });

  it('when the subscription is turned off the shop is locked', async () => {
    const off = await t.call('PATCH', `/admin/shops/${shopId}/subscription`, { token: ADMIN_KEY, body: { status: 'past_due' } });
    expect(off.status).toBe(200);
    const me = await t.call('GET', '/shops/me', { token });
    expect(me.body.locked).toBe(true);
    const r = await t.call('GET', '/appointments', { token });
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
    // Feedback and export still work, so a locked shop can reach us and take its data.
    expect((await t.call('POST', '/feedback', { token, body: { message: 'help' } })).status).toBe(201);
    await t.call('PATCH', `/admin/shops/${shopId}/subscription`, { token: ADMIN_KEY, body: { status: 'active' } });
    expect((await t.call('GET', '/appointments', { token })).status).toBe(200);
  });

  it('errors share one shape and lists are paged', async () => {
    const r = await t.call('POST', '/clients', { token, body: { name: '', phone_e164: '123', consent: true } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    const list = await t.call('GET', '/clients?page=1&page_size=1', { token });
    expect(list.body).toMatchObject({ page: 1, page_size: 1, total: 2 });
    expect(list.body.data).toHaveLength(1);
    expect((await t.call('GET', '/nope', { token })).body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
