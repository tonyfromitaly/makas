import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { hash, verify } from '@node-rs/argon2';
import { createApi, errorBody, type Config, type Database, type Deps } from '@makas/core';

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
  logger?: boolean;
}

export async function buildServer(o: ServerOptions) {
  const app = Fastify({ logger: o.logger ?? false, trustProxy: o.trustProxy ?? false, bodyLimit: 64 * 1024 });
  const handle = createApi({ db: o.db, config: o.config, deps: o.deps, log: (e) => app.log.error(e) });

  await app.register(helmet, { hsts: { maxAge: 31536000, includeSubDomains: true } });
  await app.register(cors, {
    // Only the app's own origin(s); everything else gets no CORS headers.
    origin: (origin, cb) => cb(null, !origin || (o.corsOrigins ?? []).includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      ...errorBody('RATE_LIMITED', `Too many requests, retry in ${Math.ceil(ctx.ttl / 1000)}s`),
    }),
  });

  if (o.requireHttps) {
    app.addHook('onRequest', async (req, reply) => {
      if (req.protocol !== 'https' && req.url !== '/health')
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

  const forward = async (req: FastifyRequest, reply: FastifyReply) => {
    const url = new URL(req.url, 'http://x');
    const res = await handle({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: req.body,
      authorization: req.headers.authorization,
      ip: req.ip,
    });
    reply.code(res.status).header('cache-control', 'no-store');
    return res.body === undefined ? reply.send() : reply.send(res.body);
  };

  // Auth endpoints get a much tighter per-IP limit (credential stuffing, signup spam).
  app.route({
    method: ['GET', 'POST', 'PATCH', 'DELETE'],
    url: '/auth/*',
    config: { rateLimit: { max: o.authRateLimit ?? 10, timeWindow: '1 minute' } },
    handler: forward,
  });
  app.route({ method: ['GET', 'POST', 'PATCH', 'DELETE'], url: '/*', handler: forward });
  app.route({ method: ['GET'], url: '/', handler: async () => ({ name: 'makas-api', docs: '/docs/api.md' }) });
  return app;
}
