import { z } from 'zod';
import { DateTime } from 'luxon';
import { audit, badRequest, cents, conflict, forbidden, isoDate, noContent, notFound, ok, positiveCents, uuid, type Ctx, type Route } from '../http';
import { createAccessKey } from '../provision';
import { STATION_KINDS, DEFAULT_HOURS, type Hours } from '../ekip/saat';
import { payReport, saveSale, staffOf, syncVisitSale, type Line } from '../ekip/kasa';
import { dropQueued, enqueueReminders } from '../reminders';
import { periodBounds } from './money';
import { fold } from '../parse/text';

// The team, the stations they work at, what the shop sells over the counter, the till and settling up.
// The owner sees and changes everything; a team member sees their own work and rings up their own sales.

const isStaff = (ctx: Ctx) => ctx.role === 'barber';

/** The team member behind this login; a staff login without one sees nothing of anyone. */
async function me(ctx: Ctx) {
  return staffOf(ctx.db, ctx.shopId, ctx.userId);
}

async function shopTz(ctx: Ctx): Promise<string> {
  return (await ctx.db.query('select timezone from shops where id = $1', [ctx.shopId])).rows[0].timezone;
}

/** today / week / month around a date, or an explicit from–to. */
async function rangeOf(ctx: Ctx, q: { period?: 'day' | 'week' | 'month'; date?: string; from?: string; to?: string }) {
  if (q.from && q.to) {
    if (q.to < q.from) throw badRequest('to is before from');
    return { from: q.from, to: q.to };
  }
  const tz = await shopTz(ctx);
  const d = q.date ? DateTime.fromISO(q.date, { zone: tz }) : DateTime.fromJSDate(ctx.now, { zone: tz });
  const b = periodBounds(q.period ?? 'day', d);
  return { from: b.from, to: b.to };
}

