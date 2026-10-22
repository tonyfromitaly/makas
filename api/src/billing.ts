import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { IANAZone } from 'luxon';
import {
  createAccessKey,
  errorBody,
  logOperator,
  safeEqual,
  verifyOps,
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
  business_type: z.enum(['barber', 'salon', 'beauty', 'other']).default('barber'),
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
    // Without a payment provider the website takes applications that the operator approves.
    if (!o.provider) return { enabled: false, applications: true };
    try {
      return { enabled: true, ...(await o.provider.plan()) };
    } catch (e) {
      app.log.error(e);
      return { enabled: true };
    }
  });

  app.post(`${o.prefix}/billing/checkout`, { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = checkoutBody.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
    const b = parsed.data;
    const signup = await withSystem(o.db, async (tx) => {
      const taken = await tx.query('select 1 from users where lower(email) = $1', [b.email]);
      if (taken.rows.length) return null;
      // An application sent twice stays one application.
      if (!o.provider) {
        const pending = (await tx.query(`select id from signups where lower(email) = $1 and status = 'pending'`, [b.email])).rows[0];
        if (pending) return pending;
      }
      return (
        await tx.query(
          `insert into signups (email, shop_name, owner_name, country, timezone, language, business_type) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [b.email, b.shop_name, b.owner_name, b.country, b.timezone, b.language, b.business_type],
        )
      ).rows[0];
    });
    if (!signup) return fail(reply, 409, 'EMAIL_TAKEN', 'An account with this email already exists');
    if (!o.provider) return { applied: true };
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

  /**
   * Turns a pending sign-up into a shop, issues the access key and e-mails it. Used by the Stripe webhook
   * and by the operator's "approve". Idempotent: a sign-up that is no longer pending is left alone.
   */
  async function openShop(
    find: { sql: string; param: string },
    sub: { status: SubStatus; periodEnd: Date | null; customerId?: string | null; subscriptionId?: string | null; planKey: string },
    trialDays?: number,
  ) {
    const now = o.config.now();
    const created = await withSystem(o.db, async (tx) => {
      const s = (await tx.query(`select * from signups where ${find.sql} and status = 'pending' for update`, [find.param])).rows[0];
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
        businessType: s.business_type,
        defaultServices: true,
        subscription: { status: sub.status, planKey: sub.planKey, periodEnd: sub.periodEnd, stripeCustomerId: sub.customerId, stripeSubscriptionId: sub.subscriptionId },
        now,
      });
      const key = await createAccessKey(tx, shopId, user.id, now);
      await tx.query(`update signups set status = 'completed', shop_id = $2 where id = $1`, [s.id, shopId]);
      return { signup: s, key, shopId };
    });
    if (!created) return null;
    // After commit: if the e-mail fails the shop still exists and the operator can issue a new key.
    let emailed = true;
    try {
      await o.mailer.send(
        welcomeEmail({ to: created.signup.email, name: created.signup.owner_name, shop: created.signup.shop_name, key: created.key, appUrl, lang: created.signup.language, trialDays }),
      );
    } catch (e) {
      emailed = false;
      app.log.error(e, 'welcome e-mail failed');
    }
    return { shopId: created.shopId, emailed };
  }

  async function handleEvent(event: BillingEvent) {
    const now = o.config.now();
    if (event.type === 'checkout.completed') {
      const sub = event.subscriptionId ? await o.provider!.subscription(event.subscriptionId) : { status: 'active' as SubStatus, periodEnd: null };
      // Idempotent: Stripe retries webhooks; a completed sign-up is never provisioned twice.
      await openShop(
        { sql: 'stripe_session_id = $1', param: event.sessionId },
        { ...sub, customerId: event.customerId, subscriptionId: event.subscriptionId, planKey: 'pro' },
      );
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

  // --- operator: applications from the website (while payments are off) and invitations ---
  // The same rule as every other admin route (core/src/api.ts): the panel's 30-minute session, or the raw
  // key only while no authenticator secret is configured. Every attempt goes to operator_log.
  const admin = async (req: any, reply: any) => {
    const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    const session = token.split('.').length === 3 && (await verifyOps(o.config, token));
    const raw = !session && (await safeEqual(token, o.config.adminApiKey));
    const allowed = session || (raw && !o.config.adminTotpSecret);
    const path = String(req.routeOptions?.url ?? req.url).replace(o.prefix, '');
    await withSystem(o.db, (tx) =>
      logOperator(tx, { action: `${req.method} ${path}`, target: (req.params as any)?.id ?? null, ip: req.ip, ok: !!allowed, at: o.config.now() }),
    ).catch(() => {});
    if (!allowed) {
      fail(reply, 401, 'UNAUTHORIZED', raw ? 'Sign in with the admin key and your authenticator code' : 'Invalid admin credentials');
      return false;
    }
    return true;
  };

  app.get(`${o.prefix}/admin/signups`, async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const status = (req.query as any)?.status ?? 'pending';
    const { rows } = await withSystem(o.db, (tx) =>
      tx.query(
        `select id, email, shop_name, owner_name, country, timezone, language, business_type, status, stripe_session_id is not null as paid_checkout, created_at
           from signups where ($1 = 'all' or status = $1) order by created_at desc limit 200`,
        [status],
      ),
    );
    return { data: rows };
  });

  app.post(`${o.prefix}/admin/signups/:id/approve`, async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const body = z
      .object({ status: z.enum(['trial', 'active']).default('trial'), days: z.number().int().min(1).max(366).default(o.config.trialDays) })
      .safeParse(req.body ?? {});
    if (!body.success) return fail(reply, 400, 'VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid input');
    const id = (req.params as any).id;
    if (!z.string().uuid().safeParse(id).success) return fail(reply, 404, 'NOT_FOUND', 'Application not found');
    const end = new Date(o.config.now().getTime() + body.data.days * 86400_000);
    const r = await openShop(
      { sql: 'id = $1', param: id },
      { status: body.data.status, periodEnd: end, planKey: body.data.status === 'trial' ? 'trial' : 'pro' },
      body.data.status === 'trial' ? body.data.days : undefined,
    );
    if (!r) return fail(reply, 409, 'NOT_PENDING', 'This application is no longer pending');
    return { shop_id: r.shopId, emailed: r.emailed };
  });

  // Field sales: the operator opens a shop for someone they met and e-mails the invitation in one step.
  app.post(`${o.prefix}/admin/invites`, async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const body = checkoutBody
      .extend({ status: z.enum(['trial', 'active']).default('trial'), days: z.number().int().min(1).max(366).default(o.config.trialDays) })
      .safeParse(req.body ?? {});
    if (!body.success) return fail(reply, 400, 'VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Invalid input');
    const b = body.data;
    const signup = await withSystem(o.db, async (tx) => {
      if ((await tx.query('select 1 from users where lower(email) = $1', [b.email])).rows[0]) return null;
      return (
        await tx.query(
          `insert into signups (email, shop_name, owner_name, country, timezone, language, business_type) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [b.email, b.shop_name, b.owner_name, b.country, b.timezone, b.language, b.business_type],
        )
      ).rows[0];
    });
    if (!signup) return fail(reply, 409, 'EMAIL_TAKEN', 'An account with this email already exists');
    const end = new Date(o.config.now().getTime() + b.days * 86400_000);
    const r = await openShop(
      { sql: 'id = $1', param: signup.id },
      { status: b.status, periodEnd: end, planKey: b.status === 'trial' ? 'trial' : 'pro' },
      b.status === 'trial' ? b.days : undefined,
    );
    return { shop_id: r?.shopId, emailed: !!r?.emailed };
  });

  app.post(`${o.prefix}/admin/signups/:id/reject`, async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const id = (req.params as any).id;
    if (!z.string().uuid().safeParse(id).success) return fail(reply, 404, 'NOT_FOUND', 'Application not found');
    const { rows } = await withSystem(o.db, (tx) => tx.query(`update signups set status = 'expired' where id = $1 and status = 'pending' returning id`, [id]));
    if (!rows.length) return fail(reply, 409, 'NOT_PENDING', 'This application is no longer pending');
    return { rejected: true };
  });

  // A fresh access key for an existing shop, e-mailed to its owner (lost e-mail, new phone).
  app.post(`${o.prefix}/admin/shops/:id/invite`, async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const id = (req.params as any).id;
    if (!z.string().uuid().safeParse(id).success) return fail(reply, 404, 'NOT_FOUND', 'Shop not found');
    const now = o.config.now();
    const r = await withSystem(o.db, async (tx) => {
      const s = (
        await tx.query(`select s.id, s.name, s.language, u.id as user_id, u.email, u.name as owner from shops s join users u on u.id = s.owner_user_id where s.id = $1`, [id])
      ).rows[0];
      if (!s) return null;
      return { s, key: await createAccessKey(tx, s.id, s.user_id, now) };
    });
    if (!r) return fail(reply, 404, 'NOT_FOUND', 'Shop not found');
    try {
      await o.mailer.send(welcomeEmail({ to: r.s.email, name: r.s.owner, shop: r.s.name, key: r.key, appUrl, lang: r.s.language }));
      return { emailed: true };
    } catch (e) {
      app.log.error(e, 'invite e-mail failed');
      return { emailed: false, key: r.key };
    }
  });

  return { handleEvent };
}
