import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { IANAZone } from 'luxon';
import {
  createAccessKey,
  errorBody,
  provisionShop,
  verifyAccess,
  withSystem,
  withTenant,
  type Config,
  type Database,
} from '@makas/core';
import { welcomeEmail, type Mailer } from './email';

export type SubStatus = 'trial' | 'active' | 'past_due' | 'cancelled';

export type BillingEvent =
  | { type: 'checkout.completed'; sessionId: string; customerId: string | null; subscriptionId: string | null }
  | { type: 'subscription.changed'; subscriptionId: string; status: SubStatus; periodEnd: Date | null }
  | { type: 'ignored' };

/** What the app needs from a payment provider. Stripe in production, a fake in tests. */
export interface PaymentProvider {
  plan(): Promise<{ amount_cents: number; currency: string; interval: string } | null>;
  createCheckout(p: { email: string; signupId: string; successUrl: string; cancelUrl: string; locale: string }): Promise<{ id: string; url: string }>;
  parseWebhook(raw: Buffer, signature: string): BillingEvent;
  subscription(id: string): Promise<{ status: SubStatus; periodEnd: Date | null }>;
  portal(customerId: string, returnUrl: string): Promise<string>;
}

export function mapStripeStatus(s: string): SubStatus {
  if (s === 'active') return 'active';
  if (s === 'trialing') return 'trial';
  if (s === 'canceled' || s === 'incomplete_expired') return 'cancelled';
  return 'past_due'; // past_due, unpaid, incomplete, paused
}

/** Stripe Checkout (subscription mode), webhooks and the customer portal. */
export function stripeProvider(opts: { secretKey: string; priceId: string; webhookSecret: string }): PaymentProvider {
  const stripe = new Stripe(opts.secretKey);
  // Current API versions keep the billing period on the subscription items.
  const periodEnd = (sub: Stripe.Subscription) => {
    const end = sub.items?.data?.[0]?.current_period_end;
    return end ? new Date(end * 1000) : null;
  };
  return {
    async plan() {
      const price = await stripe.prices.retrieve(opts.priceId);
      return { amount_cents: price.unit_amount ?? 0, currency: price.currency.toUpperCase(), interval: price.recurring?.interval ?? 'month' };
    },
    async createCheckout(p) {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: opts.priceId, quantity: 1 }],
        customer_email: p.email,
        client_reference_id: p.signupId,
        metadata: { signup_id: p.signupId },
        subscription_data: { metadata: { signup_id: p.signupId } },
        allow_promotion_codes: true,
        locale: p.locale as Stripe.Checkout.SessionCreateParams.Locale,
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
      });
      return { id: session.id, url: session.url! };
    },
    parseWebhook(raw, signature) {
      const event = stripe.webhooks.constructEvent(raw, signature, opts.webhookSecret);
      if (event.type === 'checkout.session.completed') {
        const s = event.data.object;
        const id = (v: unknown) => (typeof v === 'string' ? v : ((v as { id?: string } | null)?.id ?? null));
        return { type: 'checkout.completed', sessionId: s.id, customerId: id(s.customer), subscriptionId: id(s.subscription) };
      }
      if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;
        return {
          type: 'subscription.changed',
          subscriptionId: sub.id,
          status: event.type === 'customer.subscription.deleted' ? 'cancelled' : mapStripeStatus(sub.status),
          periodEnd: periodEnd(sub),
        };
      }
      return { type: 'ignored' };
    },
    async subscription(id) {
      const sub = await stripe.subscriptions.retrieve(id);
      return { status: mapStripeStatus(sub.status), periodEnd: periodEnd(sub) };
    },
    async portal(customerId, returnUrl) {
      const s = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return s.url;
    },
  };
}

const checkoutBody = z.object({
  shop_name: z.string().trim().min(1).max(120),
  owner_name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  country: z.string().trim().length(2).toUpperCase(),
  timezone: z.string().refine((tz) => IANAZone.isValidZone(tz), 'Unknown timezone'),
  language: z.enum(['tr', 'en', 'es']).default('en'),
});

/**
 * Website subscriptions: checkout → Stripe → webhook → shop + access key → welcome e-mail.
 * Registered under the API prefix; the webhook reads the raw body to verify Stripe's signature.
 */
