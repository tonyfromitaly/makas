import { alertPlan, healthChecks, markSent, migrate, plaidBaglanti, purgeDeletedShops, purgeOldDemoRequests, runExclusive, runMemoryUpkeep, runRetention, seedDemo, squareBaglanti, withSystem } from '@makas/core';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { env, llmEnv, llmName, loadConfig } from './config';
import { openDatabase } from './db';
import { parseServiceClient } from './parse-service';
import { assistantClient, chatClient, reflectClient } from './assistant-llm';
import { argon2Deps, buildServer } from './server';
import { stripeProvider } from './billing';
import { consoleMailer, resendMailer } from './email';
import { fileURLToPath } from 'node:url';
import { dryRunChannel, twilioSmsChannel, whatsappChannel, type Channel, type ChannelKind } from './messaging';
import { startSender } from './messaging-routes';
import { alerter, alertText } from './alerts';

const db = await openDatabase(env.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log('migrations applied:', applied.join(', '));
// The demo shop has a published password: never on a production server unless SEED_DEMO asks for it.
if (env.seedDemo || (!env.isProd && env.databaseUrl.startsWith('pglite:'))) {
  const r = await seedDemo(db, { hashPassword: argon2Deps.hashPassword, now: new Date() });
  if (r.created) console.log('demo shop seeded (see README for the demo login)');
}

const config = loadConfig();
if (!env.isProd) {
  console.log('dev mode: service and admin keys are random per boot unless set in .env');
}
const llm = llmEnv();
console.log(`assistant: ${llmName(llm)}`);
// Square: on when the app id and secret are set. Stored tokens are encrypted with CONNECTION_SECRET.
const squareOn = !!(env.squareAppId && env.squareAppSecret);
const plaidOn = !!(env.plaidClientId && env.plaidSecret);
if ((squareOn || plaidOn) && env.isProd && env.connectionSecret.length < 32) throw new Error('CONNECTION_SECRET (32+ characters) is required when a connection is configured');
const plaid = plaidOn
  ? plaidBaglanti(db, { env: env.plaidEnv, clientId: env.plaidClientId, secret: env.plaidSecret, kasaSecret: env.connectionSecret || config.jwtSecret }, () => new Date())
  : undefined;
const square = squareOn
  ? squareBaglanti(db, { env: env.squareEnv, clientId: env.squareAppId, clientSecret: env.squareAppSecret, secret: env.connectionSecret || config.jwtSecret }, () => new Date())
  : undefined;
console.log(`connections: ${[squareOn ? `square (${env.squareEnv})` : '', plaidOn ? `bank via plaid (${env.plaidEnv})` : ''].filter(Boolean).join(' + ') || 'off (set SQUARE_APP_ID/SECRET or PLAID_CLIENT_ID/SECRET)'}`);
// What the health checks read from this server: is a reminder channel on, how many 5xx in 15 minutes.
let sending = false;
const errors: number[] = [];
const recentErrors = () => {
  const since = Date.now() - 15 * 60_000;
  while (errors.length && errors[0] < since) errors.shift();
  return errors.length;
};
const JOBS = ['sync', 'upkeep'];
const deps = {
  ...argon2Deps,
  health: () => ({ sending, errors5xx: recentErrors(), jobs: JOBS }),
  // Called only while serving requests, after `alerts` below exists.
  notifyOperator: (subject: string, lines: string[]) => alerts.send(subject, lines),
  parseNote: parseServiceClient(env.parseServiceUrl, env.parseServiceKey),
  assistant: assistantClient(llm),
  chat: chatClient(llm),
  reflect: reflectClient(llm),
  baglanti: square || plaid ? { square, plaid } : undefined,
};
const mailer = env.resendApiKey ? resendMailer(env.resendApiKey, env.mailFrom) : consoleMailer();
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
  mailer,
  publicUrl: env.publicUrl,
  messaging: {
    whatsapp: env.whatsappAppSecret && env.whatsappVerifyToken ? { appSecret: env.whatsappAppSecret, verifyToken: env.whatsappVerifyToken } : undefined,
    twilio: env.twilioAuthToken ? { authToken: env.twilioAuthToken, webhookUrl: `${env.publicUrl}${env.apiPrefix}/webhooks/twilio` } : undefined,
  },
});
const paymentsOn = !!(env.stripeSecretKey && env.stripePriceId && env.stripeWebhookSecret);
console.log(`billing: ${paymentsOn ? 'stripe' : 'off, website takes applications (set STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET)'} · mail: ${env.resendApiKey ? 'resend' : 'console'} · signup: ${env.allowSignup ? 'open' : 'website only'}`);
app.addHook('onResponse', async (_req, reply) => {
  if (reply.statusCode >= 500) errors.push(Date.now());
});
const alerts = alerter({ mailer, to: env.alertEmail, webhookUrl: env.alertWebhookUrl, service: 'monacount', log: (o, m) => app.log.warn(o, m) });
console.log(`alerts: ${[env.alertEmail ? 'e-mail' : '', env.alertWebhookUrl ? 'webhook' : ''].filter(Boolean).join(' + ') || 'log only (set ALERT_EMAIL or ALERT_WEBHOOK_URL)'}`);
await app.listen({ port: env.port, host: env.host });

