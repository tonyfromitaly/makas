import { migrate, runMemoryUpkeep, seedDemo } from '@makas/core';
import { env, loadConfig } from './config';
import { openDatabase } from './db';
import { parseServiceClient } from './parse-service';
import { assistantClient, chatClient, reflectClient } from './assistant-llm';
import { argon2Deps, buildServer } from './server';
import { stripeProvider } from './billing';
import { consoleMailer, resendMailer } from './email';
import { fileURLToPath } from 'node:url';
import { dryRunChannel, twilioSmsChannel, whatsappChannel, type Channel, type ChannelKind } from './messaging';
import { startSender } from './messaging-routes';

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
  messaging: {
    whatsapp: env.whatsappAppSecret && env.whatsappVerifyToken ? { appSecret: env.whatsappAppSecret, verifyToken: env.whatsappVerifyToken } : undefined,
    twilio: env.twilioAuthToken ? { authToken: env.twilioAuthToken, webhookUrl: `${env.publicUrl}${env.apiPrefix}/webhooks/twilio` } : undefined,
  },
});
const paymentsOn = !!(env.stripeSecretKey && env.stripePriceId && env.stripeWebhookSecret);
console.log(`billing: ${paymentsOn ? 'stripe' : 'off, website takes applications (set STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET)'} · mail: ${env.resendApiKey ? 'resend' : 'console'} · signup: ${env.allowSignup ? 'open' : 'website only'}`);
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
const stopSender = channelNames.length ? startSender(app, { prefix: env.apiPrefix, serviceKey: config.serviceApiKey, channels }) : () => {};

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
  stopSender();
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
