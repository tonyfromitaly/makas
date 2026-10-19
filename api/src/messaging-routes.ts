// Where the providers call us back: STOP replies (WhatsApp and SMS), plus the in-process sending loop.
// Both talk to the core API through app.inject with the service key, so consent rules live in one place.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isStop, sendDue, type Channel, type ChannelKind, type Outgoing, type SenderIO, type TickResult } from './messaging';

export interface MessagingOptions {
  prefix: string;
  serviceKey: string;
  /** Meta app secret (signs webhook posts) and the verify token chosen when subscribing. */
  whatsapp?: { appSecret: string; verifyToken: string };
  /** Twilio auth token and the exact public URL Twilio posts to (it is part of the signature). */
  twilio?: { authToken: string; webhookUrl: string };
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Twilio: base64 HMAC-SHA1 of the URL followed by every POST field (sorted) as key+value. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', authToken).update(data).digest('base64');
}

export function metaSignature(appSecret: string, raw: Buffer | string) {
  return 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
}

/** The core API, called in-process as the message service. */
export function serviceIO(app: FastifyInstance, prefix: string, serviceKey: string): SenderIO & { optout(phone: string): Promise<number> } {
  const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
    const res = await app.inject({ method, url: prefix + url, headers: { authorization: `Bearer ${serviceKey}`, 'x-forwarded-proto': 'https' }, payload });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
  };
  return {
    async due(limit) {
      const r = await call('GET', `/reminders/due?limit=${limit}`);
      if (r.status !== 200) throw new Error(`reminders/due ${r.status}`);
      return r.body.data as Outgoing[];
    },
    async report(id, result) {
      const r = await call('POST', `/reminders/${id}/result`, result);
      // 409: already final (a second sender or an operator got there first); nothing to do.
      if (r.status !== 200 && r.status !== 409) throw new Error(`reminders/${id}/result ${r.status}`);
    },
    async optout(phone) {
      const r = await call('POST', '/reminders/optout', { phone_e164: phone });
      return r.status === 200 ? r.body.revoked : 0;
    },
  };
}

export async function messagingRoutes(app: FastifyInstance, o: MessagingOptions) {
  const io = serviceIO(app, o.prefix, o.serviceKey);
  const stop = async (phone: string, text: string, via: string) => {
    if (!isStop(text)) return;
    const revoked = await io.optout(phone.startsWith('+') ? phone : `+${phone}`);
    app.log.info({ via, revoked }, 'reminder opt-out (STOP)');
  };

  // WhatsApp (Meta): GET is the one-time subscription check, POST carries incoming messages.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.get(`${o.prefix}/webhooks/whatsapp`, async (req, reply) => {
      const q = req.query as Record<string, string>;
      if (o.whatsapp && q['hub.mode'] === 'subscribe' && same(q['hub.verify_token'] ?? '', o.whatsapp.verifyToken))
        return reply.type('text/plain').send(q['hub.challenge'] ?? '');
      return reply.code(403).send();
    });
    scope.post(`${o.prefix}/webhooks/whatsapp`, async (req, reply) => {
      if (!o.whatsapp) return reply.code(404).send();
      const raw = req.body as Buffer;
      if (!same(String(req.headers['x-hub-signature-256'] ?? ''), metaSignature(o.whatsapp.appSecret, raw))) return reply.code(401).send();
      let body: any;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply.code(400).send();
      }
      for (const entry of body?.entry ?? [])
        for (const change of entry?.changes ?? [])
          for (const msg of change?.value?.messages ?? []) {
            const text = msg?.text?.body ?? msg?.button?.text ?? msg?.button?.payload ?? msg?.interactive?.button_reply?.title ?? '';
            if (msg?.from && text) await stop(String(msg.from), String(text), 'whatsapp');
          }
      return { received: true }; // always 200 once verified, or Meta retries
    });
  });

  // SMS (Twilio): incoming messages arrive form-encoded; the answer is an empty TwiML reply.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(body as string))),
    );
    scope.post(`${o.prefix}/webhooks/twilio`, async (req, reply) => {
      if (!o.twilio) return reply.code(404).send();
      const params = (req.body ?? {}) as Record<string, string>;
      const expected = twilioSignature(o.twilio.authToken, o.twilio.webhookUrl, params);
      if (!same(String(req.headers['x-twilio-signature'] ?? ''), expected)) return reply.code(401).send();
      if (params.From && params.Body) await stop(params.From, params.Body, 'sms');
      return reply.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    });
  });
}

/** Sends due reminders every `everyMs`. Returns a stop function. One round at a time, never overlapping. */
export function startSender(
  app: FastifyInstance,
  o: { prefix: string; serviceKey: string; channels: Partial<Record<ChannelKind, Channel>>; everyMs?: number },
) {
  const io = serviceIO(app, o.prefix, o.serviceKey);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r: TickResult = await sendDue(io, o.channels, { log: (obj, msg) => app.log.warn(obj, msg) });
      if (r.sent || r.failed || r.retry) app.log.info({ reminders: r }, 'reminders sent');
    } catch (e) {
      app.log.error(e, 'reminder round failed');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, o.everyMs ?? 30_000);
  const first = setTimeout(tick, 5_000);
  return () => {
    clearInterval(timer);
    clearTimeout(first);
  };
}
