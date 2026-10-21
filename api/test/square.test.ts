import { afterEach, describe, expect, it } from 'vitest';
import { squareBaglanti, squareDefter, type SquareHam } from '@makas/core';
import { setup } from './helpers';

// The Square connection against a fake Square that answers like the real API (cursors, date filters,
// OAuth): connect, first sync, re-sync without doubles, token refresh, the shop's Röntgen, disconnect.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

/** Moving the test clock past the 15-minute session: sign in again with the refresh token. */
async function fresh(t: any, s: any) {
  const r = await t.call('POST', '/auth/refresh', { body: { refresh_token: s.refresh } });
  s.refresh = r.body.refresh_token;
  s.token = r.body.access_token;
}

const day = (iso: string, plus: number) => new Date(Date.parse(iso) + plus * 86_400_000).toISOString();

/** A year of a two-chair salon: 15 regulars every two weeks, five of whom stopped in mid-July. */
function salon(): SquareHam {
  const customers = Array.from({ length: 15 }, (_, i) => ({ id: `c${i + 1}`, given_name: `Müşteri`, family_name: String(i + 1), created_at: '2025-09-01T10:00:00Z' }));
  const orders: any[] = [];
  const payments: any[] = [];
  customers.forEach((c, i) => {
    const stop = i < 5 ? '2026-07-15' : '2026-10-14';
    for (let d = day('2025-10-01T15:00:00Z', i % 14); d.slice(0, 10) <= stop; d = day(d, 14)) {
      const id = `o-${c.id}-${d.slice(0, 10)}`;
      const lines = [{ uid: 'l1', name: 'Haircut', variation_name: 'Regular', quantity: '1', catalog_object_id: 'var-cut', total_money: { amount: 3000, currency: 'USD' } }];
      if (i % 4 === 0) lines.push({ uid: 'l2', name: 'Pomade', variation_name: 'Regular', quantity: '1', catalog_object_id: 'var-wax', total_money: { amount: 1500, currency: 'USD' } });
      orders.push({ id, location_id: 'L1', customer_id: c.id, state: 'COMPLETED', created_at: d, closed_at: d, line_items: lines });
      payments.push({ id: `p-${id}`, order_id: id, location_id: 'L1', status: 'COMPLETED', created_at: d, source_type: i % 3 ? 'CARD' : 'CASH', tip_money: { amount: 500, currency: 'USD' }, processing_fee: i % 3 ? [{ type: 'INITIAL', amount_money: { amount: 117, currency: 'USD' } }] : [] });
    }
  });
  const bookings = Array.from({ length: 60 }, (_, i) => ({
    id: `b${i}`,
    location_id: 'L1',
    customer_id: `c${(i % 10) + 6}`,
    start_at: day('2026-07-20T14:00:00Z', i * 1.4),
    status: i % 7 === 0 ? 'NO_SHOW' : i % 20 === 3 ? 'CANCELLED_BY_CUSTOMER' : 'ACCEPTED',
  }));
  return {
    locations: [{ id: 'L1', name: 'Salon', timezone: 'America/New_York', status: 'ACTIVE' }],
    orders,
    payments,
    refunds: [{ id: 'r1', location_id: 'L1', status: 'COMPLETED', created_at: '2026-09-02T18:00:00Z', amount_money: { amount: 3000, currency: 'USD' } }],
    customers,
    items: [
      { type: 'ITEM', id: 'cut', item_data: { name: 'Haircut', product_type: 'APPOINTMENTS_SERVICE', variations: [{ id: 'var-cut' }] } },
      { type: 'ITEM', id: 'wax', item_data: { name: 'Pomade', product_type: 'REGULAR', variations: [{ id: 'var-wax' }] } },
    ],
    bookings,
  };
}

