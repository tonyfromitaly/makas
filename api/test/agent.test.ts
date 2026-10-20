import { afterEach, describe, expect, it } from 'vitest';
import { nakitTahmini } from '@makas/core';
import { setup } from './helpers';
import { argon2Deps, buildServer } from '../src/server';
import { loadConfig } from '../src/config';

// The first-customer path: the wizard sets the shop up, the assistant speaks as that shop's agent,
// and what the records say becomes the agent's notes (Röntgen findings and the cash forecast).

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

const kafe = { isletme: 'Lale Kafe', sahip: 'Selin', sablon: 'kafe', dil: 'tr', sistemler: ['square', 'banka'], dertler: ['stok', 'nakit'], ekip: ['maas'], kisi: 4, ton: 'samimi', gizlilik: 'ozet' };

/** A bank connection's rows as Plaid would leave them: steady takings, rent on the 1st, a balance. */
async function bankShop(t: any, shopId: string, kasa: number) {
  const rows: [string, string, object][] = [];
  for (let d = Date.parse('2026-06-01'); d <= Date.parse('2026-10-19'); d += 86_400_000) {
    const day = new Date(d).toISOString().slice(0, 10);
    rows.push([`in-${day}`, day, { tarih: day, tur: 'gelir', tutar: 300, para: 'USD', kategori: 'satis', karsiTaraf: 'Customers', giris: true }]);
    rows.push([`sup-${day}`, day, { tarih: day, tur: 'gider', tutar: 180, para: 'USD', kategori: 'malzeme', karsiTaraf: `Supplier ${day.slice(8)}` }]);
    if (day.endsWith('-01')) rows.push([`rent-${day}`, day, { tarih: day, tur: 'gider', tutar: 5200, para: 'USD', kategori: 'kira', karsiTaraf: 'Oak Properties' }]);
  }
  for (const [id, day, data] of rows)
    await t.db.query(`insert into import_rows (shop_id, provider, kind, external_id, happened_on, data) values ($1, 'plaid', 'kayit', $2, $3, $4)`, [shopId, `tx:${id}`, day, JSON.stringify(data)]);
  await t.db.query(`insert into connections (shop_id, provider, status, meta, last_sync_at) values ($1, 'plaid', 'connected', $2, $3)`, [shopId, JSON.stringify({ kasa: { tutar: kasa, para: 'USD', hesap: 1 } }), t.clock.now]);
}

describe('setup applied to the shop', () => {
  it('saves modules, look and the agent; /shops/me tells the app what to show', async () => {
    const t = await setup('2026-10-20T12:00:00Z');
    closers.push(t.close);
    const s = await t.registerShop('Lale Kafe');
    const r = await t.call('POST', '/shops/me/setup', { token: s.token, body: kafe });
    expect(r.status).toBe(200);
    expect(r.body.agent_name).toBe('Lale Kafe asistanı');
    expect(r.body.modules).toEqual(expect.arrayContaining(['defter', 'satis', 'stok', 'personel', 'rontgen']));
    expect(r.body.modules).not.toContain('veresiye');
    expect(r.body.modules).not.toContain('randevu');
    const me = (await t.call('GET', '/shops/me', { token: s.token })).body.shop;
    expect(me).toMatchObject({ set_up: true, agent_name: 'Lale Kafe asistanı', look: { skin: 'cini' } });
    const agent = (await t.call('GET', '/shops/me/agent', { token: s.token })).body;
    expect(agent.soul).toContain('Lale Kafe için çalışan asistanım');
    expect(agent.md).toContain('Stok uyarısı');
  });

  it('the assistant answers as the shop’s own agent', async () => {
    const t = await setup('2026-10-20T12:00:00Z');
    closers.push(t.close);
    const s = await t.registerShop('Lale Kafe');
    await t.call('POST', '/shops/me/setup', { token: s.token, body: kafe });
    let seen: any = null;
    const app = await buildServer({
      db: t.db,
      config: loadConfig({ jwtSecret: 'test-jwt-secret-that-is-long-enough-123', now: () => t.clock.now }),
      deps: { ...argon2Deps, chat: async (input) => ((seen = input), 'Stoklar iyi.') },
    });
    closers.push(() => app.close());
    const res = await app.inject({ method: 'POST', url: '/assistant', headers: { authorization: `Bearer ${s.token}` }, payload: { text: 'müşterilerim neden azaldı?' } });
    expect(JSON.parse(res.body).reply).toBe('Stoklar iyi.');
    expect(seen.soul).toContain('Lale Kafe için çalışan asistanım');
    expect(seen.soul).toContain('Görevlerim');
  });
});

