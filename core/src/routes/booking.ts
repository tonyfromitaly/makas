import { z } from 'zod';
import { DateTime } from 'luxon';
import { ApiError, conflict, isoDate, lang as langSchema, notFound, ok, uuid, type Ctx, type Route } from '../http';
import type { Queryable } from '../db';
import { freeSlots, openOn, type Hours, type Slot } from '../ekip/saat';
import { anyone, dayLabel, parseDay, parsePhoneish, parseTime, pick, say, PHONE_EXAMPLE, type AgentOption, type AgentState, type Field, type Lang } from '../ekip/ajan';
import { toE164 } from '../assistant/phone';
import { enqueueReminders } from '../reminders';
import { isLocked, loadSubscription } from './shop';

// The shop's public booking page (/book/<slug>) and the agent behind it. No login: the shop is found by
// its address, must have online booking switched on and a live subscription, and everything after that
// runs inside that shop's tenant scope. Clients never see other clients: slots carry times and names
// of the team, nothing else.

const DAYS_AHEAD = 30;
const MAX_OPEN_PER_PHONE = 3;

interface PublicShop {
  id: string;
  name: string;
  timezone: string;
  language: Lang;
  currency: string;
  country: string;
  hours: Hours | null;
  booking_note: string | null;
  business_type: string;
}

/** Finds the shop by its address and narrows this transaction to it. Off, deleted or locked: not found. */
async function openShop(ctx: Ctx, slug: string): Promise<PublicShop> {
  const s = (
    await ctx.db.query(
      `select id, name, timezone, language, currency, country, hours, booking_note, business_type, booking_enabled, deleted_at
         from shops where lower(slug) = lower($1)`,
      [slug],
    )
  ).rows[0];
  if (!s || !s.booking_enabled || s.deleted_at || isLocked(await loadSubscription(ctx.db, s.id), ctx.now))
    throw new ApiError(404, 'BOOKING_OFF', 'This booking page is not available');
  // From here on, row-level security holds the queries to this one shop.
  await ctx.db.query(`select set_config('app.shop_id', $1, true), set_config('app.system', 'off', true)`, [s.id]);
  return s;
}

