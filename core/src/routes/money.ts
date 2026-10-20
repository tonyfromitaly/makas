import { z } from 'zod';
import { DateTime } from 'luxon';
import { ApiError, conflict, isoDate, noContent, notFound, ok, pageQuery, paged, positiveCents, uuid, type Ctx, type Route } from '../http';
import { CATEGORIES, parseNotesLocal, type NoteDraft } from '../parse/note';
import { shopTz } from './appointments';

const category = z.enum(CATEGORIES as [string, ...string[]]);

async function clientBalance(ctx: Ctx, clientId: string) {
  const r = (
    await ctx.db.query(
      `select coalesce(sum(case when kind = 'charge' then amount_cents else -amount_cents end), 0)::int8 as balance
         from ledger_entries where shop_id = $1 and client_id = $2`,
      [ctx.shopId, clientId],
    )
  ).rows[0];
  return Number(r.balance);
}

async function assertClient(ctx: Ctx, id: string) {
  const c = (await ctx.db.query('select id, name from clients where id = $1 and shop_id = $2', [id, ctx.shopId])).rows[0];
  if (!c) throw notFound('Client');
  return c;
}

/** Period bounds in the shop's calendar. Weeks start on Monday. */
export function periodBounds(period: 'day' | 'week' | 'month', date: DateTime) {
  const from = date.startOf(period === 'week' ? 'week' : period);
  const to = from.plus(period === 'day' ? { days: 1 } : period === 'week' ? { weeks: 1 } : { months: 1 }).minus({ days: 1 });
  const prevFrom = from.minus(period === 'day' ? { days: 1 } : period === 'week' ? { weeks: 1 } : { months: 1 });
  return { from: from.toISODate()!, to: to.toISODate()!, prevFrom: prevFrom.toISODate()!, prevTo: from.minus({ days: 1 }).toISODate()! };
}

const draftSchema = z.object({
  kind: z.enum(['income', 'expense']),
  amount_cents: positiveCents,
  category,
  entry_date: isoDate,
  note: z.string().max(200).default(''),
});