describe('cash forecast', () => {
  it('finds the day the balance goes below zero, and why', () => {
    const k: any[] = [];
    for (const m of ['06', '07', '08', '09', '10']) k.push({ tarih: `2026-${m}-01`, tur: 'gider', tutar: 2400, kategori: 'kira', karsiTaraf: 'Oak Properties' });
    for (let d = Date.parse('2026-08-25'); d <= Date.parse('2026-10-20'); d += 86_400_000) k.push({ tarih: new Date(d).toISOString().slice(0, 10), tur: 'gelir', tutar: 50, kategori: 'satis' });
    const f = nakitTahmini(k, 1000, '2026-10-20');
    expect(f.sabit).toEqual([{ karsi: 'Oak Properties', tutar: 2400, gun: 1 }]);
    expect(f.gunlukNet).toBeCloseTo(50, 0);
    expect(f.eksiGun).toEqual({ tarih: '2026-11-01', sebep: 'Oak Properties' });
    expect(f.enDusuk.tarih).toBe('2026-11-01');
  });
});

describe('agent notes', () => {
  it('the forecast becomes an urgent note; dismissed stays dismissed; a cured cause resolves', async () => {
    const t = await setup('2026-10-20T12:00:00Z');
    closers.push(t.close);
    const s = await t.registerShop('Shop');
    await bankShop(t, s.shopId, 900);
    const r = await t.call('GET', '/signals', { token: s.token });
    expect(r.status).toBe(200);
    const nakit = r.body.data.find((x: any) => x.key === 'nakit-tahmin');
    expect(nakit).toMatchObject({ severity: 'yuksek', title: 'Bu gidişle 1 Kasım günü kasa eksiye düşer' });
    expect(nakit.body).toContain('Oak Properties ödemesi');
    expect(nakit.evidence.map((e: any) => e.etiket)).toContain("Oak Properties · her ayın 1'i");
    expect(r.body.data[0].key).toBe('nakit-tahmin'); // the most urgent first
    // One tap: a reminder three days before the day the money runs out.
    expect(nakit.action).toEqual({ type: 'task', title: 'Tahsilatları iste: 1 Kasım kasa sıkışıyor', due_date: '2026-10-29' });

    expect((await t.call('POST', `/signals/${nakit.id}/dismiss`, { token: s.token })).status).toBe(204);
    // Recomputed with the same content: still dismissed.
    await t.db.query(`update shops set signals_at = null`);
    expect((await t.call('GET', '/signals', { token: s.token })).body.data.find((x: any) => x.key === 'nakit-tahmin')).toBeUndefined();

    // Money came in: the cause is gone and the note is resolved.
    await t.db.query(`update connections set meta = $1, last_sync_at = $2`, [JSON.stringify({ kasa: { tutar: 40000, para: 'USD', hesap: 1 } }), new Date('2026-10-20T13:00:00Z')]);
    t.clock.now = new Date('2026-10-20T13:05:00Z');
    const fresh = (await t.call('POST', '/auth/refresh', { body: { refresh_token: s.refresh } })).body.access_token; // past the 15-minute session
    expect((await t.call('GET', '/signals', { token: fresh })).status).toBe(200);
    expect((await t.db.query(`select resolved_at from agent_signals where key = 'nakit-tahmin'`)).rows[0].resolved_at).not.toBeNull();
  });

  it('the morning brief carries the most important note; staff cannot see the notes', async () => {
    const t = await setup('2026-10-20T12:00:00Z');
    closers.push(t.close);
    const s = await t.registerShop('Shop', { language: 'tr' });
    await bankShop(t, s.shopId, 900);
    // With a bank connected, "kasada ne var" is the real balance.
    const cash = await t.call('POST', '/assistant', { token: s.token, body: { text: 'kasada ne var', lang: 'tr' } });
    expect(cash.body.reply).toMatch(/^Bankada şu an \$900 var/);
    const b = await t.call('GET', '/assistant/brief?lang=tr', { token: s.token });
    expect(b.body.reply).toContain('Bu gidişle 1 Kasım günü kasa eksiye düşer.');
    expect(b.body.signal.title).toContain('kasa eksiye düşer');

    // A staff account in the same shop.
    await t.db.query(
      `insert into users (shop_id, email, password_hash, role, name) values ($1, 'staff@example.com', $2, 'barber', 'Emre')`,
      [s.shopId, await argon2Deps.hashPassword('staff-password-123')],
    );
    const staff = (await t.call('POST', '/auth/login', { body: { email: 'staff@example.com', password: 'staff-password-123' } })).body.access_token;
    expect((await t.call('GET', '/signals', { token: staff })).status).toBe(403);
    expect((await t.call('POST', '/shops/me/setup', { token: staff, body: kafe })).status).toBe(403);
    expect((await t.call('GET', '/assistant/brief?lang=tr', { token: staff })).body.signal).toBeNull();
  });
});
