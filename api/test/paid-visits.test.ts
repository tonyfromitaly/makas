import { afterEach, describe, expect, it } from 'vitest';
import { setup } from './helpers';

// A paid visit's receipt is money that came in. Moving the visit on the calendar must not rewrite it, a team
// member must not undo it, and undoing it (owner only) is a void with a reason. Audit 2026-10-22, F01–F03.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function shopWithWorker() {
  const t = await setup('2026-10-22T16:00:00Z'); // 12:00 in New York
  closers.push(t.close);
  const s = await t.registerShop('Oak Barbers');
  const owner = s.token;
  const call = (method: string, path: string, body?: unknown, token = owner) => t.call(method, path, { token, body });
  const staff = (await call('POST', '/barbers', { name: 'Rio', pay_model: 'commission', service_pct: 40 })).body;
  const invite = (await call('POST', `/barbers/${staff.id}/login`, { email: 'rio@example.com' })).body;
  const worker = (await call('POST', '/auth/key', { key: invite.key, password: 'rio-test-password-123' }, undefined)).body.access_token;
  const ownerStaff = (await call('GET', '/barbers')).body.data.find((b: any) => b.is_owner);
  const book = async (starts_local: string, barber_id = staff.id) =>
    (await call('POST', '/appointments', { client_id: s.client.id, service_id: s.service.id, barber_id, starts_local })).body;
  const till = async (date = '2026-10-22') => (await call('GET', `/sales?date=${date}`)).body;
  const statusOf = async (id: string, date = '2026-10-22') => (await call('GET', `/appointments?date=${date}`)).body.data.find((x: any) => x.id === id)?.status;
  return { t, s, call, staff, worker, ownerStaff, book, till, statusOf };
}

describe('paid visits', () => {
  it('F01: a team member cannot undo their paid visit by setting it back to booked, cancelled or missed', async () => {
    const { call, worker, book, till, statusOf } = await shopWithWorker();
    const a = await book('2026-10-22T11:00');
    expect((await call('POST', '/sales', { appointment_id: a.id, method: 'cash' }, worker)).status).toBe(201);
    expect((await till()).totals.total_cents).toBe(3000);

    for (const status of ['booked', 'cancelled', 'missed']) {
      const r = await call('PATCH', `/appointments/${a.id}`, { status, cancel_reason: 'wrong_entry' }, worker);
      expect(r.status).toBe(403);
    }
    expect((await till()).totals.total_cents).toBe(3000);
    expect(await statusOf(a.id)).toBe('done');
    // Nor can they ring the same paid visit up again with a smaller receipt.
    const again = await call('POST', '/sales', { appointment_id: a.id, method: 'cash', lines: [{ kind: 'other', name: 'Cheaper', unit_cents: 100 }] }, worker);
    expect(again.status).toBe(403);
    expect((await till()).totals.total_cents).toBe(3000);
  });

  it('F01: the owner undoes a paid visit only with a reason, and the voided receipt is kept', async () => {
    const { call, worker, book, till } = await shopWithWorker();
    const a = await book('2026-10-22T11:00');
    await call('POST', '/sales', { appointment_id: a.id, method: 'card', tip_cents: 500 }, worker);

    expect((await call('PATCH', `/appointments/${a.id}`, { status: 'booked' })).status).toBe(400);
    expect((await till()).totals.total_cents).toBe(3500);

    const r = await call('PATCH', `/appointments/${a.id}`, { status: 'booked', cancel_reason: 'wrong_entry', cancel_note: 'Rang up the wrong client' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('booked');
    expect((await till()).totals.total_cents).toBe(0);
    const voids = (await call('GET', '/voids')).body.data;
    expect(voids).toMatchObject([{ kind: 'sale', reason: 'wrong_entry', note: 'Rang up the wrong client', amount_cents: 3500 }]);
  });

  it('F02: moving a paid visit keeps its receipt: lines, total, tip and the day it was paid', async () => {
    const { s, call, book, till } = await shopWithWorker();
    const a = await book('2026-10-22T11:00');
    const sale = (
      await call('POST', '/sales', {
        appointment_id: a.id,
        method: 'cash',
        tip_cents: 700,
        lines: [{ kind: 'service', ref_id: s.service.id }, { kind: 'other', name: 'Hot towel', unit_cents: 2000 }],
      })
    ).body;
    expect(sale.total_cents).toBe(5700);

    // A later calendar fix: the visit was really at 10:00 the day before, with someone else.
    const moved = await call('PATCH', `/appointments/${a.id}`, { starts_local: '2026-10-21T10:00' });
    expect(moved.status).toBe(200);
    const kept = (await till()).data.find((x: any) => x.id === sale.id);
    expect(kept).toMatchObject({ total_cents: 5700, tip_cents: 700, sold_on: '2026-10-22' });
    expect(kept.items.map((i: any) => [i.name, i.unit_cents]).sort()).toEqual([['Haircut', 3000], ['Hot towel', 2000]].sort());
    expect((await till('2026-10-21')).totals.total_cents).toBe(0);
  });

  it('F03: at checkout a team member cannot put a line on someone else', async () => {
    const { s, call, worker, ownerStaff, book, till, statusOf } = await shopWithWorker();
    const a = await book('2026-10-22T11:00');
    const r = await call('POST', '/sales', { appointment_id: a.id, method: 'cash', lines: [{ kind: 'service', ref_id: s.service.id, staff_id: ownerStaff.id }] }, worker);
    expect(r.status).toBe(403);
    expect((await till()).totals.total_cents).toBe(0);
    expect(await statusOf(a.id)).toBe('booked');
  });
});
