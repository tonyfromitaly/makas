import { z } from 'zod';
import { DateTime } from 'luxon';
import { badRequest, conflict, notFound, pageQuery, paged, phone, uuid, type Route } from '../http';
import { renderTemplate, type Lang, type TemplateKey } from '../reminders';
import { isLocked } from './shop';
import { createAccessKey } from '../provision';

const LEASE_MINUTES = 5;

/** Endpoints for Tony's message infrastructure. Service key only; user tokens are rejected. */
export const workerRoutes: Route[] = [
  {
    method: 'GET',
    path: '/reminders/due',
    auth: 'service',
    query: z.object({
      until: z.string().datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }),
    async handler(ctx, { query }) {
      const until = query.until ? new Date(query.until) : ctx.now;
      // Lease the rows so a second poll can't pick them up while they are being sent.
      const leased = (
        await ctx.db.query(
          `with picked as (
             select r.id from reminder_queue r
              where r.status = 'queued' and r.scheduled_at <= $1
                and (r.locked_until is null or r.locked_until < $2)
              order by r.scheduled_at limit $3
              for update skip locked)
           update reminder_queue r
              set locked_until = $2::timestamptz + make_interval(mins => $4), attempts = r.attempts + 1
             from picked where r.id = picked.id
           returning r.id`,
          [until, ctx.now, query.limit, LEASE_MINUTES],
        )
      ).rows.map((r: any) => r.id);
      if (!leased.length) return { data: [] };

      const { rows } = await ctx.db.query(
        `select r.id, r.shop_id, r.appointment_id, r.client_id, r.channel, r.template_key, r.scheduled_at, r.attempts,
                c.name as client_name, c.phone_e164, c.language, c.consent_status,
                a.starts_at, a.status as appointment_status, s.name as service_name,
                sh.name as shop_name, sh.timezone, sub.status as sub_status, sub.current_period_end
           from reminder_queue r
           join clients c on c.id = r.client_id
           join appointments a on a.id = r.appointment_id
           join services s on s.id = a.service_id
           join shops sh on sh.id = r.shop_id
           left join subscriptions sub on sub.shop_id = r.shop_id
          where r.id = any($1::uuid[])
          order by r.scheduled_at`,
        [leased],
      );
      const out = [];
      for (const r of rows) {
        // Last line of defence: re-check consent, booking state and the shop's subscription at send time.
        const reason =
          r.consent_status !== 'granted' ? 'consent_revoked'
          : r.appointment_status !== 'booked' ? `appointment_${r.appointment_status}`
          : isLocked({ status: r.sub_status, current_period_end: r.current_period_end }, ctx.now) ? 'subscription_inactive'
          : null;
        if (reason) {
          await ctx.db.query(`update reminder_queue set status = 'skipped', error = $2, locked_until = null where id = $1`, [
            r.id,
            reason,
          ]);
          continue;
        }
        const local = DateTime.fromJSDate(new Date(r.starts_at), { zone: r.timezone });
        const vars = {
          name: r.client_name.split(' ')[0],
          shop: r.shop_name,
          service: r.service_name,
          time: local.toFormat('HH:mm'),
          date: local.toISODate()!,
        };
        await ctx.db.query(
          `insert into audit_log (shop_id, user_id, action, entity, entity_id, at) values ($1, null, 'client.phone_read_worker', 'client', $2, $3)`,
          [r.shop_id, r.client_id, ctx.now],
        );
        out.push({
          id: r.id,
          shop_id: r.shop_id,
          appointment_id: r.appointment_id,
          channel: r.channel,
          to: r.phone_e164,
          language: r.language,
          template_key: r.template_key,
          vars,
          message: renderTemplate(r.language as Lang, r.template_key as TemplateKey, vars),
          scheduled_at: r.scheduled_at,
          attempt: r.attempts,
          lease_expires_at: new Date(ctx.now.getTime() + LEASE_MINUTES * 60_000),
        });
      }
      return { data: out };
    },
  },
  {
    method: 'POST',
    path: '/reminders/:id/result',
    auth: 'service',
    body: z.object({
      status: z.enum(['sent', 'failed', 'skipped']),
      provider_ref: z.string().max(200).optional(),
      error: z.string().max(500).optional(),
    }),
    async handler(ctx, { params, body }) {
      const row = (
        await ctx.db.query(
          `update reminder_queue
              set status = $2, provider_ref = $3, error = $4, locked_until = null,
                  sent_at = case when $2 = 'sent' then $5::timestamptz else sent_at end
            where id = $1 and status = 'queued'
        returning id, status, provider_ref, sent_at, error`,
          [params.id, body.status, body.provider_ref ?? null, body.error ?? null, ctx.now],
        )
      ).rows[0];
      if (row) return row;
      const exists = (await ctx.db.query('select status from reminder_queue where id = $1', [params.id])).rows[0];
      if (!exists) throw notFound('Reminder');
      throw conflict(`Reminder is already ${exists.status}`, 'ALREADY_FINAL');
    },
  },
  {
    // A STOP reply. With a reminder id only that shop's client is opted out; with a bare phone, every shop's.
    method: 'POST',
    path: '/reminders/optout',
    auth: 'service',
    body: z.object({ reminder_id: uuid.optional(), phone_e164: phone.optional() }),
    async handler(ctx, { body }) {
      if (!body.reminder_id && !body.phone_e164) throw badRequest('reminder_id or phone_e164 is required');
      const clients = body.reminder_id
        ? (await ctx.db.query('select client_id as id, shop_id from reminder_queue where id = $1', [body.reminder_id])).rows
        : (await ctx.db.query('select id, shop_id from clients where phone_e164 = $1', [body.phone_e164])).rows;
      if (!clients.length) throw notFound('Client');
      for (const c of clients) {
        await ctx.db.query(`update clients set consent_status = 'revoked' where id = $1`, [c.id]);
        await ctx.db.query(
          `update reminder_queue set status = 'skipped', error = 'consent_revoked', locked_until = null
            where client_id = $1 and status = 'queued'`,
          [c.id],
        );
        await ctx.db.query(
          `insert into audit_log (shop_id, user_id, action, entity, entity_id, at) values ($1, null, 'client.consent_revoked_stop', 'client', $2, $3)`,
          [c.shop_id, c.id, ctx.now],
        );
      }
      return { revoked: clients.length };
    },
  },
];

