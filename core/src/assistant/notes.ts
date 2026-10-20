import { DateTime } from 'luxon';
import { z } from 'zod';
import { withSystem, type Database, type Queryable } from '../db';
import { fold } from '../parse/text';
import type { Deps } from '../http';
import type { Turn } from './memory';

// Long-term memory: the shop's notebook (DÜKKÂN.md). The rules are in core/agent/AGENT.md.
// Notes come from four places: the barber says "aklında tut" (said), the nightly review of
// conversations (learned), the records themselves (data, recomputed every run) and the memory
// screen (owner). Each note lives NOTE_DAYS from when it was last confirmed; pinned notes stay.

export const NOTE_DAYS = 90;
export const NOTE_KINDS = ['client', 'money', 'team', 'shop', 'preference'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface Note {
  id: string;
  user_id: string | null;
  kind: NoteKind;
  subject: string | null;
  text: string;
  source: 'said' | 'learned' | 'data' | 'owner';
  pinned: boolean;
  last_seen_at: Date;
  expires_at: Date | null;
  created_at: Date;
}

const COLS = 'id, user_id, kind, subject, text, source, pinned, last_seen_at, expires_at, created_at';
const expiry = (now: Date) => new Date(now.getTime() + NOTE_DAYS * 86_400_000);

/** Things the assistant never keeps, even when told (SOUL.md → "Dedikodu tutmam"). */
const SENSITIVE_STEM =
  /(^|\s)(hastalig|hastalik|hastane|ilac|kanser|seker hastas|tansiyon|hamile|ameliyat|depresyon|namaz|oruc|mezhep|siyaset|siyasi|bosan|sifre|kart no|kart numara|iban|illness|hospital|medicat|cancer|diabet|pregnan|surgery|religio|politic|divorc|password|card number|enfermedad|embarazad|religion|politica|divorci|contrasena)/;
const SENSITIVE_WORD = /(^|\s)(hasta|din|dini|parti|sick|church|mosque|iglesia)(\s|$)/;
const CONTACT = /(\d[\s-]?){7,}|@\S+\.\S+/;
export const isSensitive = (text: string) => {
  const f = fold(text);
  return CONTACT.test(text) || SENSITIVE_STEM.test(f) || SENSITIVE_WORD.test(f);
};

/** Live notes this user may see: the shop's shared notes plus their own personal ones. */
export async function liveNotes(db: Queryable, shopId: string, userId: string | null, now: Date): Promise<Note[]> {
  const { rows } = await db.query(
    `select ${COLS} from assistant_notes
      where shop_id = $1 and (user_id is null or user_id = $2) and (pinned or expires_at > $3)
      order by pinned desc, last_seen_at desc limit 300`,
    [shopId, userId, now],
  );
  return rows as Note[];
}

/**
 * The notes worth sending with a message, most relevant first: notes about someone named in the
 * sentence, then pinned ones and the user's preferences, then the most recently confirmed.
 */
export function notesForPrompt(notes: Note[], text: string, max = 24): string[] {
  const f = fold(text);
  const named = (n: Note) => !!n.subject && fold(n.subject).split(' ').some((w) => w.length >= 3 && f.includes(w.slice(0, Math.max(3, w.length - 2))));
  const score = (n: Note) => (named(n) ? 4 : 0) + (n.pinned ? 2 : 0) + (n.kind === 'preference' ? 2 : 0) + (n.kind === 'shop' || n.kind === 'money' ? 1 : 0);
  return [...notes]
    .sort((a, b) => score(b) - score(a) || +new Date(b.last_seen_at) - +new Date(a.last_seen_at))
    .slice(0, max)
    .map((n) => `[${n.kind}${n.subject ? `: ${n.subject}` : ''}] ${n.text}`);
}

const HEADINGS: Record<'tr' | 'en' | 'es', Record<NoteKind, string>> = {
  tr: { shop: 'Dükkân', money: 'Para ve ödemeler', team: 'Ekip', client: 'Müşteriler', preference: 'Senin tercihlerin' },
  en: { shop: 'The shop', money: 'Money and payments', team: 'Team', client: 'Clients', preference: 'Your preferences' },
  es: { shop: 'El local', money: 'Dinero y pagos', team: 'Equipo', client: 'Clientes', preference: 'Tus preferencias' },
};
const SOURCE: Record<'tr' | 'en' | 'es', Record<Note['source'], string>> = {
  tr: { said: 'sen söyledin', learned: 'konuşmalardan', data: 'kayıtlardan', owner: 'sen yazdın' },
  en: { said: 'you said', learned: 'from conversations', data: 'from the records', owner: 'you wrote' },
  es: { said: 'lo dijiste', learned: 'de las conversaciones', data: 'de los registros', owner: 'lo escribiste' },
};

/** The notebook as one markdown document, the way the barber and the model read it. */
export function memoryMarkdown(notes: Note[], shop: string, lang: 'tr' | 'en' | 'es', now: Date) {
  const day = (d: Date | string) => DateTime.fromJSDate(new Date(d)).setLocale(lang).toFormat('d LLL');
  const lines = [`# ${lang === 'tr' ? 'DÜKKÂN.md' : lang === 'es' ? 'LOCAL.md' : 'SHOP.md'} · ${shop}`, ''];
  for (const kind of ['shop', 'money', 'team', 'client', 'preference'] as NoteKind[]) {
    const group = notes.filter((n) => n.kind === kind);
    if (!group.length) continue;
    lines.push(`## ${HEADINGS[lang][kind]}`, '');
    for (const n of group) {
      const left = n.expires_at ? Math.max(0, Math.round((+new Date(n.expires_at) - now.getTime()) / 86_400_000)) : null;
      const meta = [SOURCE[lang][n.source], day(n.last_seen_at), n.pinned ? '📌' : left !== null ? `${left}g` : ''].filter(Boolean).join(' · ');
      lines.push(`- ${n.subject && kind === 'client' ? `**${n.subject}**: ` : ''}${n.text} _(${meta})_`);
    }
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

/** Adds a note, or refreshes the same note if it is already there. Returns the note, or null if refused. */
export async function addNote(
  db: Queryable,
  n: { shopId: string; userId: string | null; kind: NoteKind; subject?: string | null; text: string; source: Note['source']; now: Date; pinned?: boolean },
): Promise<Note | null> {
  const text = n.text.trim().replace(/\s+/g, ' ').slice(0, 280);
  if (!text || (n.source !== 'data' && isSensitive(text))) return null;
  const same = (
    await db.query(
      `select ${COLS} from assistant_notes where shop_id = $1 and (user_id is null or user_id = $2) and (pinned or expires_at > $3)`,
      [n.shopId, n.userId, n.now],
    )
  ).rows.find((x: any) => fold(x.text) === fold(text)) as Note | undefined;
  if (same) {
    await db.query('update assistant_notes set last_seen_at = $2, expires_at = case when pinned then null else $3 end where id = $1', [same.id, n.now, expiry(n.now)]);
    return same;
  }
  const { rows } = await db.query(
    `insert into assistant_notes (shop_id, user_id, kind, subject, text, source, pinned, last_seen_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${COLS}`,
    [n.shopId, n.userId, n.kind, n.subject?.slice(0, 80) || null, text, n.source, !!n.pinned, n.now, n.pinned ? null : expiry(n.now)],
  );
  return rows[0] as Note;
}

/** What the model may do to its notes (AGENT.md → "Hafıza güncelleme"). */
export const reflectSchema = z.object({
  ops: z
    .array(
      z.discriminatedUnion('op', [
        z.object({ op: z.literal('add'), kind: z.enum(NOTE_KINDS), subject: z.string().max(80).nullable().optional(), text: z.string().min(1).max(200) }),
        z.object({ op: z.literal('update'), id: z.string(), text: z.string().min(1).max(200) }),
        z.object({ op: z.literal('touch'), id: z.string() }),
        z.object({ op: z.literal('forget'), id: z.string() }),
      ]),
    )
    .max(6),
});

/** Applies the model's memory edits. Data notes are off limits; personal preferences stay personal. */
export async function applyOps(db: Queryable, shopId: string, userId: string, ops: z.infer<typeof reflectSchema>['ops'], notes: Note[], now: Date) {
  const own = new Map(notes.filter((n) => n.source !== 'data').map((n) => [n.id, n]));
  const done = { added: 0, updated: 0, touched: 0, forgotten: 0 };
  for (const op of ops) {
    if (op.op === 'add') {
      const note = await addNote(db, { shopId, userId: op.kind === 'preference' ? userId : null, kind: op.kind, subject: op.subject, text: op.text, source: 'learned', now });
      if (note) done.added++;
      continue;
    }
    const target = own.get(op.id);
    if (!target) continue; // unknown id or a data note: ignore
    if (op.op === 'update' && !isSensitive(op.text)) {
      await db.query('update assistant_notes set text = $2, last_seen_at = $3, expires_at = case when pinned then null else $4 end where id = $1 and shop_id = $5', [op.id, op.text, now, expiry(now), shopId]);
      done.updated++;
    } else if (op.op === 'touch') {
      await db.query('update assistant_notes set last_seen_at = $2, expires_at = case when pinned then null else $3 end where id = $1 and shop_id = $4', [op.id, now, expiry(now), shopId]);
      done.touched++;
    } else if (op.op === 'forget' && !target.pinned) {
      await db.query('delete from assistant_notes where id = $1 and shop_id = $2', [op.id, shopId]);
      done.forgotten++;
    }
  }
  return done;
}

// --- notes computed from the records -------------------------------------------------------

type L = 'tr' | 'en' | 'es';
const WEEKDAY: Record<L, string[]> = {
  tr: ['pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi', 'pazar'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  es: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
};
const CATEGORY: Record<L, Record<string, string>> = {
  tr: { rent: 'Kira', utilities: 'Faturalar' },
  en: { rent: 'Rent', utilities: 'Bills' },
  es: { rent: 'El alquiler', utilities: 'Las facturas' },
};
const cap = (s: string) => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);

/** Recomputes the notes that come from the records: regulars' habits, no-shows, fixed payments, the week's rhythm. */
export async function refreshDataNotes(db: Queryable, shopId: string, now: Date) {
  const shop = (await db.query('select language, currency, timezone from shops where id = $1', [shopId])).rows[0];
  if (!shop) return 0;
  const lang: L = shop.language;
  const money = (c: number) => new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : lang === 'es' ? 'es-ES' : 'en-US', { style: 'currency', currency: shop.currency, maximumFractionDigits: 0 }).format(c / 100);
  const since = new Date(now.getTime() - 120 * 86_400_000);
  const notes: { key: string; kind: NoteKind; subject: string | null; text: string }[] = [];

  // Regulars: three or more visits in four months.
  const visits = (
    await db.query(
      `select c.id, c.name, a.starts_at, s.name as service, b.name as barber
         from appointments a join clients c on c.id = a.client_id
         left join services s on s.id = a.service_id left join barbers b on b.id = a.barber_id
        where a.shop_id = $1 and a.status = 'done' and a.starts_at >= $2 and a.starts_at < $3
        order by c.id, a.starts_at`,
      [shopId, since, now],
    )
  ).rows;
  const byClient = new Map<string, any[]>();
  for (const v of visits) byClient.set(v.id, [...(byClient.get(v.id) ?? []), v]);
  const mode = (xs: (string | number | null)[]) => {
    const c = new Map<string | number, number>();
    for (const x of xs) if (x !== null && x !== undefined) c.set(x, (c.get(x) ?? 0) + 1);
    const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] / xs.length >= 0.5 ? top[0] : null;
  };
  for (const [id, vs] of byClient) {
    if (vs.length < 3) continue;
    const days = vs.slice(1).map((v, i) => (+new Date(v.starts_at) - +new Date(vs[i].starts_at)) / 86_400_000);
    const weeks = Math.max(1, Math.round(days.reduce((a, b) => a + b, 0) / days.length / 7));
    const wd = mode(vs.map((v) => DateTime.fromJSDate(new Date(v.starts_at), { zone: shop.timezone }).weekday - 1)) as number | null;
    const service = mode(vs.map((v) => v.service)) as string | null;
    const barber = mode(vs.map((v) => v.barber)) as string | null;
    const t = {
      tr: `${weeks === 1 ? 'Her hafta' : `Genelde ${weeks} haftada bir`} gelir${wd !== null ? `, çoğunlukla ${WEEKDAY.tr[wd]}` : ''}${service ? `; genelde ${service}` : ''}${barber ? `, ${barber} ile` : ''}.`,
      en: `Comes ${weeks === 1 ? 'every week' : `about every ${weeks} weeks`}${wd !== null ? `, usually on ${WEEKDAY.en[wd]}` : ''}${service ? `; usually ${service}` : ''}${barber ? ` with ${barber}` : ''}.`,
      es: `Viene ${weeks === 1 ? 'cada semana' : `cada ${weeks} semanas más o menos`}${wd !== null ? `, casi siempre el ${WEEKDAY.es[wd]}` : ''}${service ? `; suele pedir ${service}` : ''}${barber ? ` con ${barber}` : ''}.`,
    }[lang];
    notes.push({ key: `client:${id}:habit`, kind: 'client', subject: vs[0].name, text: t });
  }

  // Clients who missed appointments.
  const missed = (
    await db.query(
      `select c.id, c.name, count(*)::int as n from appointments a join clients c on c.id = a.client_id
        where a.shop_id = $1 and a.status = 'missed' and a.starts_at >= $2 group by c.id, c.name having count(*) >= 2`,
      [shopId, since],
    )
  ).rows;
  for (const m of missed)
    notes.push({
      key: `client:${m.id}:noshow`,
      kind: 'client',
      subject: m.name,
      text: { tr: `Son 4 ayda ${m.n} randevuya gelmedi; bir gün önce teyit et.`, en: `Missed ${m.n} appointments in the last 4 months; confirm the day before.`, es: `Faltó a ${m.n} citas en los últimos 4 meses; confírmale el día antes.` }[lang],
    });

  // Fixed payments: rent and bills paid in at least two different months.
  const fixed = (
    await db.query(
      `select category, extract(day from entry_date)::int as d, amount_cents, to_char(entry_date, 'YYYY-MM') as m
         from book_entries where shop_id = $1 and kind = 'expense' and category in ('rent', 'utilities') and entry_date >= $2
        order by entry_date`,
      [shopId, DateTime.fromJSDate(since).toISODate()],
    )
  ).rows;
  for (const cat of ['rent', 'utilities']) {
    const rows = fixed.filter((r: any) => r.category === cat);
    if (new Set(rows.map((r: any) => r.m)).size < 2) continue;
    const d = mode(rows.map((r: any) => r.d)) as number | null;
    const last = rows[rows.length - 1];
    const what = CATEGORY[lang][cat];
    const text = {
      tr: `${what} ${d ? `genelde ayın ${d}'inde` : 'her ay'} ödeniyor; son ödeme ${money(last.amount_cents)}.`,
      en: `${what} ${d ? `usually paid on the ${d}th` : 'paid monthly'}; last payment ${money(last.amount_cents)}.`,
      es: `${what} ${d ? `se paga normalmente el día ${d}` : 'se paga cada mes'}; último pago ${money(last.amount_cents)}.`,
    }[lang];
    notes.push({ key: `money:${cat}`, kind: 'money', subject: null, text });
  }

  // The week's rhythm, once there are eight weeks of takings.
  const daysRows = (
    await db.query(
      `select extract(isodow from entry_date)::int as wd, count(distinct entry_date)::int as days, sum(amount_cents)::int8 as total
         from book_entries where shop_id = $1 and kind = 'income' and entry_date >= $2 group by 1`,
      [shopId, DateTime.fromJSDate(now).minus({ weeks: 8 }).toISODate()],
    )
  ).rows.map((r: any) => ({ wd: r.wd - 1, avg: Number(r.total) / r.days, days: r.days }));
  if (daysRows.reduce((a: number, r: any) => a + r.days, 0) >= 24) {
    const sorted = [...daysRows].sort((a, b) => b.avg - a.avg);
    const busy = WEEKDAY[lang][sorted[0].wd];
    const quiet = WEEKDAY[lang][sorted[sorted.length - 1].wd];
    const closed = [0, 1, 2, 3, 4, 5, 6].filter((w) => !daysRows.some((r: any) => r.wd === w)).map((w) => WEEKDAY[lang][w]);
    notes.push({
      key: 'shop:rhythm',
      kind: 'shop',
      subject: null,
      text: {
        tr: `En yoğun gün ${busy}, en sakin gün ${quiet}.${closed.length ? ` ${cap(closed.join(', '))} kapalı görünüyor.` : ''}`,
        en: `Busiest day is ${busy}, quietest is ${quiet}.${closed.length ? ` Looks closed on ${closed.join(', ')}.` : ''}`,
        es: `El día más fuerte es el ${busy} y el más flojo el ${quiet}.${closed.length ? ` Parece cerrado el ${closed.join(', ')}.` : ''}`,
      }[lang],
    });
  }

  for (const n of notes)
    await db.query(
      `insert into assistant_notes (shop_id, user_id, kind, subject, text, source, data_key, last_seen_at, expires_at)
       values ($1, null, $2, $3, $4, 'data', $5, $6, $7)
       on conflict (shop_id, data_key) where data_key is not null
       do update set text = excluded.text, subject = excluded.subject, last_seen_at = excluded.last_seen_at,
                     expires_at = case when assistant_notes.pinned then null else excluded.expires_at end`,
      [shopId, n.kind, n.subject, n.text, n.key, now, expiry(now)],
    );
  // A pattern that stopped holding goes away (unless the barber pinned it).
  await db.query(`delete from assistant_notes where shop_id = $1 and source = 'data' and not pinned and not (data_key = any($2::text[]))`, [shopId, notes.map((n) => n.key)]);
  return notes.length;
}

/** Turns since the last review, for one user. Reviewed once the conversation has been quiet a while. */
async function pendingTurns(db: Queryable, shopId: string, userId: string, since: Date | null) {
  const { rows } = await db.query(
    `select role, text, created_at from assistant_turns where shop_id = $1 and user_id = $2 and ($3::timestamptz is null or created_at > $3)
      order by created_at desc limit 40`,
    [shopId, userId, since],
  );
  return rows.reverse() as (Turn & { created_at: Date })[];
}

export const QUIET_MINUTES = 20;

type Summary = { shops: number; dataNotes: number; reviewed: number; added: number; updated: number; forgotten: number; expired: number };
const emptySummary = (): Summary => ({ shops: 0, dataNotes: 0, reviewed: 0, added: 0, updated: 0, forgotten: 0, expired: 0 });

/** One shop's upkeep: recompute data notes, then let the model review each conversation gone quiet. */
async function upkeepShop(tx: Queryable, deps: Deps, shop: { id: string; name: string; language: string; soul?: string | null }, now: Date, summary: Summary) {
  summary.shops++;
  summary.dataNotes += await refreshDataNotes(tx, shop.id, now);
  if (!deps.reflect) return;
  const users = (
    await tx.query(
      `select t.user_id, max(t.created_at) as last_at, m.reflected_at from assistant_turns t
         left join assistant_memory m on m.shop_id = t.shop_id and m.user_id = t.user_id
        where t.shop_id = $1 group by t.user_id, m.reflected_at
       having max(t.created_at) > coalesce(m.reflected_at, 'epoch') and max(t.created_at) < $2`,
      [shop.id, new Date(now.getTime() - QUIET_MINUTES * 60_000)],
    )
  ).rows;
  for (const u of users) {
    const turns = await pendingTurns(tx, shop.id, u.user_id, u.reflected_at);
    const notes = await liveNotes(tx, shop.id, u.user_id, now);
    try {
      const out = reflectSchema.safeParse(
        await deps.reflect({
          lang: shop.language,
          shop: shop.name,
          today: DateTime.fromJSDate(now).toISODate()!,
          notes: notes.map((n) => ({ id: n.id, kind: n.kind, subject: n.subject, text: n.text, source: n.source })),
          turns: turns.map((t) => ({ role: t.role, text: t.text })),
          soul: shop.soul ?? undefined,
        }),
      );
      if (out.success) {
        const d = await applyOps(tx, shop.id, u.user_id, out.data.ops, notes, now);
        summary.added += d.added;
        summary.updated += d.updated;
        summary.forgotten += d.forgotten;
      }
      summary.reviewed++;
    } catch {
      continue; // the model is down: try again next hour
    }
    // Mark the last message actually reviewed, so one that arrives meanwhile is reviewed next time.
    const upTo = turns.length ? turns[turns.length - 1].created_at : now;
    await tx.query(
      `insert into assistant_memory (shop_id, user_id, reflected_at) values ($1, $2, $3)
       on conflict (shop_id, user_id) do update set reflected_at = excluded.reflected_at`,
      [shop.id, u.user_id, upTo],
    );
  }
}

/** The upkeep inside a transaction already in system mode (the admin route). */
export async function memoryUpkeepIn(tx: Queryable, deps: Deps, now: Date) {
  const summary = emptySummary();
  summary.expired = (await tx.query('delete from assistant_notes where not pinned and expires_at < $1 returning id', [now])).rows.length;
  for (const shop of (await tx.query(`select id, name, language, nullif(concat_ws(E'\\n\\n', agent_soul, agent_md), '') as soul from shops`)).rows) await upkeepShop(tx, deps, shop, now, summary);
  return summary;
}

/**
 * The memory's upkeep, run by the API every hour: drop expired notes, then each shop in its own
 * transaction, so one slow model call never holds the others.
 */
export async function runMemoryUpkeep(db: Database, deps: Deps, now: Date) {
  const summary = emptySummary();
  const shops = await withSystem(db, async (tx) => {
    summary.expired = (await tx.query('delete from assistant_notes where not pinned and expires_at < $1 returning id', [now])).rows.length;
    return (await tx.query(`select id, name, language, nullif(concat_ws(E'\\n\\n', agent_soul, agent_md), '') as soul from shops`)).rows;
  });
  for (const shop of shops) await withSystem(db, (tx) => upkeepShop(tx, deps, shop, now, summary));
  return summary;
}
