import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_KEY, setup } from './helpers';

// "Bize yaz" is a live thread: the shop writes, we answer from the operator inbox, the shop sees it.
describe('support chat', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let A: Awaited<ReturnType<typeof t.registerShop>>;
  let B: Awaited<ReturnType<typeof t.registerShop>>;
  beforeAll(async () => {
    t = await setup();
    A = await t.registerShop('Alpha');
    B = await t.registerShop('Bravo');
  });
  afterAll(() => t.close());

  it('shop message reaches the operator inbox, the reply comes back and is marked read', async () => {
    expect((await t.call('POST', '/support', { token: A.token, body: { message: 'Excel çıktısı alabilir miyim?' } })).status).toBe(201);
    const inbox = await t.call('GET', '/admin/support', { token: ADMIN_KEY });
    const thread = inbox.body.data.find((x: any) => x.shop_id === A.shopId);
    expect(thread).toMatchObject({ waiting: 1, last_author: 'shop', last_message: 'Excel çıktısı alabilir miyim?' });

    t.clock.now = new Date(t.clock.now.getTime() + 60_000);
    const reply = await t.call('POST', `/admin/support/${A.shopId}`, { token: ADMIN_KEY, body: { message: 'Evet, Ayarlar > Verimi indir.' } });
    expect(reply.body.author).toBe('operator');
    expect((await t.call('GET', '/support/unread', { token: A.token })).body.unread).toBe(1);

    const mine = await t.call('GET', '/support', { token: A.token });
    expect(mine.body.data.map((m: any) => m.author)).toEqual(['shop', 'operator']);
    expect((await t.call('GET', '/support/unread', { token: A.token })).body.unread).toBe(0);
    const after = (await t.call('GET', '/admin/support', { token: ADMIN_KEY })).body.data.find((x: any) => x.shop_id === A.shopId);
    expect(after.waiting).toBe(0);
  });

  it('threads are private to each shop and the inbox needs the admin key', async () => {
    const other = await t.call('GET', '/support', { token: B.token });
    expect(other.body.data).toHaveLength(0);
    expect((await t.call('GET', '/admin/support', { token: A.token })).status).toBe(401);
    expect((await t.call('POST', `/admin/support/${B.shopId}`, { token: A.token, body: { message: 'x' } })).status).toBe(401);
  });

  it('works while the subscription is locked', async () => {
    await t.call('PATCH', `/admin/shops/${B.shopId}/subscription`, { token: ADMIN_KEY, body: { status: 'past_due' } });
    expect((await t.call('POST', '/support', { token: B.token, body: { message: 'Ödeme yapacağım' } })).status).toBe(201);
    expect((await t.call('GET', '/support', { token: B.token })).status).toBe(200);
  });
});
