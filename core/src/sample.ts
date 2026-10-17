import { DateTime } from 'luxon';
import { withSystem, type Database } from './db';
import { enqueueReminders } from './reminders';
import { DEFAULT_SERVICES, type BusinessType } from './provision';

export type SampleKind = 'barber' | 'salon';

export const SAMPLE_LOGINS: Record<SampleKind, { email: string; password: string }> = {
  barber: { email: 'ornek-berber@fade.demo', password: 'ornek-veri-2026' },
  salon: { email: 'ornek-kuafor@fade.demo', password: 'ornek-veri-2026' },
};

const PROFILES: Record<SampleKind, { shop: string; owner: string; staff: string[]; clients: [string, string, boolean?][]; type: BusinessType }> = {
  barber: {
    shop: 'Berber Halil',
    owner: 'Halil Usta',
    staff: ['Halil Usta', 'Emre'],
    clients: [
      ['Ahmet Yılmaz', '+905321112233'],
      ['Mehmet Kaya', '+905332223344'],
      ['Can Demir', '+905343334455'],
      ['John Carter', '+14155550123'],
      ['Burak Şahin', '+905354445566'],
      ['Ali Öztürk', '+905365556677', false],
    ],
    type: 'barber',
  },
  salon: {
    shop: 'Salon Elif',
    owner: 'Elif Hanım',
    staff: ['Elif Hanım', 'Derya'],
    clients: [
      ['Ayşe Kara', '+905321112244'],
      ['Zeynep Arslan', '+905332223355'],
      ['Selin Çelik', '+905343334466'],
      ['Maria Lopez', '+13055550188'],
      ['Gizem Aydın', '+905354445577'],
      ['Merve Koç', '+905365556688', false],
    ],
    type: 'salon',
  },
};

/**
 * A lived-in sample shop for the website screenshots and "try it with sample data": six weeks of books,
 * today's appointments around the current time, an open tab, payments due and a few reminders.
 * Never used for real shops.
 */
