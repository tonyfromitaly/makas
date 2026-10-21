// Stress test for the assistant's conversation memory, through the real API:
//   1. every dialogue in api/test/assistant-dialogues.json, each in a fresh conversation;
//   2. one long conversation (STRESS_TURNS, default 120) that never clears, to see whether
//      understanding holds up as the conversation grows.
// Uses the model when a key is set (ANTHROPIC_API_KEY, or AI_API_KEY locally) (each turn is one or two model calls), otherwise the local engine.
import { llmEnv } from '../config';
import { assistantClient, chatClient } from '../assistant-llm';
import { setup } from '../../test/helpers';
import { dialogueSet, prepareShop, resetDay, runDialogue, type TurnResult } from '../dialogue-lib';

const turnsWanted = Number(process.env.STRESS_TURNS ?? 120);
const llm = llmEnv();
const model = assistantClient(llm);
const sizes: number[] = [];
const modelMs: number[] = [];
let modelErrors = 0;
const deps = model
  ? {
      assistant: async (input: any) => {
        sizes.push(JSON.stringify(input.context ?? {}).length);
        const t0 = performance.now();
        try {
          return await model(input);
        } catch (e) {
          modelErrors++;
          throw e;
        } finally {
          modelMs.push(performance.now() - t0);
        }
      },
      chat: chatClient(llm),
    }
  : {};

const t = await setup(dialogueSet.start, deps);
const session = await prepareShop(t);
const engineName = model ? llm.model : 'local engine';
const pct = (a: number, b: number) => `${a}/${b} (${Math.round((a / Math.max(b, 1)) * 100)}%)`;
const q = (xs: number[], p: number) => (xs.length ? Math.round([...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]) : 0);
const show = (r: TurnResult) => {
  console.log(`${r.ok ? '✓' : '✗'} [${r.engine}] ${r.say}`);
  for (const m of r.misses) console.log(`      ${m}`);
};

console.log(`\n== Dialogues (${engineName}) ==`);
const all: TurnResult[] = [];
for (const d of dialogueSet.dialogues) {
  resetDay(t);
  console.log(`\n— ${d.name}`);
  const res = await runDialogue(t, session, d);
  res.forEach(show);
  all.push(...res);
}

console.log(`\n== One long conversation, ${turnsWanted} turns, never cleared ==`);
resetDay(t);
await t.call('DELETE', '/assistant/history', { token: session.token });
const round = dialogueSet.dialogues.filter((d: any) => !d.turns.some((x: any) => x.after_hours));
const long: TurnResult[] = [];
while (long.length < turnsWanted) {
  for (const d of round) {
    if (long.length >= turnsWanted) break;
    const res = await runDialogue(t, session, { ...d, turns: d.turns.slice(0, turnsWanted - long.length) }, false);
    res.filter((r) => !r.ok).forEach((r) => (console.log(`turn ${long.length + res.indexOf(r) + 1}:`), show(r)));
    long.push(...res);
  }
}
const half = Math.floor(long.length / 2);
const ok = (xs: TurnResult[]) => xs.filter((r) => r.ok).length;
const stored = await t.call('GET', '/assistant/history?limit=200', { token: session.token });

console.log(`\n== Summary (${engineName}) ==`);
console.log(`dialogues:            ${pct(ok(all), all.length)} turns understood`);
console.log(`long conversation:    ${pct(ok(long), long.length)} — first half ${pct(ok(long.slice(0, half)), half)}, second half ${pct(ok(long.slice(half)), long.length - half)}`);
const local = [...all, ...long].filter((r) => r.engine === 'local').length;
if (model) {
  console.log(`answered by model:    ${pct(all.length + long.length - local, all.length + long.length)} (the rest fell back to the local rules)`);
  console.log(`model errors:         ${modelErrors}`);
  console.log(`model latency:        p50 ${q(modelMs, 0.5)} ms, p95 ${q(modelMs, 0.95)} ms`);
  console.log(`context sent:         max ${Math.max(0, ...sizes)} chars (turn 1: ${sizes[0] ?? 0}, last: ${sizes[sizes.length - 1] ?? 0})`);
}
const api = [...all, ...long].map((r) => r.ms);
console.log(`API time per turn:    p50 ${q(api, 0.5)} ms, p95 ${q(api, 0.95)} ms`);
console.log(`turns stored:         ${stored.body.data.length} shown of the last 200`);
await t.close();
