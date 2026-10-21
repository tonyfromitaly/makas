import type { Config } from '@makas/core';

// Local .env files (never committed). The repo ships only .env.example with empty values.
for (const f of ['.env', '../.env']) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* not present */
  }
}

const isProd = process.env.NODE_ENV === 'production';

function secret(name: string, devFallback: string) {
  const v = process.env[name];
  if (v) {
    if (isProd && v.length < 32) throw new Error(`${name} must be at least 32 characters in production`);
    return v;
  }
  if (isProd) throw new Error(`${name} is required in production`);
  // Development only: random per boot, never a value committed to the repo.
  return devFallback;
}

const rand = () => crypto.randomUUID() + crypto.randomUUID();

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  /** postgres://... for a real server, or "pglite:./.data/db" for the zero-install dev mode. */
  databaseUrl: process.env.DATABASE_URL ?? 'pglite:./.data/db',
  corsOrigins: (process.env.CORS_ORIGINS ?? (isProd ? '' : 'http://localhost:5173')).split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === 'true',
  parseServiceUrl: process.env.PARSE_SERVICE_URL ?? '',
  parseServiceKey: process.env.PARSE_SERVICE_KEY ?? '',
  // The assistant's model (see llmEnv below). Claude in production; DeepSeek or any OpenAI-compatible API
  // for local work and trials. No key = the built-in rule engine.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  aiProvider: process.env.AI_PROVIDER ?? '',
  aiBaseUrl: process.env.AI_BASE_URL || 'https://api.deepseek.com',
  aiApiKey: process.env.AI_API_KEY ?? '',
  aiModel: process.env.AI_MODEL || 'deepseek-chat',
  seedDemo: process.env.SEED_DEMO === 'true',
  // Production on one server: API under /api, website at /, app at /app/.
  apiPrefix: process.env.API_PREFIX ?? '',
  serveStatic: process.env.SERVE_STATIC === 'true',
  publicUrl: (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  // Shops are sold on the website in production; open self-signup stays on for local development.
  allowSignup: process.env.ALLOW_SIGNUP ? process.env.ALLOW_SIGNUP === 'true' : !isProd,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripePriceId: process.env.STRIPE_PRICE_ID ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  mailFrom: process.env.MAIL_FROM || 'Monacount <onboarding@resend.dev>',
  // Reminder sending (docs/hatirlatma-gonderimi.md). WhatsApp: Meta Cloud API; SMS: Twilio.
  whatsappToken: process.env.WHATSAPP_TOKEN ?? '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET ?? '',
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
  whatsappTemplateDayBefore: process.env.WHATSAPP_TEMPLATE_DAY_BEFORE || 'randevu_hatirlatma_onceki_gun',
  whatsappTemplateDayOf: process.env.WHATSAPP_TEMPLATE_DAY_OF || 'randevu_hatirlatma_bugun',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  twilioFrom: process.env.TWILIO_FROM ?? '',
  // Square connection (docs/square-baglantisi.md): the app's id and secret from developer.squareup.com.
  squareAppId: process.env.SQUARE_APP_ID ?? '',
  squareAppSecret: process.env.SQUARE_APP_SECRET ?? '',
  squareEnv: (process.env.SQUARE_ENV === 'production' ? 'production' : 'sandbox') as 'production' | 'sandbox',
  // Bank connection through Plaid (dashboard.plaid.com → Developers → Keys). PLAID_ENV: sandbox or production.
  plaidClientId: process.env.PLAID_CLIENT_ID ?? '',
  plaidSecret: process.env.PLAID_SECRET ?? '',
  plaidEnv: (process.env.PLAID_ENV === 'production' ? 'production' : 'sandbox') as 'production' | 'sandbox',
  /** Encrypts stored connection tokens. Required in production once a connection is configured. */
  connectionSecret: process.env.CONNECTION_SECRET ?? '',
  /** "true": reminders are printed and marked sent, nothing leaves the machine. Never in production. */
  senderDryRun: process.env.SENDER_DRY_RUN === 'true',
  // Operator alerts (docs/gozetim.md): an e-mail address and/or a Slack or Discord webhook. Empty = log only.
  alertEmail: process.env.ALERT_EMAIL ?? '',
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL ?? '',
};

/**
 * Which model the assistant uses:
 *   AI_PROVIDER=openai      → the OpenAI-compatible API (DeepSeek), wherever it runs, when asked for by name
 *   ANTHROPIC_API_KEY set   → Claude
 *   AI_API_KEY set, not production → DeepSeek, for local work and trials
 * A production server with only a DeepSeek key runs the rule engine: shop data does not go to it unasked.
 */
export function llmEnv(e: typeof env = env): { provider: 'anthropic' | 'openai'; key: string; model: string; url?: string } {
  const compat = { provider: 'openai' as const, key: e.aiApiKey, model: e.aiModel, url: e.aiBaseUrl };
  if (e.aiProvider === 'openai') return compat;
  if (e.anthropicApiKey) return { provider: 'anthropic', key: e.anthropicApiKey, model: e.anthropicModel };
  if (e.aiApiKey && !e.isProd) return compat;
  return { provider: 'anthropic', key: '', model: e.anthropicModel };
}

/** One line for the start-up log and the scripts. */
export function llmName(l = llmEnv(), e: typeof env = env) {
  if (!l.key) return e.aiApiKey && e.isProd ? 'built-in rule engine (AI_API_KEY is ignored in production; set ANTHROPIC_API_KEY, or AI_PROVIDER=openai to use it)' : 'built-in rule engine (set ANTHROPIC_API_KEY in .env)';
  return l.provider === 'anthropic' ? `${l.model} (Anthropic)` : `${l.model} via ${l.url}`;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    jwtSecret: secret('JWT_SECRET', rand()),
    serviceApiKey: secret('SERVICE_API_KEY', process.env.NODE_ENV === 'test' ? 'test-service-key' : rand()),
    adminApiKey: secret('ADMIN_API_KEY', process.env.NODE_ENV === 'test' ? 'test-admin-key' : rand()),
    accessTtlSec: Number(process.env.ACCESS_TTL_SEC ?? 900),
    refreshTtlSec: Number(process.env.REFRESH_TTL_SEC ?? 60 * 60 * 24 * 30),
    trialDays: Number(process.env.TRIAL_DAYS ?? 14),
    now: () => new Date(),
    allowSignup: env.allowSignup,
    publicUrl: env.publicUrl,
    billingEnabled: !!(env.stripeSecretKey && env.stripePriceId && env.stripeWebhookSecret),
    ...overrides,
  };
}