export async function seedSample(db: Database, kind: SampleKind, opts: { hashPassword: (p: string) => Promise<string>; now: Date }) {
  const login = SAMPLE_LOGINS[kind];
  const p = PROFILES[kind];
  return withSystem(db, async (tx) => {
    if ((await tx.query('select 1 from users where email = $1', [login.email])).rows[0]) return { created: false };
    const tz = 'Europe/Istanbul';
    const now = DateTime.fromJSDate(opts.now, { zone: tz });
    const today = now.startOf('day');
    const q = async (sql: string, params: unknown[]) => (await tx.query(sql, params)).rows[0];

    const shop = await q(
      `insert into shops (name, country, timezone, language, currency, business_type) values ($1, 'TR', $2, 'tr', 'USD', $3) returning id`,
      [p.shop, tz, p.type],
    );
    const user = await q(`insert into users (shop_id, email, password_hash, role, name) values ($1, $2, $3, 'owner', $4) returning id`, [
      shop.id,
      login.email,
      await opts.hashPassword(login.password),
      p.owner,
    ]);
    await tx.query('update shops set owner_user_id = $1 where id = $2', [user.id, shop.id]);
    await tx.query(`insert into subscriptions (shop_id, plan_key, status, current_period_end) values ($1, 'pro', 'active', $2)`, [
      shop.id,
      now.plus({ days: 30 }).toJSDate(),
    ]);

    const services = [];
    for (const [name, usd, min] of DEFAULT_SERVICES[p.type]) {
      services.push(await q('insert into services (shop_id, name, price_cents, duration_min) values ($1, $2, $3, $4) returning id, price_cents, duration_min', [shop.id, name, usd * 100, min]));
    }
    const staff = [];
    for (const name of p.staff) staff.push((await q('insert into barbers (shop_id, name) values ($1, $2) returning id', [shop.id, name])).id);
    const clients = [];
    for (const [name, phone, consent = true] of p.clients) {
      clients.push(
        (
          await q(
            `insert into clients (shop_id, name, phone_e164, language, consent_status, consent_at) values ($1, $2, $3, $4, $5, $6) returning id`,
            [shop.id, name, phone, phone.startsWith('+1') ? 'en' : 'tr', consent ? 'granted' : 'revoked', consent ? opts.now : null],
          )
        ).id,
      );
    }

    const appt = async (b: string, c: string, s: { id: string; price_cents: number; duration_min: number }, at: DateTime, status: string) =>
      (
        await q(
          `insert into appointments (shop_id, barber_id, client_id, service_id, starts_at, ends_at, price_cents_snapshot, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [shop.id, b, c, s.id, at.toJSDate(), at.plus({ minutes: s.duration_min }).toJSDate(), s.price_cents, status],
        )
      ).id;
    const income = (id: string, at: DateTime, cents: number) =>
      tx.query(
        `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, source, appointment_id, created_by)
         values ($1, 'income', 'service', $2, $3, 'Randevu', 'appointment', $4, $5)`,
        [shop.id, cents, at.toISODate(), id, user.id],
      );

    // History: one lapsed regular, one client who missed once.
    const history: [number, number, number, number, number, string][] = [
      [0, 4, 0, 49, 11, 'done'],
      [0, 0, 2, 21, 14, 'done'],
      [1, 2, 0, 18, 16, 'missed'],
      [1, 1, 1, 12, 12, 'done'],
      [0, 3, 0, 9, 15, 'done'],
      [0, 2, 0, 4, 17, 'done'],
    ];
    for (const [b, c, s, daysAgo, hour, status] of history) {
      const at = today.minus({ days: daysAgo }).set({ hour });
      const id = await appt(staff[b], clients[c], services[s], at, status);
      if (status === 'done') await income(id, at, services[s].price_cents);
    }
    // Today: two done, two still to come, placed around the current time.
    const base = now.set({ minute: now.minute < 30 ? 0 : 30, second: 0, millisecond: 0 });
    const slots: [number, number, number, DateTime][] = [
      [0, 0, 0, base.minus({ hours: 3 })],
      [1, 1, 2, base.minus({ minutes: 90 })],
      [0, 3, 1, base.plus({ hours: 1 })],
      [0, 2, 3, base.plus({ minutes: 150 })],
    ];
    for (const [b, c, s, at] of slots) {
      const past = at < now;
      const id = await appt(staff[b], clients[c], services[s], at, past ? 'done' : 'booked');
      if (past) await income(id, at, services[s].price_cents);
      else await enqueueReminders(tx, id, opts.now);
    }
    await enqueueReminders(tx, await appt(staff[1], clients[4], services[0], today.plus({ days: 1 }).set({ hour: 11 }), 'booked'), opts.now);

    await tx.query(`insert into ledger_entries (shop_id, client_id, amount_cents, kind, note, created_by) values ($1, $2, 4000, 'charge', 'Sonra ödeyecek', $3)`, [
      shop.id,
      clients[1],
      user.id,
    ]);

    const book = (kind2: string, category: string, usd: number, day: DateTime, raw: string) =>
      tx.query(
        `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, raw_text, source, created_by)
         values ($1, $2, $3, $4, $5, $6, $6, 'ai_note', $7)`,
        [shop.id, kind2, category, Math.round(usd * 100), day.toISODate(), raw, user.id],
      );
    const month = today.startOf('month');
    for (const m of [month.minus({ months: 1 }), month]) {
      const at = (d: DateTime) => (d < today ? d : today);
      await book('expense', 'rent', 1800, at(m.plus({ days: 2 })), 'kira 1800 dolar ödedim');
      await book('expense', 'utilities', 120, at(m.plus({ days: 4 })), 'elektrik faturası ödendi');
      await book('expense', 'supplies', 75, at(m.plus({ days: 9 })), 'malzeme aldım');
    }
    await book('income', 'tips', 15, today.minus({ days: 1 }), 'bahşiş 15 dolar');
    for (let d = 1; d <= 45; d++) {
      const day = today.minus({ days: d });
      if (day.weekday === 7) continue;
      await book('income', 'service', 260 + ((d * 73) % 220), day, 'gün sonu kasa');
    }

    const end = today.endOf('month').startOf('day');
    const within = (n: number) => (today.plus({ days: n }) > end ? end : today.plus({ days: n })).toISODate();
    const task = (k: string, title: string, due: string, usd: number | null) =>
      tx.query(`insert into shop_tasks (shop_id, kind, title, due_date, amount_cents, source, created_by) values ($1, $2, $3, $4, $5, 'assistant', $6)`, [
        shop.id,
        k,
        title,
        due,
        usd ? usd * 100 : null,
        user.id,
      ]);
    await task('payment', 'Su faturası', today.minus({ days: 2 }).toISODate()!, 45);
    await task('payment', 'Doğalgaz faturası', within(3)!, 140);
    await task('payment', 'Ürün tedarikçisi', within(6)!, 260);
    await task('reminder', kind === 'salon' ? 'Boya siparişini ver' : 'Makas bileme servisini ara', today.toISODate()!, null);
    return { created: true, shopId: shop.id };
  });
}
