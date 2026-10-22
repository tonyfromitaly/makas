import { afterEach, describe, expect, it } from 'vitest';
import { setup } from './helpers';

// The shop's public booking page and its agent: off until the owner turns it on; only real free times,
// within the hours, on the days each person works, with a free chair or room; nothing about other clients.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function salon() {
  const t = await setup('2026-10-15T13:00:00Z'); // Thursday 09:00 in New York
  closers.push(t.close);
  const s = await t.registerShop('Elif Hair Studio', { language: 'tr' });
  const owner = s.token;
  const post = async (path: string, body: unknown) => (await t.call('POST', path, { token: owner, body })).body;
  const c1 = await post('/stations', { name: 'Koltuk 1', kind: 'chair' });
  await post('/stations', { name: 'Koltuk 2', kind: 'chair' });
  await t.call('PATCH', `/services/${s.service.id}`, { token: owner, body: { station_kind: 'chair' } });
  const color = await post('/services', { name: 'Boya', price_cents: 9000, duration_min: 90, station_kind: 'chair' });
  const hidden = await post('/services', { name: 'Gelin başı', price_cents: 30000, duration_min: 120, online: false });
  const team = (await t.call('GET', '/barbers', { token: owner })).body.data;
  const ownerStaff = team[0];
  const elif = await post('/barbers', { name: 'Elif', title: 'Renk uzmanı', station_id: c1.id });
  const can = await post('/barbers', { name: 'Can', work_days: [1, 2, 3, 4, 5] }); // not on weekends
  const off = await post('/barbers', { name: 'Stajyer', online: false });
  return { t, s, owner, color, hidden, elif, can, off, ownerStaff };
}

