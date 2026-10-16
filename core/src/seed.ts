import { DateTime } from 'luxon';
import { withSystem, type Database } from './db';
import { enqueueReminders } from './reminders';

export const DEMO_LOGIN = { email: 'fatihyahyayildizz@gmail.com', password: 'demo-berber-2026' };

/**
 * Demo shop "Berber Halil" (USD): 4 services, 2 barbers, 6 clients, today's 4 appointments, one open tab,
 * six weeks of books (so "last month" questions have answers), open payments and reminders for the assistant.
 */
export async function seedDemo(db: Database, opts: { hashPassword: (p: string) => Promise<string>; now: Date }) {
  return withSystem(db, async (tx) => {
    const existing = (await tx.query('select id from users where email = $1', [DEMO_LOGIN.email])).rows[0];
    if (existing) return { created: false };
    const tz = 'Europe/Istanbul';
    const now = DateTime.fromJSDate(opts.now, { zone: tz });
    const today = now.startOf('day');
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

    const svc = async (name: string, price: number, min: number) =>
      (await q('insert into services (shop_id, name, price_cents, duration_min) values ($1, $2, $3, $4) returning id, price_cents', [shop.id, name, price * 100, min]));
    const cut = await svc('Saç kesimi', 30, 30);
    const beard = await svc('Sakal tıraşı', 15, 20);
    const combo = await svc('Saç + sakal', 40, 45);
    const kid = await svc('Çocuk tıraşı', 20, 25);

    const barber = async (name: string) => (await q('insert into barbers (shop_id, name) values ($1, $2) returning id', [shop.id, name])).id;
    const hasan = await barber('Halil Usta');
    const emre = await barber('Emre');

    const client = async (name: string, phone: string, consent = true, language = 'tr') =>
      (
        await q(
          `insert into clients (shop_id, name, phone_e164, language, consent_status, consent_at) values ($1, $2, $3, $4, $5, $6) returning id`,
          [shop.id, name, phone, language, consent ? 'granted' : 'revoked', consent ? opts.now : null],
        )
      ).id;
    const ahmet = await client('Ahmet Yılmaz', '+905321112233');
    const mehmet = await client('Mehmet Kaya', '+905332223344');
    const can = await client('Can Demir', '+905343334455');
    const john = await client('John Carter', '+14155550123', true, 'en');
    const burak = await client('Burak Şahin', '+905354445566');
    const ali = await client('Ali Öztürk', '+905365556677', false);

    const appt = async (b: string, c: string, s: { id: string; price_cents: number }, at: DateTime, min: number, status: string) =>
      (
        await q(
          `insert into appointments (shop_id, barber_id, client_id, service_id, starts_at, ends_at, price_cents_snapshot, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [shop.id, b, c, s.id, at.toJSDate(), at.plus({ minutes: min }).toJSDate(), s.price_cents, status],
        )
      ).id;
    const income = async (id: string, at: DateTime, cents: number, note: string) =>
      tx.query(
        `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, source, appointment_id, created_by)
         values ($1, 'income', 'service', $2, $3, $4, 'appointment', $5, $6)`,
        [shop.id, cents, at.toISODate(), note, id, user.id],
      );

    // History: Burak hasn't been in for ~7 weeks (lapsed); Can missed once (risk).
    const past: [string, string, typeof cut, number, number, string][] = [
      [hasan, burak, cut, 49, 11, 'done'],
      [hasan, ahmet, combo, 21, 14, 'done'],
      [emre, can, cut, 18, 16, 'missed'],
      [emre, mehmet, beard, 12, 12, 'done'],
      [hasan, john, cut, 9, 15, 'done'],
      [hasan, can, cut, 4, 17, 'done'],
    ];
    for (const [b, c, s, daysAgo, hour, status] of past) {
      const at = today.minus({ days: daysAgo }).set({ hour });
      const id = await appt(b, c, s, at, 30, status);
      if (status === 'done') await income(id, at, s.price_cents, 'Geçmiş randevu');
    }

    // Today's book: four appointments around the current time, so the demo always shows
    // two finished (already in the till) and two still waiting with reminders queued.
    const base = now.set({ minute: now.minute < 30 ? 0 : 30, second: 0, millisecond: 0 });
    const slots: [string, string, typeof cut, DateTime][] = [
      [hasan, ahmet, cut, base.minus({ hours: 3 })],
      [emre, mehmet, combo, base.minus({ minutes: 90 })],
      [hasan, john, beard, base.plus({ hours: 1 })],
      [hasan, can, kid, base.plus({ minutes: 150 })],
    ];
    for (const [b, c, s, at] of slots) {
      const isPast = at < now;
      const id = await appt(b, c, s, at, s === combo ? 45 : 30, isPast ? 'done' : 'booked');
      if (isPast) await income(id, at, s.price_cents, 'Bugünkü randevu');
      else await enqueueReminders(tx, id, opts.now);
    }
    // Tomorrow, so the day-before reminder flow is visible too.
    const tmr = await appt(emre, burak, cut, today.plus({ days: 1 }).set({ hour: 11 }), 30, 'booked');
    await enqueueReminders(tx, tmr, opts.now);

    // One open tab: Mehmet owes for a combo.
    await tx.query(
      `insert into ledger_entries (shop_id, client_id, amount_cents, kind, note, created_by) values ($1, $2, 4000, 'charge', 'Saç + sakal, sonra ödeyecek', $3)`,
      [shop.id, mehmet, user.id],
    );

    const book = async (kind: string, category: string, usd: number, day: DateTime, raw: string) =>
      tx.query(
        `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, raw_text, source, created_by)
         values ($1, $2, $3, $4, $5, $6, $6, 'ai_note', $7)`,
        [shop.id, kind, category, Math.round(usd * 100), day.toISODate(), raw, user.id],
      );
    const monthStart = today.startOf('month');
    const lastMonth = monthStart.minus({ months: 1 });
    // This month's and last month's fixed costs.
    for (const m of [lastMonth, monthStart]) {
      const inPast = (d: DateTime) => (d < today ? d : today);
      await book('expense', 'rent', 1800, inPast(m.plus({ days: 2 })), 'kira 1800 dolar ödedim');
      await book('expense', 'utilities', m === monthStart ? 125 : 118, inPast(m.plus({ days: 4 })), 'elektrik faturası ödendi');
      await book('expense', 'supplies', m === monthStart ? 64 : 90, inPast(m.plus({ days: 9 })), 'jilet ve şampuan aldım');
    }
    await book('income', 'tips', 15, today.minus({ days: 1 }), 'bahşiş 15 dolar');
    // End-of-day takings noted by hand for the last six weeks (closed on Sundays).
    for (let d = 1; d <= 45; d++) {
      const day = today.minus({ days: d });
      if (day.weekday === 7) continue;
      await book('income', 'service', 240 + ((d * 73) % 210), day, 'gün sonu kasa');
    }

    // Open payments and reminders for the assistant ("bu ay ne kadar ödemem var?").
    const endOfMonth = today.endOf('month').startOf('day');
    const within = (n: number) => { const d = today.plus({ days: n }); return (d > endOfMonth ? endOfMonth : d).toISODate(); };
    const task = (kind: string, title: string, due: string, usd: number | null) =>
      tx.query(
        `insert into shop_tasks (shop_id, kind, title, due_date, amount_cents, source, created_by) values ($1, $2, $3, $4, $5, 'assistant', $6)`,
        [shop.id, kind, title, due, usd ? usd * 100 : null, user.id],
      );
    await task('payment', 'Su faturası', today.minus({ days: 2 }).toISODate()!, 45);
    await task('payment', 'Doğalgaz faturası', within(3)!, 140);
    await task('payment', 'Ürün tedarikçisi', within(6)!, 260);
    await task('payment', 'Kira', today.plus({ months: 1 }).startOf('month').plus({ days: 2 }).toISODate()!, 1800);
    await task('reminder', 'Makas bileme servisini ara', today.toISODate()!, null);
    await task('reminder', 'Ahmet’e doğum günü indirimi', today.plus({ days: 1 }).toISODate()!, null);
    void ali;
    return { created: true, shopId: shop.id };
  });
}
