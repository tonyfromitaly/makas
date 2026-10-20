import { z } from 'zod';
import { audit, badRequest, lang, maskPhone, notFound, ok, pageQuery, paged, phone, type Ctx, type Route } from '../http';
import { dropQueued, enqueueReminders } from '../reminders';
import { staffOf } from '../ekip/kasa';

/**
 * A team member's client book: the people they served, have booked or added themselves. The owner sees
 * everyone. Returns the extra condition and its two parameters ($a staff id, $b user id).
 */
async function scope(ctx: Ctx, a: number, b: number) {
  if (ctx.role !== 'barber') return { sql: 'true', params: [] as string[] };
  const staff = (await staffOf(ctx.db, ctx.shopId, ctx.userId)) ?? '00000000-0000-0000-0000-000000000000';
  return {
    sql: `(c.created_by = $${b}::uuid or exists (select 1 from appointments x where x.client_id = c.id and x.barber_id = $${a}::uuid)
           or exists (select 1 from sales y where y.client_id = c.id and y.staff_id = $${a}::uuid))`,
    params: [staff, ctx.userId],
  };
}

// Stats are derived on read so they can never drift from the appointments and ledger.
const CLIENT_SELECT = `
  select c.id, c.name, c.phone_e164, c.language, c.channel_pref, c.consent_status, c.consent_at, c.notes, c.created_at,
         coalesce(st.visits, 0)::int as visits, coalesce(st.missed, 0)::int as missed, st.last_visit,
         coalesce(lb.balance, 0)::int8 as balance_cents, nx.next_at
    from clients c
    left join lateral (
      select count(*) filter (where a.status = 'done') as visits,
             count(*) filter (where a.status = 'missed') as missed,
             max(a.starts_at) filter (where a.status = 'done') as last_visit
        from appointments a where a.client_id = c.id and a.shop_id = c.shop_id
    ) st on true
    left join lateral (
      select sum(case when l.kind = 'charge' then l.amount_cents else -l.amount_cents end) as balance
        from ledger_entries l where l.client_id = c.id and l.shop_id = c.shop_id
    ) lb on true
    left join lateral (
      select min(a.starts_at) as next_at from appointments a
       where a.client_id = c.id and a.shop_id = c.shop_id and a.status = 'booked' and a.starts_at > $2
    ) nx on true`;

/** The full number never leaves in list views; it is fetched on demand and that read is audited. */
export function presentClient(c: any, staff = false) {
  const { phone_e164, ...rest } = c;
  return {
    ...rest,
    // Store credit is between the owner and the client.
    balance_cents: staff ? 0 : Number(c.balance_cents),
    phone_masked: maskPhone(phone_e164),
    // No-show risk: any missed visit, weighted by how often it happens.
    risk: c.missed >= 2 || (c.missed >= 1 && c.missed / Math.max(c.visits + c.missed, 1) >= 0.25) ? 'high' : c.missed >= 1 ? 'some' : 'none',
  };
}

async function getClient(ctx: Ctx, id: string) {
  const sc = await scope(ctx, 4, 5);
  const row = (await ctx.db.query(`${CLIENT_SELECT} where c.shop_id = $1 and c.id = $3 and ${sc.sql}`, [ctx.shopId, ctx.now, id, ...sc.params]))
    .rows[0];
  if (!row) throw notFound('Client');
  return row;
}

