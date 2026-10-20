import { z } from 'zod';
import { isaretleriGuncelle, isaretlerEskiMi } from '../ajan/isaretler';
import { yuzdeEk } from '../rontgen/ek';
import { DateTime } from 'luxon';
import { badRequest, forbidden, isoDate, lang, noContent, notFound, ok, pageQuery, paged, positiveCents, type Ctx, type Route } from '../http';
import { understandLocal } from '../assistant/local';
import { planSchema, type Plan, type PlanItem } from '../assistant/plan';
import { replier } from '../assistant/replies';
import { toE164 } from '../assistant/phone';
import { bestMatch, type Named } from '../parse/voice';
import { fold } from '../parse/text';
import { updateRow } from './shop';
import { shopSnapshot } from '../assistant/snapshot';
import { localAdvice } from '../assistant/advice';
import { EARLIER_MAX, RECENT, earlierLine, nextFocus, sessionView, type Focus } from '../assistant/memory';
import { NOTE_KINDS, addNote, isSensitive, liveNotes, memoryMarkdown, notesForPrompt, memoryUpkeepIn } from '../assistant/notes';

type Lang = 'tr' | 'en' | 'es';

async function shopInfo(ctx: Ctx) {
  return (
    await ctx.db.query(
      `select name, timezone, language, currency, country,
              nullif(concat_ws(E'\n\n', agent_soul, agent_md), '') as soul from shops where id = $1`,
      [ctx.shopId],
    )
  ).rows[0] as { name: string; timezone: string; language: Lang; currency: string; country: string; soul: string | null };
}

async function lists(ctx: Ctx) {
  const q = async (sql: string) => (await ctx.db.query(sql, [ctx.shopId])).rows as (Named & Record<string, any>)[];
  return {
    services: await q('select id, name, price_cents, duration_min from services where shop_id = $1 and active order by name'),
    barbers: await q('select id, name from barbers where shop_id = $1 and active order by created_at'),
    clients: await q('select id, name, phone_e164 from clients where shop_id = $1 order by name limit 500'),
  };
}

/** Calendar range for a period name, in the shop's timezone. */
export function periodRange(period: string, now: DateTime) {
  const d = now.startOf('day');
  switch (period) {
    case 'today':
      return { from: d, to: d };
    case 'yesterday':
      return { from: d.minus({ days: 1 }), to: d.minus({ days: 1 }) };
    case 'tomorrow':
      return { from: d.plus({ days: 1 }), to: d.plus({ days: 1 }) };
    case 'this_week':
      return { from: d.startOf('week'), to: d.endOf('week').startOf('day') };
    case 'last_week':
      return { from: d.minus({ weeks: 1 }).startOf('week'), to: d.minus({ weeks: 1 }).endOf('week').startOf('day') };
    case 'last_month':
      return { from: d.minus({ months: 1 }).startOf('month'), to: d.minus({ months: 1 }).endOf('month').startOf('day') };
    case 'this_year':
      return { from: d.startOf('year'), to: d.endOf('year').startOf('day') };
    default:
      return { from: d.startOf('month'), to: d.endOf('month').startOf('day') };
  }
}

const match = (name: string | null | undefined, items: Named[]) => {
  if (!name) return null;
  const exact = items.find((i) => fold(i.name) === fold(name));
  if (exact) return exact;
  // "Ahmed" finds Ahmet Yılmaz, but "Ali Kaya" must not become Mehmet Kaya on the surname alone.
  const said = fold(name).split(' ');
  const m = bestMatch(said, items);
  return m && (said.length === 1 || m.used.length >= 2) ? m.item : null;
};

