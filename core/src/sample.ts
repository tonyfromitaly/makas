import { DateTime } from 'luxon';
import { withSystem, type Database } from './db';
import { enqueueReminders } from './reminders';
import { DEFAULT_SERVICES, type BusinessType } from './provision';
import { salesFromVisits, saveSale } from './ekip/kasa';
import { SAMPLE_HOURS } from './seed';

export type SampleKind = 'barber' | 'salon';

export const SAMPLE_LOGINS: Record<SampleKind, { email: string; password: string }> = {
  barber: { email: 'ornek-berber@fade.demo', password: 'ornek-veri-2026' },
  salon: { email: 'ornek-kuafor@fade.demo', password: 'ornek-veri-2026' },
};
/** The second person on each sample team has a login of their own: the team member's app. */
export const SAMPLE_STAFF_LOGINS: Record<SampleKind, { email: string; password: string }> = {
  barber: { email: 'ornek-emre@fade.demo', password: 'ornek-veri-2026' },
  salon: { email: 'ornek-derya@fade.demo', password: 'ornek-veri-2026' },
};

type Deal = { title: string; pay_model: 'commission' | 'booth_rent' | 'salary'; service_pct?: number; product_pct?: number; salary_cents?: number; rent_cents?: number };

const PROFILES: Record<
  SampleKind,
  { shop: string; slug: string; owner: string; staff: string[]; deals: Deal[]; products: [string, number, number][]; clients: [string, string, boolean?][]; type: BusinessType }
> = {
  barber: {
    shop: 'Berber Halil',
    slug: 'ornek-berber',
    owner: 'Halil Usta',
    staff: ['Halil Usta', 'Emre', 'Kerem'],
    deals: [
      { title: 'Usta', pay_model: 'commission', service_pct: 0, product_pct: 0 },
      { title: 'Kalfa', pay_model: 'commission', service_pct: 50, product_pct: 10 },
      { title: 'Berber', pay_model: 'booth_rent', rent_cents: 25000 },
    ],
    products: [
      ['Wax', 18, 12],
      ['Sakal yağı', 16, 6],
      ['Şampuan', 14, 9],
    ],
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
    slug: 'ornek-salon',
    owner: 'Elif Hanım',
    staff: ['Elif Hanım', 'Derya', 'Melis'],
    deals: [
      { title: 'Kurucu', pay_model: 'commission', service_pct: 0, product_pct: 0 },
      { title: 'Renk uzmanı', pay_model: 'commission', service_pct: 45, product_pct: 10 },
      { title: 'Bakım', pay_model: 'salary', salary_cents: 240000, service_pct: 10, product_pct: 5 },
    ],
    products: [
      ['Saç bakım yağı', 22, 8],
      ['Şampuan', 16, 10],
      ['Saç maskesi', 19, 5],
    ],
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
      `insert into shops (name, country, timezone, language, currency, business_type, slug, booking_enabled, hours) values ($1, 'TR', $2, 'tr', 'USD', $3, $4, true, $5) returning id`,
      [p.shop, tz, p.type, p.slug, JSON.stringify(SAMPLE_HOURS)],
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
      services.push(
        await q(`insert into services (shop_id, name, price_cents, duration_min, station_kind) values ($1, $2, $3, $4, 'chair') returning id, name, price_cents, duration_min`, [
          shop.id,
          name,
          usd * 100,
          min,
        ]),
      );
    }
    // A chair for each person, and a spare.
    const chairs: string[] = [];
    for (let i = 0; i <= p.staff.length; i++)
      chairs.push((await q(`insert into stations (shop_id, name, kind, sort) values ($1, $2, 'chair', $3) returning id`, [shop.id, `Koltuk ${i + 1}`, i])).id);
    const staffLogin = SAMPLE_STAFF_LOGINS[kind];
    const staffUser = await q(`insert into users (shop_id, email, password_hash, role, name) values ($1, $2, $3, 'barber', $4) returning id`, [
      shop.id,
      staffLogin.email,
      await opts.hashPassword(staffLogin.password),
      p.staff[1],
    ]);
    const staff: string[] = [];
    for (const [i, name] of p.staff.entries()) {
      const d = p.deals[i];
      staff.push(
        (
          await q(
            `insert into barbers (shop_id, name, title, user_id, station_id, pay_model, service_pct, product_pct, salary_cents, rent_cents)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
            [shop.id, name, d.title, i === 0 ? user.id : i === 1 ? staffUser.id : null, chairs[i], d.pay_model, d.service_pct ?? 50, d.product_pct ?? 10, d.salary_cents ?? 0, d.rent_cents ?? 0],
          )
        ).id,
      );
    }
    const products: { id: string; name: string; price_cents: number }[] = [];
    for (const [name, usd, stock] of p.products)
      products.push(await q('insert into products (shop_id, name, price_cents, stock) values ($1, $2, $3, $4) returning id, name, price_cents', [shop.id, name, usd * 100, stock]));
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
          `insert into appointments (shop_id, barber_id, client_id, service_id, station_id, starts_at, ends_at, price_cents_snapshot, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [shop.id, b, c, s.id, chairs[staff.indexOf(b)], at.toJSDate(), at.plus({ minutes: s.duration_min }).toJSDate(), s.price_cents, status],
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
      [2, 4, 0, base.minus({ hours: 2 })],
      [2, 5, 1, base.minus({ minutes: 15 })],
      [0, 3, 1, base.plus({ hours: 1 })],
      [0, 2, 3, base.plus({ minutes: 150 })],
      [2, 1, 0, base.plus({ minutes: 45 })],
    ];
    for (const [b, c, s, at] of slots) {
      // One visit is in the chair right now; the rest are done or still to come.
      const past = at.plus({ minutes: services[s].duration_min }) <= now;
      const id = await appt(staff[b], clients[c], services[s], at, past ? 'done' : 'booked');
      if (past) await income(id, at, services[s].price_cents);
      else await enqueueReminders(tx, id, opts.now);
    }
    await enqueueReminders(tx, await appt(staff[1], clients[4], services[0], today.plus({ days: 1 }).set({ hour: 11 }), 'booked'), opts.now);

    // The till: every done visit is a sale (card mostly), and today's has products and tips on it.
    await salesFromVisits(tx, shop.id, (i) => (i % 3 === 2 ? 'cash' : 'card'));
    const todays = (
      await tx.query(
        `select s.id, s.staff_id, s.appointment_id from sales s where s.shop_id = $1 and s.sold_on = $2 order by s.sold_at`,
        [shop.id, today.toISODate()],
      )
    ).rows;
    for (const [i, sale] of todays.entries()) {
      const items = (await tx.query(`select kind, ref_id, name, unit_cents, qty, staff_id from sale_items where sale_id = $1`, [sale.id])).rows;
      const pr = products[i % products.length];
      await saveSale(
        tx,
        shop.id,
        user.id,
        {
          staff_id: sale.staff_id,
          appointment_id: sale.appointment_id,
          method: i % 2 ? 'cash' : 'card',
          tip_cents: [500, 300, 0, 800][i % 4],
          lines: i % 2 === 0 ? [...items, { kind: 'product', ref_id: pr.id, name: pr.name, unit_cents: pr.price_cents, qty: 1, staff_id: sale.staff_id }] : items,
          sold_at: new Date((await tx.query('select sold_at from sales where id = $1', [sale.id])).rows[0].sold_at),
        },
        sale.id,
      );
    }

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
