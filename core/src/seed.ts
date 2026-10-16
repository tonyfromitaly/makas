import { DateTime } from 'luxon';
import { withSystem, type Database } from './db';

export const DEMO_LOGIN = { email: 'fatihyahyayildizz@gmail.com', password: 'demo-berber-2026' };

/**
 * Demo shop "Berber Halil" (USD), starting empty: the account, a 14-day trial, the service menu and
 * two barbers. No clients, appointments, books, tabs or reminders: the shop fills them in itself.
 */
export async function seedDemo(db: Database, opts: { hashPassword: (p: string) => Promise<string>; now: Date }) {
  return withSystem(db, async (tx) => {
    const existing = (await tx.query('select id from users where email = $1', [DEMO_LOGIN.email])).rows[0];
    if (existing) return { created: false };
    const tz = 'Europe/Istanbul';
    const now = DateTime.fromJSDate(opts.now, { zone: tz });
    const q = async (sql: string, p: unknown[]) => (await tx.query(sql, p)).rows[0];

    const shop = await q(
      `insert into shops (name, country, timezone, language, currency) values ('Berber Halil', 'TR', $1, 'tr', 'USD') returning id`,
      [tz],
    );
    const user = await q(
      `insert into users (shop_id, email, password_hash, role, name) values ($1, $2, $3, 'owner', 'Halil Usta') returning id`,
      [shop.id, DEMO_LOGIN.email, await opts.hashPassword(DEMO_LOGIN.password)],
    );
    await tx.query('update shops set owner_user_id = $1 where id = $2', [user.id, shop.id]);
    await tx.query(
      `insert into subscriptions (shop_id, plan_key, status, current_period_end) values ($1, 'basic', 'trial', $2)`,
      [shop.id, now.plus({ days: 14 }).toJSDate()],
    );

    for (const [name, usd, min] of [
      ['Saç kesimi', 30, 30],
      ['Sakal tıraşı', 15, 20],
      ['Saç + sakal', 40, 45],
      ['Çocuk tıraşı', 20, 25],
    ] as const) {
      await tx.query('insert into services (shop_id, name, price_cents, duration_min) values ($1, $2, $3, $4)', [shop.id, name, usd * 100, min]);
    }
    for (const name of ['Halil Usta', 'Emre']) {
      await tx.query('insert into barbers (shop_id, name) values ($1, $2)', [shop.id, name]);
    }
    return { created: true, shopId: shop.id };
  });
}
