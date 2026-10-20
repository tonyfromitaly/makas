// The shop's setup (what the wizard decided) and the agent's notes. Owner only: the notes speak about
// the whole business's money, which staff accounts do not see.
import { z } from 'zod';
import { noContent, notFound, uuid, type Route } from '../http';
import { kurulumUret } from '../kurulum/uret';
import { SABLONLAR } from '../kurulum/katalog';
import { isaretleriGuncelle, isaretlerEskiMi } from '../ajan/isaretler';

const cevaplar = z.object({
  isletme: z.string().trim().min(1).max(80),
  sahip: z.string().trim().max(60).default(''),
  sablon: z.enum(SABLONLAR.map((s) => s.id) as [string, ...string[]]),
  dil: z.enum(['tr', 'en']),
  sistemler: z.array(z.string().max(40)).max(30).default([]),
  dertler: z.array(z.string().max(40)).max(4).default([]),
  ekip: z.array(z.enum(['maas', 'komisyon', 'kira'])).max(3).default([]),
  kisi: z.number().int().min(1).max(500).default(1),
  ton: z.enum(['samimi', 'resmi']).default('samimi'),
  gizlilik: z.enum(['yerel', 'ozet']).default('yerel'),
  tema: z.object({ skin: z.string().max(20), accent: z.string().max(20).nullable() }).optional(),
});

export const agentRoutes: Route[] = [
  {
    method: 'POST',
    path: '/shops/me/setup',
    auth: 'user',
    ownerOnly: true,
    gated: true,
    body: cevaplar,
    async handler(ctx, { body }) {
      const k = kurulumUret(body as any);
      const modules = k.moduller.filter((m) => m.acik).map((m) => m.id);
      await ctx.db.query(
        `update shops set modules = $2, look = $3, setup = $4, agent_soul = $5, agent_md = $6, signals_at = null where id = $1`,
        [ctx.shopId, modules, JSON.stringify(k.tema), JSON.stringify({ cevaplar: body, ajanAdi: k.ajanAdi, at: ctx.now }), k.soulMd, k.agentMd],
      );
      // Where the work happens: a salon gets its chairs, a spa its rooms, one per person to start with.
      const place = ({ kuafor: 'chair', guzellik: 'room' } as Record<string, string>)[body.sablon];
      if (place) {
        const has = (await ctx.db.query('select count(*)::int as n from stations where shop_id = $1', [ctx.shopId])).rows[0].n;
        if (!has) {
          const word = place === 'chair' ? (body.dil === 'tr' ? 'Koltuk' : 'Chair') : body.dil === 'tr' ? 'Oda' : 'Room';
          for (let i = 1; i <= Math.min(Math.max(body.kisi, 1), 20); i++)
            await ctx.db.query('insert into stations (shop_id, name, kind, sort) values ($1, $2, $3, $4)', [ctx.shopId, `${word} ${i}`, place, i]);
          await ctx.db.query('update services set station_kind = $2 where shop_id = $1 and station_kind is null', [ctx.shopId, place]);
        }
      }
      // One way of paying the team named: it becomes everyone's starting deal (each can be changed later).
      if (body.ekip.length === 1) {
        const model = ({ maas: 'salary', komisyon: 'commission', kira: 'booth_rent' } as Record<string, string>)[body.ekip[0] as string];
        await ctx.db.query(`update barbers set pay_model = $2 where shop_id = $1 and pay_model = 'commission' and service_pct = 50`, [ctx.shopId, model]);
      }
      return { modules, look: k.tema, agent_name: k.ajanAdi, warnings: k.uyarilar, steps: k.adimlar };
    },
  },
  {
    method: 'GET',
    path: '/shops/me/agent',
    auth: 'user',
    ownerOnly: true,
    async handler(ctx) {
      const r = (await ctx.db.query(`select agent_soul as soul, agent_md as md, setup->>'ajanAdi' as name from shops where id = $1`, [ctx.shopId])).rows[0];
      return r ?? { soul: null, md: null, name: null };
    },
  },
  {
    method: 'GET',
    path: '/signals',
    auth: 'user',
    ownerOnly: true,
    gated: true,
    async handler(ctx) {
      if (await isaretlerEskiMi(ctx.db, ctx.shopId, ctx.now)) await isaretleriGuncelle(ctx.db, ctx.shopId, ctx.now);
      const { rows } = await ctx.db.query(
        `select id, key, severity, title, body, advice, evidence, effect, action, updated_at from agent_signals
          where shop_id = $1 and dismissed_at is null and resolved_at is null
          order by case severity when 'yuksek' then 0 when 'orta' then 1 else 2 end, effect desc nulls last`,
        [ctx.shopId],
      );
      const name = (await ctx.db.query(`select setup->>'ajanAdi' as n from shops where id = $1`, [ctx.shopId])).rows[0]?.n ?? null;
      return { data: rows, agent_name: name };
    },
  },
  {
    method: 'POST',
    path: '/signals/:id/dismiss',
    auth: 'user',
    ownerOnly: true,
    async handler(ctx, { params }) {
      uuid.parse(params.id);
      const r = await ctx.db.query(`update agent_signals set dismissed_at = $3 where id = $1 and shop_id = $2 returning id`, [params.id, ctx.shopId, ctx.now]);
      if (!r.rows.length) throw notFound('Signal');
      return noContent();
    },
  },
];