describe('the booking page', () => {
  it('is off until the owner turns it on, and then shows only what is bookable online', async () => {
    const { t, owner, hidden, off } = await salon();
    const set = await t.call('GET', '/shops/me/booking', { token: owner });
    expect(set.body).toMatchObject({ slug: 'elif-hair-studio', saved: false, booking_enabled: false });
    expect((await t.call('GET', '/public/book/elif-hair-studio')).status).toBe(404);

    const on = await t.call('PATCH', '/shops/me/booking', { token: owner, body: { booking_enabled: true, hours: { '7': null } } });
    expect(on.body).toMatchObject({ slug: 'elif-hair-studio', booking_enabled: true });
    const page = await t.call('GET', '/public/book/ELIF-hair-studio');
    expect(page.status).toBe(200);
    expect(page.body.shop.name).toBe('Elif Hair Studio');
    expect(page.body.services.map((x: any) => x.name)).not.toContain('Gelin başı');
    expect(page.body.staff.map((x: any) => x.name)).toEqual(['Elif Hair Studio Owner', 'Elif', 'Can']);
    expect(JSON.stringify(page.body)).not.toContain(hidden.id);
    expect(JSON.stringify(page.body)).not.toContain(off.id);
    // Addresses are unique and some are reserved.
    expect((await t.call('PATCH', '/shops/me/booking', { token: owner, body: { slug: 'api' } })).status).toBe(400);
  });

  it('offers real free times only: hours, working days, the lead time, people and chairs', async () => {
    const { t, s, owner, can, elif } = await salon();
    await t.call('PATCH', '/shops/me/booking', { token: owner, body: { booking_enabled: true, hours: { '6': ['10:00', '16:00'], '7': null } } });
    const slots = async (date: string, staff?: string) =>
      (await t.call('GET', `/public/book/elif-hair-studio/slots?service_id=${s.service.id}&date=${date}${staff ? `&staff_id=${staff}` : ''}`)).body.slots;

    // Today: nothing within the next hour (09:00 now → 10:00 first).
    expect((await slots('2026-10-15'))[0].time).toBe('10:00');
    // Sunday closed; Saturday 10–16; Can does not work Saturdays.
    expect(await slots('2026-10-18')).toEqual([]);
    const sat = await slots('2026-10-17');
    expect(sat[0].time).toBe('10:00');
    expect(sat.at(-1).time).toBe('15:30');
    expect(await slots('2026-10-17', can.id)).toEqual([]);

    // Two chairs: with two visits at 11:00 tomorrow, nobody else can start at 11:00 (three people, two chairs).
    for (const barber_id of [elif.id, can.id])
      await t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, barber_id, starts_local: '2026-10-16T11:00' } });
    const fri = await slots('2026-10-16');
    expect(fri.map((x: any) => x.time)).not.toContain('11:00');
    expect(fri.map((x: any) => x.time)).toContain('11:30');
    // A slot names the person, never a client.
    expect(JSON.stringify(fri)).not.toContain('Jane');
    expect(Object.keys(fri[0]).sort()).toEqual(['staff_id', 'staff_name', 'station_name', 'time']);
  });

  it('a booking cannot turn texts back on for a number that said no (audit F07)', async () => {
    const { t, s, owner } = await salon();
    await t.call('PATCH', '/shops/me/booking', { token: owner, body: { booking_enabled: true } });
    const known = (await t.call('POST', '/clients', { token: owner, body: { name: 'Rosa Diaz', phone_e164: '+14155550199', consent: true } })).body;
    // Rosa replied STOP; the shop recorded it.
    await t.call('PATCH', `/clients/${known.id}`, { token: owner, body: { consent: false } });

    // Someone who knows her number books online and ticks "text me".
    const r = await t.call('POST', '/public/book/elif-hair-studio', {
      body: { service_id: s.service.id, date: '2026-10-16', time: '14:00', name: 'Not Rosa', phone: '(415) 555-0199', consent: true },
    });
    expect(r.status).toBe(201);
    const rosa = (await t.call('GET', `/clients/${known.id}`, { token: owner })).body;
    expect(rosa).toMatchObject({ name: 'Rosa Diaz', consent_status: 'revoked' });
    const appt = (await t.call('GET', '/appointments?date=2026-10-16', { token: owner })).body.data[0];
    expect(appt.reminders).toEqual([]);
  });

  it('books: a client by phone, an online appointment with a chair, reminders when they agree', async () => {
    const { t, s, owner, elif } = await salon();
    await t.call('PATCH', '/shops/me/booking', { token: owner, body: { booking_enabled: true } });
    const book = (body: Record<string, unknown>) =>
      t.call('POST', '/public/book/elif-hair-studio', { body: { service_id: s.service.id, date: '2026-10-16', time: '14:00', name: 'Maya Lopez', phone: '(415) 555-0177', consent: true, ...body } });
    const r = await book({ staff_id: elif.id });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ booked: true, staff_name: 'Elif', station_name: 'Koltuk 1', time: '14:00' });
    const appt = (await t.call('GET', '/appointments?date=2026-10-16', { token: owner })).body.data[0];
    expect(appt).toMatchObject({ source: 'online', client_name: 'Maya Lopez', barber_name: 'Elif' });
    expect(appt.reminders.length).toBeGreaterThan(0);
    // The same time with the same person is gone.
    const again = await book({ staff_id: elif.id, phone: '+14155550178', name: 'Someone' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SLOT_TAKEN');
    // A known phone is the same client; three open bookings per number at most.
    await book({ time: '15:00' });
    await book({ time: '16:00' });
    expect((await book({ time: '17:00' })).body.error.code).toBe('TOO_MANY_BOOKINGS');
    const clients = (await t.call('GET', '/clients?q=Maya', { token: owner })).body.data;
    expect(clients).toHaveLength(1);
    // A bot filling the hidden field gets a yes and books nothing.
    expect((await book({ time: '18:00', website: 'http://spam', phone: '+14155550111' })).status).toBe(201);
    expect((await t.call('GET', '/appointments?date=2026-10-16', { token: owner })).body.data).toHaveLength(3);
    expect((await book({ phone: '12-ab-34', time: '12:00' })).body.error.code).toBe('BAD_PHONE');
  });
});

