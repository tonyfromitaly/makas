import { migrate, seedDemo } from '@makas/core';
import { env, loadConfig } from './config';
import { openDatabase } from './db';
import { parseServiceClient } from './parse-service';
import { assistantClient, chatClient } from './assistant-llm';
import { argon2Deps, buildServer } from './server';

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
const app = await buildServer({
  db,
  config,
  deps: {
    ...argon2Deps,
    parseNote: parseServiceClient(env.parseServiceUrl, env.parseServiceKey),
    assistant: assistantClient({ url: env.aiBaseUrl, key: env.aiApiKey, model: env.aiModel }),
    chat: chatClient({ url: env.aiBaseUrl, key: env.aiApiKey, model: env.aiModel }),
  },
  corsOrigins: env.corsOrigins,
  trustProxy: env.trustProxy,
  requireHttps: env.isProd && process.env.REQUIRE_HTTPS !== 'false',
  logger: true,
});
await app.listen({ port: env.port, host: env.host });

const shutdown = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
