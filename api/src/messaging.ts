// Sends the reminders the API queues. Every half minute it leases what is due (GET /reminders/due),
// sends each one over WhatsApp (Meta Cloud API) or SMS (Twilio), and reports the result back.
// Consent, booking state and the shop's subscription are re-checked by the API at lease time.
//
// Failures: a provider saying "no" for good (bad number, template rejected) marks the reminder failed.
// A passing problem (timeout, 429, 5xx) is left alone: the lease runs out after 5 minutes and the next
// round tries again, up to MAX_ATTEMPTS, after which it is marked failed so it never loops.

export type ChannelKind = 'whatsapp' | 'sms';

export interface Outgoing {
  id: string;
  to: string;
  language: 'tr' | 'en' | 'es';
  template_key: 'reminder_day_before' | 'reminder_day_of';
  vars: { name: string; shop: string; service: string; time: string; date: string };
  message: string;
  attempt: number;
  channel: ChannelKind;
}

export interface Channel {
  kind: ChannelKind;
  name: string;
  send(m: Outgoing): Promise<{ ref: string }>;
}

/** permanent: retrying will not help (invalid number, rejected template, auth). */
export class SendError extends Error {
  constructor(message: string, readonly permanent: boolean) {
    super(message);
  }
}

type Fetch = typeof fetch;

const transient = (status: number) => status === 408 || status === 429 || status >= 500;

/** One HTTP call to a provider, with a timeout; network errors and timeouts are passing problems. */
async function post(f: Fetch, url: string, init: RequestInit, label: string) {
  let res: Response;
  try {
    res = await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new SendError(`${label}: ${(e as Error).message}`, false);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const why = body?.error?.message ?? body?.message ?? text.slice(0, 200);
    throw new SendError(`${label} ${res.status}: ${why}`, !transient(res.status));
  }
  return body;
}

// --- WhatsApp: Meta Cloud API. Business-initiated messages must use a template approved by Meta. ---

const WA_LANG = { tr: 'tr', en: 'en_US', es: 'es' } as const;

export interface WhatsAppOptions {
  token: string;
  phoneNumberId: string;
  /** Approved template names (same name in every language, one translation each). */
  templates: Record<Outgoing['template_key'], string>;
  apiVersion?: string;
  fetch?: Fetch;
}

/**
 * Template bodies (Utility category), the variables in this order:
 *  day before: {{1}} name, {{2}} time, {{3}} shop, {{4}} service
 *  day of:     {{1}} name, {{2}} time, {{3}} shop
 * Texts to submit are in docs/hatirlatma-gonderimi.md.
 */
export function whatsappChannel(o: WhatsAppOptions): Channel {
  const f = o.fetch ?? fetch;
  const url = `https://graph.facebook.com/${o.apiVersion ?? 'v21.0'}/${o.phoneNumberId}/messages`;
  return {
    kind: 'whatsapp',
    name: 'whatsapp-cloud',
    async send(m) {
      const v = m.vars;
      const params = m.template_key === 'reminder_day_before' ? [v.name, v.time, v.shop, v.service] : [v.name, v.time, v.shop];
      const body = await post(
        f,
        url,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: m.to.replace(/^\+/, ''),
            type: 'template',
            template: {
              name: o.templates[m.template_key],
              language: { code: WA_LANG[m.language] ?? 'en_US' },
              components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
            },
          }),
        },
        'whatsapp',
      );
      const ref = body?.messages?.[0]?.id;
      if (!ref) throw new SendError('whatsapp: no message id in the response', false);
      return { ref };
    },
  };
}

// --- SMS: Twilio. "from" is a number (+1...) or a Messaging Service (MG...). ---

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  from: string;
  fetch?: Fetch;
}

export function twilioSmsChannel(o: TwilioOptions): Channel {
  const f = o.fetch ?? fetch;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${o.accountSid}/Messages.json`;
  const auth = 'Basic ' + Buffer.from(`${o.accountSid}:${o.authToken}`).toString('base64');
  return {
    kind: 'sms',
    name: 'twilio-sms',
    async send(m) {
      const form = new URLSearchParams({ To: m.to, Body: m.message });
      form.set(o.from.startsWith('MG') ? 'MessagingServiceSid' : 'From', o.from);
      const body = await post(f, url, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' }, body: form }, 'twilio');
      if (!body?.sid) throw new SendError('twilio: no message sid in the response', false);
      return { ref: body.sid };
    },
  };
}

/** Prints instead of sending: for trying the whole loop without a provider account. */
export function dryRunChannel(kind: ChannelKind, log: (s: string) => void): Channel {
  return {
    kind,
    name: `dry-run-${kind}`,
    async send(m) {
      log(`[${kind} dry-run] to ${m.to}: ${m.message.replace(/\n/g, ' | ')}`);
      return { ref: `dry-run-${m.id}` };
    },
  };
}

// --- The loop ---

export const MAX_ATTEMPTS = 3;

export interface SenderIO {
  /** Leases due reminders (GET /reminders/due). */
  due(limit: number): Promise<Outgoing[]>;
  /** POST /reminders/:id/result */
  report(id: string, r: { status: 'sent' | 'failed'; provider_ref?: string; error?: string }): Promise<void>;
}

export interface TickResult {
  sent: number;
  failed: number;
  retry: number;
}

/** The client asked for WhatsApp but only SMS is set up (or the other way): use what there is. */
export function pickChannel(channels: Partial<Record<ChannelKind, Channel>>, wanted: ChannelKind) {
  return channels[wanted] ?? channels[wanted === 'whatsapp' ? 'sms' : 'whatsapp'] ?? null;
}

export async function sendDue(io: SenderIO, channels: Partial<Record<ChannelKind, Channel>>, opts: { limit?: number; log?: (o: object, msg: string) => void } = {}): Promise<TickResult> {
  const log = opts.log ?? (() => {});
  const out: TickResult = { sent: 0, failed: 0, retry: 0 };
  const due = await io.due(opts.limit ?? 50);
  for (const m of due) {
    const ch = pickChannel(channels, m.channel);
    if (!ch) {
      await io.report(m.id, { status: 'failed', error: 'no_channel_configured' });
      out.failed++;
      continue;
    }
    try {
      const { ref } = await ch.send(m);
      await io.report(m.id, { status: 'sent', provider_ref: `${ch.name}:${ref}`.slice(0, 200) });
      out.sent++;
    } catch (e) {
      const err = e instanceof SendError ? e : new SendError(String((e as Error)?.message ?? e), false);
      if (err.permanent || m.attempt >= MAX_ATTEMPTS) {
        await io.report(m.id, { status: 'failed', error: `${ch.name}: ${err.message}`.slice(0, 500) });
        out.failed++;
      } else {
        out.retry++; // the lease expires and the next round tries again
      }
      log({ reminder: m.id, attempt: m.attempt, permanent: err.permanent, error: err.message }, 'reminder not sent');
    }
  }
  return out;
}

// --- STOP replies ---

/**
 * "STOP", "dur", "baja"… as the whole message or its first word. CANCEL is there because Twilio itself
 * blocks the number on it. "iptal" is not: a client writing "iptal" means the appointment, not the messages.
 */
export function isStop(text: string) {
  const t = text
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .trim();
  return /^(stop|stopall|unsubscribe|cancel|end|quit|dur|durdur|mesaj istemiyorum|baja|alto|parar)\b/.test(t);
}
