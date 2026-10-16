// Runs the assistant eval set (api/test/assistant-eval.json) against the local engine and, when
// AI_API_KEY is set, against the model. Prints accuracy and every miss. Each model call costs a little.
import { planSchema } from '@makas/core';
import { env } from '../config';
import { assistantClient } from '../assistant-llm';
import { evalContext, evalSet, runLocal, score } from '../eval-lib';

const model = assistantClient({ url: env.aiBaseUrl, key: env.aiApiKey, model: env.aiModel });
const results = { local: 0, ai: 0 };
for (const c of evalSet.cases) {
  const localMiss = score(runLocal(c.text, c.lang), c.expect);
  if (!localMiss.length) results.local++;
  let aiMiss: string[] | null = null;
  if (model) {
    const ctx = evalContext(c.lang);
    try {
      const raw = await model({
        text: c.text, lang: c.lang, today: ctx.now.toISODate()!, weekday: ctx.now.weekdayLong!, timezone: evalSet.context.timezone,
        currency: 'USD', services: evalSet.context.services, barbers: evalSet.context.barbers, clients: evalSet.context.clients,
      });
      const plan = planSchema.safeParse(raw);
      aiMiss = plan.success ? score(plan.data, c.expect) : ['invalid plan: ' + plan.error.issues[0]?.message];
    } catch (e) {
      aiMiss = ['error: ' + (e as Error).message];
    }
    if (!aiMiss.length) results.ai++;
  }
  const mark = (m: string[] | null) => (m === null ? '·' : m.length ? '✗' : '✓');
  console.log(`${mark(localMiss)} local  ${mark(aiMiss)} ai   [${c.lang}] ${c.text}`);
  for (const m of localMiss) console.log(`      local: ${m}`);
  for (const m of aiMiss ?? []) console.log(`      ai:    ${m}`);
}
const n = evalSet.cases.length;
console.log(`\nlocal engine: ${results.local}/${n}`);
console.log(model ? `${env.aiModel}: ${results.ai}/${n}` : 'model: skipped (AI_API_KEY is empty)');
