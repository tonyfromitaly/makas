// Three months of a two-chair US barbershop in Square's own shapes (orders, payments, refunds, customers,
// catalog, bookings), for demos while a real seller's history is not available. Square does not let
// anyone backdate orders or payments, so a sandbox seller cannot hold this history; this can.
// Deterministic (seeded). Planted, as real shops have them: regulars who quietly stopped coming,
// no-shows, cash tips that never get recorded.
import { DateTime } from 'luxon';
import type { SquareHam } from './square';

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const HIZMET = [
  { id: 'var-cut', ad: 'Haircut', fiyat: 3500, pay: 0.36 },
  { id: 'var-fade', ad: 'Skin fade', fiyat: 4200, pay: 0.3 },
  { id: 'var-cutbeard', ad: 'Cut + beard', fiyat: 5500, pay: 0.18 },
  { id: 'var-beard', ad: 'Beard trim', fiyat: 2000, pay: 0.08 },
  { id: 'var-kids', ad: 'Kids cut', fiyat: 2500, pay: 0.08 },
];
const URUN = [
  { id: 'var-pomade', ad: 'Pomade', fiyat: 1800 },
  { id: 'var-shampoo', ad: 'Beard oil', fiyat: 1400 },
];
const ADLAR = ['James', 'Marcus', 'Diego', 'Andre', 'Tyler', 'Luis', 'Kevin', 'Omar', 'Brandon', 'Carlos', 'Jamal', 'Ethan', 'Mateo', 'Darius', 'Ryan', 'Isaiah', 'Noah', 'Javier', 'Chris', 'Malik'];
const SOYADLAR = ['Johnson', 'Garcia', 'Williams', 'Martinez', 'Brown', 'Lopez', 'Davis', 'Hernandez', 'Wilson', 'Thomas', 'Moore', 'Jackson', 'Lee', 'Perez', 'Harris', 'Clark'];

