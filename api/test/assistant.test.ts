import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from './helpers';

// The assistant understands; the API resolves names, answers with SQL, and nothing is written until confirmed.
describe('assistant', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let token: string;
  let other: string;
  const ask = (text: string, tok = token) => t.call('POST', '/assistant', { token: tok, body: { text, lang: 'tr' } });

  beforeAll(async () => {
    t = await setup('2026-10-16T09:00:00Z'); // Friday, 12:00 in Istanbul
    const reg = await t.call('POST', '/auth/register', {
      body: { shop_name: 'Berber Halil', owner_name: 'Halil Usta', email: 'halil@example.com', password: 'super-secret-1', country: 'TR', timezone: 'Europe/Istanbul', language: 'tr', currency: 'USD' },
    });
    token = reg.body.access_token;
    await t.call('POST', '/services', { token, body: { name: 'Saç kesimi', price_cents: 3000, duration_min: 30 } });
    await t.call('POST', '/services', { token, body: { name: 'Sakal tıraşı', price_cents: 1500, duration_min: 20 } });
    await t.call('POST', '/clients', { token, body: { name: 'Ahmet Yılmaz', phone_e164: '+905321112233', consent: true } });
    other = (await t.registerShop('Other')).token;
  });
  afterAll(() => t.close());

  it('splits a note with several amounts into separate, correctly typed entries', async () => {
    const r = await ask('Bugün 100 dolar saç kesiminden kazandım, 300 dolar kira ödedim, 20 dolar bahşiş');
    expect(r.status).toBe(200);
    expect(r.body.drafts.map((d: any) => [d.type, d.kind, d.amount_cents, d.category])).toEqual([
      ['book', 'income', 10000, 'service'],
      ['book', 'expense', 30000, 'rent'],
      ['book', 'income', 2000, 'tips'],
    ]);
    const r2 = await ask('hem 100 dolar gelir hem de 300 dolar gider');
    expect(r2.body.drafts.map((d: any) => [d.kind, d.amount_cents])).toEqual([['income', 10000], ['expense', 30000]]);
    // Drafts only: nothing was written.
    expect((await t.call('GET', '/books', { token })).body.total).toBe(0);
  });

  it('registers a client from speech, normalising the number', async () => {
    const r = await ask('Yeni müşteri Ali Kaya numarası 0532 444 55 66');
    expect(r.body.drafts[0]).toMatchObject({ type: 'client', name: 'Ali Kaya', phone_e164: '+905324445566' });
    const dup = await ask('müşteri kaydet Ahmet Bey 0532 111 22 33');
    expect(dup.body.drafts[0].duplicate_of).toBe('Ahmet Yılmaz');
  });

  it('turns a booking sentence into an appointment draft with resolved ids', async () => {
    const r = await ask("yarın saat 3'te Ahmet sakal");
    expect(r.body.drafts[0]).toMatchObject({ type: 'appointment', client_name: 'Ahmet Yılmaz', service_name: 'Sakal tıraşı', date: '2026-10-17', time: '15:00' });
    expect(r.body.drafts[0].client_id).toBeTruthy();
  });

  it('creates barber reminders, including payments with an amount and a day of month', async () => {
    const r = await ask("ayın 25'inde 1800 dolar kira ödemesini hatırlat");
    expect(r.body.drafts[0]).toMatchObject({ type: 'reminder', kind: 'payment', amount_cents: 180000, due_date: '2026-10-25' });
    const r2 = await ask('yarın saat 10da makasçıyı aramamı hatırlat');
    expect(r2.body.drafts[0]).toMatchObject({ type: 'reminder', kind: 'reminder', due_date: '2026-10-17', due_time: '10:00' });
    for (const d of [r.body.drafts[0], { ...r2.body.drafts[0] }]) {
      const { type, ...task } = d;
      expect((await t.call('POST', '/tasks', { token, body: { ...task, source: 'assistant' } })).status).toBe(201);
    }
    await t.call('POST', '/tasks', { token, body: { kind: 'payment', title: 'Elektrik', due_date: '2026-10-20', amount_cents: 14000 } });
    await t.call('POST', '/tasks', { token, body: { kind: 'payment', title: 'Gelecek ay kira', due_date: '2026-11-03', amount_cents: 180000 } });
  });

  it('answers "how much do I have to pay this month" from open payments only', async () => {
    const r = await ask('bu ay ne kadar ödemem var?');
    expect(r.body.drafts).toHaveLength(0);
    expect(r.body.reply).toContain('$1.940'); // 1800 + 140, not next month's rent
    expect(r.body.reply).toContain('Kira');
    // A paid item leaves the total.
    const tasks = (await t.call('GET', '/tasks', { token })).body.data;
    const elec = tasks.find((x: any) => x.title === 'Elektrik');
    await t.call('PATCH', `/tasks/${elec.id}`, { token, body: { status: 'done' } });
    expect((await ask('bu ay ne kadar ödemem var?')).body.reply).toContain('$1.800');
  });

  it('answers income and expense questions with the exact SQL totals', async () => {
    const entries = [
      { kind: 'income', category: 'service', amount_cents: 41000, entry_date: '2026-09-05' },
      { kind: 'income', category: 'service', amount_cents: 39050, entry_date: '2026-09-28' },
      { kind: 'expense', category: 'rent', amount_cents: 180000, entry_date: '2026-09-03' },
      { kind: 'income', category: 'service', amount_cents: 25000, entry_date: '2026-10-10' },
      { kind: 'expense', category: 'supplies', amount_cents: 6400, entry_date: '2026-10-11' },
      { kind: 'expense', category: 'rent', amount_cents: 180000, entry_date: '2026-10-03' },
    ];
    for (const e of entries) await t.call('POST', '/books', { token, body: e });
    const last = await ask('geçen ay ne kadar kazandık?');
    expect(last.body.reply).toContain('Geçen ay');
    expect(last.body.reply).toContain('$800,50');
    const exp = await ask('bu ayki toplam masraf ne?');
    // $1.864 written here, plus the $140 electricity bill ticked as paid in the test above.
    expect(exp.body.reply).toContain('$2.004');
    expect(exp.body.reply).toContain('kira');
    const net = await ask('bu ay net ne kadar');
    expect(net.body.reply).toContain('$1.754 açık var'); // a shortfall is said in words, not as a minus sign
  });

  it('gives the whole account of a period, compared with the one before, in plain words', async () => {
    // Clock: 15 October 2026. September is a whole month; October is still running. A shop of its own.
    const own = (await t.registerShop('Hesap', { language: 'tr' })).token;
    for (const e of [
      { kind: 'income', category: 'service', amount_cents: 40000, entry_date: '2026-08-05' },
      { kind: 'income', category: 'service', amount_cents: 50000, entry_date: '2026-09-05' },
      { kind: 'expense', category: 'rent', amount_cents: 30000, entry_date: '2026-09-03' },
      { kind: 'expense', category: 'supplies', amount_cents: 10000, entry_date: '2026-09-10' },
      { kind: 'income', category: 'service', amount_cents: 20000, entry_date: '2026-10-06' },
    ])
      await t.call('POST', '/books', { token: own, body: e });
    const r = (await ask('geçen ayın hesabını getir', own)).body.reply;
    expect(r).toContain('Geçen ay (1 Eyl – 30 Eyl) $500 girdi, $400 çıktı; elinde $100 kaldı.');
    expect(r).toContain('Gelir bir önceki aya göre %25 arttı.');
    expect(r).toContain("En büyük kalem kira: $300, giderlerin %75'i.");
    const named = (await ask('eylül ayının hesabı', own)).body.reply;
    expect(named).toContain('Eylül (1 Eyl – 30 Eyl)');
    const running = (await ask('bu ay nasıl gidiyor', own)).body.reply;
    expect(running).toMatch(/^Bu ay \(1 Eki – 1\d Eki\)/); // counted and named up to today
    expect(running).not.toContain('31 Eki');
    expect(running).toContain('Ay daha bitmedi');
    // No bank connected: what the books say came in today, and how to get the real balance.
    expect((await ask('kasada ne var', own)).body.reply).toContain('Bankanı bağlarsan gerçek bakiyeyi söylerim');
  });

  it('handles client tabs and answers balance questions', async () => {
    const c = await ask('Ahmet 40 dolar veresiye');
    expect(c.body.drafts[0]).toMatchObject({ type: 'ledger', kind: 'charge', amount_cents: 4000, client_name: 'Ahmet Yılmaz' });
    await t.call('POST', '/ledger', { token, body: { client_id: c.body.drafts[0].client_id, kind: 'charge', amount_cents: 4000 } });
    expect((await ask('Ahmet ne kadar borçlu?')).body.reply).toContain('$40');
    expect((await ask('Ahmet borcunu ödedi 40 dolar')).body.drafts[0]).toMatchObject({ type: 'ledger', kind: 'payment' });
  });

  it('gives a daily brief with reminders due', async () => {
    const r = await t.call('GET', '/assistant/brief', { token });
    expect(r.body.reply).toContain('Halil');
    expect(r.body.tasks.map((x: any) => x.due_date)).toContain('2026-10-17');
  });

  it('works in English and Spanish', async () => {
    const en = await t.call('POST', '/assistant', { token, body: { text: 'made 100 dollars from cuts, paid 300 for rent', lang: 'en' } });
    expect(en.body.drafts.map((d: any) => d.kind)).toEqual(['income', 'expense']);
    const es = await t.call('POST', '/assistant', { token, body: { text: '¿cuánto ganamos el mes pasado?', lang: 'es' } });
    expect(es.body.reply).toContain('El mes pasado');
  });

  it('answers open questions from the SQL snapshot (local advice without a model key)', async () => {
    const r = await ask('işler nasıl gidiyor, ne yapmalıyım?');
    expect(r.body.drafts).toHaveLength(0);
    expect(r.body.engine).toBe('local');
    expect(r.body.reply).toMatch(/\$/);
  });

  it('with a model configured, chat sees only the computed snapshot and its words are returned', async () => {
    const { buildServer, argon2Deps } = await import('../src/server');
    const { loadConfig } = await import('../src/config');
    let seen: any = null;
    const app = await buildServer({
      db: t.db,
      config: loadConfig({ jwtSecret: 'test-jwt-secret-that-is-long-enough-123', now: () => t.clock.now }),
      deps: { ...argon2Deps, chat: async (input) => ((seen = input), 'Bu ay iyi gidiyor.') },
    });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'halil@example.com', password: 'super-secret-1' } });
    const tok = JSON.parse(login.body).access_token;
    const res = await app.inject({ method: 'POST', url: '/assistant', headers: { authorization: `Bearer ${tok}` }, payload: { text: 'müşterilerim neden azaldı?' } });
    const body = JSON.parse(res.body);
    expect(body.reply).toBe('Bu ay iyi gidiyor.');
    expect(body.engine).toBe('ai');
    expect(seen.snapshot.last_month.income_cents).toBe(80050);
    expect(JSON.stringify(seen.snapshot)).not.toContain('+905'); // no phone numbers or raw records
    await app.close();
  });

  it('never leaks another shop’s data', async () => {
    expect((await ask('bu ay ne kadar ödemem var?', other)).body.reply).not.toContain('$');
    expect((await ask('Ahmet ne kadar borçlu?', other)).body.reply).not.toContain('$40');
    const mine = (await t.call('GET', '/tasks', { token })).body.data[0];
    expect((await t.call('PATCH', `/tasks/${mine.id}`, { token: other, body: { status: 'done' } })).status).toBe(404);
  });
});
