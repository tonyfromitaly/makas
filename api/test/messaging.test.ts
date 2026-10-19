import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '@makas/core';
import { setup, SERVICE_KEY } from './helpers';
import { openDatabase } from '../src/db';
import { loadConfig } from '../src/config';
import { argon2Deps, buildServer } from '../src/server';
import { isStop, MAX_ATTEMPTS, SendError, sendDue, twilioSmsChannel, whatsappChannel, type Channel, type Outgoing } from '../src/messaging';
import { metaSignature, serviceIO, twilioSignature } from '../src/messaging-routes';

// Reminder sending: the loop against the real API (fake providers), the provider adapters, STOP replies.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

function fakeChannel(kind: 'whatsapp' | 'sms', behaviour: (m: Outgoing) => void = () => {}) {
  const sent: Outgoing[] = [];
  const ch: Channel = {
    kind,
    name: `fake-${kind}`,
    async send(m) {
      behaviour(m);
      sent.push(m);
      return { ref: `ref-${sent.length}` };
    },
  };
  return { ch, sent };
}

async function shopWithBooking() {
  const t = await setup('2026-10-15T09:00:00Z');
  closers.push(t.close);
  const s = await t.registerShop('Fade Factory');
  const r = await t.call('POST', '/appointments', { token: s.token, body: { client_id: s.client.id, service_id: s.service.id, starts_local: '2026-10-16T10:00' } });
  expect(r.status).toBe(201);
  const io = serviceIO(t.app, '', SERVICE_KEY);
  const queue = async () =>
    (await t.db.query(`select template_key, status, provider_ref, error, attempts from reminder_queue order by scheduled_at`)).rows;
  return { t, s, io, queue };
}

