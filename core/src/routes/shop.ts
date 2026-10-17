import { z } from 'zod';
import { IANAZone } from 'luxon';
import { audit, badRequest, cents, lang, noContent, notFound, ok, pageQuery, paged, unauthorized, uuid, type Ctx, type Route } from '../http';
import type { Queryable } from '../db';

export function isLocked(sub: { status: string; current_period_end: Date | string | null } | undefined, now: Date) {
  if (!sub) return true;
  if (sub.status !== 'trial' && sub.status !== 'active') return true;
  return !!sub.current_period_end && new Date(sub.current_period_end) < now;
}

export async function loadSubscription(db: Queryable, shopId: string) {
  return (
    await db.query('select plan_key, status, current_period_end from subscriptions where shop_id = $1', [shopId])
  ).rows[0];
}

const SHOP_FIELDS = `id, name, country, timezone, language, currency, status, business_type,
  reminder_day_before_hour, reminder_hours_before, created_at`;

export const shopRoutes: Route[] = [
  {
    method: 'GET',
    path: '/shops/me',
    auth: 'user',
    async handler(ctx) {
      const shop = (await ctx.db.query(`select ${SHOP_FIELDS} from shops where id = $1`, [ctx.shopId])).rows[0];
      const user = (
        await ctx.db.query('select id, name, email, role from users where id = $1 and shop_id = $2', [ctx.userId, ctx.shopId])
      ).rows[0];
      const subscription = await loadSubscription(ctx.db, ctx.shopId);
      return { shop, user, subscription, locked: isLocked(subscription, ctx.now) };
    },
  },
  {
    method: 'PATCH',
    path: '/shops/me',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: z
      .object({
        name: z.string().trim().min(1).max(120),
        country: z.string().trim().length(2).toUpperCase(),
        timezone: z.string().refine((tz) => IANAZone.isValidZone(tz), 'Unknown timezone'),
        language: lang,
        currency: z.string().trim().length(3).toUpperCase(),
        reminder_day_before_hour: z.number().int().min(0).max(23),
        reminder_hours_before: z.number().int().min(1).max(24),
      })
      .partial(),
    async handler(ctx, { body }) {
      const keys = Object.keys(body);
      if (!keys.length) throw badRequest('Nothing to update');
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const shop = (
        await ctx.db.query(`update shops set ${sets} where id = $1 returning ${SHOP_FIELDS}`, [
          ctx.shopId,
          ...keys.map((k) => (body as any)[k]),
        ])
      ).rows[0];
      await audit(ctx, 'shop.update', 'shop', ctx.shopId);
      return shop;
    },
  },
  {
    // Data portability: everything the shop owns, as one JSON document.
    method: 'GET',
    path: '/shops/me/export',
    auth: 'user',
    ownerOnly: true,
    async handler(ctx) {
      const q = async (sql: string) => (await ctx.db.query(sql, [ctx.shopId])).rows;
      const data = {
        exported_at: ctx.now.toISOString(),
        shop: (await q(`select ${SHOP_FIELDS} from shops where id = $1`))[0],
        users: await q('select id, name, email, role, created_at from users where shop_id = $1'),
        services: await q('select * from services where shop_id = $1'),
        barbers: await q('select * from barbers where shop_id = $1'),
        clients: await q('select * from clients where shop_id = $1'),
        appointments: await q('select * from appointments where shop_id = $1 order by starts_at'),
        ledger_entries: await q('select * from ledger_entries where shop_id = $1 order by created_at'),
        book_entries: await q('select * from book_entries where shop_id = $1 order by entry_date'),
        reminders: await q('select * from reminder_queue where shop_id = $1 order by scheduled_at'),
        assistant_notes: await q('select kind, subject, text, source, pinned, last_seen_at, expires_at, created_at from assistant_notes where shop_id = $1 order by kind, created_at'),
        assistant_conversations: await q('select user_id, role, text, drafts, created_at from assistant_turns where shop_id = $1 order by created_at'),
        audit_log: await q('select * from audit_log where shop_id = $1 order by at'),
      };
      await audit(ctx, 'shop.export', 'shop', ctx.shopId);
      return data;
    },
  },
  {
    // Right to erasure: removes the shop and every row that hangs off it.
    method: 'DELETE',
    path: '/shops/me',
    auth: 'user',
    ownerOnly: true,
    system: true,
    body: z.object({ password: z.string().min(1).max(128) }),
    async handler(ctx, { body }) {
      const user = (
        await ctx.db.query('select password_hash from users where id = $1 and shop_id = $2', [ctx.userId, ctx.shopId])
      ).rows[0];
      if (!user || !(await ctx.deps.verifyPassword(user.password_hash, body.password)))
        throw unauthorized('Password is incorrect');
      await ctx.db.query('delete from shops where id = $1', [ctx.shopId]);
      return noContent();
    },
  },
  // --- "Bize yaz": the shop's live support thread with us. Open even while the shop is locked. ---
  {
    method: 'POST',
    path: '/feedback',
    auth: 'user',
    body: z.object({ message: z.string().trim().min(1).max(2000) }),
    async handler(ctx, { body }) {
      return ok(await postSupport(ctx, body.message), 201);
    },
  },
  {
    method: 'POST',
    path: '/support',
    auth: 'user',
    body: z.object({ message: z.string().trim().min(1).max(2000) }),
    async handler(ctx, { body }) {
      return ok(await postSupport(ctx, body.message), 201);
    },
  },
  {
    // The whole thread, oldest first. Reading it marks our replies as read.
    method: 'GET',
    path: '/support',
    auth: 'user',
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select id, author, message, created_at, read_at from feedback where shop_id = $1 order by created_at, id limit 500`,
        [ctx.shopId],
      );
      await ctx.db.query(`update feedback set read_at = $2 where shop_id = $1 and author = 'operator' and read_at is null`, [ctx.shopId, ctx.now]);
      return { data: rows };
    },
  },
  {
    method: 'GET',
    path: '/support/unread',
    auth: 'user',
    async handler(ctx) {
      const r = (
        await ctx.db.query(`select count(*)::int as n from feedback where shop_id = $1 and author = 'operator' and read_at is null`, [ctx.shopId])
      ).rows[0];
      return { unread: r.n };
    },
  },

  // --- services ---
  {
    method: 'GET',
    path: '/services',
    auth: 'user',
    gated: true,
    query: pageQuery.extend({ include_inactive: z.enum(['true', 'false']).default('false') }),
    async handler(ctx, { query }) {
      const { rows } = await ctx.db.query(
        `select id, name, price_cents, duration_min, active, created_at, count(*) over() as total_count
           from services where shop_id = $1 and ($2 or active)
          order by active desc, name limit $3 offset $4`,
        [ctx.shopId, query.include_inactive === 'true', query.page_size, (query.page - 1) * query.page_size],
      );
      return paged(rows, query.page, query.page_size);
    },
  },
  {
    method: 'POST',
    path: '/services',
    auth: 'user',
    gated: true,
    body: z.object({
      name: z.string().trim().min(1).max(80),
      price_cents: cents,
      duration_min: z.number().int().min(5).max(600),
    }),
    async handler(ctx, { body }) {
      const row = (
        await ctx.db.query(
          'insert into services (shop_id, name, price_cents, duration_min) values ($1, $2, $3, $4) returning *',
          [ctx.shopId, body.name, body.price_cents, body.duration_min],
        )
      ).rows[0];
      return ok(row, 201);
    },
  },
  {
    method: 'PATCH',
    path: '/services/:id',
    auth: 'user',
    gated: true,
    body: z
      .object({
        name: z.string().trim().min(1).max(80),
        price_cents: cents,
        duration_min: z.number().int().min(5).max(600),
        active: z.boolean(),
      })
      .partial(),
    async handler(ctx, { params, body }) {
      return updateRow(ctx.db, 'services', ctx.shopId, params.id, body);
    },
  },
  {
    // Soft delete: past appointments keep pointing at the service.
    method: 'DELETE',
    path: '/services/:id',
    auth: 'user',
    gated: true,
    async handler(ctx, { params }) {
      await updateRow(ctx.db, 'services', ctx.shopId, params.id, { active: false });
      return noContent();
    },
  },

  // --- barbers ---
  {
    method: 'GET',
    path: '/barbers',
    auth: 'user',
    gated: true,
    query: pageQuery.extend({ include_inactive: z.enum(['true', 'false']).default('false') }),
    async handler(ctx, { query }) {
      const { rows } = await ctx.db.query(
        `select id, name, active, created_at, count(*) over() as total_count
           from barbers where shop_id = $1 and ($2 or active)
          order by active desc, created_at limit $3 offset $4`,
        [ctx.shopId, query.include_inactive === 'true', query.page_size, (query.page - 1) * query.page_size],
      );
      return paged(rows, query.page, query.page_size);
    },
  },
  {
    method: 'POST',
    path: '/barbers',
    auth: 'user',
    gated: true,
    body: z.object({ name: z.string().trim().min(1).max(80) }),
    async handler(ctx, { body }) {
      const row = (
        await ctx.db.query('insert into barbers (shop_id, name) values ($1, $2) returning id, name, active, created_at', [
          ctx.shopId,
          body.name,
        ])
      ).rows[0];
      return ok(row, 201);
    },
  },
  {
    method: 'PATCH',
    path: '/barbers/:id',
    auth: 'user',
    gated: true,
    body: z.object({ name: z.string().trim().min(1).max(80), active: z.boolean() }).partial(),
    async handler(ctx, { params, body }) {
      return updateRow(ctx.db, 'barbers', ctx.shopId, params.id, body);
    },
  },
];

/** Partial update that is always scoped to the caller's shop; a foreign id is a plain 404. */
export async function updateRow(db: Queryable, table: string, shopId: string, id: string, patch: Record<string, unknown>) {
  if (!uuid.safeParse(id).success) throw notFound();
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) throw badRequest('Nothing to update');
  const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const row = (
    await db.query(`update ${table} set ${sets} where id = $1 and shop_id = $2 returning *`, [
      id,
      shopId,
      ...keys.map((k) => patch[k]),
    ])
  ).rows[0];
  if (!row) throw notFound();
  return row;
}


async function postSupport(ctx: Ctx, message: string) {
  return (
    await ctx.db.query(
      `insert into feedback (shop_id, user_id, message, author, created_at) values ($1, $2, $3, 'shop', $4)
       returning id, author, message, created_at`,
      [ctx.shopId, ctx.userId, message, ctx.now],
    )
  ).rows[0];
}