/** Answers a question. Every number comes from SQL; this only words the result. */
async function answer(ctx: Ctx, item: Extract<PlanItem, { type: 'query' }>, shop: Awaited<ReturnType<typeof shopInfo>>, l: Lang, clients: Named[]) {
  const r = replier(l, shop.currency);
  const now = DateTime.fromJSDate(ctx.now, { zone: shop.timezone });
  // A month named outright ("ekim ayının hesabı"): its latest occurrence, this month included.
  const named = item.month ? now.set({ month: item.month }).startOf('month').minus({ years: item.month > now.month ? 1 : 0 }) : null;
  const { from, to } = named ? { from: named, to: named.endOf('month').startOf('day') } : periodRange(item.period, now);
  const f = from.toISODate()!;
  const t = to.toISODate()!;
  const p = named ? r.monthName(named.month, named.year !== now.year ? named.year : null) : r.period(item.period);
  const pl = named ? p : r.period(item.period, true);
  // A period still running is counted, and named, up to today: "1 Eki – 20 Eki", not the whole month.
  const today = now.startOf('day');
  const running = from <= today && to > today;
  const upTo = running ? today : to;
  const range = r.range(f, upTo.toISODate()!);
  const one = async (sql: string, params: unknown[]) => (await ctx.db.query(sql, params)).rows[0];
  const sumsBetween = async (a: string, b: string) => {
    const s = await one(
      `select coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int8 as income,
              coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int8 as expense,
              count(*) filter (where kind = 'income')::int as n_income
         from book_entries where shop_id = $1 and entry_date between $2 and $3`,
      [ctx.shopId, a, b],
    );
    return { income: Number(s.income), expense: Number(s.expense), n: s.n_income as number };
  };
  const sums = () => sumsBetween(f, upTo.toISODate()!);

  // What to measure against. A period still running is compared day for day with the one before
  // ("the same days last month"), so a half month is never set against a whole one.
  const days = Math.round(upTo.diff(from, 'days').days);
  const unit = named || item.period.endsWith('month') ? 'month' : item.period.endsWith('week') ? 'week' : item.period.endsWith('year') ? 'year' : 'day';
  const prevFrom = unit === 'day' ? (item.period === 'today' ? from.minus({ weeks: 1 }) : from.minus({ days: 1 })) : from.minus({ [`${unit}s`]: 1 } as any);
  const prevTo = DateTime.min(prevFrom.plus({ days }), unit === 'day' ? prevFrom : prevFrom.endOf(unit as any).startOf('day'));
  const base = r.say(`cmp_${unit}${running && unit !== 'day' ? '_sofar' : ''}${item.period === 'today' ? '_weekday' : ''}`);
  const baseLower = base.charAt(0).toLocaleLowerCase('tr') + base.slice(1);
  const versus = async () => {
    const [cur, prev] = await Promise.all([sumsBetween(f, upTo.toISODate()!), sumsBetween(prevFrom.toISODate()!, prevTo.toISODate()!)]);
    return { cur, prev };
  };
  /** " Geçen aya göre %12 fazla." — nothing when there is nothing to compare with. */
  const change = (cur: number, prev: number, key = 'cmp') => {
    if (prev <= 0 || cur < 0) return '';
    const d = cur / prev - 1;
    if (Math.abs(d) < 0.03) return r.say(`${key}_same`, { base, baseLower });
    return r.say(d > 0 ? `${key}_up` : `${key}_down`, { base, baseLower, pct: Math.round(Math.abs(d) * 100) });
  };
  const topExpense = async (total: number) => {
    const top = await one(
      `select category, sum(amount_cents)::int8 as total from book_entries
        where shop_id = $1 and kind = 'expense' and entry_date between $2 and $3
        group by category order by total desc limit 1`,
      [ctx.shopId, f, t],
    );
    const share = Number(top?.total ?? 0) / Math.max(1, total);
    return top && total > 0 ? r.say('expense_top', { cat: r.category(top.category), catAmount: r.money(Number(top.total)), pct: Math.round(share * 100), pctTr: yuzdeEk(share, 'i') }) : '';
  };

  switch (item.metric) {
    case 'cash': {
      // The real balance when a bank is connected; otherwise what the books say came in today.
      const bank = await one(`select meta->'kasa' as kasa, last_sync_at from connections where shop_id = $1 and provider = 'plaid' and status <> 'disconnected'`, [ctx.shopId]);
      if (bank?.kasa) {
        const at = DateTime.fromJSDate(new Date(bank.last_sync_at), { zone: shop.timezone });
        return { text: r.say('cash_bank', { amount: r.money(Math.round(Number(bank.kasa.tutar) * 100)), n: bank.kasa.hesap, when: at.hasSame(now, 'day') ? at.toFormat('HH:mm') : r.day(at.toISODate()!) }), data: { balance: Number(bank.kasa.tutar) } };
      }
      const s = await sumsBetween(today.toISODate()!, today.toISODate()!);
      return { text: r.say('cash_books', { income: r.money(s.income), expense: r.money(s.expense) }), data: { income_cents: s.income, expense_cents: s.expense } };
    }
    case 'summary': {
      const s = await sums();
      if (!s.income && !s.expense) return { text: r.say('summary_empty', { p, range }), data: { from: f, to: t } };
      const net = s.income - s.expense;
      const { cur, prev } = await versus();
      const parts = [
        r.say(net >= 0 ? 'net_pos' : 'net_neg', { p, range, income: r.money(s.income), expense: r.money(s.expense), net: r.money(Math.abs(net)), cmp: '' }),
        change(cur.income, prev.income, 'cmp_income').trim(),
        (await topExpense(s.expense)).trim(),
      ];
      const svc = await one(
        `select s.name, count(*)::int as n from appointments a join services s on s.id = a.service_id
          where a.shop_id = $1 and a.status = 'done' and a.starts_at >= $2 and a.starts_at < $3
          group by s.name order by n desc limit 1`,
        [ctx.shopId, from.toJSDate(), to.plus({ days: 1 }).toJSDate()],
      );
      if (svc) parts.push(r.say('summary_service', { name: svc.name, n: svc.n }));
      if (running) parts.push(r.say(`summary_running_${unit}`));
      // The owner also hears the agent's most important note (written in Turkish for now).
      if (ctx.role === 'owner' && l === 'tr') {
        const sig = await one(
          `select title from agent_signals where shop_id = $1 and dismissed_at is null and resolved_at is null and severity = 'yuksek'
            order by effect desc nulls last limit 1`,
          [ctx.shopId],
        );
        if (sig) parts.push(r.say('summary_signal', { title: sig.title }));
      }
      return { text: parts.filter(Boolean).join(' '), data: { from: f, to: t, income_cents: s.income, expense_cents: s.expense, net_cents: net } };
    }
    case 'income': {
      const s = await sums();
      if (!s.income) return { text: r.say('income_none', { p, range }), data: { from: f, to: t, income_cents: 0 } };
      const { cur, prev } = await versus();
      return { text: r.say('income', { p, range, amount: r.money(s.income), n: s.n, cmp: change(cur.income, prev.income) }), data: { from: f, to: t, income_cents: s.income } };
    }
    case 'expense': {
      const s = await sums();
      if (!s.expense) return { text: r.say('expense_none', { p, range }), data: { from: f, to: t, expense_cents: 0 } };
      const { cur, prev } = await versus();
      return {
        text: r.say('expense', { p, range, amount: r.money(s.expense), top: await topExpense(s.expense), cmp: change(cur.expense, prev.expense) }),
        data: { from: f, to: t, expense_cents: s.expense },
      };
    }
    case 'net': {
      const s = await sums();
      const net = s.income - s.expense;
      const { cur, prev } = await versus();
      return {
        text: r.say(net >= 0 ? 'net_pos' : 'net_neg', { p, range, income: r.money(s.income), expense: r.money(s.expense), net: r.money(Math.abs(net)), cmp: change(cur.income - cur.expense, prev.income - prev.expense) }),
        data: { from: f, to: t, income_cents: s.income, expense_cents: s.expense, net_cents: net },
      };
    }
    case 'payables': {
      // Open payment reminders due by the end of the period, overdue ones included.
      const { rows } = await ctx.db.query(
        `select title, amount_cents, to_char(due_date, 'YYYY-MM-DD') as due_date from shop_tasks
          where shop_id = $1 and kind = 'payment' and status = 'open' and due_date <= $2
          order by due_date`,
        [ctx.shopId, t],
      );
      const total = await one(
        `select coalesce(sum(amount_cents), 0)::int8 as total from shop_tasks
          where shop_id = $1 and kind = 'payment' and status = 'open' and due_date <= $2`,
        [ctx.shopId, t],
      );
      if (!rows.length) return { text: r.say('payables_none', { p: pl }), data: { total_cents: 0 } };
      const list = rows
        .slice(0, 6)
        .map((x: any) => `${x.title}${x.amount_cents ? ` ${r.money(x.amount_cents)}` : ''} (${r.day(x.due_date)})`)
        .join(', ');
      return { text: r.say('payables', { p, amount: r.money(Number(total.total)), list }), data: { total_cents: Number(total.total) } };
    }
    case 'receivables': {
      const { rows } = await ctx.db.query(
        `select c.name, sum(case when l.kind = 'charge' then l.amount_cents else -l.amount_cents end)::int8 as b
           from ledger_entries l join clients c on c.id = l.client_id
          where l.shop_id = $1 group by c.name having sum(case when l.kind = 'charge' then l.amount_cents else -l.amount_cents end) > 0
          order by b desc`,
        [ctx.shopId],
      );
      const total = await one(
        `select coalesce(sum(b), 0)::int8 as t from (
           select sum(case when kind = 'charge' then amount_cents else -amount_cents end) as b
             from ledger_entries where shop_id = $1 group by client_id) s where b > 0`,
        [ctx.shopId],
      );
      if (!rows.length) return { text: r.say('receivables_none'), data: { total_cents: 0 } };
      const list = rows.slice(0, 3).map((x: any) => `${x.name} ${r.money(Number(x.b))}`).join(', ');
      return { text: r.say('receivables', { amount: r.money(Number(total.t)), list }), data: { total_cents: Number(total.t) } };
    }
    case 'appointments': {
      const s = await one(
        `select count(*) filter (where status in ('booked', 'done'))::int as n,
                count(*) filter (where status = 'done')::int as d,
                coalesce(sum(price_cents_snapshot) filter (where status in ('booked', 'done')), 0)::int8 as expected
           from appointments where shop_id = $1 and starts_at >= $2 and starts_at < $3`,
        [ctx.shopId, from.toJSDate(), to.plus({ days: 1 }).toJSDate()],
      );
      if (!s.n) return { text: r.say('appointments_none', { p: pl }), data: { count: 0 } };
      return {
        text: r.say('appointments', { p, n: s.n, done: s.d ? r.say('appointments_done', { d: s.d }) : '', amount: r.money(Number(s.expected)) }),
        data: { count: s.n, done: s.d, expected_cents: Number(s.expected) },
      };
    }
    case 'top_service': {
      const s = await one(
        `select sv.name, count(*)::int as n, sum(a.price_cents_snapshot)::int8 as total
           from appointments a join services sv on sv.id = a.service_id
          where a.shop_id = $1 and a.status = 'done' and a.starts_at >= $2 and a.starts_at < $3
          group by sv.name order by n desc, total desc limit 1`,
        [ctx.shopId, from.toJSDate(), to.plus({ days: 1 }).toJSDate()],
      );
      if (!s) return { text: r.say('top_service_none', { p: pl }), data: null };
      return { text: r.say('top_service', { p, name: s.name, n: s.n, amount: r.money(Number(s.total)) }), data: s };
    }
    case 'client_balance': {
      const c = match(item.client_name, clients);
      if (!c) return { text: r.say('client_missing', { name: item.client_name ?? '' }), data: null };
      const b = await one(
        `select coalesce(sum(case when kind = 'charge' then amount_cents else -amount_cents end), 0)::int8 as b
           from ledger_entries where shop_id = $1 and client_id = $2`,
        [ctx.shopId, c.id],
      );
      const bal = Number(b.b);
      return { text: r.say(bal > 0 ? 'client_balance' : 'client_balance_zero', { name: c.name, amount: r.money(bal) }), data: { client_id: c.id, balance_cents: bal } };
    }
    case 'reminders': {
      const { rows } = await ctx.db.query(
        `select title, amount_cents, to_char(due_date, 'YYYY-MM-DD') as due_date from shop_tasks
          where shop_id = $1 and status = 'open' and due_date <= $2 order by due_date limit 8`,
        [ctx.shopId, t],
      );
      if (!rows.length) return { text: r.say('reminders_none', { p: pl }), data: { count: 0 } };
      const list = rows.map((x: any) => `${x.title}${x.amount_cents ? ` ${r.money(x.amount_cents)}` : ''}`).join('; ');
      return { text: r.say('reminders', { p, n: rows.length, list }), data: { count: rows.length } };
    }
  }
}

