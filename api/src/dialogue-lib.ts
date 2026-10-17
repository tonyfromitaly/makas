import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Runs the multi-turn conversations in api/test/assistant-dialogues.json through the real API,
// so the stored memory, the focus and the engines are tested together. Used by the test suite
// (local engine) and by `npm run ai:stress` (the model, plus a long conversation).

export const dialogueSet = JSON.parse(readFileSync(join(import.meta.dirname, '../test/assistant-dialogues.json'), 'utf8'));

type Call = (method: string, url: string, opts?: { token?: string; body?: unknown }) => Promise<{ status: number; body: any }>;
interface Harness {
  call: Call;
  clock: { now: Date };
  registerShop(name?: string, overrides?: Record<string, unknown>): Promise<{ token: string; email: string }>;
}

/** A signed-in barber whose session outlives the test clock: signs in again when the token expires. */
export interface Session {
  token: string;
  email: string;
}

async function send(t: Harness, s: Session, method: string, url: string, body?: unknown) {
  let r = await t.call(method, url, { token: s.token, body });
  if (r.status === 401) {
    const login = await t.call('POST', '/auth/login', { body: { email: s.email, password: 'correct-horse-battery' } });
    s.token = login.body.access_token;
    r = await t.call(method, url, { token: s.token, body });
  }
  return r;
}

export async function prepareShop(t: Harness) {
  const s = dialogueSet.shop;
  const { token, email } = await t.registerShop('Berber Halil', { owner_name: s.owner, timezone: s.timezone, country: s.country, language: s.language });
  for (const name of s.barbers) await t.call('POST', '/barbers', { token, body: { name } });
  for (const [name, price_cents, duration_min] of s.services) await t.call('POST', '/services', { token, body: { name, price_cents, duration_min } });
  for (const [name, phone_e164] of s.clients) await t.call('POST', '/clients', { token, body: { name, phone_e164, consent: true } });
  return { token, email } as Session;
}

const matches = (got: Record<string, unknown>, want: Record<string, unknown>) => Object.entries(want).every(([k, v]) => got[k] === v);

export interface TurnResult {
  dialogue: string;
  say: string;
  ok: boolean;
  misses: string[];
  engine: string;
  ms: number;
  reply: string;
}

export function check(understood: Record<string, unknown>[], turn: any) {
  const misses: string[] = [];
  if (turn.expect) {
    if (understood.length !== turn.expect.length) misses.push(`expected ${turn.expect.length} item(s), got ${understood.length}: ${JSON.stringify(understood)}`);
    turn.expect.forEach((e: Record<string, unknown>, i: number) => {
      const got = understood[i] ?? {};
      for (const [k, v] of Object.entries(e)) if (got[k] !== v) misses.push(`#${i + 1}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
    });
  }
  for (const n of turn.not ?? []) if (understood.some((u) => matches(u, n))) misses.push(`must not produce ${JSON.stringify(n)}`);
  return misses;
}

/** One dialogue in the current conversation. `fresh` clears the conversation first. */
export async function runDialogue(t: Harness, s: Session, d: any, fresh = true): Promise<TurnResult[]> {
  if (fresh) await send(t, s, 'DELETE', '/assistant/history');
  const out: TurnResult[] = [];
  for (const turn of d.turns) {
    t.clock.now = new Date(t.clock.now.getTime() + (turn.after_hours ? turn.after_hours * 3600_000 : 60_000));
    const started = performance.now();
    const r = await send(t, s, 'POST', '/assistant', { text: turn.say, lang: d.lang });
    const ms = performance.now() - started;
    const misses = r.status === 200 ? check(r.body.understood, turn) : [`HTTP ${r.status}: ${JSON.stringify(r.body)}`];
    out.push({ dialogue: d.name, say: turn.say, ok: !misses.length, misses, engine: r.body?.engine ?? '?', ms, reply: r.body?.reply ?? '' });
  }
  return out;
}

/** Brings the clock back to the dialogue set's day, so relative dates in the expectations hold. */
export function resetDay(t: Harness) {
  t.clock.now = new Date(dialogueSet.start);
}
