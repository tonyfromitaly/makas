import { DateTime } from 'luxon';
import type { Queryable } from '../db';

/**
 * A compact, SQL-computed picture of the shop for open questions ("why are clients dropping?").
 * The chat model may only quote these numbers; it never computes its own.
 */
export async function shopSnapshot(db: Queryable, shopId: string, now: DateTime) {
  const one = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows[0];
  const all = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows;
  const month = now.startOf('month');
  const last = month.minus({ months: 1 });
  const books = async (from: DateTime, to: DateTime) => {
    const r = await one(
      `select coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int8 as income,
              coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int8 as expense
         from book_entries where shop_id = $1 and entry_date between $2 and $3`,
      [shopId, from.toISODate(), to.toISODate()],
    );
    return { income_cents: Number(r.income), expense_cents: Number(r.expense), net_cents: Number(r.income) - Number(r.expense) };
  };
  const since60 = now.minus({ days: 60 }).toJSDate();
  const visits = await one(
    `select count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'missed')::int as missed,
            coalesce(avg(price_cents_snapshot) filter (where status = 'done'), 0)::int as avg_ticket
       from appointments where shop_id = $1 and starts_at >= $2 and starts_at < $3`,
    [shopId, since60, now.toJSDate()],
  );
  const busiest = await all(
    `select extract(isodow from entry_date)::int as weekday, round(avg(day_total))::int8 as avg_income_cents from (
       select entry_date, sum(amount_cents) as day_total from book_entries
        where shop_id = $1 and kind = 'income' and entry_date >= $2 group by entry_date) d
      group by 1 order by 2 desc`,
    [shopId, now.minus({ days: 60 }).toISODate()],
  );
  const lapsed = await one(
    `select count(*)::int as n from clients c where c.shop_id = $1
        and exists (select 1 from appointments a where a.client_id = c.id and a.status = 'done')
        and not exists (select 1 from appointments a where a.client_id = c.id and (a.status = 'booked' and a.starts_at > $2 or a.status = 'done' and a.starts_at > $3))`,
    [shopId, now.toJSDate(), now.minus({ days: 42 }).toJSDate()],
  );
  const clients = await one(`select count(*)::int as n, count(*) filter (where consent_status = 'granted')::int as reachable from clients where shop_id = $1`, [shopId]);
  const topServices = await all(
    `select s.name, count(*)::int as visits from appointments a join services s on s.id = a.service_id
      where a.shop_id = $1 and a.status = 'done' and a.starts_at >= $2 group by s.name order by visits desc limit 3`,
    [shopId, since60],
  );
  const receivable = await one(
    `select coalesce(sum(b), 0)::int8 as t from (select sum(case when kind = 'charge' then amount_cents else -amount_cents end) as b
       from ledger_entries where shop_id = $1 group by client_id) s where b > 0`,
    [shopId],
  );
  const payable = await one(
    `select coalesce(sum(amount_cents), 0)::int8 as t, count(*)::int as n from shop_tasks
      where shop_id = $1 and kind = 'payment' and status = 'open' and due_date <= $2`,
    [shopId, now.endOf('month').toISODate()],
  );
  const upcoming = await one(
    `select count(*)::int as n from appointments where shop_id = $1 and status = 'booked' and starts_at between $2 and $3`,
    [shopId, now.toJSDate(), now.plus({ days: 7 }).toJSDate()],
  );
  const doneMissed = visits.done + visits.missed;
  return {
    today: now.toISODate(),
    this_month_so_far: await books(month, now),
    last_month: await books(last, month.minus({ days: 1 })),
    last_60_days: {
      finished_visits: visits.done,
      no_shows: visits.missed,
      no_show_rate_pct: doneMissed ? Math.round((visits.missed / doneMissed) * 100) : 0,
      average_ticket_cents: visits.avg_ticket,
      top_services: topServices,
      income_by_weekday: busiest.map((b: any) => ({ weekday: b.weekday, avg_income_cents: Number(b.avg_income_cents) })),
    },
    clients_total: clients.n,
    clients_reachable_by_message: clients.reachable,
    lapsed_clients_6_weeks: lapsed.n,
    receivables_cents: Number(receivable.t),
    payables_this_month: { total_cents: Number(payable.t), items: payable.n },
    booked_next_7_days: upcoming.n,
  };
}

export type ShopSnapshot = Awaited<ReturnType<typeof shopSnapshot>>;
