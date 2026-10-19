// Connections (Square first) and the shop's own Röntgen. Owner only.
// Flow: start → the owner signs in at Square → Square sends them back to the app with ?code&state →
// the app posts them to finish → first sync. Later syncs run hourly on the server, or on demand.
import { z } from 'zod';
import { ApiError, badRequest, ok, type Route } from '../http';
import { durumOku, durumYaz, rontgenVerisi } from '../baglanti/esitle';
import { rontgen } from '../rontgen/motor';
import { raporHtml } from '../rontgen/rapor';

const square = (ctx: { deps: any }) => {
  const s = ctx.deps.baglanti?.square;
  if (!s) throw new ApiError(503, 'NOT_CONFIGURED', 'Square connection is not set up on this server');
  return s as NonNullable<NonNullable<import('../http').Deps['baglanti']>['square']>;
};

export const connectionRoutes: Route[] = [
  {
    method: 'GET',
    path: '/connections',
    auth: 'user',
    ownerOnly: true,
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select provider, status, external_account, last_sync_at, last_error, created_at,
                (select count(*)::int from import_rows i where i.shop_id = c.shop_id and i.provider = c.provider and i.kind = 'kayit') as rows
           from connections c where shop_id = $1 order by provider`,
        [ctx.shopId],
      );
      return { data: rows, available: { square: !!ctx.deps.baglanti?.square } };
    },
  },
  {
    method: 'POST',
    path: '/connections/square/start',
    auth: 'user',
    ownerOnly: true,
    gated: true,
    async handler(ctx) {
      return { url: square(ctx).yetkiUrl(await durumYaz(ctx.config.jwtSecret, ctx.shopId, ctx.now)) };
    },
  },
  {
    method: 'POST',
    path: '/connections/square/finish',
    auth: 'user',
    ownerOnly: true,
    gated: true,
    outside: true,
    body: z.object({ code: z.string().min(1).max(500), state: z.string().min(1).max(500) }),
    async handler(ctx, { body }) {
      const shop = await durumOku(ctx.config.jwtSecret, body.state, ctx.now);
      if (shop !== ctx.shopId) throw badRequest('This sign-in link is expired or belongs to another shop; start again', 'BAD_STATE');
      const s = square(ctx);
      const { merchant } = await s.bagla(ctx.shopId, body.code);
      const sync = await s.esitle(ctx.shopId);
      return ok({ merchant, sync }, 201);
    },
  },
  {
    method: 'POST',
    path: '/connections/square/sync',
    auth: 'user',
    ownerOnly: true,
    gated: true,
    outside: true,
    async handler(ctx) {
      return { sync: await square(ctx).esitle(ctx.shopId) };
    },
  },
  {
    // Disconnects; ?data=delete also removes everything read from Square.
    method: 'DELETE',
    path: '/connections/square',
    auth: 'user',
    ownerOnly: true,
    outside: true,
    query: z.object({ data: z.enum(['keep', 'delete']).default('keep') }),
    async handler(ctx, { query }) {
      await square(ctx).kopar(ctx.shopId);
      if (query.data === 'delete') {
        await ctx.db.query(`delete from import_rows where shop_id = $1 and provider = 'square'`, [ctx.shopId]);
        await ctx.db.query(`delete from book_entries where shop_id = $1 and source = 'import' and external_ref like 'square:%'`, [ctx.shopId]);
      }
    },
  },
  {
    // The shop's X-ray from everything we hold: imported data plus the app's own books and appointments.
    method: 'GET',
    path: '/rontgen',
    auth: 'user',
    ownerOnly: true,
    gated: true,
    query: z.object({ format: z.enum(['json', 'html']).default('json') }),
    async handler(ctx, { query }) {
      const v = await rontgenVerisi(ctx.db, ctx.shopId);
      if (!v.kayitlar.length) return { rontgen: null, reason: 'NO_DATA' };
      const r = rontgen(v.kayitlar, { ad: v.ad, para: v.para, randevular: v.randevular });
      return query.format === 'html' ? { html: raporHtml(r) } : { rontgen: r };
    },
  },
];
