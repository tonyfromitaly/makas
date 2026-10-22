import { afterEach, describe, expect, it } from 'vitest';
import { runRetention, withSystem } from '@makas/core';
import { setup } from './helpers';

// What the privacy policy promises, run by the hourly upkeep: cancelled shops go after 90 days,
// assistant conversations after 90 days.
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

describe('retention', () => {
  it('removes shops cancelled more than 90 days ago and conversations older than 90 days, nothing else', async () => {
    const t = await setup('2026-10-15T09:00:00Z');
    closers.push(t.close);
    const gone = await t.registerShop('Gone');
    const kept = await t.registerShop('Kept');
    const recent = await t.registerShop('Recently cancelled');
    await withSystem(t.db, async (tx) => {
      await tx.query(`update subscriptions set status = 'cancelled', cancelled_at = '2026-07-01' where shop_id = $1`, [gone.shopId]);
      await tx.query(`update subscriptions set status = 'cancelled', cancelled_at = '2026-10-01' where shop_id = $1`, [recent.shopId]);
      const user = (await tx.query('select id from users where shop_id = $1', [kept.shopId])).rows[0].id;
      await tx.query(`insert into assistant_turns (shop_id, user_id, role, text, created_at) values ($1, $2, 'user', 'old', '2026-06-01'), ($1, $2, 'user', 'new', '2026-10-10')`, [kept.shopId, user]);
    });
    const r = await withSystem(t.db, (tx) => runRetention(tx, t.clock.now));
    expect(r).toMatchObject({ shops: 1, turns: 1 });
    const left = await withSystem(t.db, async (tx) => ({
      shops: (await tx.query('select name from shops order by name')).rows.map((x: any) => x.name),
      turns: (await tx.query('select text from assistant_turns')).rows.map((x: any) => x.text),
    }));
    expect(left).toEqual({ shops: ['Kept', 'Recently cancelled'], turns: ['new'] });
  });
});
