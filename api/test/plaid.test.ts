import { afterEach, describe, expect, it } from 'vitest';
import { plaidBaglanti, plaidDefter } from '@makas/core';
import { setup } from './helpers';

// The bank connection (Plaid) against a fake Plaid that pages /transactions/sync with cursors like the
// real one: categories, own-account transfers, owner withdrawals, no double income next to Square,
// opening cash from today's balance, incremental changes, disconnect.

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

const tx = (id: string, date: string, amount: number, detailed: string, name: string, extra: object = {}) => ({
  transaction_id: id,
  account_id: 'acc-chk',
  date,
  amount,
  iso_currency_code: 'USD',
  name,
  merchant_name: name,
  pending: false,
  personal_finance_category: { primary: detailed.split('_').slice(0, detailed.startsWith('RENT_AND_UTILITIES') ? 3 : detailed.startsWith('GENERAL_MERCHANDISE') ? 2 : 2).join('_'), detailed },
  ...extra,
});

/** Six months of a shop's checking account. */
function history() {
  const out: any[] = [];
  for (let m = 4; m <= 9; m++) {
    const mm = String(m).padStart(2, '0');
    out.push(tx(`rent-${m}`, `2026-${mm}-01`, 2400, 'RENT_AND_UTILITIES_RENT', 'Oak Properties'));
    out.push(tx(`elec-${m}`, `2026-${mm}-08`, 180 + m * 4, 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', 'CenterPoint Energy'));
    out.push(tx(`net-${m}`, `2026-${mm}-10`, 89, 'RENT_AND_UTILITIES_INTERNET_AND_CABLE', 'Comcast'));
    out.push(tx(`sup-${m}`, `2026-${mm}-14`, 310, 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', 'Barber Supply Co'));
    out.push(tx(`loan-${m}`, `2026-${mm}-20`, 450, 'LOAN_PAYMENTS_OTHER_PAYMENT', 'SBA Loan'));
    out.push(tx(`atm-${m}`, `2026-${mm}-25`, 1500, 'TRANSFER_OUT_WITHDRAWAL', 'ATM Withdrawal'));
    out.push(tx(`sav-${m}`, `2026-${mm}-26`, 500, 'TRANSFER_OUT_ACCOUNT_TRANSFER', 'Transfer to Savings'));
    for (const d of ['05', '12', '19', '26']) out.push(tx(`dep-${m}-${d}`, `2026-${mm}-${d}`, -2100, 'TRANSFER_IN_DEPOSIT', 'SQUARE INC'));
  }
  out.push(tx('pending-1', '2026-10-14', 75, 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', 'Barber Supply Co', { pending: true }));
  return out;
}

function fakePlaid() {
  const calls: string[] = [];
  const all = history();
  let later: { added: any[]; modified: any[]; removed: any[] } = { added: [], modified: [], removed: [] };
  let balance = 8420.55;
  const f = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const h = init.headers as any;
    const body = JSON.parse(String(init.body));
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (h['PLAID-CLIENT-ID'] !== 'cid' || h['PLAID-SECRET'] !== 'sec') return json({ error_code: 'INVALID_API_KEYS' }, 400);
    switch (path) {
      case '/sandbox/public_token/create':
        return json({ public_token: 'public-sandbox-1' });
      case '/item/public_token/exchange':
        return body.public_token === 'public-sandbox-1' ? json({ access_token: 'access-sandbox-1', item_id: 'item-1' }) : json({ error_code: 'INVALID_PUBLIC_TOKEN' }, 400);
      case '/accounts/get':
        return json({ accounts: [{ account_id: 'acc-chk', type: 'depository', subtype: 'checking', balances: { current: balance, iso_currency_code: 'USD' } }, { account_id: 'acc-cc', type: 'credit', balances: { current: 900, iso_currency_code: 'USD' } }] });
      case '/item/remove':
        return json({ removed: true });
      case '/transactions/sync': {
        if (body.access_token !== 'access-sandbox-1') return json({ error_code: 'INVALID_ACCESS_TOKEN' }, 400);
        const half = Math.ceil(all.length / 2);
        if (!body.cursor) return json({ added: all.slice(0, half), modified: [], removed: [], next_cursor: 'c1', has_more: true, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' });
        if (body.cursor === 'c1') return json({ added: all.slice(half), modified: [], removed: [], next_cursor: 'c2', has_more: false, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' });
        if (body.cursor === 'c2') {
          const r = { ...later, next_cursor: 'c3', has_more: false, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' };
          later = { added: [], modified: [], removed: [] };
          return json(r);
        }
        return json({ added: [], modified: [], removed: [], next_cursor: body.cursor, has_more: false });
      }
    }
    return json({ error_code: 'NOT_FOUND' }, 404);
  }) as unknown as typeof fetch;
  return { f, calls, setLater: (l: typeof later) => (later = l), setBalance: (b: number) => (balance = b) };
}

describe('bank → ledger', () => {
  it('sorts bank lines into rent, utilities, supplies, loans, owner withdrawals and deposits', () => {
    const k = plaidDefter(history());
    const by = (id: string) => k.find((x) => x.dis === `tx:${id}`);
    expect(by('rent-4')).toMatchObject({ tur: 'gider', kategori: 'kira', tutar: 2400, karsiTaraf: 'Oak Properties' });
    expect(by('elec-4')!.kategori).toBe('elektrik');
    expect(by('net-4')!.kategori).toBe('abonelik');
    expect(by('sup-4')!.kategori).toBe('malzeme');
    expect(by('loan-4')!.kategori).toBe('finansman');
    expect(by('atm-4')).toMatchObject({ tur: 'cekis', kategori: 'sahip' });
    expect(by('dep-4-05')).toMatchObject({ tur: 'gelir', tutar: 2100, giris: true });
    expect(by('sav-4')).toBeUndefined(); // own accounts
    expect(by('pending-1')).toBeUndefined(); // waits until it posts
  });
});

describe('bank connection', () => {
  async function connected() {
    const baglanti: any = {};
    const t = await setup('2026-10-15T12:00:00Z', { baglanti });
    closers.push(t.close);
    const fake = fakePlaid();
    baglanti.plaid = plaidBaglanti(t.db, { env: 'sandbox', clientId: 'cid', secret: 'sec', kasaSecret: 'connection-secret-for-tests-0123456789', fetch: fake.f }, () => t.clock.now);
    const s = await t.registerShop('Shop');
    return { t, s, fake };
  }

  it('links the test bank, reads every page, keeps the token encrypted and books the days', async () => {
    const { t, s, fake } = await connected();
    const r = await t.call('POST', '/connections/plaid/sandbox', { token: s.token });
    expect(r.status).toBe(201);
    expect(r.body.sync.kasa).toEqual({ tutar: 8420.55, para: 'USD', hesap: 1 });
    expect(fake.calls.filter((c) => c === '/transactions/sync')).toHaveLength(2); // followed has_more
    const conn = (await t.db.query(`select access_token_enc, sync_cursor from connections where provider = 'plaid'`)).rows[0];
    expect(conn.access_token_enc).toMatch(/^v1\./);
    expect(JSON.stringify(conn)).not.toContain('access-sandbox');
    expect(conn.sync_cursor).toBe('c2');
    const list = await t.call('GET', '/connections', { token: s.token });
    expect(list.body.data[0]).toMatchObject({ provider: 'plaid', status: 'connected', balance: { tutar: 8420.55 } });
    // No sales system: the deposits are this shop's income; rent shows as rent; withdrawals are not costs.
    const may = (await t.db.query(`select kind, category, amount_cents, note from book_entries where source = 'import' and entry_date between '2026-05-01' and '2026-05-31' order by entry_date, kind`)).rows;
    expect(may.find((b: any) => b.category === 'rent')).toMatchObject({ kind: 'expense', amount_cents: 240000, note: 'Banka · 1 kira' });
    expect(may.find((b: any) => b.category === 'utilities')).toBeTruthy();
    expect(may.filter((b: any) => b.kind === 'income')).toHaveLength(4);
    expect(may.some((b: any) => b.amount_cents === 150000)).toBe(false); // the ATM withdrawal
  });

  it('next to Square, deposits are not income twice; opening cash comes from today’s balance', async () => {
    const { t, s } = await connected();
    // Square's sales for the same months, as a connected Square would have written them.
    const sid = s.shopId;
    for (let m = 4; m <= 9; m++)
      await t.db.query(`insert into import_rows (shop_id, provider, kind, external_id, happened_on, data) values ($1, 'square', 'kayit', $2, $3, $4)`, [
        sid,
        `order:${m}`,
        `2026-0${m}-15`,
        JSON.stringify({ tarih: `2026-0${m}-15`, tur: 'gelir', tutar: 9000, para: 'USD', kategori: 'hizmet' }),
      ]);
    await t.call('POST', '/connections/plaid/sandbox', { token: s.token });
    const income = (await t.db.query(`select count(*)::int as n from book_entries where source = 'import' and external_ref like 'plaid:%' and kind = 'income'`)).rows[0].n;
    expect(income).toBe(0);
    const r = await t.call('GET', '/rontgen', { token: s.token });
    const x = r.body.rontgen;
    expect(x.ozet.toplamGelir).toBe(54000); // Square's sales only, not the bank deposits on top
    expect(x.ozet.kasa).toBeCloseTo(8420.55, 2); // runs forward to today's balance
    expect(x.yapilamayan.join(' ')).not.toMatch(/Kasa ve banka bakiyesi verilmedi/);
  });

  it('applies what changed: new lines, a removed one, a pending one that posted', async () => {
    const { t, s, fake } = await connected();
    await t.call('POST', '/connections/plaid/sandbox', { token: s.token });
    const n = async () => (await t.db.query(`select count(*)::int as n from import_rows where provider = 'plaid'`)).rows[0].n;
    const before = await n();
    fake.setLater({
      added: [tx('rent-10', '2026-10-01', 2400, 'RENT_AND_UTILITIES_RENT', 'Oak Properties')],
      modified: [tx('pending-1', '2026-10-14', 75, 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', 'Barber Supply Co')],
      removed: [{ transaction_id: 'sup-9', account_id: 'acc-chk' }],
    });
    const r = await t.call('POST', '/connections/plaid/sync', { token: s.token });
    expect(r.body.sync).toMatchObject({ kayit: 2, silinen: 1 });
    expect(await n()).toBe(before + 2 - 1);
    expect((await t.db.query(`select count(*)::int as n from import_rows where external_id = 'tx:sup-9'`)).rows[0].n).toBe(0);
    const sep = (await t.db.query(`select note from book_entries where external_ref = 'plaid:2026-09-14:expense:supplies'`)).rows;
    expect(sep).toEqual([]); // the removed purchase left the books too
  });

  it('disconnecting removes the item at Plaid and forgets the token', async () => {
    const { t, s, fake } = await connected();
    await t.call('POST', '/connections/plaid/sandbox', { token: s.token });
    expect((await t.call('DELETE', '/connections/plaid?data=delete', { token: s.token })).status).toBe(204);
    expect(fake.calls).toContain('/item/remove');
    expect((await t.db.query(`select status, access_token_enc from connections where provider = 'plaid'`)).rows[0]).toEqual({ status: 'disconnected', access_token_enc: null });
    expect((await t.db.query(`select count(*)::int as n from import_rows where provider = 'plaid'`)).rows[0].n).toBe(0);
  });

  it('the test-bank shortcut does not exist outside the sandbox', async () => {
    const baglanti: any = {};
    const t = await setup('2026-10-15T12:00:00Z', { baglanti });
    closers.push(t.close);
    baglanti.plaid = plaidBaglanti(t.db, { env: 'production', clientId: 'cid', secret: 'sec', kasaSecret: 'x'.repeat(40), fetch: fakePlaid().f }, () => t.clock.now);
    const s = await t.registerShop('Shop');
    expect((await t.call('POST', '/connections/plaid/sandbox', { token: s.token })).status).toBe(404);
    expect((await t.call('GET', '/connections', { token: s.token })).body.available).toMatchObject({ plaid: true, plaidSandbox: false });
  });
});
