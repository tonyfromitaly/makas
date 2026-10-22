import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedSample, SAMPLE_LOGINS } from '@makas/core';
import { ADMIN_KEY, setup } from './helpers';
import { argon2Deps } from '../src/server';
import { dialogueSet, prepareShop, type Session } from '../src/dialogue-lib';

// The assistant's long-term memory (core/agent/AGENT.md): notes it is told, notes it learns from
// conversations, notes it computes from the records; 90 days unless pinned; never sensitive details.
describe('assistant long-term memory', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let s: Session;
  const sent: any[] = [];
  let reflectOps: unknown[] = [];
  const reflected: any[] = [];

  beforeAll(async () => {
    t = await setup(dialogueSet.start, {
      assistant: async (input: any) => {
        sent.push(input);
        throw new Error('offline'); // the local engine answers; we only watch what the model would get
      },
      reflect: async (input: any) => {
        reflected.push(input);
        return { ops: reflectOps };
      },
    });
    s = await prepareShop(t);
    // These tests travel months ahead; keep the shop paid up so the trial does not lock it.
    await t.app.inject({
      method: 'PATCH',
      url: `/admin/shops/${s.shopId}/subscription`,
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: { status: 'active', current_period_end: '2030-01-01T00:00:00Z' },
    });
  });
  afterAll(() => t.close());

  // Signs in again when the test clock has outrun the access token.
  const as = async (method: string, url: string, body?: unknown) => {
    let r = await t.call(method, url, { token: s.token, body });
    if (r.status === 401) {
      s.token = (await t.call('POST', '/auth/login', { body: { email: s.email, password: 'correct-horse-battery' } })).body.access_token;
      r = await t.call(method, url, { token: s.token, body });
    }
    return r;
  };
  const say = (text: string, lang = 'tr') => as('POST', '/assistant', { text, lang });
  const notes = async () => (await as('GET', '/assistant/notes')).body;
  const admin = () => t.app.inject({ method: 'POST', url: '/admin/memory/run', headers: { authorization: `Bearer ${ADMIN_KEY}` } }).then((r) => JSON.parse(r.body));

  it('"aklında tut" writes a note, "bunu unut" takes it back', async () => {
    const r = await say('aklında tut, Ahmet sakalını kısa ister');
    expect(r.body.reply).toContain('Aklımda');
    let n = await notes();
    expect(n.data).toHaveLength(1);
    expect(n.data[0]).toMatchObject({ kind: 'client', subject: 'Ahmet Yılmaz', source: 'said', pinned: false });
    expect(n.markdown).toContain('## Müşteriler');
    expect(n.markdown).toContain('Ahmet sakalını kısa ister');
    t.clock.now = new Date(t.clock.now.getTime() + 60_000);
    const f = await say('bunu unut');
    expect(f.body.reply).toContain('unuttum');
    n = await notes();
    expect(n.data).toHaveLength(0);
  });

  it('never keeps sensitive details, by voice or by hand', async () => {
    const r = await say('aklında tut Mehmet şeker hastası');
    expect(r.body.reply).toContain('not almıyorum');
    expect((await notes()).data).toHaveLength(0);
    const p = await t.call('POST', '/assistant/notes', { token: s.token, body: { kind: 'client', subject: 'Can Demir', text: 'Numarası 0532 111 22 33' } });
    expect(p.status).toBe(400);
  });

  it('sends the notes with every message, the ones about who is named first', async () => {
    for (const text of ['Pazar günleri kapalıyız', 'Emre pazartesi izinli', 'John 2 numara fade sever'])
      await t.call('POST', '/assistant/notes', { token: s.token, body: { kind: text.startsWith('John') ? 'client' : 'shop', subject: text.startsWith('John') ? 'John Carter' : null, text } });
    sent.length = 0;
    await say("John'a yarın 3'te randevu");
    const memory: string[] = sent[0].context.memory;
    expect(memory[0]).toContain('John 2 numara fade sever');
    expect(memory).toHaveLength(3);
  });

  it('a note lives 90 days from when it was last confirmed; a pinned one stays', async () => {
    const list = (await notes()).data;
    const pin = list.find((n: any) => n.text.startsWith('Pazar'));
    expect((await t.call('PATCH', `/assistant/notes/${pin.id}`, { token: s.token, body: { pinned: true } })).body.pinned).toBe(true);
    const start = t.clock.now;
    t.clock.now = new Date(start.getTime() + 91 * 86_400_000);
    const run = await admin();
    expect(run.expired).toBe(2);
    // Time only moves forward from here, as it does in a real shop.
    const left = (await notes()).data;
    expect(left.map((n: any) => n.text)).toEqual(['Pazar günleri kapalıyız']);
  });

  it('reviews a quiet conversation and applies only safe edits', async () => {
    await say('Burak her geldiğinde ense tıraşı da istiyor');
    reflectOps = [];
    // Not yet quiet: nothing to review.
    let run = await admin();
    expect(run.reviewed).toBe(0);
    t.clock.now = new Date(t.clock.now.getTime() + 30 * 60_000);
    const pinned = (await notes()).data[0];
    reflectOps = [
      { op: 'add', kind: 'client', subject: 'Burak Şahin', text: 'Her seferinde ense tıraşı da ister.' },
      { op: 'add', kind: 'client', subject: 'Mehmet Kaya', text: 'Tansiyon ilacı kullanıyor.' }, // sensitive: refused
      { op: 'forget', id: pinned.id }, // pinned: kept
      { op: 'update', id: '00000000-0000-0000-0000-000000000000', text: 'x' }, // unknown: ignored
    ];
    run = await admin();
    expect(run).toMatchObject({ reviewed: 1, added: 1, forgotten: 0 });
    expect(reflected[reflected.length - 1].turns.some((x: any) => x.text.includes('ense'))).toBe(true);
    const texts = (await notes()).data.map((n: any) => n.text);
    expect(texts).toContain('Her seferinde ense tıraşı da ister.');
    expect(texts).toContain('Pazar günleri kapalıyız');
    expect(texts.join(' ')).not.toContain('Tansiyon');
    // Reviewed once: the same conversation is not reviewed again.
    expect((await admin()).reviewed).toBe(0);
  });

  it('another shop never sees these notes', async () => {
    const other = await t.registerShop('Other');
    expect((await t.call('GET', '/assistant/notes', { token: other.token })).body.data).toEqual([]);
    const mine = (await notes()).data;
    expect((await t.call('DELETE', `/assistant/notes/${mine[0].id}`, { token: other.token })).status).toBe(404);
  });
});