describe('the booking agent', () => {
  it('asks what, who ("we are three … or anyone"), when, a name and a phone, then books', async () => {
    const { t, s, owner } = await salon();
    await t.call('PATCH', '/shops/me/booking', { token: owner, body: { booking_enabled: true } });
    let state: any = {};
    const turn = async (input: { set?: Record<string, unknown>; text?: string }) => {
      const r = await t.call('POST', '/public/book/elif-hair-studio/agent', { body: { lang: 'tr', state, ...input } });
      expect(r.status).toBe(200);
      state = r.body.state;
      return r.body;
    };
    const hello = await turn({});
    expect(hello.say).toBe('Elif Hair Studio randevu asistanıyım. Hangi hizmet için geliyorsunuz?');
    expect(hello.options.map((o: any) => o.label)).toEqual(['Boya', 'Haircut']);

    const who = await turn({ set: { service_id: s.service.id } });
    expect(who.step).toBe('staff');
    expect(who.say).toBe('Haircut için kimi istersiniz? 3 kişiyiz.');
    expect(who.options.map((o: any) => o.label)).toEqual(['Elif Hair Studio Owner', 'Elif', 'Can', 'Fark etmez, ilk boş olan']);
    expect(who.options[1].hint).toBe('Renk uzmanı');

    // Free text fills several answers at once.
    const named = await turn({ text: "yarın 3'te Elif olsun" });
    expect(state).toMatchObject({ date: '2026-10-16', time: '15:00' });
    expect(named.step).toBe('name');
    expect(named.say).toBe('Randevuyu kimin adına alayım?');
    await turn({ text: 'Maya Lopez' });
    const phone = await turn({ text: '415 555 0177', set: { consent: true } });
    expect(phone.step).toBe('confirm');
    expect(phone.say).toBe('Özetliyorum: Haircut, Elif, yarın saat 15:00. Ücret $30. Onaylıyor musunuz?');
    const done = await turn({ set: { confirm: true } });
    expect(done.step).toBe('done');
    expect(done.booked).toMatchObject({ staff_name: 'Elif', time: '15:00', date: '2026-10-16' });
    expect(done.say).toContain('Tamamdır Maya, randevunuz alındı: yarın saat 15:00, Elif.');
  });

  it('"anyone" goes to whoever is free and least booked; a taken time gets the nearest free ones', async () => {
    const { t, s, owner, elif, ownerStaff } = await salon();
    await t.call('PATCH', '/shops/me/booking', { token: owner, body: { booking_enabled: true } });
    await t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, barber_id: ownerStaff.id, starts_local: '2026-10-16T09:00' } });
    await t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, barber_id: elif.id, starts_local: '2026-10-16T09:30' } });
    let state: any = { service_id: s.service.id };
    const turn = async (input: Record<string, unknown>) => {
      const r = (await t.call('POST', '/public/book/elif-hair-studio/agent', { body: { lang: 'en', state, ...input } })).body;
      state = r.state;
      return r;
    };
    const any = await turn({ text: 'anyone is fine, tomorrow at 10' });
    // Can has no bookings that day: "anyone" is Can.
    expect(state.staff_id).toBe((await t.call('GET', '/barbers', { token: owner })).body.data.find((b: any) => b.name === 'Can').id);
    expect(any.step).toBe('name');

    // Tapping a time under "anyone" books that time with the person who has it free.
    state = { service_id: s.service.id, staff_id: 'any', date: '2026-10-16' };
    const times = await turn({});
    const chip = times.options.find((o: any) => o.label === '12:00');
    const tapped = await turn({ set: chip.set });
    expect(tapped.step).toBe('name');
    expect(state).toMatchObject({ time: '12:00', staff_id: chip.set.staff_id });

    // Elif at 09:30 tomorrow is taken: the agent says so and offers her nearest free times.
    state = { service_id: s.service.id, staff_id: elif.id, date: '2026-10-16' };
    const taken = await turn({ text: '9:30' });
    expect(taken.step).toBe('time');
    expect(taken.say).toMatch(/^09:30 is taken\. The nearest free times:/);
    expect(taken.options.map((o: any) => o.label)).toContain('10:00');
    expect(taken.options.map((o: any) => o.label)).not.toContain('09:30');
  });

  it('a closed day is said plainly, and the next free days are offered', async () => {
    const { t, s, owner } = await salon();
    await t.call('PATCH', '/shops/me/booking', { token: owner, body: { booking_enabled: true, hours: { '7': null } } });
    const r = (
      await t.call('POST', '/public/book/elif-hair-studio/agent', { body: { lang: 'en', state: { service_id: s.service.id, staff_id: 'any' }, text: 'sunday please' } })
    ).body;
    expect(r.say).toMatch(/^We’re closed on/);
    expect(r.step).toBe('date');
    expect(r.options[0]).toMatchObject({ label: 'Today', hint: '10:00' });
    expect(r.options.map((o: any) => o.set.date)).not.toContain('2026-10-18');
  });
});