describe('reminder sender', () => {
  it('sends what is due over the client’s channel and records the provider reference', async () => {
    const { t, io, queue } = await shopWithBooking();
    const wa = fakeChannel('whatsapp');
    t.clock.now = new Date('2026-10-15T22:30:00Z'); // the day-before slot (18:00 New York) has passed
    expect(await sendDue(io, { whatsapp: wa.ch })).toEqual({ sent: 1, failed: 0, retry: 0 });
    expect(wa.sent[0]).toMatchObject({ to: '+14155551001', template_key: 'reminder_day_before', vars: { name: 'Jane', shop: 'Fade Factory', time: '10:00' } });
    expect(wa.sent[0].message).toContain('STOP');
    const rows = await queue();
    expect(rows[0]).toMatchObject({ status: 'sent', provider_ref: 'fake-whatsapp:ref-1' });
    expect(rows[1].status).toBe('queued'); // the day-of one is not due yet
    // Nothing is sent twice.
    expect(await sendDue(io, { whatsapp: wa.ch })).toEqual({ sent: 0, failed: 0, retry: 0 });
  });

  it('falls back to SMS when WhatsApp is not set up', async () => {
    const { t, io } = await shopWithBooking();
    const sms = fakeChannel('sms');
    t.clock.now = new Date('2026-10-15T22:30:00Z');
    expect((await sendDue(io, { sms: sms.ch })).sent).toBe(1);
    expect(sms.sent).toHaveLength(1);
  });

  it('retries a passing failure after the lease runs out, and gives up after three tries', async () => {
    const { t, io, queue } = await shopWithBooking();
    const down = fakeChannel('whatsapp', () => {
      throw new SendError('whatsapp 503: unavailable', false);
    });
    t.clock.now = new Date('2026-10-15T22:30:00Z');
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const r = await sendDue(io, { whatsapp: down.ch });
      expect(r, `round ${i}`).toEqual(i < MAX_ATTEMPTS ? { sent: 0, failed: 0, retry: 1 } : { sent: 0, failed: 1, retry: 0 });
      // Within the 5-minute lease nobody picks it up again.
      expect((await sendDue(io, { whatsapp: down.ch })).retry).toBe(0);
      t.clock.now = new Date(t.clock.now.getTime() + 6 * 60_000);
    }
    const [row] = await queue();
    expect(row).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect(row.error).toContain('503');
  });

  it('a permanent refusal (bad number) fails at once', async () => {
    const { t, io, queue } = await shopWithBooking();
    const bad = fakeChannel('whatsapp', () => {
      throw new SendError('whatsapp 400: invalid recipient', true);
    });
    t.clock.now = new Date('2026-10-15T22:30:00Z');
    expect(await sendDue(io, { whatsapp: bad.ch })).toEqual({ sent: 0, failed: 1, retry: 0 });
    expect((await queue())[0]).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('a client who said STOP gets nothing', async () => {
    const { t, io } = await shopWithBooking();
    const wa = fakeChannel('whatsapp');
    // The client API never returns the full number; the opt-out comes in by phone, as from a provider.
    expect((await t.call('POST', '/reminders/optout', { token: SERVICE_KEY, body: { phone_e164: '+14155551001' } })).status).toBe(200);
    t.clock.now = new Date('2026-10-16T13:00:00Z');
    expect(await sendDue(io, { whatsapp: wa.ch })).toEqual({ sent: 0, failed: 0, retry: 0 });
    expect(wa.sent).toHaveLength(0);
  });
});

describe('provider adapters', () => {
  const msg: Outgoing = {
    id: 'r1',
    to: '+905551112233',
    language: 'tr',
    template_key: 'reminder_day_before',
    vars: { name: 'Ali', shop: 'Berber Halil', service: 'Saç kesimi', time: '15:00', date: '2026-10-20' },
    message: 'Merhaba Ali…\nMesaj almak istemiyorsanız STOP yazın.',
    attempt: 1,
    channel: 'whatsapp',
  };
  const fakeFetch = (status: number, body: object, seen: { url?: string; init?: RequestInit }) =>
    (async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.init = init;
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;

  it('WhatsApp: an approved template with the variables in order, Turkish language code', async () => {
    const seen: any = {};
    const ch = whatsappChannel({ token: 'tok', phoneNumberId: '123', templates: { reminder_day_before: 'onceki', reminder_day_of: 'bugun' }, fetch: fakeFetch(200, { messages: [{ id: 'wamid.X' }] }, seen) });
    expect(await ch.send(msg)).toEqual({ ref: 'wamid.X' });
    expect(seen.url).toBe('https://graph.facebook.com/v21.0/123/messages');
    expect(seen.init.headers.authorization).toBe('Bearer tok');
    const body = JSON.parse(seen.init.body);
    expect(body).toMatchObject({ to: '905551112233', type: 'template', template: { name: 'onceki', language: { code: 'tr' } } });
    expect(body.template.components[0].parameters.map((p: any) => p.text)).toEqual(['Ali', '15:00', 'Berber Halil', 'Saç kesimi']);
  });

  it('WhatsApp: 400 is permanent, 429 and 500 are worth retrying', async () => {
    const mk = (status: number) => whatsappChannel({ token: 't', phoneNumberId: '1', templates: { reminder_day_before: 'a', reminder_day_of: 'b' }, fetch: fakeFetch(status, { error: { message: 'nope' } }, {}) });
    await expect(mk(400).send(msg)).rejects.toMatchObject({ permanent: true });
    await expect(mk(429).send(msg)).rejects.toMatchObject({ permanent: false });
    await expect(mk(500).send(msg)).rejects.toMatchObject({ permanent: false });
  });

  it('Twilio SMS: the full text with the STOP line, from a number or a messaging service', async () => {
    const seen: any = {};
    const ch = twilioSmsChannel({ accountSid: 'AC1', authToken: 'secret', from: 'MG9', fetch: fakeFetch(201, { sid: 'SM1' }, seen) });
    expect(await ch.send({ ...msg, channel: 'sms' })).toEqual({ ref: 'SM1' });
    expect(seen.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    const form = new URLSearchParams(String(seen.init.body));
    expect(form.get('To')).toBe('+905551112233');
    expect(form.get('MessagingServiceSid')).toBe('MG9');
    expect(form.get('Body')).toContain('STOP');
    expect(seen.init.headers.authorization).toBe('Basic ' + Buffer.from('AC1:secret').toString('base64'));
  });

  it('knows a STOP from an ordinary reply', () => {
    for (const s of ['STOP', 'stop lütfen', 'Dur', 'DURDUR', 'mesaj istemiyorum', 'Baja', 'UNSUBSCRIBE']) expect(isStop(s), s).toBe(true);
    for (const s of ['iptal', 'gelemiyorum', 'tamam', 'Teşekkürler', 'durum ne?']) expect(isStop(s), s).toBe(false);
  });
});

describe('STOP webhooks', () => {
  async function server(opts: { requireHttps?: boolean } = {}) {
    const db = await openDatabase('pglite:memory');
    await migrate(db);
    const config = loadConfig({ jwtSecret: 'test-jwt-secret-that-is-long-enough-123', serviceApiKey: SERVICE_KEY, now: () => new Date('2026-10-15T09:00:00Z') });
    const app = await buildServer({
      db,
      config,
      deps: argon2Deps,
      trustProxy: true,
      requireHttps: opts.requireHttps,
      authRateLimit: 1000,
      messaging: { whatsapp: { appSecret: 'meta-secret', verifyToken: 'verify-me' }, twilio: { authToken: 'twilio-secret', webhookUrl: 'https://x.test/webhooks/twilio' } },
    });
    closers.push(async () => {
      await app.close();
      await db.close();
    });
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'x-forwarded-proto': 'https' },
      payload: { shop_name: 'S', owner_name: 'O', email: `o${Date.now()}@example.com`, password: 'correct-horse-battery', country: 'TR', timezone: 'Europe/Istanbul', language: 'tr', currency: 'TRY' },
    });
    const token = JSON.parse(reg.body).access_token;
    const c = await app.inject({ method: 'POST', url: '/clients', headers: { authorization: `Bearer ${token}`, 'x-forwarded-proto': 'https' }, payload: { name: 'Ali', phone_e164: '+905551112233', consent: true } });
    const consent = async () => (await db.query(`select consent_status from clients where id = $1`, [JSON.parse(c.body).id])).rows[0].consent_status;
    return { app, consent };
  }

  it('WhatsApp: answers the subscription check, rejects bad signatures, revokes consent on STOP', async () => {
    const { app, consent } = await server();
    const ok = await app.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42' });
    expect(ok.body).toBe('42');
    expect((await app.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42' })).statusCode).toBe(403);

    const payload = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '905551112233', type: 'text', text: { body: 'STOP' } }] } }] }] });
    const forged = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' }, payload });
    expect(forged.statusCode).toBe(401);
    expect(await consent()).toBe('granted');

    const chat = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '905551112233', type: 'text', text: { body: 'iptal' } }] } }] }] });
    await app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': metaSignature('meta-secret', chat) }, payload: chat });
    expect(await consent()).toBe('granted');

    const real = await app.inject({ method: 'POST', url: '/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': metaSignature('meta-secret', payload) }, payload });
    expect(real.statusCode).toBe(200);
    expect(await consent()).toBe('revoked');
  });

  it('Twilio: checks the signature over the URL and fields, revokes consent on STOP', async () => {
    const { app, consent } = await server();
    const fields = { From: '+905551112233', Body: 'Dur', MessageSid: 'SM1' };
    const form = new URLSearchParams(fields).toString();
    const forged = await app.inject({ method: 'POST', url: '/webhooks/twilio', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'abc' }, payload: form });
    expect(forged.statusCode).toBe(401);
    const real = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignature('twilio-secret', 'https://x.test/webhooks/twilio', fields) },
      payload: form,
    });
    expect(real.statusCode).toBe(200);
    expect(real.body).toContain('<Response>');
    expect(await consent()).toBe('revoked');
  });

  it('the in-process sender still reaches the API when HTTPS is required', async () => {
    const { app } = await server({ requireHttps: true });
    expect(await serviceIO(app, '', SERVICE_KEY).due(10)).toEqual([]);
  });
});