export const moneyRoutes: Route[] = [
  // --- client debt book (veresiye) ---
  {
    method: 'GET',
    path: '/ledger',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    query: pageQuery.extend({ client_id: uuid.optional() }),
    async handler(ctx, { query }) {
      if (!query.client_id) {
        // Who owes what, biggest first.
        const { rows } = await ctx.db.query(
          `select x.*, count(*) over() as total_count from (
             select c.id as client_id, c.name,
                    sum(case when l.kind = 'charge' then l.amount_cents else -l.amount_cents end)::int8 as balance_cents,
                    max(l.created_at) as last_entry_at
               from ledger_entries l join clients c on c.id = l.client_id
              where l.shop_id = $1 group by c.id, c.name
             having sum(case when l.kind = 'charge' then l.amount_cents else -l.amount_cents end) > 0) x
           order by balance_cents desc limit $2 offset $3`,
          [ctx.shopId, query.page_size, (query.page - 1) * query.page_size],
        );
        const total = (
          await ctx.db.query(
            `select coalesce(sum(b), 0)::int8 as t from (
               select sum(case when kind = 'charge' then amount_cents else -amount_cents end) as b
                 from ledger_entries where shop_id = $1 group by client_id) s where b > 0`,
            [ctx.shopId],
          )
        ).rows[0].t;
        const res = paged(rows, query.page, query.page_size);
        return {
          ...res,
          data: res.data.map((r: any) => ({ ...r, balance_cents: Number(r.balance_cents) })),
          outstanding_cents: Number(total),
        };
      }
      await assertClient(ctx, query.client_id);
      const { rows } = await ctx.db.query(
        `select id, client_id, amount_cents, kind, note, created_at, count(*) over() as total_count
           from ledger_entries where shop_id = $1 and client_id = $2
          order by created_at desc limit $3 offset $4`,
        [ctx.shopId, query.client_id, query.page_size, (query.page - 1) * query.page_size],
      );
      return { ...paged(rows, query.page, query.page_size), balance_cents: await clientBalance(ctx, query.client_id) };
    },
  },
  {
    method: 'POST',
    path: '/ledger',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: z.object({
      client_id: uuid,
      kind: z.enum(['charge', 'payment']),
      amount_cents: positiveCents,
      note: z.string().trim().max(200).optional(),
    }),
    async handler(ctx, { body }) {
      await assertClient(ctx, body.client_id);
      const row = (
        await ctx.db.query(
          `insert into ledger_entries (shop_id, client_id, amount_cents, kind, note, created_by, created_at)
           values ($1, $2, $3, $4, $5, $6, $7) returning id, client_id, amount_cents, kind, note, created_at`,
          [ctx.shopId, body.client_id, body.amount_cents, body.kind, body.note ?? null, ctx.userId, ctx.now],
        )
      ).rows[0];
      return ok({ ...row, balance_cents: await clientBalance(ctx, body.client_id) }, 201);
    },
  },

  // --- shop books (income & expenses) ---
  {
    method: 'GET',
    path: '/books',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    query: pageQuery.extend({ from: isoDate.optional(), to: isoDate.optional(), kind: z.enum(['income', 'expense']).optional() }),
    async handler(ctx, { query }) {
      const { rows } = await ctx.db.query(
        `select id, kind, category, amount_cents, to_char(entry_date, 'YYYY-MM-DD') as entry_date, note, raw_text, source,
                appointment_id, created_at, count(*) over() as total_count
           from book_entries
          where shop_id = $1 and ($2::date is null or entry_date >= $2) and ($3::date is null or entry_date <= $3)
            and ($4::text is null or kind = $4)
          order by entry_date desc, created_at desc limit $5 offset $6`,
        [ctx.shopId, query.from ?? null, query.to ?? null, query.kind ?? null, query.page_size, (query.page - 1) * query.page_size],
      );
      return paged(rows, query.page, query.page_size);
    },
  },
  {
    method: 'POST',
    path: '/books',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: draftSchema.extend({
      note: z.string().trim().max(200).optional(),
      raw_text: z.string().trim().max(500).optional(),
      source: z.enum(['manual', 'ai_note']).default('manual'),
    }),
    async handler(ctx, { body }) {
      const row = (
        await ctx.db.query(
          `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, raw_text, source, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id, kind, category, amount_cents, to_char(entry_date, 'YYYY-MM-DD') as entry_date, note, raw_text, source, created_at`,
          [ctx.shopId, body.kind, body.category, body.amount_cents, body.entry_date, body.note ?? null, body.raw_text ?? null, body.source, ctx.userId],
        )
      ).rows[0];
      return ok(row, 201);
    },
  },
  {
    method: 'DELETE',
    path: '/books/:id',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    async handler(ctx, { params }) {
      const row = (
        await ctx.db.query('select source, appointment_id, sale_id from book_entries where id = $1 and shop_id = $2', [params.id, ctx.shopId])
      ).rows[0];
      if (!row) throw notFound('Entry');
      if (row.source === 'appointment' || row.appointment_id)
        throw conflict('This income comes from an appointment; change the appointment instead', 'LINKED_TO_APPOINTMENT');
      if (row.sale_id) throw conflict('This income comes from a sale; void the sale instead', 'LINKED_TO_SALE');
      if (row.source === 'payout') throw conflict('This is a team settlement; it stays in the books', 'LINKED_TO_PAYOUT');
      await ctx.db.query('delete from book_entries where id = $1 and shop_id = $2', [params.id, ctx.shopId]);
      return noContent();
    },
  },
  {
    // Free text → drafts (one per amount). Nothing is saved here; the barber confirms and then POSTs /books.
    method: 'POST',
    path: '/books/parse',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    body: z.object({ text: z.string().trim().min(1).max(500), lang: z.enum(['tr', 'en', 'es']).optional() }),
    async handler(ctx, { body }) {
      const shop = (await ctx.db.query('select timezone, language from shops where id = $1', [ctx.shopId])).rows[0];
      const today = DateTime.fromJSDate(ctx.now, { zone: shop.timezone }).toISODate()!;
      const l = body.lang ?? shop.language;
      let drafts: NoteDraft[] = [];
      let engine: 'ai' | 'local' = 'local';
      if (ctx.deps.parseNote) {
        try {
          const out: any = await ctx.deps.parseNote({ text: body.text, lang: l, today, timezone: shop.timezone });
          const list = z.array(draftSchema).min(1).safeParse(Array.isArray(out) ? out : out?.entries ?? [out]);
          if (list.success) {
            drafts = list.data as NoteDraft[];
            engine = 'ai';
          }
        } catch {
          /* fall back to the local parser */
        }
      }
      if (!drafts.length) drafts = parseNotesLocal(body.text, today, l);
      if (!drafts.length) throw new ApiError(422, 'PARSE_FAILED', 'Could not find an amount in that note');
      return { drafts: drafts.map((d) => ({ ...d, raw_text: body.text })), engine };
    },
  },
  {
    // Every number here is SQL over book_entries. The AI never produces a total.
    method: 'GET',
    path: '/books/summary',
    auth: 'user',
    gated: true,
    ownerOnly: true,
    query: z.object({ period: z.enum(['day', 'week', 'month']).default('day'), date: isoDate.optional() }),
    async handler(ctx, { query }) {
      const tz = await shopTz(ctx);
      const date = query.date ? DateTime.fromISO(query.date, { zone: tz }) : DateTime.fromJSDate(ctx.now, { zone: tz });
      const b = periodBounds(query.period, date);
      const { rows } = await ctx.db.query(
        `select kind, category, sum(amount_cents)::int8 as total, count(*)::int as n
           from book_entries where shop_id = $1 and entry_date between $2 and $3
          group by kind, category order by kind, total desc`,
        [ctx.shopId, b.from, b.to],
      );
      const series = (
        await ctx.db.query(
          `select to_char(entry_date, 'YYYY-MM-DD') as date,
                  coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int8 as income,
                  coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int8 as expense
             from book_entries where shop_id = $1 and entry_date between $2 and $3
            group by entry_date order by entry_date`,
          [ctx.shopId, b.from, b.to],
        )
      ).rows.map((r: any) => ({ date: r.date, income: Number(r.income), expense: Number(r.expense) }));
      const totals = async (from: string, to: string) => {
        const r = (
          await ctx.db.query(
            `select coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int8 as income,
                    coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int8 as expense
               from book_entries where shop_id = $1 and entry_date between $2 and $3`,
            [ctx.shopId, from, to],
          )
        ).rows[0];
        return { income: Number(r.income), expense: Number(r.expense) };
      };
      const { income, expense } = await totals(b.from, b.to);
      const prev = await totals(b.prevFrom, b.prevTo);
      // A fair comparison for the cards: a period still running is set against the same days of the
      // one before ("the same days last month"); a finished one against the whole previous period.
      const today = DateTime.fromJSDate(ctx.now, { zone: tz }).toISODate()!;
      const running = query.period !== 'day' && b.from <= today && today < b.to;
      const span = running ? Math.round(DateTime.fromISO(today).diff(DateTime.fromISO(b.from), 'days').days) : 0;
      const cur = running ? await totals(b.from, today) : { income, expense };
      const base = running ? await totals(b.prevFrom, DateTime.fromISO(b.prevFrom).plus({ days: span }).toISODate()!) : prev;
      const pct = (a: number, z: number) => (z > 0 && a >= 0 ? Math.round((a / z - 1) * 100) : null);
      const compare = {
        basis: running ? 'same_days' : 'previous',
        income_pct: pct(cur.income, base.income),
        expense_pct: pct(cur.expense, base.expense),
        net_pct: base.income - base.expense > 0 ? pct(cur.income - cur.expense, base.income - base.expense) : null,
      };
      const by_category = rows.map((r: any) => ({ kind: r.kind, category: r.category, total_cents: Number(r.total), count: r.n }));
      const prevNet = prev.income - prev.expense;
      const net = income - expense;
      // A one-line read of the numbers, built from the same SQL results (the client words it per language).
      const topExpense = by_category.find((c) => c.kind === 'expense');
      const insight = {
        // Only meaningful against a positive previous net, and only within a sane range.
        net_change_pct:
          prevNet > 0 && Math.abs((net - prevNet) / prevNet) <= 3 ? Math.round(((net - prevNet) / prevNet) * 100) : null,
        top_expense_category: topExpense?.category ?? null,
        top_expense_share_pct: topExpense && expense ? Math.round((topExpense.total_cents / expense) * 100) : null,
      };
      return {
        period: query.period,
        from: b.from,
        to: b.to,
        income_cents: income,
        expense_cents: expense,
        net_cents: net,
        previous: { income_cents: prev.income, expense_cents: prev.expense, net_cents: prevNet },
        compare,
        by_category,
        series,
        insight,
      };
    },
  },
];
