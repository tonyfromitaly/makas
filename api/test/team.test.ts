import { afterEach, describe, expect, it } from 'vitest';
import { setup } from './helpers';

// The team and the till: chairs and rooms a booking needs, each person's own login and view,
// checkout as a sale (service, products, tip, how it was paid), and who is owed what.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function shop() {
  const t = await setup('2026-10-15T13:00:00Z'); // 09:00 in New York, a Thursday
  closers.push(t.close);
  const s = await t.registerShop('Oak Barbers');
  const owner = s.token;
  const add = async (path: string, body: unknown) => {
    const r = await t.call('POST', path, { token: owner, body });
    if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  /** A team member with their own login. */
  const member = async (name: string, deal: Record<string, unknown> = {}) => {
    const b = await add('/barbers', { name, ...deal });
    const login = await add(`/barbers/${b.id}/login`, { email: `${name.toLowerCase()}@oak.example` });
    const signed = await t.call('POST', '/auth/key', { body: { key: login.key, password: `${name}-strong-pass-1` } });
    return { id: b.id as string, token: signed.body.access_token as string };
  };
  return { t, s, owner, add, member };
}

describe('stations', () => {
  it('a service that needs a chair needs a free chair, the person’s own first', async () => {
    const { t, s, owner, add } = await shop();
    const c1 = await add('/stations', { name: 'Chair 1', kind: 'chair' });
    const c2 = await add('/stations', { name: 'Chair 2', kind: 'chair' });
    await t.call('PATCH', `/services/${s.service.id}`, { token: owner, body: { station_kind: 'chair' } });
    const ali = await add('/barbers', { name: 'Ali', station_id: c2.id });
    const ben = await add('/barbers', { name: 'Ben' });
    const cara = await add('/barbers', { name: 'Cara' });
    const book = (barber_id: string) =>
      t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, barber_id, starts_local: '2026-10-16T10:00' } });

    const a = await book(ali.id);
    expect(a.status).toBe(201);
    expect(a.body.station_name).toBe('Chair 2'); // Ali's own chair
    const b = await book(ben.id);
    expect(b.body.station_id).toBe(c1.id); // the other free one
    const c = await book(cara.id);
    // Three people, two chairs: the third cannot sit down at 10:00.
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('STATION_TAKEN');

    // The free-time finder knows it too: at 10:00 nobody can start a chair service, at 10:30 someone can.
    const free = await t.call('GET', `/appointments/free?date=2026-10-16&service_id=${s.service.id}&near=10:00&count=3`, { token: owner });
    expect(free.body.taken).toBe(true);
    expect(free.body.slots.map((x: any) => x.time)).not.toContain('10:00');
    expect(free.body.slots.map((x: any) => x.time)).toContain('10:30');
  });

  it('a room service and a chair service do not compete', async () => {
    const { t, s, owner, add } = await shop();
    await add('/stations', { name: 'Chair 1', kind: 'chair' });
    await add('/stations', { name: 'Room A', kind: 'room' });
    await t.call('PATCH', `/services/${s.service.id}`, { token: owner, body: { station_kind: 'chair' } });
    const massage = await add('/services', { name: 'Massage', price_cents: 8000, duration_min: 60, station_kind: 'room' });
    const ben = await add('/barbers', { name: 'Ben' });
    const r1 = await t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, starts_local: '2026-10-16T10:00' } });
    const r2 = await t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: massage.id, barber_id: ben.id, starts_local: '2026-10-16T10:00' } });
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r2.body.station_name).toBe('Room A');
  });
});