export function squareSimulasyon(o: { now: Date; gun?: number; seed?: number } = { now: new Date() }): { ham: SquareHam; ad: string } {
  const r = rng(o.seed ?? 11);
  const tz = 'America/Chicago';
  const son = DateTime.fromJSDate(o.now).setZone(tz).startOf('day');
  const bas = son.minus({ days: o.gun ?? 91 });
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const hizmetSec = () => {
    let x = r();
    for (const h of HIZMET) if ((x -= h.pay) <= 0) return h;
    return HIZMET[0];
  };

  const customers: any[] = [];
  const orders: any[] = [];
  const payments: any[] = [];
  const bookings: any[] = [];
  let n = 0;
  const musteri = () => {
    n++;
    const c = { id: `C${String(n).padStart(4, '0')}`, given_name: pick(ADLAR), family_name: pick(SOYADLAR), created_at: bas.minus({ days: Math.floor(r() * 400) }).toUTC().toISO() };
    customers.push(c);
    return c;
  };
  const acik = (d: DateTime) => d.weekday !== 1; // closed on Mondays

  const ziyaret = (c: any, d: DateTime, randevulu: boolean) => {
    if (!acik(d)) d = d.plus({ days: 1 });
    if (d > son) return;
    const saat = d.set({ hour: 10 + Math.floor(r() * 9), minute: [0, 15, 30, 45][Math.floor(r() * 4)] });
    const h = hizmetSec();
    const lines: any[] = [{ uid: 's', name: h.ad, variation_name: 'Regular', quantity: '1', catalog_object_id: h.id, total_money: { amount: h.fiyat, currency: 'USD' }, total_tax_money: { amount: 0, currency: 'USD' } }];
    if (r() < 0.14) {
      const u = pick(URUN);
      const tax = Math.round(u.fiyat * 0.0825); // Texas sales tax on goods, not on services
      lines.push({ uid: 'p', name: u.ad, variation_name: 'Regular', quantity: '1', catalog_object_id: u.id, total_money: { amount: u.fiyat + tax, currency: 'USD' }, total_tax_money: { amount: tax, currency: 'USD' } });
    }
    const id = `O${orders.length + 1}`;
    const at = saat.toUTC().toISO()!;
    orders.push({ id, location_id: 'LSIM', customer_id: c.id, state: 'COMPLETED', created_at: at, closed_at: at, line_items: lines });
    const total = lines.reduce((s, l) => s + l.total_money.amount, 0);
    const kart = r() < 0.82;
    // Card tips are recorded; cash tips go in the pocket and never reach the books.
    const tip = kart ? Math.round((h.fiyat * (0.15 + r() * 0.08)) / 25) * 25 : 0;
    const fee = kart ? Math.round((total + tip) * 0.026 + 15) : 0;
    payments.push({ id: `P${payments.length + 1}`, order_id: id, location_id: 'LSIM', status: 'COMPLETED', created_at: at, source_type: kart ? 'CARD' : 'CASH', amount_money: { amount: total, currency: 'USD' }, tip_money: { amount: tip, currency: 'USD' }, processing_fee: fee ? [{ type: 'INITIAL', amount_money: { amount: fee, currency: 'USD' } }] : [] });
    if (randevulu) bookings.push({ id: `B${bookings.length + 1}`, location_id: 'LSIM', customer_id: c.id, start_at: at, status: 'ACCEPTED' });
  };

  // Regulars: every 2 to 5 weeks; 28 of them stopped coming five to seven weeks ago.
  for (let i = 0; i < 260; i++) {
    const c = musteri();
    const aralik = i < 28 ? 14 : pick([14, 21, 21, 28, 28, 35]);
    const dur = i < 28 ? son.minus({ days: 35 + Math.floor(r() * 14) }) : son;
    for (let d = bas.plus({ days: Math.floor(r() * aralik) }); d <= dur; d = d.plus({ days: aralik + Math.round((r() - 0.5) * 4) })) ziyaret(c, d, r() < 0.75);
  }
  // Walk-ins: once or twice.
  for (let i = 0; i < 300; i++) {
    const c = musteri();
    const d = bas.plus({ days: Math.floor(r() * 91) });
    ziyaret(c, d, false);
    if (r() < 0.25) ziyaret(c, d.plus({ days: 20 + Math.floor(r() * 30) }), false);
  }
  // Booked chairs that stayed empty: about one in eight bookings.
  const gecmis = bookings.length;
  for (let i = 0; i < Math.round(gecmis * 0.12); i++) {
    const d = bas.plus({ days: Math.floor(r() * 90), hours: 15 + Math.floor(r() * 8) });
    bookings.push({ id: `B${bookings.length + 1}`, location_id: 'LSIM', customer_id: pick(customers).id, start_at: d.toUTC().toISO(), status: r() < 0.7 ? 'NO_SHOW' : 'CANCELLED_BY_CUSTOMER' });
  }
  // The next two weeks are already being booked.
  for (let i = 0; i < 90; i++) {
    const d = son.plus({ days: 1 + Math.floor(r() * 14), hours: 10 + Math.floor(r() * 9) });
    bookings.push({ id: `B${bookings.length + 1}`, location_id: 'LSIM', customer_id: pick(customers).id, start_at: d.toUTC().toISO(), status: 'ACCEPTED' });
  }
  const refunds = [0.2, 0.55, 0.8].map((f, i) => {
    const p = payments[Math.floor(payments.length * f)];
    return { id: `R${i + 1}`, location_id: 'LSIM', status: 'COMPLETED', created_at: p.created_at, amount_money: { amount: p.amount_money.amount, currency: 'USD' } };
  });
  const items = [
    ...HIZMET.map((h) => ({ type: 'ITEM', id: h.id.slice(4), item_data: { name: h.ad, product_type: 'APPOINTMENTS_SERVICE', variations: [{ id: h.id }] } })),
    ...URUN.map((u) => ({ type: 'ITEM', id: u.id.slice(4), item_data: { name: u.ad, product_type: 'REGULAR', variations: [{ id: u.id }] } })),
  ];
  return {
    ad: 'Fade Studio (simülasyon)',
    ham: { locations: [{ id: 'LSIM', name: 'Fade Studio', timezone: tz, status: 'ACTIVE' }], orders, payments, refunds, customers, items, bookings },
  };
}
