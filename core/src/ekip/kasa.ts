import { DateTime } from 'luxon';
import type { Queryable } from '../db';
import { badRequest, notFound } from '../http';
import { recordVoid, type VoidReason } from '../voids';

// The till. Every payment is a sale: lines (services, products, anything else), each done by a person,
// a tip for the person who rang it up, and how it was paid. The shop's books are written from the sales:
// a chair renter's takings are their own money, so they never become the shop's income.

export type Method = 'cash' | 'card' | 'other';

export interface Line {
  kind: 'service' | 'product' | 'other';
  ref_id?: string | null;
  name: string;
  unit_cents: number;
  qty: number;
  staff_id?: string | null;
}

export interface SaleInput {
  staff_id: string | null;
  appointment_id?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  method: Method;
  tip_cents: number;
  lines: Line[];
  sold_at: Date;
  note?: string | null;
}

/** The team member behind a login, when there is one (staff always; an owner who also works the floor). */
export async function staffOf(db: Queryable, shopId: string, userId: string): Promise<string | null> {
  if (!userId) return null;
  return (await db.query('select id from barbers where shop_id = $1 and user_id = $2', [shopId, userId])).rows[0]?.id ?? null;
}

/** Writes (or rewrites) a sale and its lines, then the books. Returns the sale id. */
export async function saveSale(db: Queryable, shopId: string, userId: string | null, input: SaleInput, existingId?: string | null): Promise<string> {
  if (!input.lines.length) throw badRequest('A sale needs at least one line', 'EMPTY_SALE');
  const tz = (await db.query('select timezone from shops where id = $1', [shopId])).rows[0].timezone;
  const soldOn = DateTime.fromJSDate(input.sold_at, { zone: tz }).toISODate();
  const subtotal = input.lines.reduce((s, l) => s + l.unit_cents * l.qty, 0);
  const total = subtotal + input.tip_cents;
  let id = existingId ?? null;
  if (id) {
    await restock(db, shopId, id, +1);
    await db.query('delete from sale_items where sale_id = $1 and shop_id = $2', [id, shopId]);
    await db.query(
      `update sales set staff_id = $3, client_id = $4, client_name = $5, method = $6, subtotal_cents = $7, tip_cents = $8,
              total_cents = $9, sold_on = $10, sold_at = $11, note = $12 where id = $1 and shop_id = $2`,
      [id, shopId, input.staff_id, input.client_id ?? null, input.client_name ?? null, input.method, subtotal, input.tip_cents, total, soldOn, input.sold_at, input.note ?? null],
    );
  } else {
    id = (
      await db.query(
        `insert into sales (shop_id, staff_id, appointment_id, client_id, client_name, method, subtotal_cents, tip_cents, total_cents, sold_on, sold_at, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
        [shopId, input.staff_id, input.appointment_id ?? null, input.client_id ?? null, input.client_name ?? null, input.method, subtotal, input.tip_cents, total, soldOn, input.sold_at, input.note ?? null, userId],
      )
    ).rows[0].id as string;
  }
  for (const l of input.lines)
    await db.query(
      `insert into sale_items (shop_id, sale_id, kind, ref_id, name, unit_cents, qty, staff_id) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [shopId, id, l.kind, l.ref_id ?? null, l.name.slice(0, 80), l.unit_cents, l.qty, l.staff_id ?? input.staff_id],
    );
  await restock(db, shopId, id, -1);
  await writeBooks(db, shopId, id!, userId);
  return id!;
}

/** Products sold leave the shelf; a voided or rewritten sale puts them back. */
async function restock(db: Queryable, shopId: string, saleId: string, sign: 1 | -1) {
  await db.query(
    `update products p set stock = p.stock + $3 * i.qty
       from (select ref_id, sum(qty)::int as qty from sale_items where sale_id = $1 and shop_id = $2 and kind = 'product' and ref_id is not null group by ref_id) i
      where p.id = i.ref_id and p.shop_id = $2 and p.stock is not null`,
    [saleId, shopId, sign],
  );
}

const CAT = { service: 'service', product: 'product', other: 'other' } as const;

/**
 * One book row per kind of takings (services, products, other, tips). A chair renter's lines and tips are
 * left out: that money is theirs, and the shop's income from them is the rent. A sale for an appointment
 * carries the appointment on its service row, so undoing the visit takes the income away with it.
 */
export async function writeBooks(db: Queryable, shopId: string, saleId: string, userId: string | null) {
  await db.query('delete from book_entries where sale_id = $1 and shop_id = $2', [saleId, shopId]);
  const sale = (
    await db.query(
      `select s.*, b.name as staff_name, b.pay_model from sales s left join barbers b on b.id = s.staff_id where s.id = $1 and s.shop_id = $2`,
      [saleId, shopId],
    )
  ).rows[0];
  if (!sale) return;
  if (sale.appointment_id) await db.query('delete from book_entries where appointment_id = $1 and shop_id = $2', [sale.appointment_id, shopId]);
  const items = (
    await db.query(
      `select i.kind, i.name, i.unit_cents * i.qty as cents, coalesce(b.pay_model, 'commission') as pay_model
         from sale_items i left join barbers b on b.id = i.staff_id where i.sale_id = $1 and i.shop_id = $2`,
      [saleId, shopId],
    )
  ).rows as { kind: keyof typeof CAT; name: string; cents: number; pay_model: string }[];
  const sums = new Map<string, { cents: number; names: string[] }>();
  for (const i of items) {
    if (i.pay_model === 'booth_rent') continue;
    const k = CAT[i.kind];
    const e = sums.get(k) ?? { cents: 0, names: [] };
    e.cents += Number(i.cents);
    e.names.push(i.name);
    sums.set(k, e);
  }
  if (sale.tip_cents > 0 && sale.pay_model !== 'booth_rent') sums.set('tips', { cents: sale.tip_cents, names: [] });
  const who = [sale.client_name, sale.staff_name].filter(Boolean).join(' · ');
  for (const [category, e] of sums) {
    if (e.cents <= 0) continue;
    const note = [e.names.slice(0, 3).join(', '), who].filter(Boolean).join(' · ').slice(0, 200) || null;
    await db.query(
      `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, source, sale_id, appointment_id, created_by)
       values ($1, 'income', $2, $3, $4, $5, 'sale', $6, $7, $8)`,
      [shopId, category, e.cents, sale.sold_on, note, saleId, category === 'service' ? sale.appointment_id : null, userId],
    );
  }
}

/**
 * Writes the voids row for a sale that is about to go: what it was (amount, client, who did it, when it was
 * paid) and why. The caller then removes the sale. Returns the sale, or null when there is none.
 */
export async function recordSaleVoid(
  db: Queryable,
  v: { shopId: string; userId: string | null; saleId: string; reason: VoidReason; note?: string | null; now: Date },
) {
  const s = (
    await db.query(
      `select s.id, s.appointment_id, s.total_cents, s.sold_at, coalesce(s.client_name, c.name) as client_name, b.name as staff_name
         from sales s left join barbers b on b.id = s.staff_id left join clients c on c.id = s.client_id
        where s.id = $1 and s.shop_id = $2`,
      [v.saleId, v.shopId],
    )
  ).rows[0];
  if (!s) return null;
  await recordVoid(db, {
    shopId: v.shopId,
    userId: v.userId,
    kind: 'sale',
    refId: s.id,
    reason: v.reason,
    note: v.note,
    amountCents: s.total_cents,
    clientName: s.client_name,
    staffName: s.staff_name,
    happenedAt: s.sold_at,
    at: v.now,
  });
  return s as { id: string; appointment_id: string | null };
}

/**
 * Keeps a visit's sale in step with the visit: done → a sale for the service (kept if one exists, with the
 * service line brought up to date); anything else → no sale and no income. Called on a change of status
 * only: a paid visit that is moved keeps its receipt, and undoing a paid visit is a void (recordSaleVoid).
 */
export async function syncVisitSale(db: Queryable, shopId: string, userId: string | null, appointmentId: string, isDone: boolean) {
  const existing = (await db.query('select id, method, tip_cents, note from sales where appointment_id = $1 and shop_id = $2', [appointmentId, shopId])).rows[0];
  if (!isDone) {
    if (existing) {
      await restock(db, shopId, existing.id, +1);
      await db.query('delete from sales where id = $1 and shop_id = $2', [existing.id, shopId]);
    }
    await db.query('delete from book_entries where appointment_id = $1 and shop_id = $2', [appointmentId, shopId]);
    return null;
  }
  const a = (
    await db.query(
      `select a.barber_id, a.client_id, a.service_id, a.starts_at, a.price_cents_snapshot, s.name as service_name, c.name as client_name
         from appointments a join services s on s.id = a.service_id join clients c on c.id = a.client_id
        where a.id = $1 and a.shop_id = $2`,
      [appointmentId, shopId],
    )
  ).rows[0];
  if (!a) throw notFound('Appointment');
  const service: Line = { kind: 'service', ref_id: a.service_id, name: a.service_name, unit_cents: a.price_cents_snapshot, qty: 1, staff_id: a.barber_id };
  // Products and extra lines added at checkout stay; the service line follows the appointment.
  const extra = existing
    ? ((await db.query(`select kind, ref_id, name, unit_cents, qty, staff_id from sale_items where sale_id = $1 and shop_id = $2 and kind <> 'service'`, [existing.id, shopId])).rows as Line[])
    : [];
  return saveSale(
    db,
    shopId,
    userId,
    {
      staff_id: a.barber_id,
      appointment_id: appointmentId,
      client_id: a.client_id,
      client_name: a.client_name,
      method: existing?.method ?? 'other',
      tip_cents: existing?.tip_cents ?? 0,
      lines: [service, ...extra],
      sold_at: new Date(a.starts_at),
      note: existing?.note ?? null,
    },
    existing?.id,
  );
}

export interface PayRow {
  staff_id: string;
  name: string;
  title: string | null;
  pay_model: 'commission' | 'booth_rent' | 'salary';
  /** The shop owner's own place on the team. */
  is_owner: boolean;
  service_pct: number;
  product_pct: number;
  /** What the person sold: their lines, at full price (gross). */
  service_cents: number;
  product_cents: number;
  other_cents: number;
  gross_cents: number;
  tips_cents: number;
  /** Jobs done: services rung up (or visits done, whichever is more). */
  visits: number;
  missed: number;
  /** Their share of the takings under their deal. */
  commission_cents: number;
  /** Salary for the days in the period (monthly salary, pro rata). */
  salary_cents: number;
  /** What the shop owes them for the period: commission + salary + tips. Chair renters: nothing. */
  owed_cents: number;
  /** Chair rent for the period (pro rata), owed by a renter to the shop. */
  rent_cents: number;
  /** What the shop keeps from this person's work: takings less what it owes them; for a renter, the rent. */
  shop_cents: number;
  paid_cents: number;
  rent_paid_cents: number;
}

const MONTH_DAYS = 30.44;

/** Who sold what in [from, to] (dates inclusive) and what each person is owed under their deal. */
export async function payReport(db: Queryable, shopId: string, from: string, to: string, onlyStaff?: string | null): Promise<PayRow[]> {
  const days = Math.round(DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days) + 1;
  const { rows } = await db.query(
    `select b.id as staff_id, b.name, b.title, b.pay_model, b.service_pct, b.product_pct, b.salary_cents as salary_m, b.rent_cents as rent, b.rent_period,
            (b.user_id is not null and b.user_id = sh0.owner_user_id) as is_owner, coalesce(l.jobs, 0)::int as jobs,
            coalesce(l.service, 0)::int8 as service_cents, coalesce(l.product, 0)::int8 as product_cents, coalesce(l.other, 0)::int8 as other_cents,
            coalesce(t.tips, 0)::int8 as tips_cents,
            coalesce(v.done, 0)::int as visits, coalesce(v.missed, 0)::int as missed,
            coalesce(p.paid, 0)::int8 as paid_cents, coalesce(p.rent_paid, 0)::int8 as rent_paid_cents
       from barbers b
       join shops sh0 on sh0.id = b.shop_id
       left join lateral (
         select sum(i.unit_cents * i.qty) filter (where i.kind = 'service') as service,
                sum(i.unit_cents * i.qty) filter (where i.kind = 'product') as product,
                sum(i.unit_cents * i.qty) filter (where i.kind = 'other') as other,
                sum(i.qty) filter (where i.kind = 'service') as jobs
           from sale_items i join sales s on s.id = i.sale_id
          where i.shop_id = b.shop_id and i.staff_id = b.id and s.sold_on between $2 and $3) l on true
       left join lateral (
         select sum(s.tip_cents) as tips from sales s where s.shop_id = b.shop_id and s.staff_id = b.id and s.sold_on between $2 and $3) t on true
       left join lateral (
         select count(*) filter (where a.status = 'done') as done, count(*) filter (where a.status = 'missed') as missed
           from appointments a join shops sh on sh.id = a.shop_id
          where a.shop_id = b.shop_id and a.barber_id = b.id
            and (a.starts_at at time zone sh.timezone)::date between $2 and $3) v on true
       left join lateral (
         select sum(amount_cents) filter (where kind = 'pay') as paid, sum(amount_cents) filter (where kind = 'rent') as rent_paid
           from staff_payouts x where x.shop_id = b.shop_id and x.staff_id = b.id and x.period_from <= $3 and x.period_to >= $2) p on true
      where b.shop_id = $1 and ($4::uuid is null or b.id = $4)
        and (b.active or l.service is not null or l.product is not null or l.other is not null)
      order by (b.user_id is not null and b.user_id = sh0.owner_user_id) desc, b.created_at, b.name`,
    [shopId, from, to, onlyStaff ?? null],
  );
  return rows.map((r: any) => {
    const service = Number(r.service_cents);
    const product = Number(r.product_cents);
    const other = Number(r.other_cents);
    const gross = service + product + other;
    const tips = Number(r.tips_cents);
    const renter = r.pay_model === 'booth_rent' && !r.is_owner;
    // The owner working the floor keeps what they take: no deal, nothing to settle.
    const commission = renter || r.is_owner ? 0 : Math.round((service + other) * (r.service_pct / 100) + product * (r.product_pct / 100));
    const salary = r.pay_model === 'salary' && !r.is_owner ? Math.round((r.salary_m * days) / MONTH_DAYS) : 0;
    const rent = renter ? Math.round(r.rent_period === 'week' ? (r.rent * days) / 7 : (r.rent * days) / MONTH_DAYS) : 0;
    const owed = renter || r.is_owner ? 0 : commission + salary + tips;
    return {
      staff_id: r.staff_id,
      name: r.name,
      title: r.title,
      pay_model: r.pay_model,
      is_owner: !!r.is_owner,
      service_pct: r.service_pct,
      product_pct: r.product_pct,
      service_cents: service,
      product_cents: product,
      other_cents: other,
      gross_cents: gross,
      tips_cents: tips,
      visits: Math.max(r.visits, r.jobs),
      missed: r.missed,
      commission_cents: commission,
      salary_cents: salary,
      owed_cents: owed,
      rent_cents: rent,
      shop_cents: renter ? rent : gross - commission - salary,
      paid_cents: Number(r.paid_cents),
      rent_paid_cents: Number(r.rent_paid_cents),
    };
  });
}

/**
 * Done visits without a sale become sales (sample shops, imports): the service line, done by the person
 * who had the visit, and the visit's income row joined to it.
 */
export async function salesFromVisits(db: Queryable, shopId: string, method: (i: number) => Method = () => 'other') {
  const { rows } = await db.query(
    `select a.id, a.barber_id, a.client_id, a.service_id, a.starts_at, a.price_cents_snapshot, c.name as client_name, sv.name as service_name
       from appointments a join clients c on c.id = a.client_id join services sv on sv.id = a.service_id
      where a.shop_id = $1 and a.status = 'done' and not exists (select 1 from sales x where x.appointment_id = a.id)
      order by a.starts_at`,
    [shopId],
  );
  let i = 0;
  for (const a of rows)
    await saveSale(db, shopId, null, {
      staff_id: a.barber_id,
      appointment_id: a.id,
      client_id: a.client_id,
      client_name: a.client_name,
      method: method(i++),
      tip_cents: 0,
      lines: [{ kind: 'service', ref_id: a.service_id, name: a.service_name, unit_cents: a.price_cents_snapshot, qty: 1, staff_id: a.barber_id }],
      sold_at: new Date(a.starts_at),
    });
  return rows.length;
}
