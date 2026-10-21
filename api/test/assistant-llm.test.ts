import { describe, expect, it } from 'vitest';
import { alternate, assistantClient, chatClient, jsonIn, reflectClient, type Env } from '../src/assistant-llm';
import { env, llmEnv, llmName } from '../src/config';

// A stand-in for the network: records each request and answers like the provider would.
function fakeNet(reply: (body: any) => unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: any, init: any) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), headers, body });
    return new Response(JSON.stringify(reply(body)), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}

const message = (text: string, stop_reason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
});

const input = {
  text: 'bugün 100 dolar kazandım',
  lang: 'tr' as const,
  today: '2026-10-21',
  weekday: 'Wednesday',
  timezone: 'America/Chicago',
  currency: 'USD',
  services: ['Haircut'],
  barbers: ['Halil'],
  clients: ['Jane'],
};

describe('Claude', () => {
  const claude = (f: typeof fetch): Env => ({ provider: 'anthropic', key: 'sk-ant-test', model: 'claude-opus-5-5', fetch: f });

  it('understands a sentence: cached prompt and examples, no temperature, JSON read even inside a fence', async () => {
    const net = fakeNet(() => message('```json\n{"items":[{"type":"unknown"}]}\n```'));
    const plan = await assistantClient(claude(net.f))!(input);
    expect(plan).toEqual({ items: [{ type: 'unknown' }] });

    const { url, headers, body } = net.calls[0];
    expect(url).toContain('/v1/messages');
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(body.model).toBe('claude-opus-5-5');
    expect(body).not.toHaveProperty('temperature');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    // The breakpoint sits on the last worked example; the shop's sentence comes after it, uncached.
    const cached = body.messages.findIndex((m: any) => Array.isArray(m.content) && m.content[0].cache_control);
    expect(cached).toBe(body.messages.length - 2);
    expect(body.messages[cached].role).toBe('assistant');
    const last = body.messages.at(-1);
    expect(last.role).toBe('user');
    expect(JSON.parse(last.content).message).toBe('bugün 100 dolar kazandım');
    for (let i = 1; i < body.messages.length; i++) expect(body.messages[i].role).not.toBe(body.messages[i - 1].role);
  });

  it('answers an open question with the conversation so far', async () => {
    const net = fakeNet(() => message('Bu ay 4 müşteri 6 haftadır gelmedi.'));
    const reply = await chatClient(claude(net.f))!({
      question: 'ne yapmalıyım?',
      lang: 'tr',
      shop: 'Halil',
      currency: 'USD',
      snapshot: { lapsed: 4 },
      history: [
        { role: 'assistant', text: 'Merhaba' },
        { role: 'user', text: 'müşteriler azaldı' },
      ],
    });
    expect(reply).toBe('Bu ay 4 müşteri 6 haftadır gelmedi.');
    const { body } = net.calls[0];
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body.messages.map((m: any) => m.role)).toEqual(['user']);
    expect(body.messages[0].content).toContain('müşteriler azaldı');
    expect(body.messages[0].content).toContain('ne yapmalıyım?');
  });

  it('a refusal or a cut-off JSON answer is an error, so the rule engine takes over', async () => {
    await expect(assistantClient(claude(fakeNet(() => message('', 'refusal')).f))!(input)).rejects.toThrow('refused');
    await expect(assistantClient(claude(fakeNet(() => message('{"items":[', 'max_tokens')).f))!(input)).rejects.toThrow('tokens');
    const notes = await reflectClient(claude(fakeNet(() => message('Nothing to change.')).f))!({ lang: 'tr', shop: 'Halil', today: '2026-10-21', notes: [], turns: [] });
    expect(notes).toEqual({ ops: [] });
  });

  it('an API error surfaces as an error (no silent empty plan)', async () => {
    const net = fakeNet(() => ({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), 401);
    await expect(assistantClient(claude(net.f))!(input)).rejects.toThrow();
  });
});

describe('DeepSeek (OpenAI-compatible) stays available for local work', () => {
  it('sends the same prompt the OpenAI way', async () => {
    const net = fakeNet(() => ({ choices: [{ message: { content: '{"items":[]}' } }] }));
    const plan = await assistantClient({ provider: 'openai', key: 'ds-test', model: 'deepseek-chat', url: 'https://api.deepseek.com', fetch: net.f })!(input);
    expect(plan).toEqual({ items: [] });
    const { url, headers, body } = net.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(headers.authorization).toBe('Bearer ds-test');
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
  });
});

describe('which model the assistant uses', () => {
  const base = { ...env, anthropicApiKey: '', aiApiKey: '', aiProvider: '', isProd: false };
  it('Claude when its key is set, DeepSeek only locally or when named, otherwise the rule engine', () => {
    expect(llmEnv({ ...base, anthropicApiKey: 'a', aiApiKey: 'd' }).provider).toBe('anthropic');
    expect(llmEnv({ ...base, aiApiKey: 'd' })).toMatchObject({ provider: 'openai', key: 'd' });
    expect(llmEnv({ ...base, aiApiKey: 'd', isProd: true }).key).toBe('');
    expect(llmName(llmEnv({ ...base, aiApiKey: 'd', isProd: true }), { ...base, aiApiKey: 'd', isProd: true })).toContain('ignored in production');
    expect(llmEnv({ ...base, aiApiKey: 'd', isProd: true, aiProvider: 'openai' }).provider).toBe('openai');
    expect(llmEnv({ ...base, anthropicApiKey: 'a', aiApiKey: 'd', aiProvider: 'openai' }).provider).toBe('openai');
    expect(llmEnv(base).key).toBe('');
    expect(llmEnv({ ...base, anthropicApiKey: 'a' }).model).toBe(env.anthropicModel);
  });
});

describe('helpers', () => {
  it('merges repeated turns and drops a leading reply', () => {
    expect(
      alternate([
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: 'c' },
      ]),
    ).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
    ]);
  });
  it('finds the JSON object in a reply', () => {
    expect(jsonIn('Here you go: {"ops":[1]} thanks', '{}')).toEqual({ ops: [1] });
    expect(jsonIn('nothing', '{"ops":[]}')).toEqual({ ops: [] });
  });
});
