import { CHAT_SYSTEM, FEW_SHOT, FEW_SHOT_CONTEXT, REFLECT_RULES, SOUL, UNDERSTAND_SYSTEM, type AssistantInput, type Deps } from '@makas/core';

// DeepSeek (or any OpenAI-compatible chat API). The model is grounded on every call with the training
// in core/src/assistant/training.ts. It only understands sentences and words answers: it never sees
// raw records, never computes totals and never writes. The API validates its output and the barber
// confirms every write.

interface Env {
  url: string;
  key: string;
  model: string;
}

async function complete(env: Env, body: Record<string, unknown>, timeoutMs: number) {
  const res = await fetch(new URL('/chat/completions', env.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.key}` },
    body: JSON.stringify({ model: env.model, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`assistant model ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return String(data.choices?.[0]?.message?.content ?? '');
}

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

const examples = [
  ...FEW_SHOT.map((ex) => ({ ex, context: undefined as unknown })),
  ...FEW_SHOT_CONTEXT.map((ex) => ({ ex, context: ex.context })),
].flatMap(({ ex, context }) => [
  { role: 'user', content: JSON.stringify({ ...EXAMPLE_CONTEXT, language: 'auto', ...(context ? { context } : {}), message: ex.input }) },
  { role: 'assistant', content: JSON.stringify(ex.output) },
]);

export function assistantClient(env: Env): Deps['assistant'] {
  if (!env.key) return undefined;
  return async (input: AssistantInput) => {
    const content = await complete(
      env,
      {
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: UNDERSTAND_SYSTEM },
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
      },
      12000,
    );
    return JSON.parse(content || '{}');
  };
}

export function chatClient(env: Env): Deps['chat'] {
  if (!env.key) return undefined;
  return async (input) =>
    complete(
      env,
      {
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          // The shop's own agent when the setup wizard wrote one; the generic one otherwise.
          { role: 'system', content: `${input.soul ?? SOUL}\n\n${CHAT_SYSTEM}` },
          // The conversation so far, so "peki bunu nasıl düzeltirim?" knows what "bunu" is.
          ...(input.history ?? []).map((t) => ({ role: t.role, content: t.text })),
          { role: 'user', content: JSON.stringify({ language: input.lang, shop: input.shop, currency: input.currency, snapshot: input.snapshot, memory: input.memory ?? [], question: input.question }) },
        ],
      },
      15000,
    );
}

/** Reviews a quiet conversation and returns edits to the long-term notes (core/agent/AGENT.md). */
export function reflectClient(env: Env): Deps['reflect'] {
  if (!env.key) return undefined;
  return async (input) => {
    const content = await complete(
      env,
      {
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${input.soul ?? SOUL}\n\n${REFLECT_RULES}` },
          { role: 'user', content: JSON.stringify({ ...input, soul: undefined }) },
        ],
      },
      20000,
    );
    return JSON.parse(content || '{"ops":[]}');
  };
}