// Reminders: whichever channels are configured send what is due; nothing configured, nothing is leased
// (rows stay queued, so turning a channel on later still sends the ones not yet late).
const channels: Partial<Record<ChannelKind, Channel>> = {};
if (env.senderDryRun && !env.isProd) {
  channels.whatsapp = dryRunChannel('whatsapp', (s) => app.log.info(s));
  channels.sms = dryRunChannel('sms', (s) => app.log.info(s));
} else {
  if (env.whatsappToken && env.whatsappPhoneNumberId)
    channels.whatsapp = whatsappChannel({
      token: env.whatsappToken,
      phoneNumberId: env.whatsappPhoneNumberId,
      templates: { reminder_day_before: env.whatsappTemplateDayBefore, reminder_day_of: env.whatsappTemplateDayOf },
    });
  if (env.twilioAccountSid && env.twilioAuthToken && env.twilioFrom)
    channels.sms = twilioSmsChannel({ accountSid: env.twilioAccountSid, authToken: env.twilioAuthToken, from: env.twilioFrom });
}
const channelNames = Object.values(channels).map((c) => c!.name);
console.log(`reminders: ${channelNames.length ? channelNames.join(' + ') : 'not sending (set WHATSAPP_* or TWILIO_*, or SENDER_DRY_RUN=true locally)'}`);
sending = channelNames.length > 0;
const stopSender = channelNames.length ? startSender(app, { prefix: env.apiPrefix, serviceKey: config.serviceApiKey, channels }) : () => {};

// The assistant's memory keeps itself up to date: every hour it recomputes notes from the records,
// reviews conversations that went quiet and drops notes older than 90 days (core/agent/AGENT.md).
const upkeep = async () => {
  // Shops deleted more than 30 days ago go for good, everything they own with them.
  try {
    const purged = await withSystem(db, (tx) => purgeDeletedShops(tx, new Date()));
    if (purged) app.log.info({ purged }, 'deleted shops purged');
    const requests = await withSystem(db, (tx) => purgeOldDemoRequests(tx, new Date()));
    if (requests) app.log.info({ requests }, 'old demo requests deleted');
    // Cancelled shops after 90 days, assistant conversations after 90 days (the privacy policy's promise).
    const kept = await withSystem(db, (tx) =>
      runRetention(tx, new Date(), { days: Number(process.env.RETENTION_DAYS ?? 90), chatDays: Number(process.env.ASSISTANT_RETENTION_DAYS ?? 90) }),
    );
    if (kept.shops || kept.turns || kept.notes) app.log.info({ retention: kept }, 'retention');
  } catch (e) {
    app.log.error(e, 'purge failed');
  }
  try {
    const s = await runMemoryUpkeep(db, deps, new Date());
    app.log.info({ memory: s }, 'memory upkeep');
  } catch (e) {
    app.log.error(e, 'memory upkeep failed');
  }
};
// Connected shops with a live subscription are synced every hour, one after the other.
const syncAll = async () => {
  const shops = await withSystem(db, async (tx) => (
      await tx.query(
        `select c.shop_id, c.provider from connections c join subscriptions s on s.shop_id = c.shop_id
          join shops sh on sh.id = c.shop_id and sh.deleted_at is null
          where c.status in ('connected', 'error')
            and s.status in ('trial', 'active') and (s.current_period_end is null or s.current_period_end > now())`,
      )
    ).rows);
  for (const { shop_id, provider } of shops) {
    const p = provider === 'square' ? square : provider === 'plaid' ? plaid : undefined;
    if (!p) continue;
    try {
      app.log.info({ shop: shop_id, [provider]: await p.esitle(shop_id) }, `${provider} sync`);
    } catch (e) {
      app.log.warn({ shop: shop_id, error: String((e as Error).message) }, `${provider} sync failed`);
    }
  }
};
// Each hourly job runs on one server copy at a time: a second copy (a deploy overlapping the old one, or
// more than one instance) finds the lease taken and skips. The lease outlives a slow run, not the next hour.
const holder = `${process.env.RENDER_INSTANCE_ID ?? hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
const exclusive = (name: string, fn: () => Promise<unknown>, leaseMinutes = 55) => async () => {
  try {
    const r = await runExclusive(db, { name, holder, leaseMinutes, now: () => new Date() }, fn);
    if (!r.ran) app.log.info({ job: name }, 'job skipped: another copy holds it');
  } catch (e) {
    app.log.error(e, `job ${name} failed`);
  }
};
const runSync = exclusive('sync', syncAll);
const runUpkeep = exclusive('upkeep', upkeep);

// Every 15 minutes: run the health checks and tell the operator about new problems, ones still open after
// 6 hours, and recoveries. Uptime itself is watched from outside (GET /api/health/ready, docs/gozetim.md).
const alerted = new Map<string, Date>();
const watch = exclusive(
  'watch',
  async () => {
    const now = new Date();
    const checks = await healthChecks(db, { now, ...deps.health() });
    const plan = alertPlan(checks, alerted, now);
    if (!plan.problems.length && !plan.recovered.length) return;
    const { subject, lines } = alertText(plan);
    await alerts.send(subject, lines);
    markSent(plan, alerted, now);
  },
  10,
);

const firstUpkeep = setTimeout(runUpkeep, 60_000);
const firstWatch = setTimeout(watch, 5 * 60_000);
const hourlySync = setInterval(runSync, 3600_000);
const hourly = setInterval(runUpkeep, 3600_000);
const watching = setInterval(watch, 15 * 60_000);

// A crash is the one problem the 15-minute round never sees: say so before the process goes.
const fatal = (kind: string) => (e: unknown) => {
  app.log.fatal(e, kind);
  const done = alerts.send(`server stopped: ${kind}`, [String((e as Error)?.stack ?? e).slice(0, 1500)]);
  Promise.race([done, new Promise((r) => setTimeout(r, 5000))]).finally(() => process.exit(1));
};
process.on('uncaughtException', fatal('uncaught exception'));
process.on('unhandledRejection', fatal('unhandled rejection'));

const shutdown = async () => {
  clearTimeout(firstUpkeep);
  clearTimeout(firstWatch);
  clearInterval(hourly);
  clearInterval(hourlySync);
  clearInterval(watching);
  stopSender();
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
