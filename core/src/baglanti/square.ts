// Square: reads a seller's sales, payments, customers and bookings (read-only OAuth scopes) and turns them
// into the one ledger Röntgen and the books use. Field names follow developer.squareup.com (Orders,
// Payments, Customers, Bookings, Catalog, Locations, OAuth). Amounts arrive in the smallest currency unit.
// fetch is injected so tests run against a fake Square, and so this file works in the browser as well.
import { DateTime } from 'luxon';
import type { Kayit } from '../rontgen/kayit';

export type SquareEnv = 'production' | 'sandbox';
type Fetch = typeof fetch;

export const SQUARE_SCOPES = ['MERCHANT_PROFILE_READ', 'ORDERS_READ', 'PAYMENTS_READ', 'CUSTOMERS_READ', 'ITEMS_READ', 'APPOINTMENTS_READ', 'APPOINTMENTS_ALL_READ'];

export const squareBase = (env: SquareEnv) => (env === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com');

export function squareAuthorizeUrl(o: { env: SquareEnv; clientId: string; state: string }) {
  const q = new URLSearchParams({ client_id: o.clientId, scope: SQUARE_SCOPES.join(' '), session: 'false', state: o.state });
  return `${squareBase(o.env)}/oauth2/authorize?${q}`;
}

export interface SquareTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  merchant_id: string;
}

export class SquareError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call(f: Fetch, url: string, init: RequestInit): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await f(url, init);
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    // Rate limited or a passing server error: wait and try again, a few times.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) {
      const e = body?.errors?.[0];
      throw new SquareError(`square ${res.status}: ${e?.code ?? ''} ${e?.detail ?? text.slice(0, 200)}`.trim(), res.status);
    }
    return body;
  }
}