const money = (cents: number, currency: string, l: Lang) =>
  new Intl.NumberFormat(l === 'tr' ? 'tr-TR' : l === 'es' ? 'es-ES' : 'en-US', { style: 'currency', currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

async function menu(db: Queryable, shopId: string) {
  const services = (
    await db.query(`select id, name, price_cents, duration_min, station_kind from services where shop_id = $1 and active and online order by name`, [shopId])
  ).rows as { id: string; name: string; price_cents: number; duration_min: number; station_kind: string | null }[];
  const staff = (await db.query(`select id, name, title from barbers where shop_id = $1 and active and online order by created_at, name`, [shopId])).rows as {
    id: string;
    name: string;
    title: string | null;
  }[];
  return { services, staff };
}

export interface Booked {
  appointment_id: string;
  date: string;
  time: string;
  staff_name: string;
  station_name: string | null;
  service_name: string;
  price_cents: number;
}

/** Books one online appointment, re-checking the slot inside this transaction. */
async function bookOnline(
  ctx: Ctx,
  shop: PublicShop,
  b: { service_id: string; staff_id: string | null; date: string; time: string; name: string; phone: string; consent: boolean; lang: Lang },
): Promise<Booked> {
  const phone = toE164(b.phone, shop.country);
  if (!phone) throw new ApiError(400, 'BAD_PHONE', 'Phone number not recognised');
  const answer = await freeSlots(ctx.db, shop.id, { date: b.date, serviceId: b.service_id, staffId: b.staff_id, near: b.time, now: ctx.now, online: true, count: 4 });
  const slot = answer.slots.find((s) => s.time === b.time && (!b.staff_id || s.staff_id === b.staff_id));
  if (!slot) throw Object.assign(conflict('That time was just taken', 'SLOT_TAKEN'), { slots: answer.slots });
  const open = (
    await ctx.db.query(
      `select count(*)::int as n from appointments a join clients c on c.id = a.client_id
        where a.shop_id = $1 and c.phone_e164 = $2 and a.status = 'booked' and a.starts_at > $3`,
      [shop.id, phone, ctx.now],
    )
  ).rows[0].n;
  if (open >= MAX_OPEN_PER_PHONE) throw new ApiError(429, 'TOO_MANY_BOOKINGS', 'This number already has several bookings');

  let client = (await ctx.db.query('select id, consent_status from clients where shop_id = $1 and phone_e164 = $2', [shop.id, phone])).rows[0];
  if (!client) {
    client = (
      await ctx.db.query(
        `insert into clients (shop_id, name, phone_e164, language, consent_status, consent_at) values ($1, $2, $3, $4, $5, $6) returning id, consent_status`,
        [shop.id, b.name.slice(0, 80), phone, b.lang, b.consent ? 'granted' : 'revoked', b.consent ? ctx.now : null],
      )
    ).rows[0];
  } else if (b.consent && client.consent_status !== 'granted') {
    await ctx.db.query(`update clients set consent_status = 'granted', consent_at = $3 where id = $1 and shop_id = $2`, [client.id, shop.id, ctx.now]);
  }
  const service = (await ctx.db.query('select name, price_cents, duration_min from services where id = $1 and shop_id = $2', [b.service_id, shop.id])).rows[0];
  const starts = DateTime.fromISO(`${b.date}T${b.time}`, { zone: shop.timezone }).toJSDate();
  const ends = new Date(starts.getTime() + service.duration_min * 60_000);
  const row = (
    await ctx.db.query(
      `insert into appointments (shop_id, barber_id, client_id, service_id, station_id, starts_at, ends_at, price_cents_snapshot, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'online') returning id`,
      [shop.id, slot.staff_id, client.id, b.service_id, slot.station_id, starts, ends, service.price_cents],
    )
  ).rows[0];
  await enqueueReminders(ctx.db, row.id, ctx.now);
  await ctx.db.query(`insert into audit_log (shop_id, user_id, action, entity, entity_id, at) values ($1, null, 'appointment.online', 'appointment', $2, $3)`, [
    shop.id,
    row.id,
    ctx.now,
  ]);
  return { appointment_id: row.id, date: b.date, time: b.time, staff_name: slot.staff_name, station_name: slot.station_name, service_name: service.name, price_cents: service.price_cents };
}

/** The next days that have at least one free time, with their first few times. */
async function freeDays(ctx: Ctx, shop: PublicShop, serviceId: string, staffId: string | null, max = 6) {
  const today = DateTime.fromJSDate(ctx.now, { zone: shop.timezone }).startOf('day');
  const out: { date: string; slots: Slot[] }[] = [];
  for (let i = 0; i <= 14 && out.length < max; i++) {
    const date = today.plus({ days: i }).toISODate()!;
    if (!openOn(shop.hours, today.plus({ days: i }).weekday)) continue;
    const a = await freeSlots(ctx.db, shop.id, { date, serviceId, staffId, now: ctx.now, online: true });
    if (a.slots.length) out.push({ date, slots: a.slots });
  }
  return out;
}

/** Up to eight times spread over the day, so the client sees the morning and the evening, not just 09:00–10:45. */
function spread(slots: Slot[], n = 8): Slot[] {
  if (slots.length <= n) return slots;
  const step = (slots.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => slots[Math.round(i * step)]);
}

const agentBody = z.object({
  lang: langSchema.optional(),
  state: z
    .object({
      service_id: uuid.nullable().optional(),
      staff_id: z.union([uuid, z.literal('any')]).nullable().optional(),
      date: isoDate.nullable().optional(),
      time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      name: z.string().trim().max(80).nullable().optional(),
      phone: z.string().trim().max(40).nullable().optional(),
      consent: z.boolean().nullable().optional(),
    })
    .default({}),
  /** A chip the client tapped: merged into the state. */
  set: z.record(z.union([z.string().max(80), z.boolean()])).optional(),
  /** Or what they typed. */
  text: z.string().trim().max(300).optional(),
  /** Honeypot: people never fill it. */
  website: z.string().max(200).optional(),
});

export const bookingRoutes: Route[] = [
  {
    method: 'GET',
    path: '/public/book/:slug',
    auth: 'public',
    async handler(ctx, { params }) {
      const shop = await openShop(ctx, params.slug);
      const m = await menu(ctx.db, shop.id);
      return {
        shop: { name: shop.name, language: shop.language, currency: shop.currency, timezone: shop.timezone, country: shop.country, note: shop.booking_note, business_type: shop.business_type },
        services: m.services.map(({ station_kind, ...s }) => s),
        staff: m.staff,
        hours: shop.hours,
      };
    },
  },
  {
    method: 'GET',
    path: '/public/book/:slug/slots',
    auth: 'public',
    query: z.object({ service_id: uuid, staff_id: uuid.optional(), date: isoDate }),
    async handler(ctx, { params, query }) {
      const shop = await openShop(ctx, params.slug);
      const today = DateTime.fromJSDate(ctx.now, { zone: shop.timezone }).startOf('day');
      const d = DateTime.fromISO(query.date, { zone: shop.timezone });
      if (d < today || d > today.plus({ days: DAYS_AHEAD })) return { date: query.date, slots: [] };
      const a = await freeSlots(ctx.db, shop.id, { date: query.date, serviceId: query.service_id, staffId: query.staff_id, now: ctx.now, online: true });
      return { date: query.date, hours: a.hours, slots: a.slots.map(({ station_id, ...s }) => s) };
    },
  },
  {
    method: 'POST',
    path: '/public/book/:slug',
    auth: 'public',
    body: z.object({
      service_id: uuid,
      staff_id: uuid.nullable().optional(),
      date: isoDate,
      time: z.string().regex(/^\d{2}:\d{2}$/),
      name: z.string().trim().min(1).max(80),
      phone: z.string().trim().min(6).max(40),
      consent: z.boolean().default(false),
      lang: langSchema.optional(),
      website: z.string().max(200).optional(),
    }),
    async handler(ctx, { params, body }) {
      const shop = await openShop(ctx, params.slug);
      if (body.website) return ok({ booked: true }, 201); // a bot filled the hidden field: say yes, do nothing
      const today = DateTime.fromJSDate(ctx.now, { zone: shop.timezone }).startOf('day');
      if (DateTime.fromISO(body.date, { zone: shop.timezone }) > today.plus({ days: DAYS_AHEAD })) throw conflict('Too far ahead', 'TOO_FAR');
      const r = await bookOnline(ctx, shop, { ...body, staff_id: body.staff_id ?? null, lang: body.lang ?? shop.language });
      return ok({ booked: true, ...r }, 201);
    },
  },
  {
    // One turn of the booking agent. The client keeps the state; every turn re-checks it against the calendar.
    method: 'POST',
    path: '/public/book/:slug/agent',
    auth: 'public',
    body: agentBody,
    async handler(ctx, { params, body }) {
      const shop = await openShop(ctx, params.slug);
      const l: Lang = body.lang ?? shop.language;
      const m = await menu(ctx.db, shop.id);
      const today = DateTime.fromJSDate(ctx.now, { zone: shop.timezone }).startOf('day');
      const st: AgentState = { ...body.state };
      const notes: string[] = [];
      let expecting: Field | null = null;
      const clear = (...keys: (keyof AgentState)[]) => keys.forEach((k) => (st[k] = null));

      // What the client chose or said. A tap sets fields; text can fill several at once.
      for (const [k, v] of Object.entries(body.set ?? {})) {
        if (k === 'confirm') continue;
        (st as any)[k] = v;
        if (k === 'service_id') clear('time');
        if (k === 'staff_id') clear('time');
        if (k === 'date') clear('time');
      }
      if (body.text) {
        const t = body.text;
        const svc = pick(t, m.services);
        const who = pick(t, m.staff);
        const day = parseDay(t, today);
        const time = parseTime(t);
        const phoneish = parsePhoneish(t);
        const missing = nextField(st);
        let used = false;
        if (svc && svc.id !== st.service_id) (st.service_id = svc.id), clear('time'), (used = true);
        if (who) (st.staff_id = who.id), clear('time'), (used = true);
        else if (anyone(t)) (st.staff_id = 'any'), (used = true);
        if (day) (st.date = day), (used = true);
        if (time) (st.time = time), (used = true);
        if (missing === 'phone' && phoneish) (st.phone = phoneish), (used = true);
        if (!used && missing === 'name' && t.length >= 2 && t.length <= 80 && !/\d{3,}/.test(t)) (st.name = t), (used = true);
        if (!used && missing === 'phone') (st.phone = t), (used = true);
        if (!used) notes.push(say(l, 'notUnderstood'));
      }

      // Check what we have against the menu and the calendar, from the top.
      const service = m.services.find((s) => s.id === st.service_id) ?? null;
      if (!service) clear('service_id', 'time');
      const staff = st.staff_id && st.staff_id !== 'any' ? m.staff.find((s) => s.id === st.staff_id) ?? null : null;
      if (st.staff_id && st.staff_id !== 'any' && !staff) clear('staff_id', 'time');
      // One person on the team: nobody to choose between.
      if (service && !st.staff_id && m.staff.length === 1) {
        st.staff_id = m.staff[0].id;
        notes.push(say(l, 'staffOne', { name: m.staff[0].name, service: service.name.toLocaleLowerCase(l) }));
      }
      const staffId = st.staff_id && st.staff_id !== 'any' ? st.staff_id : null;
      if (st.date) {
        const d = DateTime.fromISO(st.date, { zone: shop.timezone });
        if (!d.isValid || d < today || d > today.plus({ days: DAYS_AHEAD })) clear('date', 'time');
      }

      let options: AgentOption[] = [];
      let input: 'text' | 'phone' | null = null;
      let booked: Booked | null = null;
      const who = staff?.name ?? (m.staff.length === 1 ? m.staff[0].name : say(l, 'anyoneShort'));
      // "Bugün", "Yarın" in the middle of a sentence are lower case; weekday labels keep their capital in English.
      const mid = (label: string) => (label === say(l, 'today') || label === say(l, 'tomorrow') ? label.toLocaleLowerCase(l) : label);

      const timeOptions = (slots: Slot[]) =>
        spread(slots).map((s) => ({ label: s.time, set: { time: s.time, ...(staffId ? {} : { staff_id: s.staff_id }) }, hint: staffId ? undefined : s.staff_name }));

      if (service && st.staff_id && st.date) {
        const a = await freeSlots(ctx.db, shop.id, { date: st.date, serviceId: service.id, staffId, near: st.time ?? null, now: ctx.now, online: true });
        const label = dayLabel(l, st.date, today);
        if (!a.hours) {
          notes.push(say(l, 'closed', { day: label }));
          clear('date', 'time');
        } else if (!a.slots.length && !st.time) {
          notes.push(say(l, 'full', { day: label }));
          clear('date', 'time');
        } else if (st.time && a.taken) {
          const why = a.reason === 'past' ? 'past' : a.reason === 'closed' ? 'outside' : 'taken';
          expecting = 'time';
          // The times nearest the one asked for, not the whole day.
          const near = await freeSlots(ctx.db, shop.id, { date: st.date, serviceId: service.id, staffId, near: st.time, now: ctx.now, online: true, count: 6 });
          options = timeOptions(near.slots);
          notes.push(say(l, why, { time: st.time, from: a.hours.from, to: a.hours.to }));
          clear('time');
        } else if (st.time && !staffId) {
          // "Anyone": the time now belongs to whoever has it free.
          const s = a.slots.find((x) => x.time === st.time);
          if (s) st.staff_id = s.staff_id;
        }
      }

      if (!expecting) expecting = nextField(st);
      const realStaff = st.staff_id && st.staff_id !== 'any' ? m.staff.find((s) => s.id === st.staff_id) : null;

      if (body.set?.confirm === true && expecting === 'confirm' && service && realStaff && st.date && st.time && st.name && st.phone) {
        if (body.website) {
          expecting = 'done';
        } else {
          try {
            booked = await bookOnline(ctx, shop, { service_id: service.id, staff_id: realStaff.id, date: st.date, time: st.time, name: st.name, phone: st.phone, consent: !!st.consent, lang: l });
            expecting = 'done';
          } catch (e: any) {
            if (e?.code === 'SLOT_TAKEN') {
              notes.push(say(l, 'gone'));
              clear('time');
              expecting = 'time';
            } else if (e?.code === 'BAD_PHONE') {
              notes.push(say(l, 'phoneBad', { example: PHONE_EXAMPLE[shop.country] ?? '+1 415 555 0142' }));
              clear('phone');
              expecting = 'phone';
            } else if (e?.code === 'TOO_MANY_BOOKINGS') {
              notes.push(say(l, 'tooMany'));
              expecting = 'done';
            } else throw e;
          }
        }
      } else if (body.set?.confirm === false) {
        clear('time');
        expecting = 'time';
      }
      if (expecting === 'phone' && st.phone && !toE164(st.phone, shop.country)) {
        notes.push(say(l, 'phoneBad', { example: PHONE_EXAMPLE[shop.country] ?? '+1 415 555 0142' }));
        clear('phone');
      }

      let question = '';
      switch (expecting) {
        case 'service':
          question = body.text || body.set ? say(l, 'service') : say(l, 'hello', { shop: shop.name });
          options = m.services.map((s) => ({ label: s.name, set: { service_id: s.id }, hint: `${money(s.price_cents, shop.currency, l)} · ${s.duration_min} ${say(l, 'minutes')}` }));
          break;
        case 'staff':
          question = say(l, 'staff', { service: service!.name.toLocaleLowerCase(l), n: m.staff.length });
          options = [...m.staff.map((s) => ({ label: s.name, set: { staff_id: s.id }, hint: s.title ?? undefined })), { label: say(l, 'anyone'), set: { staff_id: 'any' } }];
          break;
        case 'date': {
          const days = await freeDays(ctx, shop, service!.id, staffId);
          if (!days.length) {
            question = say(l, 'dayNone', { who });
            options = m.staff.length > 1 ? [{ label: say(l, 'anyone'), set: { staff_id: 'any' } }] : [];
          } else {
            question = say(l, 'day');
            options = days.map((d) => ({ label: dayLabel(l, d.date, today), set: { date: d.date }, hint: d.slots[0].time }));
          }
          break;
        }
        case 'time': {
          if (!options.length) {
            const a = await freeSlots(ctx.db, shop.id, { date: st.date!, serviceId: service!.id, staffId, now: ctx.now, online: true });
            options = timeOptions(a.slots);
          }
          question = notes.some((n) => n.endsWith(':')) ? '' : say(l, 'time', { day: dayLabel(l, st.date!, today) });
          break;
        }
        case 'name':
          question = say(l, 'name');
          input = 'text';
          break;
        case 'phone':
          question = say(l, 'phone');
          input = 'phone';
          break;
        case 'confirm':
          question = say(l, 'confirm', {
            service: service!.name,
            staff: realStaff?.name ?? who,
            day: mid(dayLabel(l, st.date!, today)),
            time: st.time!,
            price: money(service!.price_cents, shop.currency, l),
          });
          options = [
            { label: say(l, 'yes'), set: { confirm: true } },
            { label: say(l, 'change'), set: { confirm: false } },
          ];
          break;
        case 'done':
          if (booked)
            question =
              say(l, 'done', { name: st.name!.split(' ')[0], day: mid(dayLabel(l, booked.date, today)), time: booked.time, staff: booked.staff_name }) +
              (st.consent ? say(l, 'doneReminder') : '');
          break;
      }
      const text = [...notes, question].filter(Boolean).join(' ');
      return {
        // A sentence starts with a capital, even when it starts with a service name ("Saç kesimi için…").
        say: text.charAt(0).toLocaleUpperCase(l) + text.slice(1),
        options,
        input,
        step: expecting,
        state: st,
        booked,
      };
    },
  },
];

/** The first thing still missing, in the order a person at the counter would ask. */
function nextField(st: AgentState): Field {
  if (!st.service_id) return 'service';
  if (!st.staff_id) return 'staff';
  if (!st.date) return 'date';
  if (!st.time) return 'time';
  if (!st.name) return 'name';
  if (!st.phone) return 'phone';
  return 'confirm';
}

export { bookOnline };
