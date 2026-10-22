import { afterEach, describe, expect, it } from 'vitest';
import { categoryOf } from '@makas/core';
import { setup } from './helpers';

// Voids keep their reason and Mona can tell them; a paid reminder is an expense in the books.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function shop(language: 'tr' | 'en' = 'en') {
  const t = await setup('2026-10-15T13:00:00Z'); // 09:00 in New York
  closers.push(t.close);
  const s = await t.registerShop('Oak Barbers', { language });
  return { t, s, owner: s.token };
}

describe('voids and cancellations', () => {
  it('a cancelled visit, a no-show and a voided sale each leave a record with a reason, and Mona tells them', async () => {
    const { t, s, owner } = await shop('tr');
    const book = (at: string) => t.call('POST', '/appointments', { token: owner, body: { client_id: s.client.id, service_id: s.service.id, starts_local: at } });
    const a = await book('2026-10-15T11:00');
    const b = await book('2026-10-15T12:00');
    await t.call('PATCH', `/appointments/${a.body.id}`, { token: owner, body: { status: 'cancelled', cancel_reason: 'client_cancelled', cancel_note: 'Called in sick' } });
    await t.call('PATCH', `/appointments/${b.body.id}`, { token: owner, body: { status: 'missed' } });
    const sale = await t.call('POST', '/sales', { token: owner, body: { method: 'cash', lines: [{ kind: 'other', name: 'Gift card', unit_cents: 2500 }] } });
    expect((await t.call('DELETE', `/sales/${sale.body.id}`, { token: owner, body: { reason: 'wrong_entry' } })).status).toBe(204);

    const voids = (await t.call('GET', '/voids', { token: owner })).body.data;
    expect(voids.map((v: any) => [v.kind, v.reason]).sort()).toEqual([
      ['appointment', 'client_cancelled'],
      ['appointment', 'no_show'],
      ['sale', 'wrong_entry'],
    ]);
    expect(voids.find((v: any) => v.reason === 'client_cancelled')).toMatchObject({ note: 'Called in sick', client_name: 'Jane Client', amount_cents: 3000 });

    const r = await t.call('POST', '/assistant', { token: owner, body: { text: 'bugün kaç iptal oldu, nedenleri ne?', lang: 'tr' } });
    expect(r.body.reply).toContain('3 iptal');
    expect(r.body.reply).toContain('1 satış iptali ($25)');
    expect(r.body.reply).toContain('2 randevu iptali ya da gelmeyen');
    expect(r.body.reply).toMatch(/müşteri vazgeçti 1/);
    expect(r.body.reply).toMatch(/gelmedi 1/);
    expect(r.body.reply).toMatch(/yanlış giriş 1/);

    // The export carries the voids too.
    const exp = (await t.call('GET', '/shops/me/export', { token: owner })).body;
    expect(exp.voids).toHaveLength(3);
  });

  it('cancelling one appointment is still a command, not a question about cancellations', async () => {
    const { t, owner } = await shop('en');
    const r = await t.call('POST', '/assistant', { token: owner, body: { text: 'how many cancellations this week?', lang: 'en' } });
    expect(r.body.reply).toBe('No voids or cancellations this week.');
    const sale = await t.call('POST', '/sales', { token: owner, body: { method: 'cash', lines: [{ kind: 'other', name: 'Gift card', unit_cents: 2500 }] } });
    await t.call('DELETE', `/sales/${sale.body.id}`, { token: owner, body: { reason: 'refund' } });
    const one = await t.call('POST', '/assistant', { token: owner, body: { text: 'how many cancellations today and why?', lang: 'en' } });
    expect(one.body.reply).toBe('Today: 1 voided sale ($25). Reasons: refund 1.');
  });
});

describe('paid reminders', () => {
  it('ticking a payment reminder as paid writes the expense; reopening or deleting the entry undoes it', async () => {
    const { t, owner } = await shop('en');
    const task = (await t.call('POST', '/tasks', { token: owner, body: { kind: 'payment', title: 'Rent', due_date: '2026-10-15', amount_cents: 180000 } })).body;
    const books = async () => (await t.call('GET', '/books?from=2026-10-01&to=2026-10-31', { token: owner })).body.data;

    const paid = await t.call('PATCH', `/tasks/${task.id}`, { token: owner, body: { status: 'done' } });
    expect(paid.body.book_entry_id).toBeTruthy();
    expect(await books()).toMatchObject([{ kind: 'expense', category: 'rent', amount_cents: 180000, entry_date: '2026-10-15', source: 'task' }]);
    // Ticking twice never writes twice; a corrected amount follows.
    await t.call('PATCH', `/tasks/${task.id}`, { token: owner, body: { status: 'done', amount_cents: 175000 } });
    expect((await books()).map((b: any) => b.amount_cents)).toEqual([175000]);

    await t.call('PATCH', `/tasks/${task.id}`, { token: owner, body: { status: 'open' } });
    expect(await books()).toEqual([]);

    await t.call('PATCH', `/tasks/${task.id}`, { token: owner, body: { status: 'done' } });
    const [entry] = await books();
    expect((await t.call('DELETE', `/books/${entry.id}`, { token: owner })).status).toBe(204);
    const back = (await t.call('GET', '/tasks?status=all', { token: owner })).body.data[0];
    expect(back.status).toBe('open');

    // A plain reminder (no amount) never touches the books.
    const call = (await t.call('POST', '/tasks', { token: owner, body: { title: 'Call the supplier', due_date: '2026-10-15' } })).body;
    await t.call('PATCH', `/tasks/${call.id}`, { token: owner, body: { status: 'done' } });
    expect(await books()).toEqual([]);
  });

  it('guesses the category from the title', () => {
    expect(categoryOf('Kira ödemesi')).toBe('rent');
    expect(categoryOf('Water bill')).toBe('utilities');
    expect(categoryOf('Doğalgaz faturası')).toBe('utilities');
    expect(categoryOf('Product supplier')).toBe('supplies');
    expect(categoryOf('Emre maaş')).toBe('wages');
    expect(categoryOf('Accountant')).toBe('other');
  });
});