describe('a team member’s own app', () => {
  it('sees only their own appointments and clients, never the books', async () => {
    const { t, s, owner, add, member } = await shop();
    const elif = await member('Elif');
    const other = await add('/clients', { name: 'Owner Client', phone_e164: '+14155550199', consent: true });
    await t.call('POST', '/appointments', { token: owner, body: { client_id: other.id, service_id: s.service.id, starts_local: '2026-10-15T11:00' } });
    const mine = await t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, barber_id: elif.id, starts_local: '2026-10-15T12:00' } });

    const list = await t.call('GET', '/appointments?date=2026-10-15', { token: elif.token });
    expect(list.body.data.map((a: any) => a.id)).toEqual([mine.body.id]);
    expect(list.body.summary.booked).toBe(1);
    const clients = await t.call('GET', '/clients', { token: elif.token });
    expect(clients.body.data.map((c: any) => c.name)).toEqual(['Jane Client']);
    expect((await t.call('GET', `/clients/${other.id}`, { token: elif.token })).status).toBe(404);

    for (const path of ['/books', '/books/summary', '/ledger', '/tasks', '/team/report', '/signals', '/connections', '/shops/me/export'])
      expect([path, (await t.call('GET', path, { token: elif.token })).status]).toEqual([path, 403]);
    expect((await t.call('POST', '/services', { token: elif.token, body: { name: 'Free', price_cents: 0, duration_min: 10 } })).status).toBe(403);

    // Booking as a team member books with them, whatever barber is sent.
    const own = await t.call('POST', '/appointments', { token: elif.token, body: { client_id: s.client.id, service_id: s.service.id, barber_id: list.body.data[0].barber_id, starts_local: '2026-10-15T15:00' } });
    expect(own.body.barber_id).toBe(elif.id);
    // Someone else's appointment is not there to change.
    const owners = (await t.call('GET', '/appointments?date=2026-10-15', { token: owner })).body.data.find((a: any) => a.client_name === 'Owner Client');
    expect((await t.call('PATCH', `/appointments/${owners.id}`, { token: elif.token, body: { status: 'done' } })).status).toBe(404);

    const me = await t.call('GET', '/shops/me', { token: elif.token });
    expect(me.body.user.role).toBe('barber');
    expect(me.body.staff).toMatchObject({ id: elif.id, name: 'Elif' });
    // The team list shows names, not deals.
    const team = await t.call('GET', '/barbers', { token: elif.token });
    expect(team.body.data[0].pay_model).toBeUndefined();
  });

  it('the assistant answers a team member about their own work only', async () => {
    const { t, s, owner, member } = await shop();
    const elif = await member('Elif', { service_pct: 40 });
    const a = await t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, barber_id: elif.id, starts_local: '2026-10-15T08:00' } });
    await t.call('POST', '/sales', { token: elif.token, body: { appointment_id: a.body.id, method: 'card', tip_cents: 500 } });
    await t.call('POST', '/books', { token: owner, body: { kind: 'expense', category: 'rent', amount_cents: 200000, entry_date: '2026-10-15' } });

    const ask = async (text: string, token = elif.token) => (await t.call('POST', '/assistant', { token, body: { text, lang: 'en' } })).body.reply as string;
    expect(await ask('how much did I make this month')).toMatch(/you sold \$30: 1 jobs\. Tips \$5\. Their commission \(40%\) comes to \$12/);
    expect(await ask('what did we spend this month')).toMatch(/^That’s for the shop owner/);
    expect(await ask('whats in the bank')).toMatch(/^That’s for the shop owner/);
    expect(await ask('pay rent 1200 tomorrow')).toMatch(/shop owner records that/);
    // The owner asks about the team, or one person.
    expect(await ask('how much did Elif sell this month', owner)).toMatch(/Elif sold \$30: 1 jobs, services \$30, products \$0\. Tips \$5\./);
    expect(await ask('how did the team do this week', owner)).toMatch(/the team sold \$30: Elif \$30/);
  });
});

