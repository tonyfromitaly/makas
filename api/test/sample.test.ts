import { describe, expect, it } from 'vitest';
import { migrate, seedSample, SAMPLE_LOGINS } from '@makas/core';
import { openDatabase } from '../src/db';

// The sample shops behind the website screenshots and "try with sample data".
describe('sample shops', () => {
  it('seeds a lived-in barber shop and salon, once each', async () => {
    const db = await openDatabase('pglite:memory');
    await migrate(db);
    const hash = async (p: string) => `x${p}`;
    for (const kind of ['barber', 'salon'] as const) {
      expect((await seedSample(db, kind, { hashPassword: hash, now: new Date('2026-10-16T12:00:00Z') })).created).toBe(true);
      expect((await seedSample(db, kind, { hashPassword: hash, now: new Date('2026-10-16T12:00:00Z') })).created).toBe(false);
    }
    const r = await db.query<{ email: string; type: string; clients: number; books: number }>(
      `select u.email, s.business_type as type,
              (select count(*) from clients c where c.shop_id = s.id)::int as clients,
              (select count(*) from book_entries b where b.shop_id = s.id)::int as books
         from shops s join users u on u.id = s.owner_user_id order by u.email`,
    );
    expect(r.rows.map((x) => [x.email, x.type])).toEqual([
      [SAMPLE_LOGINS.barber.email, 'barber'],
      [SAMPLE_LOGINS.salon.email, 'salon'],
    ]);
    expect(r.rows.every((x) => x.clients === 6 && x.books > 30)).toBe(true);
    await db.close();
  });
});
