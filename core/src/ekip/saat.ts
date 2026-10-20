import { DateTime } from 'luxon';
import type { Queryable } from '../db';

// When work can happen: the shop's opening hours, who works which days, and which chair or room is free.
// One engine answers both the owner ("that time is taken, 15:30 or 16:00?") and the public booking page.

export const STATION_KINDS = ['chair', 'room', 'bed', 'table', 'other'] as const;
export type StationKind = (typeof STATION_KINDS)[number];

/** ISO weekday ("1" = Monday) → [open, close], or null when closed. */
export type Hours = Record<string, [string, string] | null>;

/** Shops that have not set hours yet: every day 09:00–20:00, as before hours existed. */
export const DEFAULT_HOURS: Hours = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), ['09:00', '20:00']])) as Hours;

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Opening and closing minute of a day, or null when the shop is closed that day. */
export function openOn(hours: Hours | null | undefined, weekday: number): [number, number] | null {
  const h = (hours ?? DEFAULT_HOURS)[String(weekday)];
  if (!h) return null;
  const [a, b] = [toMin(h[0]), toMin(h[1])];
  return b > a ? [a, b] : null;
}

export interface Staff {
  id: string;
  name: string;
  title: string | null;
  station_id: string | null;
  work_days: number[];
}

export interface Slot {
  time: string;
  staff_id: string;
  staff_name: string;
  station_id: string | null;
  station_name: string | null;
}

export interface SlotAnswer {
  date: string;
  /** null when the shop is closed that day. */
  hours: { from: string; to: string } | null;
  slots: Slot[];
  /** Why the time asked about cannot be had: past, outside the hours, or everyone (or every station) busy. */
  taken: boolean;
  reason: 'past' | 'closed' | 'busy' | null;
}

interface Busy {
  staff: string;
  station: string | null;
  a: number;
  b: number;
}

/**
 * Free start times for a service on a day. A slot needs a person who works that weekday and has nothing
 * on, and, when the service needs a station kind (a chair, a massage room), a free station of that kind:
 * the person's own station first, any other of the kind next. With no person named, the one with the
 * fewest bookings that day takes it, so "anyone" spreads the work instead of loading the first name.
 */
export async function freeSlots(
  db: Queryable,
  shopId: string,
  q: {
    date: string;
    serviceId: string;
    staffId?: string | null;
    near?: string | null;
    now: Date;
    count?: number;
    /** Public booking: only people and services shown online, and not within the next hour. */
    online?: boolean;
    /** The owner booking by hand may book outside the hours; the public page may not. */
    keepHours?: boolean;
    exceptAppointment?: string | null;
  },
): Promise<SlotAnswer> {
  const shop = (await db.query('select timezone, hours from shops where id = $1', [shopId])).rows[0];
  const tz: string = shop.timezone;
  const service = (await db.query('select duration_min, station_kind, online from services where id = $1 and shop_id = $2 and active', [q.serviceId, shopId])).rows[0];
  const day = DateTime.fromISO(q.date, { zone: tz }).startOf('day');
  const empty: SlotAnswer = { date: q.date, hours: null, slots: [], taken: !!q.near, reason: q.near ? 'closed' : null };
  if (!service || (q.online && !service.online)) return empty;
  const minutes = Number(service.duration_min) || 30;
  const open = openOn(shop.hours, day.weekday);
  if (!open && (q.keepHours ?? true)) return empty;
  const [from, to] = open ?? [9 * 60, 20 * 60];

  const staff = (
    await db.query(
      `select id, name, title, station_id, work_days from barbers
        where shop_id = $1 and active and ($2::boolean is not true or online) order by created_at, name`,
      [shopId, q.online ?? false],
    )
  ).rows as Staff[];
  const pool = staff.filter((s) => (!q.staffId || s.id === q.staffId) && (!(q.keepHours ?? true) || (s.work_days ?? []).includes(day.weekday)));
  const kind: StationKind | null = service.station_kind ?? null;
  const stations = kind
    ? ((await db.query('select id, name from stations where shop_id = $1 and active and kind = $2 order by sort, name', [shopId, kind])).rows as { id: string; name: string }[])
    : [];

  const busy: Busy[] = (
    await db.query(
      `select barber_id, station_id, starts_at, ends_at from appointments
        where shop_id = $1 and status in ('booked', 'done') and starts_at < $3 and ends_at > $2 and ($4::uuid is null or id <> $4)`,
      [shopId, day.toJSDate(), day.plus({ days: 1 }).toJSDate(), q.exceptAppointment ?? null],
    )
  ).rows.map((r: any) => ({ staff: r.barber_id, station: r.station_id, a: new Date(r.starts_at).getTime(), b: new Date(r.ends_at).getTime() }));
  const load = new Map<string, number>();
  for (const x of busy) load.set(x.staff, (load.get(x.staff) ?? 0) + 1);
  // "Anyone": the least booked person first; a named person is the only one tried.
  const order = [...pool].sort((x, y) => (load.get(x.id) ?? 0) - (load.get(y.id) ?? 0));

  const lead = q.online ? 60 : 15;
  const earliest = q.now.getTime() + lead * 60_000;
  const nearMin = q.near ? toMin(q.near) : from;
  const out: (Slot & { distance: number })[] = [];
  for (let m = from; m + minutes <= to; m += 15) {
    const a = day.plus({ minutes: m }).toMillis();
    const b = a + minutes * 60_000;
    if (a < earliest) continue;
    const pick = pickFor(order, stations, kind, busy, a, b);
    if (pick) out.push({ time: fromMin(m), ...pick, distance: Math.abs(m - nearMin) });
  }
  out.sort((x, y) => x.distance - y.distance || x.time.localeCompare(y.time));
  const taken = q.near ? !out.some((o) => o.time === q.near) : false;
  const nearAt = day.plus({ minutes: nearMin }).toMillis();
  const reason: SlotAnswer['reason'] = !taken ? null : nearAt < earliest ? 'past' : nearMin < from || nearMin + minutes > to ? 'closed' : 'busy';
  const count = q.count ?? 200;
  const picked = q.near ? out.slice(0, count) : out.sort((x, y) => x.time.localeCompare(y.time)).slice(0, count);
  return {
    date: q.date,
    hours: { from: fromMin(from), to: fromMin(to) },
    slots: picked.sort((x, y) => x.time.localeCompare(y.time)).map(({ distance, ...s }) => s),
    taken,
    reason,
  };
}

