// How fast each model answers, on the same requests: three sentence understandings and one open question.
// Usage: npm run ai:latency -w api -- claude-haiku-5-5 claude-sonnet-5-5   (each call costs a little)
import { llmEnv } from '../config';
import { assistantClient, chatClient } from '../assistant-llm';

const base = llmEnv();
const models = process.argv.slice(2).length ? process.argv.slice(2) : [base.model];
if (!base.key) {
  console.log('Model anahtarı yok (.env: ANTHROPIC_API_KEY ya da AI_API_KEY).');
  process.exit(1);
}
const input = {
  text: 'yarın 3te ahmet yılmaza saç kesimi yaz',
  lang: 'tr' as const,
  today: '2026-10-21',
  weekday: 'Wednesday',
  timezone: 'America/Chicago',
  currency: 'USD',
  services: ['Saç kesimi', 'Sakal'],
  barbers: ['Halil'],
  clients: ['Ahmet Yılmaz'],
};
const secs = (ms: number) => (ms / 1000).toFixed(1);
for (const model of models) {
  const env = { ...base, model };
  const times: number[] = [];
  let plan: any;
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    plan = await assistantClient(env)!(input);
    times.push(Date.now() - t);
  }
  const t = Date.now();
  const reply = await chatClient(env)!({
    question: 'müşterilerim azaldı gibi, ne yapmalıyım?',
    lang: 'tr',
    shop: 'Berber Halil',
    currency: 'USD',
    snapshot: { lapsed_clients_6_weeks: 4, last_60_days: { no_show_rate_pct: 12, no_shows: 5 } },
  });
  console.log(`${model}: understand ${times.map(secs).join(' / ')} s · chat ${secs(Date.now() - t)} s · plan ${JSON.stringify(plan.items?.map((i: any) => i.type))} · reply ${reply.length} chars`);
}