describe('notes from the records', () => {
  it('learns regulars, no-shows, rent day and the week from the sample shop, and the usual service', async () => {
    const t = await setup('2026-10-16T09:00:00Z');
    await seedSample(t.db, 'barber', { hashPassword: argon2Deps.hashPassword, now: t.clock.now });
    const run = await t.app.inject({ method: 'POST', url: '/admin/memory/run', headers: { authorization: `Bearer ${ADMIN_KEY}` } });
    expect(JSON.parse(run.body).dataNotes).toBeGreaterThan(0);
    const login = await t.call('POST', '/auth/login', { body: SAMPLE_LOGINS.barber });
    const n = (await t.call('GET', '/assistant/notes', { token: login.body.access_token })).body;
    expect(n.data.every((x: any) => x.source === 'data')).toBe(true);
    expect(n.markdown).toMatch(/Rent usually paid on the \d+(st|nd|rd|th);/);
    await t.close();
  });
});

describe('SOUL.md and AGENT.md', () => {
  it('the generated module matches the markdown (run npm run agent:sync after editing)', async () => {
    const { readFileSync } = await import('node:fs');
    // @ts-expect-error plain ESM script without types
    const { render } = await import('../../scripts/agent-sync.mjs');
    expect(readFileSync(new URL('../../core/src/assistant/agent-files.ts', import.meta.url), 'utf8')).toBe(render());
  });
});