function pickFor(order: Staff[], stations: { id: string; name: string }[], kind: StationKind | null, busy: Busy[], a: number, b: number) {
  for (const s of order) {
    if (busy.some((x) => x.staff === s.id && x.a < b && x.b > a)) continue;
    if (!kind) return { staff_id: s.id, staff_name: s.name, station_id: null, station_name: null };
    const free = stations.filter((st) => !busy.some((x) => x.station === st.id && x.a < b && x.b > a));
    const st = free.find((f) => f.id === s.station_id) ?? free[0];
    if (st) return { staff_id: s.id, staff_name: s.name, station_id: st.id, station_name: st.name };
  }
  return null;
}

/**
 * The station for an appointment booked by hand: the one asked for, else the person's own if free, else
 * any free one of the kind the service needs. No kind needed: no station. Throws nothing; null = none free.
 */
export async function stationFor(
  db: Queryable,
  shopId: string,
  o: { serviceId: string; staffId: string; starts: Date; ends: Date; wanted?: string | null; exceptAppointment?: string | null },
): Promise<{ needed: boolean; id: string | null }> {
  const service = (await db.query('select station_kind from services where id = $1 and shop_id = $2', [o.serviceId, shopId])).rows[0];
  const kind = service?.station_kind ?? null;
  if (!kind && !o.wanted) return { needed: false, id: null };
  const rows = (
    await db.query(
      `select s.id, s.kind,
              exists (select 1 from appointments a where a.shop_id = s.shop_id and a.station_id = s.id and a.status in ('booked', 'done')
                       and a.starts_at < $4 and a.ends_at > $3 and ($5::uuid is null or a.id <> $5)) as busy
         from stations s where s.shop_id = $1 and s.active and ($2::text is null or s.kind = $2)
        order by s.sort, s.name`,
      [shopId, o.wanted ? null : kind, o.starts, o.ends, o.exceptAppointment ?? null],
    )
  ).rows as { id: string; kind: string; busy: boolean }[];
  if (o.wanted) {
    const w = rows.find((r) => r.id === o.wanted);
    return { needed: true, id: w && !w.busy ? w.id : null };
  }
  if (!rows.length) return { needed: false, id: null }; // the kind is set but the shop has no such station yet
  const home = (await db.query('select station_id from barbers where id = $1 and shop_id = $2', [o.staffId, shopId])).rows[0]?.station_id;
  const free = rows.filter((r) => !r.busy);
  return { needed: true, id: (free.find((r) => r.id === home) ?? free[0])?.id ?? null };
}
