import { z } from 'zod';
import { DateTime } from 'luxon';
import { audit, badRequest, isoDate, notFound, ok, pageQuery, paged, uuid, type Ctx, type Route } from '../http';
import { dropQueued, enqueueReminders } from '../reminders';

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Expected YYYY-MM-DDTHH:mm');
const status = z.enum(['booked', 'done', 'missed', 'cancelled']);

export async function shopTz(ctx: Ctx): Promise<string> {
  return (await ctx.db.query('select timezone from shops where id = $1', [ctx.shopId])).rows[0].timezone;
}

/** starts_at (absolute ISO) wins; starts_local is wall-clock time in the shop's timezone. */
function resolveStart(b: { starts_at?: string; starts_local?: string }, tz: string): Date | undefined {
  if (b.starts_at) return new Date(b.starts_at);
  if (b.starts_local) {
    const dt = DateTime.fromISO(b.starts_local, { zone: tz });
    if (!dt.isValid) throw badRequest('Invalid starts_local', 'VALIDATION_ERROR');
    return dt.toJSDate();
  }
  return undefined;
}

const APPT_SELECT = `
  select a.id, a.barber_id, a.client_id, a.service_id, a.starts_at, a.ends_at, a.price_cents_snapshot,
         a.status, a.source, a.notes, a.created_at,
         c.name as client_name, c.consent_status, s.name as service_name, b.name as barber_name,
         (select count(*) from appointments m where m.client_id = a.client_id and m.status = 'missed')::int as client_missed,
         coalesce((select json_agg(json_build_object('id', r.id, 'template_key', r.template_key, 'status', r.status,
                    'scheduled_at', r.scheduled_at, 'error', r.error) order by r.scheduled_at)
                     from reminder_queue r where r.appointment_id = a.id), '[]'::json) as reminders
    from appointments a
    join clients c on c.id = a.client_id
    join services s on s.id = a.service_id
    join barbers b on b.id = a.barber_id`;

async function getAppointment(ctx: Ctx, id: string) {
  const row = (await ctx.db.query(`${APPT_SELECT} where a.shop_id = $1 and a.id = $2`, [ctx.shopId, id])).rows[0];
  if (!row) throw notFound('Appointment');
  return row;
}

async function loadService(ctx: Ctx, id: string) {
  const s = (await ctx.db.query('select * from services where id = $1 and shop_id = $2', [id, ctx.shopId])).rows[0];
  if (!s) throw notFound('Service');
  return s;
}

async function resolveBarber(ctx: Ctx, id?: string) {
  if (id) {
    const b = (await ctx.db.query('select id from barbers where id = $1 and shop_id = $2 and active', [id, ctx.shopId]))
      .rows[0];
    if (!b) throw notFound('Barber');
    return b.id as string;
  }
  const first = (
    await ctx.db.query('select id from barbers where shop_id = $1 and active order by created_at limit 1', [ctx.shopId])
  ).rows[0];
  if (!first) throw badRequest('Add a barber first', 'NO_BARBER');
  return first.id as string;
}

/** A done appointment is the day's income; this keeps exactly one book row per done visit. */
async function syncIncome(ctx: Ctx, appointmentId: string, isDone: boolean, tz: string) {
  if (!isDone) {
    await ctx.db.query('delete from book_entries where appointment_id = $1 and shop_id = $2', [appointmentId, ctx.shopId]);
    return;
  }
  const a = (
    await ctx.db.query(
      `select a.starts_at, a.price_cents_snapshot, s.name as service_name, c.name as client_name
         from appointments a join services s on s.id = a.service_id join clients c on c.id = a.client_id
        where a.id = $1 and a.shop_id = $2`,
      [appointmentId, ctx.shopId],
    )
  ).rows[0];
  if (!a || a.price_cents_snapshot <= 0) return;
  const day = DateTime.fromJSDate(new Date(a.starts_at), { zone: tz }).toISODate();
  await ctx.db.query(
    `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, source, appointment_id, created_by)
     values ($1, 'income', 'service', $2, $3, $4, 'appointment', $5, $6)
     on conflict (appointment_id) do update set amount_cents = excluded.amount_cents, entry_date = excluded.entry_date`,
    [ctx.shopId, a.price_cents_snapshot, day, `${a.service_name} · ${a.client_name}`.slice(0, 200), appointmentId, ctx.userId],
  );
}

