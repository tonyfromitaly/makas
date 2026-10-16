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
  // OpenAI-compatible chat API for the assistant (DeepSeek by default). Empty key = local engine only.
  aiBaseUrl: process.env.AI_BASE_URL || 'https://api.deepseek.com',
  aiApiKey: process.env.AI_API_KEY ?? '',
  aiModel: process.env.AI_MODEL || 'deepseek-chat',
  seedDemo: process.env.SEED_DEMO === 'true',
};

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    jwtSecret: secret('JWT_SECRET', rand()),
    serviceApiKey: secret('SERVICE_API_KEY', process.env.NODE_ENV === 'test' ? 'test-service-key' : rand()),
    adminApiKey: secret('ADMIN_API_KEY', process.env.NODE_ENV === 'test' ? 'test-admin-key' : rand()),
    accessTtlSec: Number(process.env.ACCESS_TTL_SEC ?? 900),
    refreshTtlSec: Number(process.env.REFRESH_TTL_SEC ?? 60 * 60 * 24 * 30),
    trialDays: Number(process.env.TRIAL_DAYS ?? 14),
    now: () => new Date(),
    ...overrides,
  };
}