async function usualService(ctx: Ctx, clientId: string): Promise<string | null> {
  const r = await ctx.db.query(
    `select service_id from appointments where shop_id = $1 and client_id = $2 and status = 'done' and service_id is not null
      group by service_id order by count(*) desc, max(starts_at) desc limit 1`,
    [ctx.shopId, clientId],
  );
  return r.rows[0]?.service_id ?? null;
}

async function loadMemory(ctx: Ctx) {
  const { rows } = await ctx.db.query(
    `select role, text, summary, created_at from assistant_turns
      where shop_id = $1 and user_id = $2 order by created_at desc, role asc limit $3`,
    [ctx.shopId, ctx.userId, RECENT + EARLIER_MAX * 2],
  );
  const m = (await ctx.db.query('select focus from assistant_memory where shop_id = $1 and user_id = $2', [ctx.shopId, ctx.userId])).rows[0];
  return { focus: (m?.focus ?? {}) as Focus, view: sessionView(rows, ctx.now) };
}

/** Stores one exchange. The assistant turn is a millisecond later so the order survives equal clocks. */
async function saveTurn(ctx: Ctx, t: { text: string; reply: string; items: PlanItem[]; drafts: unknown[]; engine: string; focus: Focus }) {
  const at = ctx.now;
  const later = new Date(at.getTime() + 1);
  const u = await ctx.db.query(
    `insert into assistant_turns (shop_id, user_id, role, text, summary, items, created_at)
     values ($1, $2, 'user', $3, $4, $5, $6) returning id`,
    [ctx.shopId, ctx.userId, t.text, earlierLine(t.text, t.items, t.reply).slice(0, 300), JSON.stringify(t.items), at],
  );
  const a = await ctx.db.query(
    `insert into assistant_turns (shop_id, user_id, role, text, drafts, engine, created_at)
     values ($1, $2, 'assistant', $3, $4, $5, $6) returning id`,
    [ctx.shopId, ctx.userId, t.reply.slice(0, 4000), t.drafts.length ? JSON.stringify(t.drafts) : null, t.engine, later],
  );
  await ctx.db.query(
    `insert into assistant_memory (shop_id, user_id, focus) values ($1, $2, $3)
     on conflict (shop_id, user_id) do update set focus = excluded.focus`,
    [ctx.shopId, ctx.userId, JSON.stringify(t.focus)],
  );
  return { user: u.rows[0].id as string, assistant: a.rows[0].id as string };
}

