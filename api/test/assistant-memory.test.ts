import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EARLIER_MAX, RECENT } from '@makas/core';
import { setup } from './helpers';
import { dialogueSet, prepareShop, resetDay, runDialogue, type Session } from '../src/dialogue-lib';

// The assistant remembers the conversation: follow-ups, pronouns and corrections, stored per user,
// cleared on request, isolated between shops, and bounded however long the conversation runs.
describe('assistant memory', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let session: Session;
  let token: string;
  const seen: unknown[] = [];

  beforeAll(async () => {
    // A stand-in model that records what it is given and then fails, so the local engine answers.
    t = await setup(dialogueSet.start, {
      assistant: async (input: unknown) => {
        seen.push(input);
        throw new Error('offline');
      },
    });
    session = await prepareShop(t);
    token = session.token;
  });
  afterAll(() => t.close());

  for (const d of dialogueSet.dialogues) {
    it(`dialogue: ${d.name}`, async () => {
      resetDay(t);
      const results = await runDialogue(t, session, d);
      const failed = results.filter((r) => !r.ok).map((r) => `"${r.say}": ${r.misses.join('; ')}`);
      expect(failed).toEqual([]);
    });
  }

  it('keeps the conversation across reloads, oldest first, with drafts', async () => {
    resetDay(t);
    token = session.token;
    await t.call('DELETE', '/assistant/history', { token });
    await t.call('POST', '/assistant', { token, body: { text: "yarın 3'te Ahmet'e sakal" } });
    t.clock.now = new Date(t.clock.now.getTime() + 60_000);
    await t.call('POST', '/assistant', { token, body: { text: 'saat 4 olsun' } });
    const h = await t.call('GET', '/assistant/history', { token });
    expect(h.status).toBe(200);
    expect(h.body.data.map((x: any) => x.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(h.body.data[0].text).toBe("yarın 3'te Ahmet'e sakal");
    expect(h.body.data[3].drafts[0]).toMatchObject({ type: 'appointment', client_name: 'Ahmet Yılmaz', time: '16:00' });
  });

  it('a model that gives up is not overruled by rules that read the sentence the same without context', async () => {
    // Gives up on the short corrections; for anything else it is offline and the rules answer.
    const giveUp = await setup(dialogueSet.start, {
      assistant: async (input: { text: string }) => {
        if (input.text.includes('olsun')) return { items: [{ type: 'unknown' }] };
        throw new Error('offline');
      },
    });
    const s = await prepareShop(giveUp);
    const r = await giveUp.call('POST', '/assistant', { token: s.token, body: { text: 'saat 5 olsun' } });
    expect(r.body.understood).toEqual([]);
    expect(r.body.drafts).toEqual([]);
    await giveUp.call('POST', '/assistant', { token: s.token, body: { text: "yarın 3'te Ahmet'e sakal" } });
    const fix = await giveUp.call('POST', '/assistant', { token: s.token, body: { text: 'saat 4 olsun' } });
    expect(fix.body.understood[0]).toMatchObject({ type: 'appointment', client_name: 'Ahmet Yılmaz', time: '16:00' });
    expect(fix.body.engine).toBe('local');
    await giveUp.close();
  });

  it('clearing forgets the turns and the focus', async () => {
    expect((await t.call('DELETE', '/assistant/history', { token })).status).toBe(204);
    expect((await t.call('GET', '/assistant/history', { token })).body.data).toEqual([]);
    const r = await t.call('POST', '/assistant', { token, body: { text: 'saat 5 olsun' } });
    expect(r.body.understood.some((i: any) => i.type === 'appointment')).toBe(false);
  });

  it('another shop never sees or continues this conversation', async () => {
    await t.call('POST', '/assistant', { token, body: { text: 'Mehmet 40 dolar veresiye yaz' } });
    const other = await t.registerShop('Other');
    expect((await t.call('GET', '/assistant/history', { token: other.token })).body.data).toEqual([]);
    const r = await t.call('POST', '/assistant', { token: other.token, body: { text: 'onun borcu ne kadar', lang: 'tr' } });
    expect(JSON.stringify(r.body)).not.toContain('Mehmet');
    const raw = await t.db.query('select count(*)::int as n from assistant_turns');
    expect(raw.rows[0].n).toBeGreaterThan(2); // the rows exist; isolation is the API's and RLS's job
  });

  it('a 300-turn conversation keeps working and the model context stays bounded', async () => {
    resetDay(t);
    await t.call('DELETE', '/assistant/history', { token });
    const round = dialogueSet.dialogues.filter((d: any) => !d.turns.some((x: any) => x.after_hours));
    const results = [];
    seen.length = 0;
    while (results.length < 300) for (const d of round) results.push(...(await runDialogue(t, session, d, false)));
    const failed = results.filter((r) => !r.ok).map((r) => `${r.dialogue} / "${r.say}": ${r.misses.join('; ')}`);
    expect(failed).toEqual([]);

    const ctx = (seen as any[]).map((x) => x.context).filter(Boolean);
    const last = ctx[ctx.length - 1];
    expect(last.recent.length).toBe(RECENT);
    expect(last.earlier.length).toBe(EARLIER_MAX);
    const sizes = ctx.map((c) => JSON.stringify(c).length);
    expect(Math.max(...sizes)).toBeLessThan(9000); // ~2-3k tokens at most, at turn 10 or turn 300

    const stored = await t.call('GET', '/assistant/history?limit=200', { token });
    expect(stored.body.data).toHaveLength(200);
  }, 120_000);
});
