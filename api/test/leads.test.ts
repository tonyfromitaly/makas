import { afterEach, describe, expect, it } from 'vitest';
import { purgeOldDemoRequests, withSystem } from '@makas/core';
import { ADMIN_KEY, setup } from './helpers';

let env: Awaited<ReturnType<typeof setup>> | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

const form = { name: 'Rosa Diaz', business: 'Northside Barbers', type: 'berber', email: 'rosa@example.com', phone: '+1 312 555 0100', city: 'Chicago, US', message: 'Two chairs, Square.', contact: 'arayin', consent: true, lang: 'en' };
const admin = async (e: NonNullable<typeof env>) => JSON.parse((await e.app.inject({ method: 'GET', url: '/admin/demo-requests', headers: { authorization: `Bearer ${ADMIN_KEY}` } })).body);

describe('website demo requests', () => {
  it('stores the request, tells the operator and lists it for the operator only', async () => {
    const told: { subject: string; lines: string[] }[] = [];
    env = await setup('2026-10-21T10:00:00Z', { notifyOperator: async (subject: string, lines: string[]) => void told.push({ subject, lines }) });
    const r = await env.call('POST', '/public/demo-requests', { body: form });
    expect(r.status).toBe(201);
    expect(told).toHaveLength(1);
    expect(told[0].subject).toBe('demo request (monacount): Northside Barbers');
    expect(told[0].lines.join('\n')).toContain('rosa@example.com');
    expect((await env.call('GET', '/admin/demo-requests')).status).toBe(401);
    const list = await admin(env);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ business: 'Northside Barbers', contact: 'arayin', lang: 'en' });
  });

  it('needs consent and valid fields', async () => {
    env = await setup();
    expect((await env.call('POST', '/public/demo-requests', { body: { ...form, consent: false } })).status).toBe(400);
    expect((await env.call('POST', '/public/demo-requests', { body: { ...form, email: 'not-an-email' } })).status).toBe(400);
    expect((await env.call('POST', '/public/demo-requests', { body: { ...form, name: '' } })).status).toBe(400);
    // "Call me" without a number cannot be answered; "email me" needs none.
    expect((await env.call('POST', '/public/demo-requests', { body: { ...form, phone: '' } })).status).toBe(400);
    expect((await env.call('POST', '/public/demo-requests', { body: { ...form, phone: '', contact: 'eposta' } })).status).toBe(201);
  });

  it('a bot that fills the hidden field, or a repeat sender, gets 201 and nothing is stored', async () => {
    const told: string[] = [];
    env = await setup('2026-10-21T10:00:00Z', { notifyOperator: async (s: string) => void told.push(s) });
    expect((await env.call('POST', '/public/demo-requests', { body: { ...form, company_url: 'http://spam' } })).status).toBe(201);
    for (let i = 0; i < 5; i++) expect((await env.call('POST', '/public/demo-requests', { body: { ...form, email: 'ROSA@example.com' } })).status).toBe(201);
    expect((await admin(env)).data).toHaveLength(3);
    expect(told).toHaveLength(3);
  });

  it('a failing notification does not lose the request', async () => {
    env = await setup('2026-10-21T10:00:00Z', { notifyOperator: async () => { throw new Error('mail down'); } });
    expect((await env.call('POST', '/public/demo-requests', { body: form })).status).toBe(201);
    expect((await admin(env)).data).toHaveLength(1);
  });

  it('requests are deleted after 12 months', async () => {
    env = await setup('2026-10-21T10:00:00Z');
    await env.call('POST', '/public/demo-requests', { body: form });
    expect(await withSystem(env.db, (tx) => purgeOldDemoRequests(tx, new Date('2027-10-20T10:00:00Z')))).toBe(0);
    expect(await withSystem(env.db, (tx) => purgeOldDemoRequests(tx, new Date('2027-10-22T10:00:00Z')))).toBe(1);
  });
});
