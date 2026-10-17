import { migrate, runMemoryUpkeep, seedDemo } from '@makas/core';
import { env, loadConfig } from './config';
import { openDatabase } from './db';
import { parseServiceClient } from './parse-service';
import { assistantClient, chatClient, reflectClient } from './assistant-llm';
import { argon2Deps, buildServer } from './server';
import { stripeProvider } from './billing';
import { consoleMailer, resendMailer } from './email';
import { fileURLToPath } from 'node:url';

const db = await openDatabase(env.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log('migrations applied:', applied.join(', '));
if (env.seedDemo || env.databaseUrl.startsWith('pglite:')) {
  const r = await seedDemo(db, { hashPassword: argon2Deps.hashPassword, now: new Date() });
  if (r.created) console.log('demo shop seeded (see README for the demo login)');
}

const config = loadConfig();
if (!env.isProd) {
  console.log('dev mode: service and admin keys are random per boot unless set in .env');
}
console.log(env.aiApiKey ? `assistant: ${env.aiModel} via ${env.aiBaseUrl}` : 'assistant: built-in rule engine (set AI_API_KEY in .env for DeepSeek)');
const llm = { url: env.aiBaseUrl, key: env.aiApiKey, model: env.aiModel };
const deps = {
  ...argon2Deps,
  parseNote: parseServiceClient(env.parseServiceUrl, env.parseServiceKey),
  assistant: assistantClient(llm),
  chat: chatClient(llm),
  reflect: reflectClient(llm),
};
const app = await buildServer({
  db,
  config,
  deps,
  corsOrigins: env.corsOrigins,
  trustProxy: env.trustProxy,
  requireHttps: env.isProd && process.env.REQUIRE_HTTPS !== 'false',
  logger: true,
  prefix: env.apiPrefix,
  staticDirs: env.serveStatic
    ? { site: fileURLToPath(new URL('../../site/dist', import.meta.url)), app: fileURLToPath(new URL('../../app/dist', import.meta.url)) }
    : undefined,
  payments:
    env.stripeSecretKey && env.stripePriceId && env.stripeWebhookSecret
      ? stripeProvider({ secretKey: env.stripeSecretKey, priceId: env.stripePriceId, webhookSecret: env.stripeWebhookSecret })
      : null,
  mailer: env.resendApiKey ? resendMailer(env.resendApiKey, env.mailFrom) : consoleMailer(),
  publicUrl: env.publicUrl,
});
const paymentsOn = !!(env.stripeSecretKey && env.stripePriceId && env.stripeWebhookSecret);
console.log(`billing: ${paymentsOn ? 'stripe' : 'off, website takes applications (set STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET)'} · mail: ${env.resendApiKey ? 'resend' : 'console'} · signup: ${env.allowSignup ? 'open' : 'website only'}`);
await app.listen({ port: env.port, host: env.host });

// The assistant's memory keeps itself up to date: every hour it recomputes notes from the records,
// reviews conversations that went quiet and drops notes older than 90 days (core/agent/AGENT.md).
const upkeep = async () => {
  try {
    const s = await runMemoryUpkeep(db, deps, new Date());
    app.log.info({ memory: s }, 'memory upkeep');
  } catch (e) {
    app.log.error(e, 'memory upkeep failed');
  }
};
const firstUpkeep = setTimeout(upkeep, 60_000);
const hourly = setInterval(upkeep, 3600_000);

const shutdown = async () => {
  clearTimeout(firstUpkeep);
  clearInterval(hourly);
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