export async function billingRoutes(
  app: FastifyInstance,
  o: { db: Database; config: Config; provider: PaymentProvider | null; mailer: Mailer; publicUrl: string; prefix: string },
) {
  const base = o.publicUrl.replace(/\/$/, '');
  const appUrl = `${base}/app/`;
  const fail = (reply: any, status: number, code: string, message: string) => reply.code(status).send(errorBody(code, message));

  app.get(`${o.prefix}/billing/plan`, async () => {
    if (!o.provider) return { enabled: false };
    try {
      return { enabled: true, ...(await o.provider.plan()) };
    } catch (e) {
      app.log.error(e);
      return { enabled: true };
    }
  });

  app.post(`${o.prefix}/billing/checkout`, { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!o.provider) return fail(reply, 503, 'BILLING_DISABLED', 'Subscriptions are not open yet');
    const parsed = checkoutBody.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
    const b = parsed.data;
    const signup = await withSystem(o.db, async (tx) => {
      const taken = await tx.query('select 1 from users where lower(email) = $1', [b.email]);
      if (taken.rows.length) return null;
      return (
        await tx.query(
          `insert into signups (email, shop_name, owner_name, country, timezone, language) values ($1, $2, $3, $4, $5, $6) returning id`,
          [b.email, b.shop_name, b.owner_name, b.country, b.timezone, b.language],
        )
      ).rows[0];
    });
    if (!signup) return fail(reply, 409, 'EMAIL_TAKEN', 'An account with this email already exists');
    const session = await o.provider.createCheckout({
      email: b.email,
      signupId: signup.id,
      successUrl: `${base}/success.html?lang=${b.language}`,
      cancelUrl: `${base}/?lang=${b.language}#abone-ol`,
      locale: b.language,
    });
    await withSystem(o.db, (tx) => tx.query('update signups set stripe_session_id = $2 where id = $1', [signup.id, session.id]));
    return { url: session.url };
  });

  // Raw body only for the webhook route, so the signature can be checked byte for byte.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.post(`${o.prefix}/billing/webhook`, async (req, reply) => {
      if (!o.provider) return fail(reply, 503, 'BILLING_DISABLED', 'Billing is not configured');
      let event: BillingEvent;
      try {
        event = o.provider.parseWebhook(req.body as Buffer, String(req.headers['stripe-signature'] ?? ''));
      } catch {
        return fail(reply, 400, 'BAD_SIGNATURE', 'Webhook signature verification failed');
      }
      await handleEvent(event);
      return { received: true };
    });
  });

  async function handleEvent(event: BillingEvent) {
    const now = o.config.now();
    if (event.type === 'checkout.completed') {
      const sub = event.subscriptionId ? await o.provider!.subscription(event.subscriptionId) : { status: 'active' as SubStatus, periodEnd: null };
      // Idempotent: Stripe retries webhooks; a completed sign-up is never provisioned twice.
      const created = await withSystem(o.db, async (tx) => {
        const s = (await tx.query(`select * from signups where stripe_session_id = $1 and status = 'pending' for update`, [event.sessionId])).rows[0];
        if (!s) return null;
        const taken = (await tx.query('select 1 from users where lower(email) = $1', [s.email])).rows[0];
        if (taken) {
          await tx.query(`update signups set status = 'expired' where id = $1`, [s.id]);
          return null;
        }
        const { shopId, user } = await provisionShop(tx, {
          shopName: s.shop_name,
          ownerName: s.owner_name,
          email: s.email,
          passwordHash: null,
          country: s.country,
          timezone: s.timezone,
          language: s.language,
          currency: s.currency,
          subscription: { status: sub.status, planKey: 'pro', periodEnd: sub.periodEnd, stripeCustomerId: event.customerId, stripeSubscriptionId: event.subscriptionId },
          now,
        });
        const key = await createAccessKey(tx, shopId, user.id, now);
        await tx.query(`update signups set status = 'completed', shop_id = $2 where id = $1`, [s.id, shopId]);
        return { signup: s, key };
      });
      if (created) {
        // After commit: if the e-mail fails the shop still exists and the operator can issue a new key.
        try {
          await o.mailer.send(
            welcomeEmail({ to: created.signup.email, name: created.signup.owner_name, shop: created.signup.shop_name, key: created.key, appUrl, lang: created.signup.language }),
          );
        } catch (e) {
          app.log.error(e, 'welcome e-mail failed');
        }
      }
    } else if (event.type === 'subscription.changed') {
      await withSystem(o.db, (tx) =>
        tx.query(
          `update subscriptions set status = $2, current_period_end = coalesce($3, current_period_end),
                  cancelled_at = case when $2 = 'cancelled' then coalesce(cancelled_at, $4) else null end
            where stripe_subscription_id = $1`,
          [event.subscriptionId, event.status, event.periodEnd, now],
        ),
      );
    }
  }

  // Owners manage card, invoices and cancellation in Stripe's portal; also reachable from the lock screen.
  app.post(`${o.prefix}/billing/portal`, async (req, reply) => {
    if (!o.provider) return fail(reply, 503, 'BILLING_DISABLED', 'Billing is not configured');
    const auth = String(req.headers.authorization ?? '');
    let claims;
    try {
      claims = await verifyAccess(o.config, auth.replace(/^Bearer /, ''));
    } catch {
      return fail(reply, 401, 'UNAUTHORIZED', 'Authentication required');
    }
    if (claims.role !== 'owner') return fail(reply, 403, 'FORBIDDEN', 'Only the shop owner can do this');
    const sub = await withTenant(o.db, claims.shop, async (tx) => (await tx.query('select stripe_customer_id from subscriptions where shop_id = $1', [claims.shop])).rows[0]);
    if (!sub?.stripe_customer_id) return fail(reply, 404, 'NO_BILLING', 'This shop is not billed through Stripe');
    return { url: await o.provider.portal(sub.stripe_customer_id, appUrl) };
  });

  return { handleEvent };
}
