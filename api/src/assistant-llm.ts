import Anthropic from '@anthropic-ai/sdk';
import { CHAT_SYSTEM, FEW_SHOT, FEW_SHOT_CONTEXT, REFLECT_RULES, SOUL, UNDERSTAND_SYSTEM, type AssistantInput, type Deps } from '@makas/core';

// The assistant's model: Claude (Anthropic) in production, or DeepSeek / any OpenAI-compatible chat API for
// local work and trials. The model is grounded on every call with the training in
// core/src/assistant/training.ts. It only understands sentences and words answers: it never sees raw
// records, never computes totals and never writes. The API validates its output and the barber confirms
// every write. Any failure here falls back to the built-in rule engine.

export type Provider = 'anthropic' | 'openai';

export interface Env {
  provider: Provider;
  key: string;
  model: string;
  /** OpenAI-compatible only: the API's base URL. */
  url?: string;
  /** Tests only: stands in for the network. */
  fetch?: typeof fetch;
}

type Msg = { role: 'user' | 'assistant'; content: string };

interface Ask {
  system: string;
  messages: Msg[];
  /** The answer must be one JSON object. */
  json: boolean;
  maxTokens: number;
  timeoutMs: number;
  /** Messages before this index never change between calls (the worked examples): cached by Claude. */
  stablePrefix?: number;
}

type Model = (a: Ask) => Promise<string>;

function openaiCompatible(env: Env): Model {
  const f = env.fetch ?? fetch;
  return async (a) => {
    const res = await f(new URL('/chat/completions', env.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.key}` },
      body: JSON.stringify({
        model: env.model,
        temperature: a.json ? 0 : 0.4,
        max_tokens: a.maxTokens,
        ...(a.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: a.system }, ...a.messages],
      }),
      signal: AbortSignal.timeout(a.timeoutMs),
    });
    if (!res.ok) throw new Error(`assistant model ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    return String(data.choices?.[0]?.message?.content ?? '');
  };
}

function claude(env: Env): Model {
  const client = new Anthropic({ apiKey: env.key, maxRetries: 1, ...(env.fetch ? { fetch: env.fetch } : {}) });
  return async (a) => {
    // The system prompt and the worked examples are the same on every call: two cache breakpoints, so a
    // turn pays full price only for the shop's own context and the sentence.
    const turns = alternate(a.messages);
    const cacheAt = a.stablePrefix ? Math.min(a.stablePrefix, turns.length) - 1 : -1;
    const messages = turns.map((m, i) =>
      i === cacheAt ? { role: m.role, content: [{ type: 'text' as const, text: m.content, cache_control: { type: 'ephemeral' as const } }] } : m,
    );
    const msg = await client.messages.create(
      {
        model: env.model,
        max_tokens: a.maxTokens,
        system: [{ type: 'text', text: a.system, cache_control: { type: 'ephemeral' } }],
        messages,
        // Understanding a sentence is extraction, not reasoning: low effort keeps it fast. Open questions
        // get room to think about the shop's numbers.
        output_config: { effort: a.json ? 'low' : 'medium' },
      },
      { timeout: a.timeoutMs },
    );
    if (msg.stop_reason === 'refusal') throw new Error('assistant model refused');
    if (msg.stop_reason === 'max_tokens' && a.json) throw new Error('assistant model ran out of tokens');
    return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  };
}

/** Claude takes turns strictly user/assistant, starting with the user: merge repeats, drop a leading reply. */
export function alternate(ms: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (const m of ms) {
    if (!out.length && m.role === 'assistant') continue;
    const prev = out[out.length - 1];
    if (prev?.role === m.role) prev.content += `\n\n${m.content}`;
    else out.push({ ...m });
  }
  return out;
}

/** The JSON object in a reply, also when the model wraps it in a sentence or a ``` fence. */
export function jsonIn(text: string, empty: string) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  return JSON.parse(s >= 0 && e > s ? text.slice(s, e + 1) : empty);
}

const modelFor = (env: Env): Model | undefined =>
  !env.key ? undefined : env.provider === 'anthropic' ? claude(env) : openaiCompatible(env);

// The worked examples assume this context; it is sent with them so dates in the examples line up.
const EXAMPLE_CONTEXT = {
  today: '2026-10-16',
  weekday: 'Friday',
  timezone: 'Europe/Istanbul',
  currency: 'USD',
  services: ['Saç kesimi', 'Sakal tıraşı', 'Saç + sakal', 'Çocuk tıraşı'],
  barbers: ['Halil Usta', 'Emre'],
  clients: ['Ahmet Yılmaz', 'Mehmet Kaya', 'Can Demir', 'John Carter'],
};

const examples: Msg[] = [
  ...FEW_SHOT.map((ex) => ({ ex, context: undefined as unknown })),
  ...FEW_SHOT_CONTEXT.map((ex) => ({ ex, context: ex.context })),
].flatMap(({ ex, context }) => [
  { role: 'user' as const, content: JSON.stringify({ ...EXAMPLE_CONTEXT, language: 'auto', ...(context ? { context } : {}), message: ex.input }) },
  { role: 'assistant' as const, content: JSON.stringify(ex.output) },
]);

export function assistantClient(env: Env): Deps['assistant'] {
  const model = modelFor(env);
  if (!model) return undefined;
  return async (input: AssistantInput) => {
    const content = await model({
      json: true,
      maxTokens: 2000,
      timeoutMs: 12000,
      system: UNDERSTAND_SYSTEM,
      stablePrefix: examples.length,
      messages: [
        ...examples,
        {
          role: 'user',
          content: JSON.stringify({
            today: input.today,
            weekday: input.weekday,
            timezone: input.timezone,
            currency: input.currency,
            services: input.services,
            barbers: input.barbers,
            clients: input.clients.slice(0, 300),
            language: input.lang,
            ...(input.context ? { context: input.context } : {}),
            message: input.text,
          }),
        },
      ],
    });
    return jsonIn(content, '{}');
  };
}

export function chatClient(env: Env): Deps['chat'] {
  const model = modelFor(env);
  if (!model) return undefined;
  return async (input) =>
    model({
      json: false,
      // Claude's budget includes any thinking; the reply itself stays short (CHAT_SYSTEM).
      maxTokens: env.provider === 'anthropic' ? 2000 : 400,
      timeoutMs: 15000,
      // The shop's own agent when the setup wizard wrote one; the generic one otherwise.
      system: `${input.soul ?? SOUL}\n\n${CHAT_SYSTEM}`,
      messages: [
        // The conversation so far, so "peki bunu nasıl düzeltirim?" knows what "bunu" is.
        ...(input.history ?? []).map((t) => ({ role: t.role, content: t.text })),
        { role: 'user', content: JSON.stringify({ language: input.lang, shop: input.shop, currency: input.currency, snapshot: input.snapshot, memory: input.memory ?? [], question: input.question }) },
      ],
    });
}

/** Reviews a quiet conversation and returns edits to the long-term notes (core/agent/AGENT.md). */
export function reflectClient(env: Env): Deps['reflect'] {
  const model = modelFor(env);
  if (!model) return undefined;
  return async (input) => {
    const content = await model({
      json: true,
      maxTokens: 2000,
      timeoutMs: 20000,
      system: `${input.soul ?? SOUL}\n\n${REFLECT_RULES}`,
      messages: [{ role: 'user', content: JSON.stringify({ ...input, soul: undefined }) }],
    });
    return jsonIn(content, '{"ops":[]}');
  };
}