/** Operator endpoints (us): subscriptions, feedback, retention. Admin key only. */
export const adminRoutes: Route[] = [
  {
    method: 'GET',
    path: '/admin/shops',
    auth: 'admin',
    query: pageQuery,
    async handler(ctx, { query }) {
      const { rows } = await ctx.db.query(
        `select s.id, s.name, s.country, s.language, s.created_at, u.email as owner_email,
                sub.plan_key, sub.status as subscription_status, sub.current_period_end,
                (select count(*) from clients c where c.shop_id = s.id)::int as clients,
                (select count(*) from appointments a where a.shop_id = s.id)::int as appointments,
                count(*) over() as total_count
           from shops s left join users u on u.id = s.owner_user_id
           left join subscriptions sub on sub.shop_id = s.id
          order by s.created_at desc limit $1 offset $2`,
        [query.page_size, (query.page - 1) * query.page_size],
      );
      return paged(rows, query.page, query.page_size);
    },
  },
  {
    method: 'GET',
    path: '/admin/feedback',
    auth: 'admin',
    query: pageQuery,
    async handler(ctx, { query }) {
      const { rows } = await ctx.db.query(
        `select f.id, f.message, f.created_at, s.name as shop_name, s.id as shop_id, u.name as user_name,
                count(*) over() as total_count
           from feedback f join shops s on s.id = f.shop_id left join users u on u.id = f.user_id
          where f.author = 'shop'
          order by f.created_at desc limit $1 offset $2`,
        [query.page_size, (query.page - 1) * query.page_size],
      );
      return paged(rows, query.page, query.page_size);
    },
  },
  {
    // A fresh one-time access key for a shop owner (manual onboarding, lost e-mail).
    method: 'POST',
    path: '/admin/shops/:id/access-key',
    auth: 'admin',
    async handler(ctx, { params }) {
      const owner = (await ctx.db.query('select owner_user_id as id from shops where id = $1', [params.id])).rows[0];
      if (!owner?.id) throw notFound('Shop');
      return { key: await createAccessKey(ctx.db, params.id, owner.id, ctx.now) };
    },
  },
  {
    // Support inbox: one row per shop thread, newest activity first, with messages we haven't answered.
    method: 'GET',
    path: '/admin/support',
    auth: 'admin',
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select s.id as shop_id, s.name as shop_name, u.email as owner_email,
                last.message as last_message, last.author as last_author, last.created_at as last_at,
                (select count(*) from feedback f2 where f2.shop_id = s.id and f2.author = 'shop'
                   and f2.created_at > coalesce((select max(created_at) from feedback f3 where f3.shop_id = s.id and f3.author = 'operator'), '-infinity'))::int as waiting
           from shops s
           left join users u on u.id = s.owner_user_id
           join lateral (select message, author, created_at from feedback f where f.shop_id = s.id order by created_at desc, id desc limit 1) last on true
          order by waiting desc, last.created_at desc`,
      );
      return { data: rows };
    },
  },
  {
    method: 'GET',
    path: '/admin/support/:id',
    auth: 'admin',
    async handler(ctx, { params }) {
      const shop = (await ctx.db.query('select id, name from shops where id = $1', [params.id])).rows[0];
      if (!shop) throw notFound('Shop');
      const { rows } = await ctx.db.query(
        `select f.id, f.author, f.message, f.created_at, f.read_at, u.name as user_name
           from feedback f left join users u on u.id = f.user_id where f.shop_id = $1 order by f.created_at, f.id`,
        [params.id],
      );
      return { shop, data: rows };
    },
  },
  {
    method: 'POST',
    path: '/admin/support/:id',
    auth: 'admin',
    body: z.object({ message: z.string().trim().min(1).max(2000) }),
    async handler(ctx, { params, body }) {
      const shop = (await ctx.db.query('select id from shops where id = $1', [params.id])).rows[0];
      if (!shop) throw notFound('Shop');
      const row = (
        await ctx.db.query(
          `insert into feedback (shop_id, user_id, message, author, created_at) values ($1, null, $2, 'operator', $3)
           returning id, author, message, created_at`,
          [params.id, body.message, ctx.now],
        )
      ).rows[0];
      return { ...row };
    },
  },
  {
    method: 'PATCH',
    path: '/admin/shops/:id/subscription',
    auth: 'admin',
    body: z
      .object({
        status: z.enum(['trial', 'active', 'past_due', 'cancelled']),
        plan_key: z.string().max(40),
        current_period_end: z.string().datetime({ offset: true }).nullable(),
      })
      .partial(),
    async handler(ctx, { params, body }) {
      const row = (
        await ctx.db.query(
          `update subscriptions set
              status = coalesce($2, status),
              plan_key = coalesce($3, plan_key),
              current_period_end = case when $5 then $4::timestamptz else current_period_end end,
              cancelled_at = case when $2 = 'cancelled' then coalesce(cancelled_at, $6) when $2 is not null then null else cancelled_at end
            where shop_id = $1 returning *`,
          [params.id, body.status ?? null, body.plan_key ?? null, body.current_period_end ?? null, 'current_period_end' in body, ctx.now],
        )
      ).rows[0];
      if (!row) throw notFound('Shop');
      return row;
    },
  },
  {
    // Retention: data of a cancelled shop is kept 90 days, then removed. Run daily (see docs/operations.md).
    method: 'POST',
    path: '/admin/retention/run',
    auth: 'admin',
    body: z.object({ days: z.number().int().min(1).max(3650).default(90) }).default({}),
    async handler(ctx, { body }) {
      const { rows } = await ctx.db.query(
        `delete from shops s using subscriptions sub
          where sub.shop_id = s.id and sub.status = 'cancelled'
            and sub.cancelled_at < $1::timestamptz - make_interval(days => $2)
        returning s.id`,
        [ctx.now, body.days],
      );
      return { deleted_shops: rows.length };
    },
  },
];