/** A fake Square: pages of 50, filters by the requested dates, OAuth with expiring tokens. */
function fakeSquare(h: SquareHam) {
  const calls: string[] = [];
  let tokenN = 0;
  const page = (rows: any[], key: string, cursor?: string | null) => {
    const start = Number(cursor ?? 0);
    const next = start + 50 < rows.length ? String(start + 50) : undefined;
    return { [key]: rows.slice(start, start + 50), ...(next ? { cursor: next } : {}) };
  };
  const within = (iso: string, a?: string | null, b?: string | null) => (!a || iso >= a) && (!b || iso <= b);
  const f = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const q = url.searchParams;
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/oauth2/token') {
      tokenN++;
      if (body.grant_type === 'authorization_code' && body.code !== 'good-code') return json({ errors: [{ code: 'BAD_CODE' }] }, 400);
      return json({ access_token: `EAAA-token-${tokenN}`, refresh_token: 'EQAA-refresh', expires_at: '2026-11-14T00:00:00Z', merchant_id: 'M1', token_type: 'bearer' });
    }
    if (url.pathname === '/oauth2/revoke') return json({ success: true });
    if (!String((init?.headers as any)?.authorization ?? '').startsWith('Bearer EAAA-token-')) return json({ errors: [{ code: 'UNAUTHORIZED' }] }, 401);
    switch (url.pathname) {
      case '/v2/locations':
        return json({ locations: h.locations });
      case '/v2/orders/search': {
        const r = body.query.filter.date_time_filter.closed_at;
        return json(page(h.orders.filter((o) => within(o.closed_at, r.start_at, r.end_at)), 'orders', body.cursor));
      }
      case '/v2/payments':
        return json(page(h.payments.filter((p) => within(p.created_at, q.get('begin_time'), q.get('end_time'))), 'payments', q.get('cursor')));
      case '/v2/refunds':
        return json(page(h.refunds.filter((p) => within(p.created_at, q.get('begin_time'), q.get('end_time'))), 'refunds', q.get('cursor')));
      case '/v2/customers':
        return json(page(h.customers, 'customers', q.get('cursor')));
      case '/v2/catalog/list':
        return json(page(h.items, 'objects', q.get('cursor')));
      case '/v2/bookings':
        return json(page(h.bookings.filter((b) => within(b.start_at, q.get('start_at_min'), q.get('start_at_max'))), 'bookings', q.get('cursor')));
    }
    return json({ errors: [{ code: 'NOT_FOUND' }] }, 404);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('square → ledger', () => {
  it('turns orders, tips, fees, refunds and bookings into ledger lines on the seller’s local day', () => {
    const h = salon();
    // 02:30 UTC is still the previous evening in New York.
    h.orders.push({ id: 'taxed', location_id: 'L1', state: 'COMPLETED', created_at: '2026-10-05T15:00:00Z', closed_at: '2026-10-05T15:00:00Z', line_items: [{ name: 'Shampoo', quantity: '2', catalog_object_id: 'var-wax', total_money: { amount: 2160, currency: 'USD' }, total_tax_money: { amount: 160, currency: 'USD' } }] });
    h.orders.push({ id: 'late', location_id: 'L1', state: 'COMPLETED', created_at: '2026-10-02T02:30:00Z', closed_at: '2026-10-02T02:30:00Z', line_items: [{ name: 'Gift card', quantity: '1', total_money: { amount: 5000, currency: 'USD' } }] });
    const { kayitlar, musteriler, randevular } = squareDefter(h, new Date('2026-10-15T12:00:00Z'));
    const late = kayitlar.find((k) => k.dis.startsWith('order:late'))!;
    expect(late).toMatchObject({ tarih: '2026-10-01', tur: 'gelir', tutar: 50, kategori: 'satis', kalem: 'Gift card' });
    const cut = kayitlar.find((k) => k.kalem === 'Haircut')!;
    expect(cut).toMatchObject({ kategori: 'hizmet', tutar: 30, para: 'USD', karsiTaraf: 'Müşteri 1', adet: 1 });
    expect(kayitlar.find((k) => k.kalem === 'Pomade')!.kategori).toBe('urun');
    expect(kayitlar.find((k) => k.kalem === 'Shampoo')).toMatchObject({ tutar: 20, adet: 2 }); // $1.60 sales tax left out
    expect(kayitlar.some((k) => k.kategori === 'bahsis' && k.tutar === 5)).toBe(true);
    expect(kayitlar.find((k) => k.kategori === 'pos')).toMatchObject({ tur: 'gider', tutar: 1.17, karsiTaraf: 'Square' });
    expect(kayitlar.find((k) => k.dis === 'refund:r1')).toMatchObject({ tutar: -30, tur: 'gelir' });
    expect(kayitlar.filter((k) => k.odeme === 'nakit').length).toBeGreaterThan(0);
    expect(musteriler).toHaveLength(15);
    expect(randevular.filter((r) => r.durum === 'gelmedi').length).toBe(9);
    expect(randevular.some((r) => r.durum === 'bekliyor')).toBe(false); // all before "now"
  });
});