/** A note this user may change: their own personal notes, or any shared note for the owner. */
async function ownNote(ctx: Ctx, id: string) {
  const n = (await ctx.db.query('select id, user_id, pinned from assistant_notes where id = $1 and shop_id = $2', [id, ctx.shopId])).rows[0];
  if (!n || (n.user_id && n.user_id !== ctx.userId)) throw notFound('Note');
  if (!n.user_id && ctx.role !== 'owner') throw forbidden('Only the shop owner can change shared notes');
  return n as { id: string; user_id: string | null; pinned: boolean };
}

const taskSelect = `id, kind, title, to_char(due_date, 'YYYY-MM-DD') as due_date, to_char(due_time, 'HH24:MI') as due_time,
  amount_cents, status, done_at, source, raw_text, created_at`;

export const assistantRoutes: Route[] = [
  {
    method: 'POST',
    path: '/assistant',
    auth: 'user',
    gated: true,
    body: z.object({ text: z.string().trim().min(1).max(600), lang: lang.optional() }),
    async handler(ctx, { body }) {
      const shop = await shopInfo(ctx);
      const l: Lang = body.lang ?? shop.language;
      const r = replier(l, shop.currency);
      const L = await lists(ctx);
      const now = DateTime.fromJSDate(ctx.now, { zone: shop.timezone });

      // The conversation so far (this user's, this session's): what "him" or "make it 4" refers to.
      const mem = await loadMemory(ctx);
      const focus: Focus = mem.view.active ? mem.focus : {};
      // Long-term notes (DÜKKÂN.md): sent with every message, the most relevant first.
      const memory = notesForPrompt(await liveNotes(ctx.db, ctx.shopId, ctx.userId, ctx.now), body.text);
      const local = () => understandLocal(body.text, { now, lang: l, ...L, focus });

      // The LLM (when configured) only understands; it never sees totals and never writes.
      let plan: Plan | null = null;
      let engine: 'ai' | 'local' = 'local';
      if (ctx.deps.assistant) {
        try {
          const out = planSchema.safeParse(
            await ctx.deps.assistant({
              text: body.text,
              lang: l,
              today: now.toISODate()!,
              weekday: now.weekdayLong!,
              timezone: shop.timezone,
              currency: shop.currency,
              services: L.services.map((s) => s.name),
              barbers: L.barbers.map((b) => b.name),
              clients: L.clients.map((c) => c.name),
              context:
                mem.view.active || memory.length
                  ? { focus, earlier: mem.view.active ? mem.view.earlier : [], recent: mem.view.active ? mem.view.recent : [], memory }
                  : undefined,
            }),
          );
          if (out.success) (plan = out.data), (engine = 'ai');
        } catch {
          /* fall back to the local engine */
        }
        // When the model gives up, the rules may still read a follow-up from the conversation. Only that:
        // a sentence the rules read the same way without context stays "not understood".
        if (plan && plan.items.every((i) => i.type === 'unknown')) {
          const p = local();
          const bare = understandLocal(body.text, { now, lang: l, ...L });
          if (p.items.some((i) => i.type !== 'unknown') && JSON.stringify(p) !== JSON.stringify(bare)) (plan = p), (engine = 'local');
        }
      }
      plan ??= local();

      const texts: string[] = [];
      const drafts: any[] = [];
      const seen: PlanItem[] = []; // the plan with names as resolved, for the next turn's focus
      let noted: Focus['note'];
      for (const item of plan.items) {
        if (item.type === 'query') {
          const a = await answer(ctx, item, shop, l, L.clients);
          if (a) texts.push(a.text);
          const c = item.metric === 'client_balance' ? match(item.client_name, L.clients) : null;
          seen.push({ ...item, client_name: c?.name ?? item.client_name ?? null });
        } else if (item.type === 'chat') {
          // Open question: the shop's numbers come from SQL; the model (or local rules) only words them.
          const snapshot = await shopSnapshot(ctx.db, ctx.shopId, now);
          let reply: string | null = null;
          if (ctx.deps.chat) {
            try {
              reply = (await ctx.deps.chat({ question: item.question, lang: l, shop: shop.name, currency: shop.currency, snapshot, history: mem.view.recent, memory, soul: shop.soul ?? undefined })).trim() || null;
              if (reply) engine = 'ai';
            } catch {
              /* fall back to local advice */
            }
          }
          texts.push(reply ?? localAdvice(item.question, snapshot, l, shop.currency));
          seen.push(item);
        } else if (item.type === 'cancel') {
          texts.push(r.say('cancelled'));
          seen.push(item);
        } else if (item.type === 'remember') {
          // A note for the long-term memory; never sensitive details (core/agent/SOUL.md).
          const note = isSensitive(item.text)
            ? null
            : await addNote(ctx.db, { shopId: ctx.shopId, userId: item.kind === 'preference' ? ctx.userId : null, kind: item.kind, subject: item.subject, text: item.text, source: 'said', now: ctx.now });
          if (note) {
            texts.push(r.say('remembered', { text: note.text }));
            noted = { id: note.id, text: note.text };
            seen.push(item);
          } else texts.push(r.say('remember_refused'));
        } else if (item.type === 'forget') {
          if (focus.note) {
            await ctx.db.query(`delete from assistant_notes where id = $1 and shop_id = $2 and source = 'said' and not pinned`, [focus.note.id, ctx.shopId]);
            texts.push(r.say('forgot', { text: focus.note.text }));
            seen.push(item);
          }
        } else if (item.type === 'appointment') {
          const client = match(item.client_name, L.clients);
          // No service named: the client's usual one (memory from the records), else the first on the menu.
          const usual = !item.service && client ? await usualService(ctx, client.id) : null;
          const service = match(item.service, L.services) ?? (usual ? L.services.find((s) => s.id === usual) : null) ?? L.services[0] ?? null;
          const barber = match(item.barber, L.barbers) ?? L.barbers[0] ?? null;
          const phone = item.phone ? toE164(item.phone, shop.country) : null;
          drafts.push({
            type: 'appointment',
            client_id: client?.id ?? null,
            client_name: client?.name ?? item.client_name,
            phone_e164: client ? null : phone,
            service_id: service?.id ?? null,
            service_name: service?.name ?? null,
            price_cents: (service as any)?.price_cents ?? null,
            barber_id: barber?.id ?? null,
            barber_name: barber?.name ?? null,
            date: item.date,
            time: item.time,
          });
          seen.push({ ...item, client_name: client?.name ?? item.client_name, service: service?.name ?? null, barber: barber?.name ?? null });
          if (!item.time) texts.push(r.say('need_time'));
          if (!client && !phone) texts.push(r.say('need_phone'));
        } else if (item.type === 'client') {
          const phone = item.phone ? toE164(item.phone, shop.country) : null;
          const dup = phone ? (L.clients as any[]).find((c) => c.phone_e164 === phone) : null;
          drafts.push({ type: 'client', name: item.name, phone_e164: phone, phone_raw: item.phone, language: item.language ?? shop.language, duplicate_of: dup?.name ?? null });
          seen.push(item);
          if (!phone) texts.push(r.say('need_phone'));
          if (dup) texts.push(r.say('duplicate', { name: dup.name }));
        } else if (item.type === 'ledger') {
          const c = match(item.client_name, L.clients);
          if (!c) texts.push(r.say('client_missing', { name: item.client_name }));
          else {
            drafts.push({ type: 'ledger', client_id: c.id, client_name: c.name, kind: item.kind, amount_cents: item.amount_cents, note: item.note ?? null });
            seen.push({ ...item, client_name: c.name });
          }
        } else if (item.type === 'book') {
          drafts.push({ ...item, raw_text: body.text });
          seen.push(item);
        } else if (item.type === 'reminder') {
          drafts.push({ ...item, raw_text: body.text });
          seen.push(item);
        }
      }
      if (drafts.length) texts.unshift(r.say(drafts.length === 1 ? 'drafts_one' : 'drafts_many', { n: drafts.length }));
      if (!texts.length) texts.push(r.say('unknown'));
      const reply = texts.join(' ');

      const next = nextFocus(focus, seen);
      if (noted) next.note = noted;
      const turns = await saveTurn(ctx, { text: body.text, reply, items: seen, drafts, engine, focus: next });
      return { reply, drafts, engine, understood: seen, turn_id: turns.assistant };
    },
  },
  {
    // The conversation as the app shows it after a reload: oldest first, the last `limit` turns.
    method: 'GET',
    path: '/assistant/history',
    auth: 'user',
    gated: true,
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(60) }),
    async handler(ctx, { query }) {
      const { rows } = await ctx.db.query(
        `select id, role, text, drafts, engine, created_at from assistant_turns
          where shop_id = $1 and user_id = $2 order by created_at desc, role desc limit $3`,
        [ctx.shopId, ctx.userId, query.limit],
      );
      return { data: rows.reverse() };
    },
  },
  {
    // "Sohbeti temizle": forgets the whole conversation and the focus. Records already saved stay.
    method: 'DELETE',
    path: '/assistant/history',
    auth: 'user',
    gated: true,
    async handler(ctx) {
      await ctx.db.query('delete from assistant_turns where shop_id = $1 and user_id = $2', [ctx.shopId, ctx.userId]);
      await ctx.db.query('delete from assistant_memory where shop_id = $1 and user_id = $2', [ctx.shopId, ctx.userId]);
      return noContent();
    },
  },
  // --- the assistant's long-term memory (DÜKKÂN.md): see, add, pin, correct, delete ---
  {
    method: 'GET',
    path: '/assistant/notes',
    auth: 'user',
    gated: true,
    query: z.object({ lang: lang.optional() }),
    async handler(ctx, { query }) {
      const shop = await shopInfo(ctx);
      const notes = await liveNotes(ctx.db, ctx.shopId, ctx.userId, ctx.now);
      return { data: notes, markdown: memoryMarkdown(notes, shop.name, query.lang ?? shop.language, ctx.now) };
    },
  },
  {
    method: 'POST',
    path: '/assistant/notes',
    auth: 'user',
    gated: true,
    body: z.object({
      kind: z.enum(NOTE_KINDS),
      subject: z.string().trim().max(80).nullable().optional(),
      text: z.string().trim().min(1).max(280),
      pinned: z.boolean().default(false),
    }),
    async handler(ctx, { body }) {
      if (isSensitive(body.text)) throw badRequest('This looks like sensitive or contact information; the assistant does not keep it.');
      const personal = body.kind === 'preference' || ctx.role !== 'owner';
      const note = await addNote(ctx.db, { shopId: ctx.shopId, userId: personal ? ctx.userId : null, kind: body.kind, subject: body.subject, text: body.text, source: 'owner', now: ctx.now, pinned: body.pinned });
      return ok(note, 201);
    },
  },
  {
    method: 'PATCH',
    path: '/assistant/notes/:id',
    auth: 'user',
    gated: true,
    body: z.object({ text: z.string().trim().min(1).max(280), pinned: z.boolean() }).partial(),
    async handler(ctx, { params, body }) {
      const note = await ownNote(ctx, params.id);
      if (body.text && isSensitive(body.text)) throw badRequest('This looks like sensitive or contact information; the assistant does not keep it.');
      const pinned = body.pinned ?? note.pinned;
      const expires = pinned ? null : new Date(ctx.now.getTime() + 90 * 86_400_000);
      const { rows } = await ctx.db.query(
        `update assistant_notes set text = coalesce($3, text), pinned = $4, expires_at = $5, last_seen_at = $6,
                source = case when $3::text is null then source else 'owner' end, data_key = case when $3::text is null then data_key else null end
          where id = $1 and shop_id = $2 returning id, user_id, kind, subject, text, source, pinned, last_seen_at, expires_at, created_at`,
        [params.id, ctx.shopId, body.text ?? null, pinned, expires, ctx.now],
      );
      return rows[0];
    },
  },
  {
    method: 'DELETE',
    path: '/assistant/notes/:id',
    auth: 'user',
    gated: true,
    async handler(ctx, { params }) {
      await ownNote(ctx, params.id);
      await ctx.db.query('delete from assistant_notes where id = $1 and shop_id = $2', [params.id, ctx.shopId]);
      return noContent();
    },
  },
  {
    // Runs the memory upkeep now (it also runs every hour): data notes, conversation review, expiry.
    method: 'POST',
    path: '/admin/memory/run',
    auth: 'admin',
    async handler(ctx) {
      return memoryUpkeepIn(ctx.db, ctx.deps, ctx.now);
    },
  },
  {
    // The day's opening line: appointments, the till so far and reminders due (overdue first).
    method: 'GET',
    path: '/assistant/brief',
    auth: 'user',
    gated: true,
    query: z.object({ lang: lang.optional() }),
    async handler(ctx, { query }) {
      const shop = await shopInfo(ctx);
      const l: Lang = query.lang ?? shop.language;
      const r = replier(l, shop.currency);
      const now = DateTime.fromJSDate(ctx.now, { zone: shop.timezone });
      const day = now.startOf('day');
      const user = (await ctx.db.query('select name from users where id = $1 and shop_id = $2', [ctx.userId, ctx.shopId])).rows[0];
      const a = (
        await ctx.db.query(
          `select count(*) filter (where status in ('booked', 'done'))::int as n, count(*) filter (where status = 'booked')::int as left
             from appointments where shop_id = $1 and starts_at >= $2 and starts_at < $3`,
          [ctx.shopId, day.toJSDate(), day.plus({ days: 1 }).toJSDate()],
        )
      ).rows[0];
      const till = (
        await ctx.db.query(
          `select coalesce(sum(amount_cents), 0)::int8 as t from book_entries where shop_id = $1 and kind = 'income' and entry_date = $2`,
          [ctx.shopId, day.toISODate()],
        )
      ).rows[0].t;
      const tasks = (
        await ctx.db.query(
          `select ${taskSelect} from shop_tasks where shop_id = $1 and status = 'open' and due_date <= $2 order by due_date, due_time nulls last limit 6`,
          [ctx.shopId, day.plus({ days: 2 }).toISODate()],
        )
      ).rows;
      const today = day.toISODate()!;
      const parts = [r.say('brief_hello', { name: user?.name?.split(' ')[0] ?? '' })];
      parts.push(a.n ? r.say('brief_appts', { n: a.n, left: a.left }) : r.say('brief_no_appts'));
      if (Number(till)) parts.push(r.say('brief_till', { amount: r.money(Number(till)) }));
      if (tasks.length)
        parts.push(
          r.say('brief_tasks', {
            list: tasks
              .map((x: any) => `${x.title}${x.amount_cents ? ` ${r.money(x.amount_cents)}` : ''} (${x.due_date < today ? r.say('overdue') : x.due_date === today ? r.period('today', true) : r.day(x.due_date)})`)
              .join('; '),
          }),
        );
      // The owner also hears the agent's most important note (Röntgen and the cash forecast write them
      // in Turkish for now, so the English and Spanish briefs leave it to the Today screen).
      let signal = null;
      if (ctx.role === 'owner') {
        if (await isaretlerEskiMi(ctx.db, ctx.shopId, ctx.now)) await isaretleriGuncelle(ctx.db, ctx.shopId, ctx.now);
        signal = (
          await ctx.db.query(
            `select id, severity, title from agent_signals where shop_id = $1 and dismissed_at is null and resolved_at is null
              order by case severity when 'yuksek' then 0 when 'orta' then 1 else 2 end, effect desc nulls last limit 1`,
            [ctx.shopId],
          )
        ).rows[0] ?? null;
        if (signal && l === 'tr') parts.push(`${signal.title}.`);
      }
      return { reply: parts.join(' '), tasks, signal };
    },
  },

  // --- the barber's reminders and upcoming payments ---
  {
    method: 'GET',
    path: '/tasks',
    auth: 'user',
    gated: true,
    query: pageQuery.extend({ status: z.enum(['open', 'done', 'all']).default('open'), until: isoDate.optional() }),
    async handler(ctx, { query }) {
      const { rows } = await ctx.db.query(
        `select ${taskSelect}, count(*) over() as total_count from shop_tasks
          where shop_id = $1 and ($2 = 'all' or status = $2) and ($3::date is null or due_date <= $3)
          order by status, due_date, due_time nulls last limit $4 offset $5`,
        [ctx.shopId, query.status, query.until ?? null, query.page_size, (query.page - 1) * query.page_size],
      );
      return paged(rows, query.page, query.page_size);
    },
  },
  {
    method: 'POST',
    path: '/tasks',
    auth: 'user',
    gated: true,
    body: z.object({
      kind: z.enum(['reminder', 'payment']).default('reminder'),
      title: z.string().trim().min(1).max(200),
      due_date: isoDate,
      due_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      amount_cents: positiveCents.nullable().optional(),
      source: z.enum(['manual', 'assistant']).default('manual'),
      raw_text: z.string().trim().max(500).optional(),
    }),
    async handler(ctx, { body }) {
      const row = (
        await ctx.db.query(
          `insert into shop_tasks (shop_id, kind, title, due_date, due_time, amount_cents, source, raw_text, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${taskSelect}`,
          [ctx.shopId, body.kind, body.title, body.due_date, body.due_time ?? null, body.amount_cents ?? null, body.source, body.raw_text ?? null, ctx.userId],
        )
      ).rows[0];
      return ok(row, 201);
    },
  },
  {
    method: 'PATCH',
    path: '/tasks/:id',
    auth: 'user',
    gated: true,
    body: z
      .object({
        status: z.enum(['open', 'done']),
        title: z.string().trim().min(1).max(200),
        due_date: isoDate,
        amount_cents: positiveCents.nullable(),
      })
      .partial(),
    async handler(ctx, { params, body }) {
      const patch: Record<string, unknown> = { ...body };
      if (body.status) patch.done_at = body.status === 'done' ? ctx.now : null;
      await updateRow(ctx.db, 'shop_tasks', ctx.shopId, params.id, patch);
      return (await ctx.db.query(`select ${taskSelect} from shop_tasks where id = $1 and shop_id = $2`, [params.id, ctx.shopId])).rows[0];
    },
  },
  {
    method: 'DELETE',
    path: '/tasks/:id',
    auth: 'user',
    gated: true,
    async handler(ctx, { params }) {
      const { rows } = await ctx.db.query('delete from shop_tasks where id = $1 and shop_id = $2 returning id', [params.id, ctx.shopId]);
      if (!rows.length) throw notFound('Task');
      return noContent();
    },
  },
];
