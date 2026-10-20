import { DateTime } from 'luxon';
import { withSystem, type Database } from './db';

export const DEMO_LOGIN = { email: 'fatihyahyayildizz@gmail.com', password: 'demo-berber-2026' };
/** Emre's own login in the demo shop: the team member's app (his day, his till, his clients). */
export const DEMO_STAFF_LOGIN = { email: 'emre@berber-halil.demo', password: 'demo-emre-2026' };

/** Monday to Saturday 09:00–20:00, closed on Sunday. */
export const SAMPLE_HOURS = { '1': ['09:00', '20:00'], '2': ['09:00', '20:00'], '3': ['09:00', '20:00'], '4': ['09:00', '20:00'], '5': ['09:00', '20:00'], '6': ['09:00', '20:00'], '7': null };

/**
 * Demo shop "Berber Halil" (USD), starting empty: the account, a 14-day trial, the service menu, two
 * chairs, two barbers (Halil works the floor; Emre on 50% commission, with his own login), two products
 * at the counter and the online booking page switched on. No clients, appointments or books yet.
 */
export async function seedDemo(db: Database, opts: { hashPassword: (p: string) => Promise<string>; now: Date }) {
  return withSystem(db, async (tx) => {
    const existing = (await tx.query('select id from users where email = $1', [DEMO_LOGIN.email])).rows[0];
    if (existing) return { created: false };
    const tz = 'Europe/Istanbul';
    const now = DateTime.fromJSDate(opts.now, { zone: tz });
    const q = async (sql: string, p: unknown[]) => (await tx.query(sql, p)).rows[0];

    const shop = await q(
      `insert into shops (name, country, timezone, language, currency, slug, booking_enabled, hours) values ('Berber Halil', 'TR', $1, 'tr', 'USD', 'berber-halil', true, $2) returning id`,
      [tz, JSON.stringify(SAMPLE_HOURS)],
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
      await tx.query(`insert into services (shop_id, name, price_cents, duration_min, station_kind) values ($1, $2, $3, $4, 'chair')`, [shop.id, name, usd * 100, min]);
    }
    const chairs: string[] = [];
    for (const [i, name] of ['Koltuk 1', 'Koltuk 2'].entries())
      chairs.push((await q(`insert into stations (shop_id, name, kind, sort) values ($1, $2, 'chair', $3) returning id`, [shop.id, name, i])).id);
    await tx.query(`insert into barbers (shop_id, name, title, user_id, station_id) values ($1, 'Halil Usta', 'Usta', $2, $3)`, [shop.id, user.id, chairs[0]]);
    const emre = await q(`insert into users (shop_id, email, password_hash, role, name) values ($1, $2, $3, 'barber', 'Emre') returning id`, [
      shop.id,
      DEMO_STAFF_LOGIN.email,
      await opts.hashPassword(DEMO_STAFF_LOGIN.password),
    ]);
    await tx.query(
      `insert into barbers (shop_id, name, title, user_id, station_id, pay_model, service_pct, product_pct) values ($1, 'Emre', 'Kalfa', $2, $3, 'commission', 50, 10)`,
      [shop.id, emre.id, chairs[1]],
    );
    for (const [name, usd, stock] of [
      ['Wax', 18, 12],
      ['Sakal yağı', 16, 6],
    ] as const)
      await tx.query('insert into products (shop_id, name, price_cents, stock) values ($1, $2, $3, $4)', [shop.id, name, usd * 100, stock]);
    return { created: true, shopId: shop.id };
  });
}
