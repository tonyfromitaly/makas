import { afterEach, describe, expect, it } from 'vitest';
import { setup } from './helpers';

// What the design review asked for, at the API: the nearest free times when a slot is taken, and a
// fair comparison under every number in the books.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

describe('taken slot → nearest free times', () => {
  it('says the time is taken and offers the closest free starts, nearest first in time order', async () => {
    const t = await setup('2026-10-15T09:00:00Z');
    closers.push(t.close);
    const s = await t.registerShop('Shop'); // New York, a 30-minute service, one barber
    for (const at of ['2026-10-16T10:00', '2026-10-16T10:30'])
      expect((await t.call('POST', '/appointments', { token: s.token, body: { client_id: s.client.id, service_id: s.service.id, starts_local: at } })).status).toBe(201);
    const r = await t.call('GET', `/appointments/free?date=2026-10-16&service_id=${s.service.id}&near=10:00`, { token: s.token });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ taken: true, reason: 'busy' });
    expect(r.body.slots.map((x: any) => x.time)).toEqual(['09:00', '09:15', '09:30']); // 9:30 and 9:15 are closest; 9:00 and 11:00 tie, the earlier wins
    const free = await t.call('GET', `/appointments/free?date=2026-10-16&service_id=${s.service.id}&near=14:00`, { token: s.token });
    expect(free.body.taken).toBe(false);
    const late = await t.call('GET', `/appointments/free?date=2026-10-16&service_id=${s.service.id}&near=20:15`, { token: s.token });
    expect(late.body.reason).toBe('closed'); // not taken: outside the working day
  });

  it('never offers a time already past', async () => {
    const t = await setup('2026-10-16T16:05:00Z'); // 12:05 in New York
    closers.push(t.close);
    const s = await t.registerShop('Shop');
    const r = await t.call('GET', `/appointments/free?date=2026-10-16&service_id=${s.service.id}&near=09:00&count=8`, { token: s.token });
    expect(r.body.slots.every((x: any) => x.time >= '12:30')).toBe(true);
  });
});

describe('books: a fair comparison on the cards', () => {
  it('a running month is compared with the same days of the last one', async () => {
    const t = await setup('2026-10-15T15:00:00Z');
    closers.push(t.close);
    const s = await t.registerShop('Shop');
    for (const [d, c] of [['2026-09-05', 10000], ['2026-09-25', 90000], ['2026-10-05', 12000]] as const)
      await t.call('POST', '/books', { token: s.token, body: { kind: 'income', category: 'service', amount_cents: c, entry_date: d } });
    const r = await t.call('GET', '/books/summary?period=month&date=2026-10-15', { token: s.token });
    expect(r.body.compare).toMatchObject({ basis: 'same_days', income_pct: 20 }); // 120 vs 100 on 1–15 Sep, not vs the whole 1,000
    const sep = await t.call('GET', '/books/summary?period=month&date=2026-09-15', { token: s.token });
    expect(sep.body.compare.basis).toBe('previous');
  });
});