const rangeQuery = z.object({
  period: z.enum(['day', 'week', 'month']).optional(),
  date: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const pct = z.number().int().min(0).max(100);
const staffBody = z.object({
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().max(60).nullable(),
  pay_model: z.enum(['commission', 'booth_rent', 'salary']),
  service_pct: pct,
  product_pct: pct,
  salary_cents: cents,
  rent_cents: cents,
  rent_period: z.enum(['week', 'month']),
  station_id: uuid.nullable(),
  work_days: z.array(z.number().int().min(1).max(7)).max(7),
  online: z.boolean(),
});

const STAFF_PUBLIC = `b.id, b.name, b.title, b.active, b.station_id, st.name as station_name, b.work_days, b.online, b.created_at`;
const STAFF_PAY = `b.pay_model, b.service_pct, b.product_pct, b.salary_cents, b.rent_cents, b.rent_period, b.user_id is not null as has_login, u.email as login_email`;

async function getStaff(ctx: Ctx, id: string) {
  const row = (
    await ctx.db.query(
      `select ${STAFF_PUBLIC}, ${STAFF_PAY} from barbers b left join stations st on st.id = b.station_id left join users u on u.id = b.user_id
        where b.id = $1 and b.shop_id = $2`,
      [id, ctx.shopId],
    )
  ).rows[0];
  if (!row) throw notFound('Team member');
  return row;
}

async function assertStation(ctx: Ctx, id: string | null | undefined) {
  if (!id) return;
  const s = (await ctx.db.query('select 1 from stations where id = $1 and shop_id = $2', [id, ctx.shopId])).rows[0];
  if (!s) throw notFound('Station');
}

const lineBody = z.object({
  kind: z.enum(['service', 'product', 'other']),
  ref_id: uuid.nullable().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  unit_cents: cents.optional(),
  qty: z.number().int().min(1).max(999).default(1),
  staff_id: uuid.nullable().optional(),
});

/** Fills a line's name and price from the menu when only the item was named; checks every id is this shop's. */
async function resolveLine(ctx: Ctx, l: z.infer<typeof lineBody>, staffId: string | null): Promise<Line> {
  let name = l.name;
  let price = l.unit_cents;
  if (l.ref_id && l.kind !== 'other') {
    const table = l.kind === 'service' ? 'services' : 'products';
    const row = (await ctx.db.query(`select name, price_cents from ${table} where id = $1 and shop_id = $2`, [l.ref_id, ctx.shopId])).rows[0];
    if (!row) throw notFound(l.kind === 'service' ? 'Service' : 'Product');
    name ??= row.name;
    price ??= row.price_cents;
  }
  if (!name || price === undefined) throw badRequest('Each line needs a name and a price', 'VALIDATION_ERROR');
  if (l.staff_id && l.staff_id !== staffId) {
    const s = (await ctx.db.query('select 1 from barbers where id = $1 and shop_id = $2', [l.staff_id, ctx.shopId])).rows[0];
    if (!s) throw notFound('Team member');
  }
  return { kind: l.kind, ref_id: l.ref_id ?? null, name, unit_cents: price, qty: l.qty, staff_id: l.staff_id ?? staffId };
}

const SALE_SELECT = `
  select s.id, s.staff_id, b.name as staff_name, s.appointment_id, s.client_id, s.client_name, s.method,
         s.subtotal_cents, s.tip_cents, s.total_cents, to_char(s.sold_on, 'YYYY-MM-DD') as sold_on, s.sold_at, s.note,
         coalesce((select json_agg(json_build_object('id', i.id, 'kind', i.kind, 'ref_id', i.ref_id, 'name', i.name, 'unit_cents', i.unit_cents,
                    'qty', i.qty, 'staff_id', i.staff_id) order by i.created_at, i.id) from sale_items i where i.sale_id = s.id), '[]'::json) as items
    from sales s left join barbers b on b.id = s.staff_id`;

async function getSale(ctx: Ctx, id: string) {
  const row = (await ctx.db.query(`${SALE_SELECT} where s.id = $1 and s.shop_id = $2`, [id, ctx.shopId])).rows[0];
  if (!row) throw notFound('Sale');
  return row;
}

export function slugify(name: string) {
  return fold(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
const RESERVED = new Set(['api', 'app', 'demo', 'book', 'admin', 'www', 'help', 'support', 'embed']);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Use 3–40 letters, digits or dashes')
  .refine((s) => !RESERVED.has(s), 'That address is reserved');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const hoursBody = z.record(z.enum(['1', '2', '3', '4', '5', '6', '7']), z.tuple([hhmm, hhmm]).nullable()).refine(
  (h) => Object.values(h).every((v) => !v || v[1] > v[0]),
  'Closing time must be after opening time',
);

/** A free address for the shop's booking page, from its name. */
async function freeSlug(ctx: Ctx, name: string) {
  const base = slugify(name).padEnd(3, '0') || 'shop';
  for (let n = 1; n < 50; n++) {
    const s = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    if (RESERVED.has(s)) continue;
    const taken = (await ctx.db.query('select 1 from shops where lower(slug) = $1 and id <> $2', [s, ctx.shopId])).rows[0];
    if (!taken) return s;
  }
  return `${base.slice(0, 30)}-${ctx.shopId.slice(0, 6)}`;
}

export const teamRoutes: Route[] = [
  // --- stations: chairs, rooms, beds, tables ---
  {
    method: 'GET',
    path: '/stations',
    auth: 'user',
    gated: true,
    query: z.object({ include_inactive: z.enum(['true', 'false']).default('false') }),
    async handler(ctx, { query }) {
      const { rows } = await ctx.db.query(
        `select s.id, s.name, s.kind, s.active, s.sort,
                (select json_agg(b.name order by b.created_at) from barbers b where b.station_id = s.id and b.active) as staff
           from stations s where s.shop_id = $1 and ($2 or s.active) order by s.active desc, s.sort, s.name`,
        [ctx.shopId, query.include_inactive === 'true'],
      );
      return { data: rows };
    },
  },
  {
    method: 'POST',
    path: '/stations',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: z.object({ name: z.string().trim().min(1).max(40), kind: z.enum(STATION_KINDS).default('chair'), sort: z.number().int().min(0).max(999).optional() }),
    async handler(ctx, { body }) {
      const sort = body.sort ?? Number((await ctx.db.query('select count(*)::int as n from stations where shop_id = $1', [ctx.shopId])).rows[0].n);
      const row = (
        await ctx.db.query('insert into stations (shop_id, name, kind, sort) values ($1, $2, $3, $4) returning id, name, kind, active, sort', [ctx.shopId, body.name, body.kind, sort])
      ).rows[0];
      return ok(row, 201);
    },
  },
  {
    method: 'PATCH',
    path: '/stations/:id',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: z.object({ name: z.string().trim().min(1).max(40), kind: z.enum(STATION_KINDS), active: z.boolean(), sort: z.number().int().min(0).max(999) }).partial(),
    async handler(ctx, { params, body }) {
      const keys = Object.keys(body).filter((k) => (body as any)[k] !== undefined);
      if (!keys.length) throw badRequest('Nothing to update');
      const row = (
        await ctx.db.query(
          `update stations set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and shop_id = $2 returning id, name, kind, active, sort`,
          [params.id, ctx.shopId, ...keys.map((k) => (body as any)[k])],
        )
      ).rows[0];
      if (!row) throw notFound('Station');
      // A station taken out of use is nobody's home station any more.
      if (body.active === false) await ctx.db.query('update barbers set station_id = null where station_id = $1 and shop_id = $2', [params.id, ctx.shopId]);
      return row;
    },
  },

  // --- the team ---
  {
    method: 'GET',
    path: '/barbers',
    auth: 'user',
    gated: true,
    query: z.object({ include_inactive: z.enum(['true', 'false']).default('false'), page_size: z.coerce.number().optional(), page: z.coerce.number().optional() }),
    async handler(ctx, { query }) {
      // Everyone sees who is on the team and where they sit; only the owner sees the deals and logins.
      const cols = isStaff(ctx) ? STAFF_PUBLIC : `${STAFF_PUBLIC}, ${STAFF_PAY}`;
      const { rows } = await ctx.db.query(
        `select ${cols}, (b.user_id is not null and b.user_id = sh.owner_user_id) as is_owner
           from barbers b join shops sh on sh.id = b.shop_id left join stations st on st.id = b.station_id left join users u on u.id = b.user_id
          where b.shop_id = $1 and ($2 or b.active) order by b.active desc, (b.user_id is not null and b.user_id = sh.owner_user_id) desc, b.created_at, b.name`,
        [ctx.shopId, query.include_inactive === 'true'],
      );
      return { data: rows, page: 1, page_size: rows.length, total: rows.length };
    },
  },
  {
    method: 'POST',
    path: '/barbers',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: staffBody.partial().required({ name: true }),
    async handler(ctx, { body }) {
      await assertStation(ctx, body.station_id);
      const keys = Object.keys(body).filter((k) => (body as any)[k] !== undefined);
      const row = (
        await ctx.db.query(
          `insert into barbers (shop_id, ${keys.join(', ')}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
          [ctx.shopId, ...keys.map((k) => (body as any)[k])],
        )
      ).rows[0];
      await audit(ctx, 'staff.create', 'barber', row.id);
      return ok(await getStaff(ctx, row.id), 201);
    },
  },
  {
    method: 'PATCH',
    path: '/barbers/:id',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: staffBody.extend({ active: z.boolean() }).partial(),
    async handler(ctx, { params, body }) {
      await assertStation(ctx, body.station_id);
      const keys = Object.keys(body).filter((k) => (body as any)[k] !== undefined);
      if (!keys.length) throw badRequest('Nothing to update');
      const r = await ctx.db.query(`update barbers set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and shop_id = $2 returning id`, [
        params.id,
        ctx.shopId,
        ...keys.map((k) => (body as any)[k]),
      ]);
      if (!r.rows.length) throw notFound('Team member');
      if (body.pay_model || body.service_pct !== undefined || body.rent_cents !== undefined) await audit(ctx, 'staff.deal_change', 'barber', params.id);
      return getStaff(ctx, params.id);
    },
  },
  {
    // A login of their own for a team member: a one-time access key the owner hands over (or we e-mail).
    method: 'POST',
    path: '/barbers/:id/login',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: z.object({ email: z.string().trim().toLowerCase().email().max(200) }),
    system: true,
    async handler(ctx, { params, body }) {
      const b = (await ctx.db.query('select id, name, user_id from barbers where id = $1 and shop_id = $2', [params.id, ctx.shopId])).rows[0];
      if (!b) throw notFound('Team member');
      if (b.user_id) throw conflict('This person already has a login', 'HAS_LOGIN');
      const taken = (await ctx.db.query('select 1 from users where lower(email) = $1', [body.email])).rows[0];
      if (taken) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
      // No usable password until they set one with the key.
      const user = (
        await ctx.db.query(`insert into users (shop_id, email, password_hash, role, name) values ($1, $2, $3, 'barber', $4) returning id`, [
          ctx.shopId,
          body.email,
          await ctx.deps.hashPassword(crypto.randomUUID() + crypto.randomUUID()),
          b.name,
        ])
      ).rows[0];
      await ctx.db.query('update barbers set user_id = $1 where id = $2 and shop_id = $3', [user.id, b.id, ctx.shopId]);
      const key = await createAccessKey(ctx.db, ctx.shopId, user.id, ctx.now);
      await audit(ctx, 'staff.login_created', 'barber', b.id);
      return ok({ email: body.email, key }, 201);
    },
  },
  {
    method: 'DELETE',
    path: '/barbers/:id/login',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    async handler(ctx, { params }) {
      const b = (await ctx.db.query('select user_id from barbers where id = $1 and shop_id = $2', [params.id, ctx.shopId])).rows[0];
      if (!b) throw notFound('Team member');
      if (!b.user_id) return noContent();
      if (b.user_id === ctx.userId) throw badRequest('You cannot remove your own login');
      await ctx.db.query('update barbers set user_id = null where id = $1 and shop_id = $2', [params.id, ctx.shopId]);
      await ctx.db.query(`delete from users where id = $1 and shop_id = $2 and role = 'barber'`, [b.user_id, ctx.shopId]);
      await audit(ctx, 'staff.login_removed', 'barber', params.id);
      return noContent();
    },
  },

  // --- over-the-counter products ---
  {
    method: 'GET',
    path: '/products',
    auth: 'user',
    gated: true,
    query: z.object({ include_inactive: z.enum(['true', 'false']).default('false') }),
    async handler(ctx, { query }) {
      const { rows } = await ctx.db.query(
        `select id, name, price_cents, stock, active from products where shop_id = $1 and ($2 or active) order by active desc, name`,
        [ctx.shopId, query.include_inactive === 'true'],
      );
      return { data: rows };
    },
  },
  {
    method: 'POST',
    path: '/products',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: z.object({ name: z.string().trim().min(1).max(80), price_cents: cents, stock: z.number().int().min(0).max(1_000_000).nullable().optional() }),
    async handler(ctx, { body }) {
      const row = (
        await ctx.db.query('insert into products (shop_id, name, price_cents, stock) values ($1, $2, $3, $4) returning id, name, price_cents, stock, active', [
          ctx.shopId,
          body.name,
          body.price_cents,
          body.stock ?? null,
        ])
      ).rows[0];
      return ok(row, 201);
    },
  },
  {
    method: 'PATCH',
    path: '/products/:id',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: z.object({ name: z.string().trim().min(1).max(80), price_cents: cents, stock: z.number().int().min(0).max(1_000_000).nullable(), active: z.boolean() }).partial(),
    async handler(ctx, { params, body }) {
      const keys = Object.keys(body).filter((k) => (body as any)[k] !== undefined);
      if (!keys.length) throw badRequest('Nothing to update');
      const row = (
        await ctx.db.query(
          `update products set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and shop_id = $2 returning id, name, price_cents, stock, active`,
          [params.id, ctx.shopId, ...keys.map((k) => (body as any)[k])],
        )
      ).rows[0];
      if (!row) throw notFound('Product');
      return row;
    },
  },

  // --- the till ---
  {
    method: 'GET',
    path: '/sales',
    auth: 'user',
    gated: true,
    query: rangeQuery.extend({ staff_id: uuid.optional() }),
    async handler(ctx, { query }) {
      const { from, to } = await rangeOf(ctx, query);
      // A team member sees the sales they rang up or did a line of; the owner sees all, or one person's.
      const staff = isStaff(ctx) ? (await me(ctx)) ?? '00000000-0000-0000-0000-000000000000' : query.staff_id ?? null;
      const { rows } = await ctx.db.query(
        `${SALE_SELECT} where s.shop_id = $1 and s.sold_on between $2 and $3
           and ($4::uuid is null or s.staff_id = $4 or exists (select 1 from sale_items i where i.sale_id = s.id and i.staff_id = $4))
         order by s.sold_at desc limit 300`,
        [ctx.shopId, from, to, staff],
      );
      const totals = { count: rows.length, total_cents: 0, tip_cents: 0, cash_cents: 0, card_cents: 0, other_cents: 0 };
      for (const s of rows) {
        totals.total_cents += s.total_cents;
        totals.tip_cents += s.tip_cents;
        totals[`${s.method as 'cash' | 'card' | 'other'}_cents`] += s.total_cents;
      }
      return { from, to, data: rows, totals };
    },
  },
  {
    method: 'POST',
    path: '/sales',
    auth: 'user',
    gated: true,
    body: z.object({
      staff_id: uuid.nullable().optional(),
      appointment_id: uuid.optional(),
      client_id: uuid.nullable().optional(),
      method: z.enum(['cash', 'card', 'other']).default('cash'),
      tip_cents: cents.default(0),
      lines: z.array(lineBody).max(40).default([]),
      note: z.string().trim().max(200).optional(),
    }),
    async handler(ctx, { body }) {
      const mine = await me(ctx);
      if (isStaff(ctx) && !mine) throw forbidden('This login is not linked to a team member');
      // A team member always rings up as themselves.
      let staffId = isStaff(ctx) ? mine : body.staff_id ?? mine;
      let client: { id: string; name: string } | null = null;
      if (body.client_id) {
        client = (await ctx.db.query('select id, name from clients where id = $1 and shop_id = $2', [body.client_id, ctx.shopId])).rows[0] ?? null;
        if (!client) throw notFound('Client');
      }
      if (staffId && staffId !== mine) {
        const s = (await ctx.db.query('select 1 from barbers where id = $1 and shop_id = $2', [staffId, ctx.shopId])).rows[0];
        if (!s) throw notFound('Team member');
      }

      if (body.appointment_id) {
        // Checkout for a visit: it is done, and its sale now carries what was really sold and paid.
        const a = (
          await ctx.db.query(
            `select a.id, a.status, a.barber_id, a.client_id, a.service_id, a.price_cents_snapshot, c.name as client_name
               from appointments a join clients c on c.id = a.client_id where a.id = $1 and a.shop_id = $2`,
            [body.appointment_id, ctx.shopId],
          )
        ).rows[0];
        if (!a) throw notFound('Appointment');
        if (isStaff(ctx) && a.barber_id !== mine) throw notFound('Appointment');
        if (a.status === 'cancelled' || a.status === 'missed') throw conflict('This visit is not on; restore it first', 'NOT_BOOKED');
        staffId = isStaff(ctx) ? mine : body.staff_id ?? a.barber_id;
        const lines = await Promise.all(body.lines.map((l: z.infer<typeof lineBody>) => resolveLine(ctx, l, staffId)));
        let service = lines.find((l) => l.kind === 'service' && l.ref_id === a.service_id);
        if (!service) {
          const s = (await ctx.db.query('select name from services where id = $1', [a.service_id])).rows[0];
          service = { kind: 'service', ref_id: a.service_id, name: s.name, unit_cents: a.price_cents_snapshot, qty: 1, staff_id: a.barber_id };
          lines.unshift(service);
        }
        // A price changed at the till is the visit's price from now on.
        await ctx.db.query(`update appointments set status = 'done', price_cents_snapshot = $3 where id = $1 and shop_id = $2`, [a.id, ctx.shopId, service.unit_cents]);
        if (a.status === 'booked') {
          await dropQueued(ctx.db, { appointmentId: a.id }, 'appointment_done');
          await audit(ctx, 'appointment.done', 'appointment', a.id);
        }
        const existing = (await ctx.db.query('select id from sales where appointment_id = $1 and shop_id = $2', [a.id, ctx.shopId])).rows[0];
        const id = await saveSale(
          ctx.db,
          ctx.shopId,
          ctx.userId,
          { staff_id: staffId, appointment_id: a.id, client_id: a.client_id, client_name: a.client_name, method: body.method, tip_cents: body.tip_cents, lines, sold_at: ctx.now, note: body.note },
          existing?.id,
        );
        await audit(ctx, 'sale.checkout', 'sale', id);
        return ok(await getSale(ctx, id), 201);
      }

      const lines = await Promise.all(body.lines.map((l: z.infer<typeof lineBody>) => resolveLine(ctx, l, staffId)));
      if (isStaff(ctx) && lines.some((l) => l.staff_id !== mine)) throw forbidden('A team member rings up only their own work');
      const id = await saveSale(ctx.db, ctx.shopId, ctx.userId, {
        staff_id: staffId,
        client_id: client?.id ?? null,
        client_name: client?.name ?? null,
        method: body.method,
        tip_cents: body.tip_cents,
        lines,
        sold_at: ctx.now,
        note: body.note,
      });
      await audit(ctx, 'sale.create', 'sale', id);
      return ok(await getSale(ctx, id), 201);
    },
  },
  {
    // Void a sale. A visit's sale cannot stand alone: voiding it puts the visit back to booked.
    method: 'DELETE',
    path: '/sales/:id',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    async handler(ctx, { params }) {
      const s = (await ctx.db.query('select id, appointment_id from sales where id = $1 and shop_id = $2', [params.id, ctx.shopId])).rows[0];
      if (!s) throw notFound('Sale');
      if (s.appointment_id) {
        await syncVisitSale(ctx.db, ctx.shopId, ctx.userId, s.appointment_id, false);
        await ctx.db.query(`update appointments set status = 'booked' where id = $1 and shop_id = $2`, [s.appointment_id, ctx.shopId]);
        await enqueueReminders(ctx.db, s.appointment_id, ctx.now);
      } else {
        await ctx.db.query(
          `update products p set stock = p.stock + i.qty from (select ref_id, sum(qty)::int as qty from sale_items where sale_id = $1 and kind = 'product' and ref_id is not null group by ref_id) i
            where p.id = i.ref_id and p.shop_id = $2 and p.stock is not null`,
          [s.id, ctx.shopId],
        );
        await ctx.db.query('delete from sales where id = $1 and shop_id = $2', [s.id, ctx.shopId]);
      }
      await audit(ctx, 'sale.void', 'sale', s.id);
      return noContent();
    },
  },

  // --- who sold what, and settling up ---
  {
    method: 'GET',
    path: '/team/report',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    query: rangeQuery,
    async handler(ctx, { query }) {
      const { from, to } = await rangeOf(ctx, { period: 'week', ...query });
      const rows = await payReport(ctx.db, ctx.shopId, from, to);
      const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (r[k] as number), 0);
      return {
        from,
        to,
        data: rows,
        totals: {
          gross_cents: sum('gross_cents'),
          tips_cents: sum('tips_cents'),
          owed_cents: sum('owed_cents'),
          rent_cents: sum('rent_cents'),
          shop_cents: sum('shop_cents'),
          visits: sum('visits'),
        },
      };
    },
  },
  {
    // A team member's own page: what they sold, their tips, their share, and their next visits.
    method: 'GET',
    path: '/me/work',
    auth: 'user',
    gated: true,
    query: rangeQuery,
    async handler(ctx, { query }) {
      const mine = await me(ctx);
      if (!mine) return { staff: null, row: null, sales: [], next: [] };
      const { from, to } = await rangeOf(ctx, { period: 'day', ...query });
      const [row] = await payReport(ctx.db, ctx.shopId, from, to, mine);
      const staff = (await ctx.db.query(`select ${STAFF_PUBLIC}, b.pay_model, b.service_pct, b.product_pct from barbers b left join stations st on st.id = b.station_id where b.id = $1`, [mine])).rows[0];
      const sales = (
        await ctx.db.query(
          `${SALE_SELECT} where s.shop_id = $1 and s.sold_on between $2 and $3
             and (s.staff_id = $4 or exists (select 1 from sale_items i where i.sale_id = s.id and i.staff_id = $4))
           order by s.sold_at desc limit 50`,
          [ctx.shopId, from, to, mine],
        )
      ).rows;
      const next = (
        await ctx.db.query(
          `select a.id, a.starts_at, a.ends_at, c.name as client_name, sv.name as service_name, st.name as station_name
             from appointments a join clients c on c.id = a.client_id join services sv on sv.id = a.service_id left join stations st on st.id = a.station_id
            where a.shop_id = $1 and a.barber_id = $2 and a.status = 'booked' and a.ends_at > $3 order by a.starts_at limit 5`,
          [ctx.shopId, mine, ctx.now],
        )
      ).rows;
      return { from, to, staff, row: row ?? null, sales, next };
    },
  },
  {
    method: 'GET',
    path: '/team/:id/payouts',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    async handler(ctx, { params }) {
      const { rows } = await ctx.db.query(
        `select id, kind, to_char(period_from, 'YYYY-MM-DD') as period_from, to_char(period_to, 'YYYY-MM-DD') as period_to, amount_cents, note, created_at
           from staff_payouts where shop_id = $1 and staff_id = $2 order by period_to desc, created_at desc limit 50`,
        [ctx.shopId, params.id],
      );
      return { data: rows };
    },
  },
  {
    // Settle a period: the shop pays the person (wages in the books), or a renter pays the chair rent (income).
    method: 'POST',
    path: '/team/:id/payouts',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: z.object({ kind: z.enum(['pay', 'rent']), from: isoDate, to: isoDate, amount_cents: positiveCents, note: z.string().trim().max(200).optional() }),
    async handler(ctx, { params, body }) {
      if (body.to < body.from) throw badRequest('to is before from');
      const b = (await ctx.db.query('select id, name from barbers where id = $1 and shop_id = $2', [params.id, ctx.shopId])).rows[0];
      if (!b) throw notFound('Team member');
      const tz = await shopTz(ctx);
      const today = DateTime.fromJSDate(ctx.now, { zone: tz }).toISODate();
      const pay = body.kind === 'pay';
      const entry = (
        await ctx.db.query(
          `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, source, created_by)
           values ($1, $2, $3, $4, $5, $6, 'payout', $7) returning id`,
          [ctx.shopId, pay ? 'expense' : 'income', pay ? 'wages' : 'other', body.amount_cents, today, `${pay ? 'Hakediş' : 'Koltuk kirası'} · ${b.name} · ${body.from}–${body.to}`.slice(0, 200), ctx.userId],
        )
      ).rows[0];
      const row = (
        await ctx.db.query(
          `insert into staff_payouts (shop_id, staff_id, kind, period_from, period_to, amount_cents, book_entry_id, note, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, kind, to_char(period_from, 'YYYY-MM-DD') as period_from, to_char(period_to, 'YYYY-MM-DD') as period_to, amount_cents, note, created_at`,
          [ctx.shopId, b.id, body.kind, body.from, body.to, body.amount_cents, entry.id, body.note ?? null, ctx.userId],
        )
      ).rows[0];
      await audit(ctx, `staff.${body.kind}`, 'barber', b.id);
      return ok(row, 201);
    },
  },

  // --- online booking settings ---
  {
    method: 'GET',
    path: '/shops/me/booking',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    async handler(ctx) {
      const s = (await ctx.db.query('select name, slug, booking_enabled, hours, booking_note from shops where id = $1', [ctx.shopId])).rows[0];
      return {
        slug: s.slug ?? (await freeSlug(ctx, s.name)),
        saved: !!s.slug,
        booking_enabled: s.booking_enabled,
        hours: (s.hours as Hours | null) ?? DEFAULT_HOURS,
        booking_note: s.booking_note,
      };
    },
  },
  {
    method: 'PATCH',
    path: '/shops/me/booking',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    system: true,
    body: z.object({ slug, booking_enabled: z.boolean(), hours: hoursBody, booking_note: z.string().trim().max(300).nullable() }).partial(),
    async handler(ctx, { body }) {
      if (body.slug) {
        const taken = (await ctx.db.query('select 1 from shops where lower(slug) = $1 and id <> $2', [body.slug, ctx.shopId])).rows[0];
        if (taken) throw conflict('That address is taken', 'SLUG_TAKEN');
      }
      const cur = (await ctx.db.query('select name, slug from shops where id = $1', [ctx.shopId])).rows[0];
      const patch: Record<string, unknown> = { ...body };
      if (body.hours) patch.hours = JSON.stringify({ ...DEFAULT_HOURS, ...body.hours });
      // Turning booking on gives the page an address if it has none yet.
      if (body.booking_enabled && !body.slug && !cur.slug) patch.slug = await freeSlug(ctx, cur.name);
      const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
      if (!keys.length) throw badRequest('Nothing to update');
      await ctx.db.query(`update shops set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [ctx.shopId, ...keys.map((k) => patch[k])]);
      await audit(ctx, 'shop.booking_update', 'shop', ctx.shopId);
      const s = (await ctx.db.query('select slug, booking_enabled, hours, booking_note from shops where id = $1', [ctx.shopId])).rows[0];
      return { ...s, saved: !!s.slug, hours: s.hours ?? DEFAULT_HOURS };
    },
  },
];
