import { z } from 'zod';
import { DateTime } from 'luxon';
import { audit, badRequest, conflict, isoDate, notFound, ok, pageQuery, paged, uuid, type Ctx, type Route } from '../http';
import { dropQueued, enqueueReminders } from '../reminders';
import { freeSlots, stationFor } from '../ekip/saat';
import { staffOf, syncVisitSale } from '../ekip/kasa';

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
         a.status, a.source, a.notes, a.created_at, a.station_id, st.name as station_name,
         c.name as client_name, c.consent_status, s.name as service_name, b.name as barber_name,
         (select count(*) from appointments m where m.client_id = a.client_id and m.status = 'missed')::int as client_missed,
         coalesce((select json_agg(json_build_object('id', r.id, 'template_key', r.template_key, 'status', r.status,
                    'scheduled_at', r.scheduled_at, 'error', r.error) order by r.scheduled_at)
                     from reminder_queue r where r.appointment_id = a.id), '[]'::json) as reminders
    from appointments a
    join clients c on c.id = a.client_id
    join services s on s.id = a.service_id
    join barbers b on b.id = a.barber_id
    left join stations st on st.id = a.station_id`;

async function getAppointment(ctx: Ctx, id: string) {
  const row = (await ctx.db.query(`${APPT_SELECT} where a.shop_id = $1 and a.id = $2`, [ctx.shopId, id])).rows[0];
  // A team member's app holds only their own appointments; anyone else's is simply not there.
  if (!row || (ctx.role === 'barber' && row.barber_id !== (await staffOf(ctx.db, ctx.shopId, ctx.userId)))) throw notFound('Appointment');
  return row;
}

/** A team member books, sees and moves only their own appointments; the owner, anyone's. */
async function ownStaff(ctx: Ctx): Promise<string | null | undefined> {
  if (ctx.role !== 'barber') return undefined;
  return (await staffOf(ctx.db, ctx.shopId, ctx.userId)) ?? '00000000-0000-0000-0000-000000000000';
}

/** The chair or room the visit takes, or a 409 when the service needs one and none is free. */
async function placeAt(ctx: Ctx, o: { serviceId: string; staffId: string; starts: Date; ends: Date; wanted?: string | null; exceptAppointment?: string }) {
  const s = await stationFor(ctx.db, ctx.shopId, o);
  if (s.needed && !s.id) throw conflict(o.wanted ? 'That station is taken at this time' : 'No free station for this service at this time', 'STATION_TAKEN');
  return s.id;
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

/** Same rule as the database constraint, for databases that can't install btree_gist. */
async function assertFree(ctx: Ctx, barberId: string, starts: Date, ends: Date, exceptId?: string) {
  const clash = (
    await ctx.db.query(
      `select 1 from appointments where shop_id = $1 and barber_id = $2 and status in ('booked', 'done')
          and starts_at < $4 and ends_at > $3 and ($5::uuid is null or id <> $5) limit 1`,
      [ctx.shopId, barberId, starts, ends, exceptId ?? null],
    )
  ).rows[0];
  if (clash) throw conflict('That barber already has an appointment at this time', 'SLOT_TAKEN');
}

export const appointmentRoutes: Route[] = [
  {
    // The nearest free start times for a service on a day: "that time is taken, 15:30 or 16:00?".
    method: 'GET',
    path: '/appointments/free',
    auth: 'user',
    gated: true,
    query: z.object({
      date: isoDate,
      service_id: uuid,
      barber_id: uuid.optional(),
      near: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      count: z.coerce.number().int().min(1).max(8).default(3),
    }),
    async handler(ctx, { query }) {
      await loadService(ctx, query.service_id);
      const own = await ownStaff(ctx);
      const a = await freeSlots(ctx.db, ctx.shopId, {
        date: query.date,
        serviceId: query.service_id,
        staffId: own ?? query.barber_id ?? null,
        near: query.near ?? null,
        now: ctx.now,
        count: query.count,
      });
      return {
        date: a.date,
        taken: a.taken,
        reason: a.reason,
        hours: a.hours ?? { from: '09:00', to: '20:00' },
        slots: a.slots.map((s) => ({ time: s.time, barber_id: s.staff_id, barber_name: s.staff_name, station_id: s.station_id, station_name: s.station_name })),
      };
    },
  },
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
      const own = await ownStaff(ctx);
      const who = own ?? query.barber_id ?? null;
      const { rows } = await ctx.db.query(
        `select x.*, count(*) over() as total_count from (${APPT_SELECT}
          where a.shop_id = $1 and a.starts_at >= $2 and a.starts_at < $3 and ($4::uuid is null or a.barber_id = $4)) x
          order by x.starts_at limit $5 offset $6`,
        [ctx.shopId, from, to, who, query.page_size, (query.page - 1) * query.page_size],
      );
      const totals = (
        await ctx.db.query(
          `select coalesce(sum(price_cents_snapshot) filter (where status in ('booked', 'done')), 0)::int8 as expected,
                  coalesce(sum(price_cents_snapshot) filter (where status = 'done'), 0)::int8 as done,
                  count(*) filter (where status = 'booked')::int as booked,
                  count(*) filter (where status = 'done')::int as done_count,
                  count(*) filter (where status = 'missed')::int as missed
             from appointments where shop_id = $1 and starts_at >= $2 and starts_at < $3 and ($4::uuid is null or barber_id = $4)`,
          [ctx.shopId, from, to, who],
        )
      ).rows[0];
      // What is really in the till that day: every receipt (services, products, tips), not just visit prices.
      const till = (
        await ctx.db.query(
          `select coalesce(sum(s.total_cents), 0)::int8 as t from sales s where s.shop_id = $1 and s.sold_on = $2
             and ($3::uuid is null or s.staff_id = $3 or exists (select 1 from sale_items i where i.sale_id = s.id and i.staff_id = $3))`,
          [ctx.shopId, day.toISODate(), who],
        )
      ).rows[0].t;
      return {
        ...paged(rows, query.page, query.page_size),
        date: day.toISODate(),
        summary: {
          expected_cents: Number(totals.expected),
          done_cents: Number(totals.done),
          till_cents: Number(till),
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
        station_id: uuid.optional(),
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
      const own = await ownStaff(ctx);
      const barberId = own ?? (await resolveBarber(ctx, body.barber_id));
      const starts = resolveStart(body, tz)!;
      const ends = new Date(starts.getTime() + service.duration_min * 60_000);
      await assertFree(ctx, barberId, starts, ends);
      const stationId = await placeAt(ctx, { serviceId: service.id, staffId: barberId, starts, ends, wanted: body.station_id });
      const row = (
        await ctx.db.query(
          `insert into appointments (shop_id, barber_id, client_id, service_id, station_id, starts_at, ends_at, price_cents_snapshot, source, notes)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          [ctx.shopId, barberId, client.id, service.id, stationId, starts, ends, service.price_cents, body.source, body.notes ?? null],
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
        station_id: uuid,
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
      // A team member cannot hand their visit to someone else.
      if (ctx.role === 'barber' && body.barber_id && body.barber_id !== before.barber_id) throw notFound('Barber');
      const moved =
        (starts && starts.getTime() !== new Date(before.starts_at).getTime()) ||
        (body.service_id && body.service_id !== before.service_id) ||
        (body.barber_id && body.barber_id !== before.barber_id) ||
        (body.station_id && body.station_id !== before.station_id);
      if (moved) {
        const s = starts ?? new Date(before.starts_at);
        patch.starts_at = s;
        patch.ends_at = new Date(s.getTime() + service.duration_min * 60_000);
        if (body.service_id) patch.service_id = service.id;
        if (body.service_id && body.service_id !== before.service_id) patch.price_cents_snapshot = service.price_cents;
        if (body.barber_id) patch.barber_id = await resolveBarber(ctx, body.barber_id);
      }
      const next = body.status ?? before.status;
      if ((moved || next !== before.status) && (next === 'booked' || next === 'done'))
        await assertFree(
          ctx,
          (patch.barber_id as string) ?? before.barber_id,
          (patch.starts_at as Date) ?? new Date(before.starts_at),
          (patch.ends_at as Date) ?? new Date(before.ends_at),
          before.id,
        );
      if ((moved || next !== before.status) && (next === 'booked' || next === 'done'))
        patch.station_id = await placeAt(ctx, {
          serviceId,
          staffId: (patch.barber_id as string) ?? before.barber_id,
          starts: (patch.starts_at as Date) ?? new Date(before.starts_at),
          ends: (patch.ends_at as Date) ?? new Date(before.ends_at),
          wanted: body.station_id ?? (moved ? null : before.station_id),
          exceptAppointment: before.id,
        });
      if (patch.station_id === before.station_id) delete patch.station_id;
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
        await syncVisitSale(ctx.db, ctx.shopId, ctx.userId, before.id, nextStatus === 'done');
      if (patch.status) await audit(ctx, `appointment.${nextStatus}`, 'appointment', before.id);
      if (moved) await audit(ctx, 'appointment.reschedule', 'appointment', before.id);
      return getAppointment(ctx, before.id);
    },
  },
];
