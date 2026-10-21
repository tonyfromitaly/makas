import type { Check } from '@makas/core';
import type { Mailer } from './email';

// Where the operator hears about problems: an e-mail address (ALERT_EMAIL, sent through the app's mailer)
// and/or a chat webhook (ALERT_WEBHOOK_URL; Slack and Discord both accept this body). Neither set: the
// alert is only logged. Sending never throws; a broken alert channel must not take the server down.

export interface Alerter {
  on: boolean;
  send(subject: string, lines: string[]): Promise<void>;
}

export function alerter(o: { mailer: Mailer; to: string; webhookUrl: string; service: string; log: (obj: object, msg: string) => void }): Alerter {
  return {
    on: !!(o.to || o.webhookUrl),
    async send(subject, lines) {
      const title = `[${o.service}] ${subject}`;
      const text = [title, ...lines].join('\n');
      o.log({ alert: subject, lines }, 'alert');
      const jobs: Promise<unknown>[] = [];
      if (o.to) jobs.push(o.mailer.send({ to: o.to, subject: title, text, html: `<pre>${esc(text)}</pre>` }));
      if (o.webhookUrl)
        jobs.push(
          fetch(o.webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, content: text.slice(0, 1900) }),
            signal: AbortSignal.timeout(10_000),
          }).then((r) => {
            if (!r.ok) throw new Error(`webhook ${r.status}`);
          }),
        );
      for (const r of await Promise.allSettled(jobs)) if (r.status === 'rejected') o.log({ error: String(r.reason) }, 'alert not delivered');
    },
  };
}

/** One message for one round of checks: what broke (or is still broken) and what recovered. */
export function alertText(plan: { problems: Check[]; recovered: string[] }) {
  const subject = plan.problems.length
    ? `${plan.problems.length} problem${plan.problems.length > 1 ? 's' : ''}: ${plan.problems.map((c) => c.name).join(', ')}`
    : `recovered: ${plan.recovered.join(', ')}`;
  const lines = [
    ...plan.problems.map((c) => `✗ ${c.name}${c.detail ? `: ${c.detail}` : ''}`),
    ...plan.recovered.map((n) => `✓ ${n} is fine again`),
  ];
  return { subject, lines };
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