describe('the till', () => {
  it('checkout: service, a product and a tip; the books follow, voiding undoes it all', async () => {
    const { t, s, owner, add, member } = await shop();
    const elif = await member('Elif', { service_pct: 50, product_pct: 10 });
    const wax = await add('/products', { name: 'Hair wax', price_cents: 1800, stock: 5 });
    const a = await t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, barber_id: elif.id, starts_local: '2026-10-15T08:00' } });

    const sale = await t.call('POST', '/sales', {
      token: elif.token,
      body: { appointment_id: a.body.id, method: 'card', tip_cents: 600, lines: [{ kind: 'product', ref_id: wax.id, qty: 2 }] },
    });
    expect(sale.status).toBe(201);
    expect(sale.body).toMatchObject({ method: 'card', subtotal_cents: 3000 + 3600, tip_cents: 600, total_cents: 7200, staff_name: 'Elif' });
    expect((await t.call('GET', `/clients/${s.client.id}`, { token: owner })).body.visits).toBe(1);
    const books = (await t.call('GET', '/books?from=2026-10-15&to=2026-10-15', { token: owner })).body.data;
    expect(books.map((b: any) => [b.category, b.amount_cents]).sort()).toEqual([
      ['product', 3600],
      ['service', 3000],
      ['tips', 600],
    ]);
    expect((await t.call('GET', '/products', { token: owner })).body.data[0].stock).toBe(3);
    // The day's till is what was taken: service, products and the tip.
    expect((await t.call('GET', '/appointments?date=2026-10-15', { token: owner })).body.summary.till_cents).toBe(7200);
    // A sale's income is changed through the sale, not deleted from the books.
    expect((await t.call('DELETE', `/books/${books[0].id}`, { token: owner })).body.error.code).toMatch(/LINKED_TO_(SALE|APPOINTMENT)/);

    const report = (await t.call('GET', '/team/report?from=2026-10-15&to=2026-10-15', { token: owner })).body;
    // The owner's own place on the team comes first and has nothing to settle.
    expect(report.data[0]).toMatchObject({ is_owner: true, owed_cents: 0 });
    const row = report.data.find((r: any) => r.name === 'Elif');
    expect(row).toMatchObject({ gross_cents: 6600, service_cents: 3000, product_cents: 3600, tips_cents: 600, commission_cents: 1500 + 360, owed_cents: 1860 + 600, shop_cents: 6600 - 1860 });

    // Elif sees her own day.
    const work = (await t.call('GET', '/me/work?period=day&date=2026-10-15', { token: elif.token })).body;
    expect(work.row).toMatchObject({ gross_cents: 6600, tips_cents: 600, commission_cents: 1860 });
    expect(work.sales).toHaveLength(1);
    // Only the owner voids. Voiding a visit's sale puts the visit back to booked.
    expect((await t.call('DELETE', `/sales/${sale.body.id}`, { token: elif.token })).status).toBe(403);
    expect((await t.call('DELETE', `/sales/${sale.body.id}`, { token: owner })).status).toBe(204);
    expect((await t.call('GET', '/books?from=2026-10-15&to=2026-10-15', { token: owner })).body.data).toEqual([]);
    expect((await t.call('GET', '/products', { token: owner })).body.data[0].stock).toBe(5);
    const back = (await t.call('GET', '/appointments?date=2026-10-15', { token: owner })).body.data[0];
    expect(back.status).toBe('booked');
  });

  it('marking a visit done is a sale too; a walk-in sale needs no appointment', async () => {
    const { t, s, owner, add } = await shop();
    const a = await t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, starts_local: '2026-10-15T08:00' } });
    await t.call('PATCH', `/appointments/${a.body.id}`, { token: owner, body: { status: 'done' } });
    const coffee = await add('/products', { name: 'Coffee', price_cents: 400 });
    const walkIn = await t.call('POST', '/sales', { token: owner, body: { method: 'cash', lines: [{ kind: 'product', ref_id: coffee.id, qty: 3 }, { kind: 'other', name: 'Gift card', unit_cents: 2500 }] } });
    expect(walkIn.body.total_cents).toBe(3700);
    const day = (await t.call('GET', '/sales?period=day&date=2026-10-15', { token: owner })).body;
    expect(day.totals).toMatchObject({ count: 2, total_cents: 6700, cash_cents: 3700, other_cents: 3000 });
    const sum = (await t.call('GET', '/books/summary?period=day&date=2026-10-15', { token: owner })).body;
    expect(sum.income_cents).toBe(6700);
    // Undoing the visit takes its sale and income away.
    await t.call('PATCH', `/appointments/${a.body.id}`, { token: owner, body: { status: 'booked' } });
    expect((await t.call('GET', '/books/summary?period=day&date=2026-10-15', { token: owner })).body.income_cents).toBe(3700);
  });

  it('a chair renter’s takings are theirs; the shop’s income from them is the rent', async () => {
    const { t, s, owner, member } = await shop();
    const rio = await member('Rio', { pay_model: 'booth_rent', rent_cents: 35000, rent_period: 'week' });
    const a = await t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, barber_id: rio.id, starts_local: '2026-10-15T08:00' } });
    await t.call('POST', '/sales', { token: rio.token, body: { appointment_id: a.body.id, method: 'cash', tip_cents: 1000 } });
    expect((await t.call('GET', '/books/summary?period=day&date=2026-10-15', { token: owner })).body.income_cents).toBe(0);
    const row = (await t.call('GET', '/team/report?from=2026-10-12&to=2026-10-18', { token: owner })).body.data.find((r: any) => r.name === 'Rio');
    expect(row).toMatchObject({ gross_cents: 3000, owed_cents: 0, rent_cents: 35000, shop_cents: 35000 });
    // Rio pays the week's rent: income in the shop's books.
    const paid = await t.call('POST', `/team/${rio.id}/payouts`, { token: owner, body: { kind: 'rent', from: '2026-10-12', to: '2026-10-18', amount_cents: 35000 } });
    expect(paid.status).toBe(201);
    expect((await t.call('GET', '/books/summary?period=day&date=2026-10-15', { token: owner })).body.income_cents).toBe(35000);
    expect((await t.call('GET', '/team/report?from=2026-10-12&to=2026-10-18', { token: owner })).body.data.find((r: any) => r.name === 'Rio').rent_paid_cents).toBe(35000);
  });

  it('salary is pro rata for the period, commission on top; paying it is a wage in the books', async () => {
    const { t, owner, add } = await shop();
    const sam = await add('/barbers', { name: 'Sam', pay_model: 'salary', salary_cents: 304400, service_pct: 0, product_pct: 0 });
    const week = (await t.call('GET', '/team/report?from=2026-10-12&to=2026-10-18', { token: owner })).body.data.find((r: any) => r.name === 'Sam');
    expect(week.salary_cents).toBe(70000); // 3,044 a month ≈ 700 a week
    expect(week.owed_cents).toBe(70000);
    await t.call('POST', `/team/${sam.id}/payouts`, { token: owner, body: { kind: 'pay', from: '2026-10-12', to: '2026-10-18', amount_cents: 70000 } });
    const sum = (await t.call('GET', '/books/summary?period=day&date=2026-10-15', { token: owner })).body;
    expect(sum.expense_cents).toBe(70000);
  });
});
