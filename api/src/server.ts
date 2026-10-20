import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { billingRoutes, type PaymentProvider } from './billing';
import { consoleMailer, type Mailer } from './email';
import { hash, verify } from '@node-rs/argon2';
import { createApi, errorBody, type Config, type Database, type Deps } from '@makas/core';
import { messagingRoutes, type MessagingOptions } from './messaging-routes';

export const argon2Deps: Pick<Deps, 'hashPassword' | 'verifyPassword'> = {
  // argon2id, OWASP-recommended parameters.
  hashPassword: (p) => hash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
  verifyPassword: (h, p) => verify(h, p).catch(() => false),
};

export interface ServerOptions {
  db: Database;
  config: Config;
  deps: Deps;
  corsOrigins?: string[];
  trustProxy?: boolean;
  requireHttps?: boolean;
  authRateLimit?: number;
  /** Requests per minute per IP for everything (default 300). */
  rateLimit?: number;
  /** Assistant messages per minute per signed-in user (default 30): each may cost a model call. */
  assistantRateLimit?: number;
  logger?: boolean;
  /** "/api" when the same server also serves the website and the app. */
  prefix?: string;
  /** Built website (served at /) and app (served at /app/). */
  staticDirs?: { site?: string; app?: string };
  payments?: PaymentProvider | null;
  mailer?: Mailer;
  publicUrl?: string;
  /** Provider callbacks for STOP replies (WhatsApp, Twilio). The routes exist either way; unset = 404. */
  messaging?: Pick<MessagingOptions, 'whatsapp' | 'twilio'>;
}

export async function buildServer(o: ServerOptions) {
  const app = Fastify({ logger: o.logger ?? false, trustProxy: o.trustProxy ?? false, bodyLimit: 64 * 1024 });
  const handle = createApi({ db: o.db, config: o.config, deps: o.deps, log: (e) => app.log.error(e) });

  // The app opens Plaid Link (the bank sign-in window) from Plaid's own CDN when served from here.
  await app.register(helmet, {
    hsts: { maxAge: 31536000, includeSubDomains: true },
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'", 'https://cdn.plaid.com'],
        'frame-src': ["'self'", 'https://cdn.plaid.com'],
        'connect-src': ["'self'", 'https://production.plaid.com', 'https://sandbox.plaid.com'],
      },
    },
  });
  await app.register(cors, {
    // Only the app's own origin(s); everything else gets no CORS headers.
    origin: (origin, cb) => cb(null, !origin || (o.corsOrigins ?? []).includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
  });
  await app.register(rateLimit, {
    global: true,
    max: o.rateLimit ?? 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      ...errorBody('RATE_LIMITED', `Too many requests, retry in ${Math.ceil(ctx.ttl / 1000)}s`),
    }),
  });

  if (o.requireHttps) {
    app.addHook('onRequest', async (req, reply) => {
      if (req.protocol !== 'https' && !req.url.endsWith('/health'))
        return reply.code(403).send(errorBody('HTTPS_REQUIRED', 'Use HTTPS'));
    });
  }

  app.setErrorHandler((err: any, _req, reply) => {
    if (err.statusCode === 429) return reply.code(429).send(errorBody('RATE_LIMITED', err.error?.message ?? 'Too many requests'));
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || err.statusCode === 400)
      return reply.code(400).send(errorBody('BAD_REQUEST', 'Malformed request body'));
    if (err.statusCode === 413) return reply.code(413).send(errorBody('PAYLOAD_TOO_LARGE', 'Request body too large'));
    app.log.error(err);
    return reply.code(500).send(errorBody('INTERNAL', 'Something went wrong'));
  });

  const prefix = o.prefix ?? '';
  const forward = async (req: FastifyRequest, reply: FastifyReply) => {
    const url = new URL(req.url, 'http://x');
    const res = await handle({
      method: req.method,
      path: url.pathname.slice(prefix.length) || '/',
      query: Object.fromEntries(url.searchParams),
      body: req.body,
      authorization: req.headers.authorization,
      ip: req.ip,
    });
    reply.code(res.status).header('cache-control', 'no-store');
    return res.body === undefined ? reply.send() : reply.send(res.body);
  };

  // Auth endpoints get a much tighter per-IP limit (credential stuffing, signup spam).
  // Website subscriptions (Stripe) live next to the core routes, under the same prefix.
  await billingRoutes(app, {
    db: o.db,
    config: o.config,
    provider: o.payments ?? null,
    mailer: o.mailer ?? consoleMailer((s) => app.log.info(s)),
    publicUrl: o.publicUrl ?? o.config.publicUrl ?? 'http://localhost:5173',
    prefix,
  });

  await messagingRoutes(app, { prefix, serviceKey: o.config.serviceApiKey, ...o.messaging });

  app.route({
    method: ['GET', 'POST', 'PATCH', 'DELETE'],
    url: `${prefix}/auth/*`,
    config: { rateLimit: { max: o.authRateLimit ?? 10, timeWindow: '1 minute' } },
    handler: forward,
  });
  app.route({
    method: 'POST',
    url: `${prefix}/assistant`,
    config: {
      rateLimit: { max: o.assistantRateLimit ?? 30, timeWindow: '1 minute', keyGenerator: (req) => String(req.headers.authorization ?? req.ip) },
    },
    handler: forward,
  });
  app.route({ method: ['GET', 'POST', 'PATCH', 'DELETE'], url: `${prefix}/*`, handler: forward });

  const site = o.staticDirs?.site;
  const web = o.staticDirs?.app;
  if (site && existsSync(site)) {
    await app.register(fastifyStatic, { root: site, prefix: '/', wildcard: false, index: ['index.html'] });
  }
  if (web && existsSync(web)) {
    await app.register(fastifyStatic, { root: web, prefix: '/app/', decorateReply: !site, wildcard: false, index: ['index.html'] });
    // The app is a single page: unknown paths under /app/ get its index.html.
    app.get('/app', (_req, reply) => reply.redirect('/app/'));
    app.get('/app/*', (_req, reply) => reply.type('text/html').sendFile('index.html', web));
  }
  if (!site) app.route({ method: ['GET'], url: '/', handler: async () => ({ name: 'fade-api', docs: '/docs/api.md' }) });
  return app;
}