export const clientRoutes: Route[] = [
  {
    method: 'GET',
    path: '/clients',
    auth: 'user',
    gated: true,
    query: pageQuery.extend({
      q: z.string().trim().max(80).optional(),
      filter: z.enum(['all', 'lapsed', 'debt', 'risk']).default('all'),
      lapsed_days: z.coerce.number().int().min(7).max(365).default(30),
    }),
    async handler(ctx, { query }) {
      const where = [
        'c.shop_id = $1',
        '($3::text is null or c.name ilike $3 or c.phone_e164 like $4::text)',
        '$7::int > 0',
      ];
      const sc = await scope(ctx, 8, 9);
      where.push(sc.sql);
      if (query.filter === 'lapsed')
        where.push(`st.last_visit < $2::timestamptz - make_interval(days => $7) and nx.next_at is null`);
      if (query.filter === 'debt') where.push('coalesce(lb.balance, 0) > 0');
      if (query.filter === 'risk') where.push('coalesce(st.missed, 0) > 0');
      const q = query.q ? `%${query.q.replace(/[%_\\]/g, '\\$&')}%` : null;
      const digits = query.q?.replace(/\D/g, '');
      const { rows } = await ctx.db.query(
        `select * , count(*) over() as total_count from (${CLIENT_SELECT} where ${where.join(' and ')}) x
          order by ${query.filter === 'lapsed' ? 'last_visit asc' : query.filter === 'debt' ? 'balance_cents desc' : 'name'}
          limit $5 offset $6`,
        [ctx.shopId, ctx.now, q, digits && digits.length >= 3 ? `%${digits}%` : null, query.page_size, (query.page - 1) * query.page_size, query.lapsed_days, ...sc.params],
      );
      const res = paged(rows, query.page, query.page_size);
      return { ...res, data: res.data.map((c) => presentClient(c, ctx.role === 'barber')) };
    },
  },
  {
    method: 'GET',
    path: '/clients/:id',
    auth: 'user',
    gated: true,
    async handler(ctx, { params }) {
      const c = await getClient(ctx, params.id);
      const history = (
        await ctx.db.query(
          `select a.id, a.starts_at, a.status, a.price_cents_snapshot, s.name as service_name
             from appointments a join services s on s.id = a.service_id
            where a.shop_id = $1 and a.client_id = $2 order by a.starts_at desc limit 20`,
          [ctx.shopId, c.id],
        )
      ).rows;
      return { ...presentClient(c, ctx.role === 'barber'), history };
    },
  },
  {
    method: 'GET',
    path: '/clients/:id/phone',
    auth: 'user',
    gated: true,
    async handler(ctx, { params }) {
      const c = await getClient(ctx, params.id);
      await audit(ctx, 'client.phone_read', 'client', c.id);
      return { id: c.id, phone_e164: c.phone_e164 };
    },
  },
  {
    method: 'POST',
    path: '/clients',
    auth: 'user',
    gated: true,
    body: z.object({
      name: z.string().trim().min(1).max(80),
      phone_e164: phone,
      language: lang.optional(),
      channel_pref: z.enum(['whatsapp', 'sms']).default('whatsapp'),
      /** The barber confirms the client agreed to receive reminders. */
      consent: z.boolean(),
      notes: z.string().trim().max(500).optional(),
    }),
    async handler(ctx, { body }) {
      const shopLang = (await ctx.db.query('select language from shops where id = $1', [ctx.shopId])).rows[0].language;
      const row = (
        await ctx.db.query(
          `insert into clients (shop_id, name, phone_e164, language, channel_pref, consent_status, consent_at, notes, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [
            ctx.shopId,
            body.name,
            body.phone_e164,
            body.language ?? shopLang,
            body.channel_pref,
            body.consent ? 'granted' : 'revoked',
            body.consent ? ctx.now : null,
            body.notes ?? null,
            ctx.userId,
          ],
        )
      ).rows[0];
      await audit(ctx, 'client.create', 'client', row.id);
      if (body.consent) await audit(ctx, 'client.consent_granted', 'client', row.id);
      return ok(presentClient(await getClient(ctx, row.id), ctx.role === 'barber'), 201);
    },
  },
  {
    method: 'PATCH',
    path: '/clients/:id',
    auth: 'user',
    gated: true,
    body: z
      .object({
        name: z.string().trim().min(1).max(80),
        phone_e164: phone,
        language: lang,
        channel_pref: z.enum(['whatsapp', 'sms']),
        consent: z.boolean(),
        notes: z.string().trim().max(500).nullable(),
      })
      .partial(),
    async handler(ctx, { params, body }) {
      const before = await getClient(ctx, params.id);
      const { consent, ...fields } = body;
      const patch: Record<string, unknown> = { ...fields };
      if (consent === true && before.consent_status !== 'granted') {
        patch.consent_status = 'granted';
        patch.consent_at = ctx.now;
      }
      if (consent === false && before.consent_status !== 'revoked') {
        patch.consent_status = 'revoked';
      }
      const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
      if (!keys.length) throw badRequest('Nothing to update');
      await ctx.db.query(
        `update clients set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and shop_id = $2`,
        [before.id, ctx.shopId, ...keys.map((k) => patch[k])],
      );
      if (fields.phone_e164 && fields.phone_e164 !== before.phone_e164)
        await audit(ctx, 'client.phone_change', 'client', before.id);
      if (patch.consent_status === 'revoked') {
        await dropQueued(ctx.db, { clientId: before.id }, 'consent_revoked');
        await audit(ctx, 'client.consent_revoked', 'client', before.id);
      }
      if (patch.consent_status === 'granted') {
        await audit(ctx, 'client.consent_granted', 'client', before.id);
        // Re-queue reminders for upcoming visits that have none waiting.
        const upcoming = await ctx.db.query(
          `select a.id from appointments a where a.shop_id = $1 and a.client_id = $2 and a.status = 'booked'
              and a.starts_at > $3
              and not exists (select 1 from reminder_queue r where r.appointment_id = a.id and r.status = 'queued')`,
          [ctx.shopId, before.id, ctx.now],
        );
        for (const a of upcoming.rows) await enqueueReminders(ctx.db, a.id, ctx.now);
      }
      if (fields.channel_pref)
        await ctx.db.query(`update reminder_queue set channel = $2 where client_id = $1 and status = 'queued'`, [
          before.id,
          fields.channel_pref,
        ]);
      return presentClient(await getClient(ctx, before.id), ctx.role === 'barber');
    },
  },
];