export const appointmentRoutes: Route[] = [
  {
    method: 'GET',
    path: '/appointments',
    auth: 'user',
    gated: true,
    query: pageQuery.extend({
      date: isoDate.optional(),
      barber_id: uuid.optional(),
      page_size: z.coerce.number().int().min(1).max(200).default(200),
    }),
    async handler(ctx, { query }) {
      const tz = await shopTz(ctx);
      const day = query.date
        ? DateTime.fromISO(query.date, { zone: tz })
        : DateTime.fromJSDate(ctx.now, { zone: tz }).startOf('day');
      const from = day.startOf('day').toJSDate();
      const to = day.plus({ days: 1 }).startOf('day').toJSDate();
      const { rows } = await ctx.db.query(
        `select x.*, count(*) over() as total_count from (${APPT_SELECT}
          where a.shop_id = $1 and a.starts_at >= $2 and a.starts_at < $3 and ($4::uuid is null or a.barber_id = $4)) x
          order by x.starts_at limit $5 offset $6`,
        [ctx.shopId, from, to, query.barber_id ?? null, query.page_size, (query.page - 1) * query.page_size],
      );
      const totals = (
        await ctx.db.query(
          `select coalesce(sum(price_cents_snapshot) filter (where status in ('booked', 'done')), 0)::int8 as expected,
                  coalesce(sum(price_cents_snapshot) filter (where status = 'done'), 0)::int8 as done,
                  count(*) filter (where status = 'booked')::int as booked,
                  count(*) filter (where status = 'done')::int as done_count,
                  count(*) filter (where status = 'missed')::int as missed
             from appointments where shop_id = $1 and starts_at >= $2 and starts_at < $3`,
          [ctx.shopId, from, to],
        )
      ).rows[0];
      return {
        ...paged(rows, query.page, query.page_size),
        date: day.toISODate(),
        summary: {
          expected_cents: Number(totals.expected),
          done_cents: Number(totals.done),
          booked: totals.booked,
          done: totals.done_count,
          missed: totals.missed,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/appointments',
    auth: 'user',
    gated: true,
    body: z
      .object({
        client_id: uuid,
        service_id: uuid,
        barber_id: uuid.optional(),
        starts_at: z.string().datetime({ offset: true }).optional(),
        starts_local: localDateTime.optional(),
        notes: z.string().trim().max(500).optional(),
        source: z.enum(['manual', 'voice']).default('manual'),
      })
      .refine((b) => b.starts_at || b.starts_local, 'starts_at or starts_local is required'),
    async handler(ctx, { body }) {
      const tz = await shopTz(ctx);
      const service = await loadService(ctx, body.service_id);
      if (!service.active) throw badRequest('Service is inactive');
      const client = (await ctx.db.query('select id from clients where id = $1 and shop_id = $2', [body.client_id, ctx.shopId]))
        .rows[0];
      if (!client) throw notFound('Client');
      const barberId = await resolveBarber(ctx, body.barber_id);
      const starts = resolveStart(body, tz)!;
      const ends = new Date(starts.getTime() + service.duration_min * 60_000);
      const row = (
        await ctx.db.query(
          `insert into appointments (shop_id, barber_id, client_id, service_id, starts_at, ends_at, price_cents_snapshot, source, notes)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [ctx.shopId, barberId, client.id, service.id, starts, ends, service.price_cents, body.source, body.notes ?? null],
        )
      ).rows[0];
      await enqueueReminders(ctx.db, row.id, ctx.now);
      await audit(ctx, 'appointment.create', 'appointment', row.id);
      return ok(await getAppointment(ctx, row.id), 201);
    },
  },
  {
    method: 'PATCH',
    path: '/appointments/:id',
    auth: 'user',
    gated: true,
    body: z
      .object({
        status,
        starts_at: z.string().datetime({ offset: true }),
        starts_local: localDateTime,
        barber_id: uuid,
        service_id: uuid,
        notes: z.string().trim().max(500).nullable(),
      })
      .partial(),
    async handler(ctx, { params, body }) {
      const tz = await shopTz(ctx);
      const before = await getAppointment(ctx, params.id);
      const patch: Record<string, unknown> = {};
      const starts = resolveStart(body, tz);
      const serviceId = body.service_id ?? before.service_id;
      const service = await loadService(ctx, serviceId);
      const moved =
        (starts && starts.getTime() !== new Date(before.starts_at).getTime()) ||
        (body.service_id && body.service_id !== before.service_id) ||
        (body.barber_id && body.barber_id !== before.barber_id);
      if (moved) {
        const s = starts ?? new Date(before.starts_at);
        patch.starts_at = s;
        patch.ends_at = new Date(s.getTime() + service.duration_min * 60_000);
        if (body.service_id) patch.service_id = service.id;
        if (body.service_id && body.service_id !== before.service_id) patch.price_cents_snapshot = service.price_cents;
        if (body.barber_id) patch.barber_id = await resolveBarber(ctx, body.barber_id);
      }
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.status && body.status !== before.status) patch.status = body.status;
      const keys = Object.keys(patch);
      if (!keys.length) return before;
      await ctx.db.query(
        `update appointments set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where id = $1 and shop_id = $2`,
        [before.id, ctx.shopId, ...keys.map((k) => patch[k])],
      );

      const nextStatus = (patch.status as string) ?? before.status;
      if (nextStatus !== 'booked') {
        await dropQueued(ctx.db, { appointmentId: before.id }, `appointment_${nextStatus}`);
      } else if (moved || before.status !== 'booked') {
        // New time (or revived booking): drop the stale reminders and queue a fresh pair.
        await dropQueued(ctx.db, { appointmentId: before.id }, 'rescheduled');
        await enqueueReminders(ctx.db, before.id, ctx.now);
      }
      if (patch.status || moved || patch.price_cents_snapshot !== undefined)
        await syncIncome(ctx, before.id, nextStatus === 'done', tz);
      if (patch.status) await audit(ctx, `appointment.${nextStatus}`, 'appointment', before.id);
      if (moved) await audit(ctx, 'appointment.reschedule', 'appointment', before.id);
      return getAppointment(ctx, before.id);
    },
  },
];
