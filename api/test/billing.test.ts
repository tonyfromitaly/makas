import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@makas/core';
import { openDatabase } from '../src/db';
import { loadConfig } from '../src/config';
import { argon2Deps, buildServer } from '../src/server';
import type { BillingEvent, PaymentProvider } from '../src/billing';
import type { Mail } from '../src/email';

// Website subscription, end to end, with a fake Stripe and a captured mailbox.
describe('billing: website subscription → shop → e-mail → access key', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let db: Awaited<ReturnType<typeof openDatabase>>;
  const mails: Mail[] = [];
  const sessions: { id: string; email: string; signupId: string }[] = [];
  let nextEvent: BillingEvent = { type: 'ignored' };
  const subs: Record<string, { status: any; periodEnd: Date | null }> = {};

  const fakeStripe: PaymentProvider = {
    async plan() {
      return { amount_cents: 2900, currency: 'USD', interval: 'month' };
    },
    async createCheckout(p) {
      const id = `cs_test_${sessions.length + 1}`;
      sessions.push({ id, email: p.email, signupId: p.signupId });
      return { id, url: `https://checkout.stripe.test/${id}` };
    },
    parseWebhook(_raw, sig) {
      if (sig !== 'valid') throw new Error('bad signature');
      return nextEvent;
    },
    async subscription(id) {
      return subs[id] ?? { status: 'active', periodEnd: new Date('2026-11-16T00:00:00Z') };
    },
    async portal(customerId) {
      return `https://billing.stripe.test/${customerId}`;
    },
  };

  const call = async (method: string, url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const r = await app.inject({
      method: method as any,
      url,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
      payload: opts.body as any,
    });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
  };
  const webhook = (event: BillingEvent, sig = 'valid') => {
    nextEvent = event;
    return call('POST', '/api/billing/webhook', { body: { any: 'payload' }, headers: { 'stripe-signature': sig } });
  };

  beforeAll(async () => {
    db = await openDatabase('pglite:memory');
    await migrate(db);
    app = await buildServer({
      db,
      config: loadConfig({ jwtSecret: 'test-jwt-secret-that-is-long-enough-123', allowSignup: false, billingEnabled: true, publicUrl: 'https://fade.test' }),
      deps: argon2Deps,
      authRateLimit: 1000,
      prefix: '/api',
      payments: fakeStripe,
      mailer: { send: async (m) => void mails.push(m) },
      publicUrl: 'https://fade.test',
    });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('the app learns that shops are opened on the website, and self-signup is closed', async () => {
    expect((await call('GET', '/api/meta')).body).toMatchObject({ signup: 'subscribe', billing: true });
    const r = await call('POST', '/api/auth/register', {
      body: { shop_name: 'X', owner_name: 'X', email: 'x@example.com', password: 'long-enough-1', country: 'US', timezone: 'UTC' },
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SIGNUP_CLOSED');
  });

  it('shows the plan price from the payment provider', async () => {
    expect((await call('GET', '/api/billing/plan')).body).toMatchObject({ enabled: true, amount_cents: 2900, currency: 'USD', interval: 'month' });
  });

  let key = '';
  it('checkout → paid webhook opens the shop and e-mails a one-time access key', async () => {
    const r = await call('POST', '/api/billing/checkout', {
      body: { shop_name: 'Berber Kemal', owner_name: 'Kemal Usta', email: 'Kemal@Example.com', country: 'TR', timezone: 'Europe/Istanbul', language: 'tr' },
    });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe('https://checkout.stripe.test/cs_test_1');
    expect(sessions[0].email).toBe('kemal@example.com');

    expect((await webhook({ type: 'checkout.completed', sessionId: 'cs_test_1', customerId: 'cus_1', subscriptionId: 'sub_1' }, 'forged')).status).toBe(400);
    expect(mails).toHaveLength(0);

    expect((await webhook({ type: 'checkout.completed', sessionId: 'cs_test_1', customerId: 'cus_1', subscriptionId: 'sub_1' })).status).toBe(200);
    expect(mails).toHaveLength(1);
    const mail = mails[0];
    expect(mail.to).toBe('kemal@example.com');
    expect(mail.subject).toContain('Berber Kemal');
    key = mail.text.match(/MONA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)![0];
    expect(mail.text).toContain(`https://fade.test/app/#key=${key}`);

    // Stripe retries the same webhook: nothing is created twice.
    await webhook({ type: 'checkout.completed', sessionId: 'cs_test_1', customerId: 'cus_1', subscriptionId: 'sub_1' });
    expect(mails).toHaveLength(1);
    const shops = await db.query<{ n: number }>(`select count(*)::int as n from shops where name = 'Berber Kemal'`);
    expect(shops.rows[0].n).toBe(1);
  });

  it('the account cannot be used until the key sets a password; the key works once', async () => {
    expect((await call('POST', '/api/auth/login', { body: { email: 'kemal@example.com', password: 'anything-at-all' } })).status).toBe(401);
    const k = await call('POST', '/api/auth/key', { body: { key: key.toLowerCase().replace(/-/g, ' '), password: 'kemal-secret-1' } });
    expect(k.status).toBe(200);
    expect(k.body.access_token).toBeTruthy();
    const me = await call('GET', '/api/shops/me', { token: k.body.access_token });
    expect(me.body.shop.name).toBe('Berber Kemal');
    expect(me.body.subscription).toMatchObject({ status: 'active', plan_key: 'pro' });
    expect(me.body.locked).toBe(false);
    expect((await call('POST', '/api/auth/key', { body: { key, password: 'another-pass-1' } })).body.error.code).toBe('INVALID_KEY');
    expect((await call('POST', '/api/auth/login', { body: { email: 'kemal@example.com', password: 'kemal-secret-1' } })).status).toBe(200);
  });

  it('the same e-mail cannot buy a second shop', async () => {
    const r = await call('POST', '/api/billing/checkout', {
      body: { shop_name: 'Again', owner_name: 'K', email: 'kemal@example.com', country: 'TR', timezone: 'Europe/Istanbul', language: 'tr' },
    });
    expect(r.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('a failed or cancelled payment locks the shop; paying again unlocks it; the owner reaches the portal', async () => {
    const login = await call('POST', '/api/auth/login', { body: { email: 'kemal@example.com', password: 'kemal-secret-1' } });
    const token = login.body.access_token;
    await webhook({ type: 'subscription.changed', subscriptionId: 'sub_1', status: 'past_due', periodEnd: null });
    expect((await call('GET', '/api/shops/me', { token })).body.locked).toBe(true);
    expect((await call('GET', '/api/appointments', { token })).status).toBe(402);
    expect((await call('POST', '/api/billing/portal', { token })).body.url).toBe('https://billing.stripe.test/cus_1');
    await webhook({ type: 'subscription.changed', subscriptionId: 'sub_1', status: 'active', periodEnd: new Date('2026-12-16T00:00:00Z') });
    expect((await call('GET', '/api/shops/me', { token })).body.locked).toBe(false);
    await webhook({ type: 'subscription.changed', subscriptionId: 'sub_1', status: 'cancelled', periodEnd: null });
    const sub = (await db.query(`select status, cancelled_at from subscriptions where stripe_subscription_id = 'sub_1'`)).rows[0];
    expect(sub.status).toBe('cancelled');
    expect(sub.cancelled_at).toBeTruthy();
  });

  it('the operator can issue a fresh key for a lost e-mail', async () => {
    const shop = (await db.query(`select id from shops where name = 'Berber Kemal'`)).rows[0];
    const r = await call('POST', `/api/admin/shops/${shop.id}/access-key`, { token: 'test-admin-key' });
    expect(r.body.key).toMatch(/^MONA-/);
  });
});