describe('square → ledger, people', () => {
  it('keeps two customers with the same name apart', () => {
    const h = salon();
    h.customers[1].family_name = h.customers[0].family_name; // two "Müşteri 1"
    const { kayitlar } = squareDefter(h, new Date('2026-10-15T12:00:00Z'));
    const who = new Set(kayitlar.filter((k) => k.karsiTaraf?.startsWith('Müşteri 1 ')).map((k) => k.karsiTaraf));
    expect([...who].sort()).toEqual(['Müşteri 1 (c1)', 'Müşteri 1 (c2)']);
  });
});

describe('square connection', () => {
  async function connected() {
    const baglanti: any = {};
    const t = await setup('2026-10-15T12:00:00Z', { baglanti });
    closers.push(t.close);
    const fake = fakeSquare(salon());
    baglanti.square = squareBaglanti(t.db, { env: 'sandbox', clientId: 'sq0idb-app', clientSecret: 'sq0csb-secret', secret: 'connection-secret-for-tests-0123456789', fetch: fake.f }, () => t.clock.now);
    const s = await t.registerShop('Salon');
    const start = await t.call('POST', '/connections/square/start', { token: s.token });
    expect(start.status).toBe(200);
    const url = new URL(start.body.url);
    expect(url.origin).toBe('https://connect.squareupsandbox.com');
    expect(url.searchParams.get('client_id')).toBe('sq0idb-app');
    expect(url.searchParams.get('scope')).toContain('ORDERS_READ');
    expect(url.searchParams.get('scope')).not.toMatch(/WRITE/);
    return { t, s, fake, state: url.searchParams.get('state')! };
  }

  it('connects, pulls two years, writes daily book lines, and never doubles on re-sync', async () => {
    const { t, s, fake, state } = await connected();
    const fin = await t.call('POST', '/connections/square/finish', { token: s.token, body: { code: 'good-code', state } });
    expect(fin.status).toBe(201);
    expect(fin.body.merchant).toBe('M1');
    expect(fin.body.sync.musteri).toBe(15);
    expect(fin.body.sync.randevu).toBe(60);
    expect(fake.calls.filter((c) => c === 'POST /v2/orders/search').length).toBeGreaterThan(1); // followed the cursor

    const rows = async () => (await t.db.query(`select count(*)::int as n from import_rows where kind = 'kayit'`)).rows[0].n;
    const first = await rows();
    expect(first).toBe(fin.body.sync.kayit);

    // The tokens are stored encrypted, never in the clear, and never sent to the app.
    const conn = (await t.db.query(`select access_token_enc, refresh_token_enc from connections`)).rows[0];
    expect(conn.access_token_enc).toMatch(/^v1\./);
    expect(JSON.stringify(conn)).not.toContain('EAAA-token');
    const list = await t.call('GET', '/connections', { token: s.token });
    expect(list.body.data[0]).toMatchObject({ provider: 'square', status: 'connected', external_account: 'M1' });
    expect(JSON.stringify(list.body)).not.toContain('token');

    // The books show one Square line per day and category.
    const books = await t.call('GET', '/books/summary?period=month&date=2026-09-15', { token: s.token });
    expect(books.body.income_cents).toBeGreaterThan(0);
    const dayRows = (await t.db.query(`select note, category from book_entries where source = 'import' and entry_date = '2026-09-02'`)).rows;
    expect(dayRows.length).toBeGreaterThan(0);
    expect(dayRows[0].note).toMatch(/^Square · /);
    // 2 September has the refund: it is named as one, not counted as a sale.
    expect(dayRows.map((r: any) => r.note).join(' ')).toMatch(/1 iade/);

    // A day later: only the overlap is re-read, and nothing is counted twice.
    t.clock.now = new Date('2026-10-16T12:00:00Z');
    await fresh(t, s);
    const again = await t.call('POST', '/connections/square/sync', { token: s.token });
    expect(again.status).toBe(200);
    expect(await rows()).toBe(first);
    const dup = (await t.db.query(`select entry_date, category, count(*)::int as n from book_entries where source = 'import' group by 1, 2 having count(*) > 1`)).rows;
    expect(dup).toEqual([]);
  });

  it('rejects a forged or expired state and a bad code', async () => {
    const { t, s, state } = await connected();
    expect((await t.call('POST', '/connections/square/finish', { token: s.token, body: { code: 'good-code', state: state.slice(0, -2) + 'xx' } })).status).toBe(400);
    const other = await t.registerShop('Other');
    expect((await t.call('POST', '/connections/square/finish', { token: other.token, body: { code: 'good-code', state } })).body.error.code).toBe('BAD_STATE');
    t.clock.now = new Date('2026-10-15T12:20:00Z');
    await fresh(t, s);
    expect((await t.call('POST', '/connections/square/finish', { token: s.token, body: { code: 'good-code', state } })).status).toBe(400);
  });

  it('renews the access token a week before it runs out', async () => {
    const { t, s, fake, state } = await connected();
    await t.call('POST', '/connections/square/finish', { token: s.token, body: { code: 'good-code', state } });
    await t.db.query(`update subscriptions set status = 'active', current_period_end = null`);
    t.clock.now = new Date('2026-11-09T12:00:00Z'); // token expires 14 November
    await fresh(t, s);
    expect((await t.call('POST', '/connections/square/sync', { token: s.token })).status).toBe(200);
    expect(fake.calls.filter((c) => c === 'POST /oauth2/token')).toHaveLength(2);
  });

  it('the shop’s Röntgen finds the regulars who stopped coming and the no-shows', async () => {
    const { t, s, state } = await connected();
    await t.call('POST', '/connections/square/finish', { token: s.token, body: { code: 'good-code', state } });
    const r = await t.call('GET', '/rontgen', { token: s.token });
    expect(r.status).toBe(200);
    const ids = r.body.rontgen.bulgular.map((b: any) => b.id);
    expect(ids).toContain('musteri-kaybi');
    expect(ids).toContain('randevu-kaybi');
    // Written in the shop's language (this shop is English), or the one the app asks for.
    const kayip = r.body.rontgen.bulgular.find((b: any) => b.id === 'musteri-kaybi');
    expect(kayip.baslik).toBe('5 regular clients stopped coming');
    expect(kayip.kanit[0].deger).toMatch(/every 14 days · away \d+ days/);
    expect(r.body.rontgen.para).toBe('USD');
    const tr = (await t.call('GET', '/rontgen?lang=tr', { token: s.token })).body.rontgen.bulgular.find((b: any) => b.id === 'musteri-kaybi');
    expect(tr.baslik).toBe('5 düzenli müşteri gelmeyi bıraktı');
    expect(tr.kanit[0].deger).toMatch(/her 14 günde bir/);
    const es = (await t.call('GET', '/rontgen?lang=es', { token: s.token })).body.rontgen.bulgular.find((b: any) => b.id === 'musteri-kaybi');
    expect(es.baslik).toBe('5 clientes habituales dejaron de venir');
    const html = await t.call('GET', '/rontgen?format=html', { token: s.token });
    expect(html.body.html).toContain('<html lang="en">');
    expect(html.body.html).toContain('regular clients stopped coming');
    expect(html.body.html).toContain('Findings and what to do');
    expect(html.body.html).not.toMatch(/Bulgular|Yapılacak|kayıt/);
  });

  it('disconnecting forgets the tokens; with data=delete the imported rows go too', async () => {
    const { t, s, fake, state } = await connected();
    await t.call('POST', '/connections/square/finish', { token: s.token, body: { code: 'good-code', state } });
    expect((await t.call('DELETE', '/connections/square?data=delete', { token: s.token })).status).toBe(204);
    expect(fake.calls).toContain('POST /oauth2/revoke');
    const conn = (await t.db.query(`select status, access_token_enc from connections`)).rows[0];
    expect(conn).toEqual({ status: 'disconnected', access_token_enc: null });
    expect((await t.db.query(`select count(*)::int as n from import_rows`)).rows[0].n).toBe(0);
    expect((await t.db.query(`select count(*)::int as n from book_entries where source = 'import'`)).rows[0].n).toBe(0);
  });

  it('without Square settings on the server the routes say so', async () => {
    const t = await setup();
    closers.push(t.close);
    const s = await t.registerShop('X');
    expect((await t.call('POST', '/connections/square/start', { token: s.token })).body.error.code).toBe('NOT_CONFIGURED');
    expect((await t.call('GET', '/connections', { token: s.token })).body.available.square).toBe(false);
  });
});
