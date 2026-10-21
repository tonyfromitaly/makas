import { z } from 'zod';
import { ok, pageQuery, paged, type Route } from '../http';
import type { Queryable } from '../db';

// The website's "request a demo" form. Public: no login, the per-IP limit on /public/* applies. The
// operator hears about each request (Deps.notifyOperator) and sees them all under /admin. Requests are
// deleted 12 months after they arrive, as the privacy notice says.

export const DEMO_REQUEST_MONTHS = 12;
/** More than this many requests from one e-mail address in a day are accepted and dropped. */
const PER_EMAIL_PER_DAY = 3;

const demoRequest = z.object({
  name: z.string().trim().min(1).max(120),
  business: z.string().trim().min(1).max(120),
  type: z.enum(['berber', 'kuafor', 'guzellik', 'diger']),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().default(''),
  city: z.string().trim().max(120).optional().default(''),
  message: z.string().trim().max(1500).optional().default(''),
  contact: z.enum(['arayin', 'eposta']).default('eposta'),
  consent: z.literal(true),
  lang: z.enum(['tr', 'en', 'es']).default('tr'),
  /** Honeypot: people never fill it. */
  company_url: z.string().max(200).optional(),
});

export const leadRoutes: Route[] = [
  {
    method: 'POST',
    path: '/public/demo-requests',
    auth: 'public',
    body: demoRequest,
    async handler(ctx, { body }) {
      const b = body as z.infer<typeof demoRequest>;
      // A bot that filled the hidden field, or someone sending the same form over and over, gets the same
      // answer as everyone else, so neither learns anything.
      if (b.company_url) return ok({ ok: true }, 201);
      const recent = (
        await ctx.db.query(`select count(*)::int as n from demo_requests where lower(email) = lower($1) and created_at > $2::timestamptz - interval '1 day'`, [b.email, ctx.now])
      ).rows[0].n;
      if (recent >= PER_EMAIL_PER_DAY) return ok({ ok: true }, 201);
      const { rows } = await ctx.db.query(
        `insert into demo_requests (name, business, business_type, email, phone, city, message, contact, lang, consent_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) returning id`,
        [b.name, b.business, b.type, b.email, b.phone, b.city, b.message, b.contact, b.lang, ctx.now],
      );
      await ctx.deps.notifyOperator
        ?.(`demo request: ${b.business}`, [
          `${b.name} · ${b.business} (${b.type})`,
          `${b.email}${b.phone ? ` · ${b.phone}` : ''}${b.city ? ` · ${b.city}` : ''}`,
          `contact by: ${b.contact === 'arayin' ? 'phone' : 'e-mail'} · language: ${b.lang}`,
          ...(b.message ? [b.message] : []),
        ])
        .catch(() => {});
      return ok({ ok: true, id: rows[0].id }, 201);
    },
  },
  {
    method: 'GET',
    path: '/admin/demo-requests',
    auth: 'admin',
    query: pageQuery,
    async handler(ctx, { query }) {
      const { rows } = await ctx.db.query(
        `select id, name, business, business_type, email, phone, city, message, contact, lang, created_at, count(*) over() as total_count
           from demo_requests order by created_at desc limit $1 offset $2`,
        [query.page_size, (query.page - 1) * query.page_size],
      );
      return paged(rows, query.page, query.page_size);
    },
  },
];

/** Deletes demo requests older than DEMO_REQUEST_MONTHS. Runs with the hourly upkeep. */
export async function purgeOldDemoRequests(tx: Queryable, now: Date) {
  const { rows } = await tx.query(`delete from demo_requests where created_at < $1::timestamptz - make_interval(months => $2) returning id`, [now, DEMO_REQUEST_MONTHS]);
  return rows.length;
}
