import { ZodError } from 'zod';
import { safeEqual, verifyAccess } from './auth';
import { withSystem, withTenant, type Database } from './db';
import { ApiError, Res, errorBody, mapPgError, notFound, unauthorized, forbidden, uuid, type Config, type Ctx, type Deps, type Route } from './http';
import { authRoutes } from './routes/auth';
import { shopRoutes, isLocked, loadSubscription } from './routes/shop';
import { clientRoutes } from './routes/clients';
import { appointmentRoutes } from './routes/appointments';
import { moneyRoutes } from './routes/money';
import { adminRoutes, workerRoutes } from './routes/worker';
import { assistantRoutes } from './routes/assistant';
import { connectionRoutes } from './routes/connections';
import { agentRoutes } from './routes/agent';

export interface ApiRequest {
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  authorization?: string;
  ip?: string;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
}

export const routes: Route[] = [
  ...authRoutes,
  ...connectionRoutes,
  ...agentRoutes,
  ...shopRoutes,
  ...clientRoutes,
  ...appointmentRoutes,
  ...moneyRoutes,
  ...assistantRoutes,
  ...workerRoutes,
  ...adminRoutes,
  { method: 'GET', path: '/health', auth: 'public', handler: async () => ({ ok: true }) },
];

interface Compiled {
  route: Route;
  re: RegExp;
  keys: string[];
}

function compile(r: Route): Compiled {
  const keys: string[] = [];
  const re = new RegExp(
    '^' + r.path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')).replace(/\//g, '\\/') + '\\/?$',
  );
  return { route: r, re, keys };
}

const bearer = (h?: string) => (h?.startsWith('Bearer ') ? h.slice(7).trim() : '');


/**
 * One request handler for every transport: Fastify on the server, and a direct call in the
 * in-browser demo. Same routes, same SQL, same tenant isolation either way.
 */
// What a shop waiting out its 30 days after deletion can still do: see that, take it back, take its
// data with it, talk to us, sign out.
const SUSPENDED_OK = new Set(['GET /shops/me', 'POST /shops/me/restore', 'GET /shops/me/export', 'GET /support', 'POST /support', 'POST /feedback', 'GET /support/unread', 'POST /auth/logout']);

async function assertNotSuspended(db: Ctx['db'], shopId: string, route: Route) {
  if (SUSPENDED_OK.has(`${route.method} ${route.path}`)) return;
  const s = (await db.query('select deleted_at, purge_after from shops where id = $1', [shopId])).rows[0];
  if (s?.deleted_at) throw new ApiError(410, 'SHOP_DELETED', `This shop is scheduled for deletion on ${new Date(s.purge_after).toISOString().slice(0, 10)}; restore it to continue`);
}

export function createApi(opts: { db: Database; config: Config; deps: Deps; log?: (e: unknown) => void }) {
  const compiled = routes.map(compile);

  return async function handle(req: ApiRequest): Promise<ApiResponse> {
    try {
      const path = req.path.split('?')[0];
      const byPath = compiled.filter((c) => c.re.test(path));
      // Static segments win over params (e.g. /reminders/due vs /reminders/:id/result).
      const match = byPath.find((c) => c.route.method === req.method.toUpperCase());
      if (!match) {
        if (byPath.length) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
        throw new ApiError(404, 'ROUTE_NOT_FOUND', 'No such endpoint');
      }
      const { route } = match;
      const m = path.match(match.re)!;
      const params: Record<string, string> = {};
      match.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      // A malformed id is indistinguishable from someone else's id: 404.
      if (params.id && !uuid.safeParse(params.id).success) throw notFound();

      const query = route.query ? route.query.parse(req.query ?? {}) : req.query ?? {};
      const body = route.body ? route.body.parse(req.body ?? {}) : req.body;
      const now = opts.config.now();
      const base = { config: opts.config, deps: opts.deps, now };
      const input = { params, query, body, ip: req.ip };
      const token = bearer(req.authorization);

      let result: unknown;
      if (route.auth === 'public') {
        result = await withSystem(opts.db, (db) => route.handler({ ...base, db, shopId: '', userId: '', role: 'public' }, input));
      } else if (route.auth === 'service' || route.auth === 'admin') {
        const secret = route.auth === 'service' ? opts.config.serviceApiKey : opts.config.adminApiKey;
        if (!(await safeEqual(token, secret))) throw unauthorized('Invalid service credentials');
        result = await withSystem(opts.db, (db) =>
          route.handler({ ...base, db, shopId: '', userId: '', role: route.auth as 'service' | 'admin' }, input),
        );
      } else {
        if (!token) throw unauthorized();
        const claims = await verifyAccess(opts.config, token);
        const run = async (db: Ctx['db']) => {
          const user = (await db.query('select id, role from users where id = $1 and shop_id = $2', [claims.sub, claims.shop]))
            .rows[0];
          if (!user) throw unauthorized('Account no longer exists');
          if (route.ownerOnly && user.role !== 'owner') throw forbidden('Only the shop owner can do this');
          await assertNotSuspended(db, claims.shop, route);
          if (route.gated && isLocked(await loadSubscription(db, claims.shop), now))
            throw new ApiError(402, 'SUBSCRIPTION_INACTIVE', 'Subscription is not active');
          return route.handler({ ...base, db, shopId: claims.shop, userId: user.id, role: user.role }, input);
        };
        if (route.outside) {
          // Checks in a short transaction, then the handler runs free of it.
          const shop = claims.shop;
          const tenantDb = { query: (sql: string, params?: unknown[]) => withTenant(opts.db, shop, (tx) => tx.query(sql, params)) } as Ctx['db'];
          let checked: { id: string; role: Ctx['role'] } | null = null;
          await withTenant(opts.db, shop, async (db) => {
            const user = (await db.query('select id, role from users where id = $1 and shop_id = $2', [claims.sub, shop])).rows[0];
            if (!user) throw unauthorized('Account no longer exists');
            if (route.ownerOnly && user.role !== 'owner') throw forbidden('Only the shop owner can do this');
            await assertNotSuspended(db, shop, route);
            if (route.gated && isLocked(await loadSubscription(db, shop), now)) throw new ApiError(402, 'SUBSCRIPTION_INACTIVE', 'Subscription is not active');
            checked = user;
          });
          const u = checked as unknown as { id: string; role: Ctx['role'] };
          result = await route.handler({ ...base, db: tenantDb, shopId: shop, userId: u.id, role: u.role }, input);
        } else result = route.system ? await withSystem(opts.db, run) : await withTenant(opts.db, claims.shop, run);
      }

      if (result instanceof Res) return { status: result.status, body: result.body };
      if (result === undefined) return { status: 204 };
      return { status: 200, body: result };
    } catch (e: any) {
      if (e instanceof ApiError) return { status: e.status, body: errorBody(e.code, e.message) };
      if (e instanceof ZodError) {
        const i = e.issues[0];
        return { status: 400, body: errorBody('VALIDATION_ERROR', `${i.path.join('.') || 'input'}: ${i.message}`) };
      }
      const mapped = mapPgError(e);
      if (mapped) return { status: mapped.status, body: errorBody(mapped.code, mapped.message) };
      opts.log?.(e);
      return { status: 500, body: errorBody('INTERNAL', 'Something went wrong') };
    }
  };
}

export type Handle = ReturnType<typeof createApi>;