/** The OAuth code (or a refresh token) for tokens. The code flow's refresh token does not expire. */
export async function squareToken(o: { env: SquareEnv; clientId: string; clientSecret: string; code?: string; refreshToken?: string; fetch?: Fetch }): Promise<SquareTokens> {
  const body = o.code
    ? { client_id: o.clientId, client_secret: o.clientSecret, grant_type: 'authorization_code', code: o.code }
    : { client_id: o.clientId, client_secret: o.clientSecret, grant_type: 'refresh_token', refresh_token: o.refreshToken };
  return call(o.fetch ?? fetch, `${squareBase(o.env)}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

export function squareClient(o: { token: string; env: SquareEnv; fetch?: Fetch; version?: string }) {
  const f = o.fetch ?? fetch;
  const base = `${squareBase(o.env)}/v2`;
  const headers: Record<string, string> = { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' };
  if (o.version) headers['square-version'] = o.version;
  const get = (path: string, q: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined) as [string, string][]);
    return call(f, `${base}${path}${qs.size ? `?${qs}` : ''}`, { headers });
  };
  const post = (path: string, body: object) => call(f, `${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

  /** Follows cursors until the last page. */
  async function all<T>(page: (cursor?: string) => Promise<any>, key: string): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    do {
      const r = await page(cursor);
      out.push(...(r[key] ?? []));
      cursor = r.cursor || undefined;
    } while (cursor);
    return out;
  }

  return {
    locations: async () => (await get('/locations')).locations ?? [],
    orders: (locationIds: string[], from: string, to: string) =>
      // Up to 10 locations per search.
      Promise.all(
        chunk(locationIds, 10).map((ids) =>
          all<any>(
            (cursor) =>
              post('/orders/search', {
                location_ids: ids,
                cursor,
                limit: 500,
                query: { filter: { date_time_filter: { closed_at: { start_at: from, end_at: to } }, state_filter: { states: ['COMPLETED'] } }, sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' } },
              }),
            'orders',
          ),
        ),
      ).then((xs) => xs.flat()),
    payments: (locationId: string, from: string, to: string) =>
      all<any>((cursor) => get('/payments', { begin_time: from, end_time: to, sort_order: 'ASC', limit: '100', location_id: locationId, cursor }), 'payments'),
    refunds: (locationId: string, from: string, to: string) =>
      all<any>((cursor) => get('/refunds', { begin_time: from, end_time: to, sort_order: 'ASC', limit: '100', location_id: locationId, cursor }), 'refunds'),
    customers: () => all<any>((cursor) => get('/customers', { limit: '100', cursor }), 'customers'),
    /** Catalog items, to tell services from products. */
    items: () => all<any>((cursor) => get('/catalog/list', { types: 'ITEM', cursor }), 'objects'),
    /** Bookings, asked for in 31-day windows (the API's default span). */
    async bookings(from: string, to: string) {
      const out: any[] = [];
      for (let s = DateTime.fromISO(from); s < DateTime.fromISO(to); s = s.plus({ days: 31 })) {
        const e = DateTime.min(s.plus({ days: 31 }), DateTime.fromISO(to));
        out.push(...(await all<any>((cursor) => get('/bookings', { start_at_min: s.toUTC().toISO()!, start_at_max: e.toUTC().toISO()!, limit: '100', cursor }), 'bookings')));
      }
      return out;
    },
  };
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export interface SquareHam {
  locations: any[];
  orders: any[];
  payments: any[];
  refunds: any[];
  customers: any[];
  items: any[];
  bookings: any[];
}

/** Everything between two moments, from every active location. */
export async function squareCek(c: ReturnType<typeof squareClient>, from: string, to: string): Promise<SquareHam> {
  const locations = ((await c.locations()) as any[]).filter((l) => l.status !== 'INACTIVE');
  const ids = locations.map((l) => l.id);
  const per = async (fn: (id: string) => Promise<any[]>) => (await Promise.all(ids.map(fn))).flat();
  const [orders, payments, refunds, customers, items] = await Promise.all([
    c.orders(ids, from, to),
    per((id) => c.payments(id, from, to)),
    per((id) => c.refunds(id, from, to)),
    c.customers(),
    c.items(),
  ]);
  // Booking reads need the seller's Appointments access; without it, the rest still works.
  let bookings: any[] = [];
  try {
    bookings = await c.bookings(from, to);
  } catch (e) {
    if (!(e instanceof SquareError) || (e.status !== 403 && e.status !== 401)) throw e;
  }
  return { locations, orders, payments, refunds, customers, items, bookings };
}

export interface SquareMusteri {
  id: string;
  ad: string;
  ilk: string;
}
export interface SquareRandevu {
  id: string;
  tarih: string;
  durum: 'geldi' | 'gelmedi' | 'iptal-musteri' | 'iptal-isletme' | 'bekliyor';
  musteri?: string;
}

/** One ledger line per thing that happened, each with a stable id so a re-sync never doubles it. */
export interface SquareKayit extends Kayit {
  dis: string;
}

const money = (m?: { amount?: number; currency?: string }) => (m?.amount ?? 0) / 100;

const DURUM: Record<string, SquareRandevu['durum']> = {
  ACCEPTED: 'geldi',
  NO_SHOW: 'gelmedi',
  CANCELLED_BY_CUSTOMER: 'iptal-musteri',
  CANCELLED_BY_SELLER: 'iptal-isletme',
  DECLINED: 'iptal-isletme',
  PENDING: 'bekliyor',
};

/**
 * Square's records as our ledger:
 * - each sold line of a completed order is income, without the sales tax collected (service or product,
 *   from the catalog), with the customer and how it was paid;
 * - tips are income of their own;
 * - Square's processing fees are an expense ("pos"), refunds lower the takings.
 * Dates are the seller location's local day.
 */
export function squareDefter(h: SquareHam, now: Date): { kayitlar: SquareKayit[]; musteriler: SquareMusteri[]; randevular: SquareRandevu[] } {
  const tz = new Map<string, string>(h.locations.map((l) => [l.id, l.timezone || 'UTC']));
  const day = (iso: string, loc?: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz.get(loc ?? '') ?? 'UTC').toISODate()!;
  // Two different "Mike Johnson"s must stay two people: namesakes get the end of their Square id.
  const base = new Map<string, string>(h.customers.map((c) => [c.id, [c.given_name, c.family_name].filter(Boolean).join(' ') || c.company_name || c.id]));
  const seen = new Map<string, number>();
  for (const n of base.values()) seen.set(n, (seen.get(n) ?? 0) + 1);
  const names = new Map<string, string>([...base].map(([id, n]) => [id, seen.get(n)! > 1 ? `${n} (${id.slice(-4)})` : n]));
  const service = new Set<string>();
  for (const it of h.items) {
    const d = it.item_data ?? {};
    if (d.product_type === 'APPOINTMENTS_SERVICE') for (const v of d.variations ?? []) service.add(v.id);
  }
  const how = new Map<string, 'kart' | 'nakit' | undefined>();
  for (const p of h.payments) if (p.order_id) how.set(p.order_id, p.source_type === 'CASH' ? 'nakit' : p.source_type ? 'kart' : undefined);

  const kayitlar: SquareKayit[] = [];
  for (const o of h.orders) {
    if (o.state && o.state !== 'COMPLETED') continue;
    const tarih = day(o.closed_at ?? o.created_at, o.location_id);
    o.line_items?.forEach((li: any, i: number) => {
      // A line's total includes the sales tax collected for the state; that is not the business's money.
      const tutar = Math.round((money(li.total_money) - money(li.total_tax_money)) * 100) / 100;
      if (!tutar) return;
      const hizmet = li.catalog_object_id && service.has(li.catalog_object_id);
      kayitlar.push({
        dis: `order:${o.id}:${li.uid ?? i}`,
        tarih,
        tur: 'gelir',
        tutar,
        para: li.total_money?.currency,
        kategori: hizmet ? 'hizmet' : li.catalog_object_id ? 'urun' : 'satis',
        kalem: [li.name, li.variation_name && li.variation_name !== 'Regular' ? li.variation_name : ''].filter(Boolean).join(' · ') || undefined,
        adet: Number(li.quantity ?? 1) || 1,
        karsiTaraf: o.customer_id ? names.get(o.customer_id) ?? o.customer_id : undefined,
        odeme: how.get(o.id),
      });
    });
  }
  for (const p of h.payments) {
    if (p.status !== 'COMPLETED') continue;
    const tarih = day(p.created_at, p.location_id);
    const tip = money(p.tip_money);
    if (tip) kayitlar.push({ dis: `tip:${p.id}`, tarih, tur: 'gelir', tutar: tip, para: p.tip_money.currency, kategori: 'bahsis', odeme: p.source_type === 'CASH' ? 'nakit' : 'kart' });
    const fee = (p.processing_fee ?? []).reduce((s: number, f: any) => s + money(f.amount_money), 0);
    if (fee > 0)
      kayitlar.push({ dis: `fee:${p.id}`, tarih, tur: 'gider', tutar: fee, para: p.processing_fee[0].amount_money?.currency, kategori: 'pos', karsiTaraf: 'Square', aciklama: 'Square işlem ücreti' });
  }
  for (const r of h.refunds) {
    if (r.status !== 'COMPLETED') continue;
    const tutar = money(r.amount_money);
    if (tutar) kayitlar.push({ dis: `refund:${r.id}`, tarih: day(r.created_at, r.location_id), tur: 'gelir', tutar: -tutar, para: r.amount_money.currency, kategori: 'satis', aciklama: 'İade' });
  }

  const randevular: SquareRandevu[] = h.bookings.map((b) => {
    let durum = DURUM[b.status] ?? 'bekliyor';
    // An accepted booking still ahead of us has not happened yet.
    if (durum === 'geldi' && new Date(b.start_at) > now) durum = 'bekliyor';
    return { id: b.id, tarih: day(b.start_at, b.location_id), durum, musteri: b.customer_id ? names.get(b.customer_id) ?? b.customer_id : undefined };
  });
  const musteriler: SquareMusteri[] = h.customers.map((c) => ({ id: c.id, ad: names.get(c.id)!, ilk: (c.created_at ?? '').slice(0, 10) }));
  return { kayitlar: kayitlar.sort((a, b) => a.tarih.localeCompare(b.tarih)), musteriler, randevular };
}
