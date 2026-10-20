// Keeping a shop's bank account in step (Plaid). Like Square: network calls outside transactions, short
// tenant writes, the access token encrypted. Plaid's access tokens do not expire; the sync cursor and
// today's balance are kept on the connection.
//
// Where the data goes:
// - import_rows (provider 'plaid'): every posted transaction as a ledger line. Röntgen reads these.
// - book_entries: one line per day and category for money going out (rent, supplies, utilities, wages,
//   other). Money coming in is booked only when no sales system is connected (otherwise Square's sales
//   would be counted twice: once as sales, again as the payout landing in the bank).
import { withTenant, type Database, type Queryable } from '../db';
import { coz, sifrele } from './esitle';
import { girisSayilir, plaidClient, plaidDefter, plaidKasa, PlaidError, type PlaidEnv } from './plaid';

export interface PlaidAyar {
  env: PlaidEnv;
  clientId: string;
  secret: string;
  /** Encrypts the stored access token (the connection secret). */
  kasaSecret: string;
  fetch?: typeof fetch;
}

const KITAP: Record<string, string> = { kira: 'rent', malzeme: 'supplies', elektrik: 'utilities', su: 'utilities', dogalgaz: 'utilities', abonelik: 'utilities', maas: 'wages' };
const AD: Record<string, string> = { rent: 'kira', supplies: 'malzeme', utilities: 'fatura ve abonelik', wages: 'maaş', other: 'diğer gider' };

export function plaidBaglanti(db: Database, a: PlaidAyar, now: () => Date) {
  const c = plaidClient({ env: a.env, clientId: a.clientId, secret: a.secret, fetch: a.fetch });

  async function sakla(shopId: string, publicToken: string) {
    const t = await c.exchange(publicToken);
    await withTenant(db, shopId, async (tx) => {
      await tx.query(
        `insert into connections (shop_id, provider, status, external_account, access_token_enc, sync_cursor, last_error)
         values ($1, 'plaid', 'connected', $2, $3, null, null)
         on conflict (shop_id, provider) do update set status = 'connected', external_account = excluded.external_account,
           access_token_enc = excluded.access_token_enc, sync_cursor = null, last_error = null`,
        [shopId, t.item_id, await sifrele(a.kasaSecret, t.access_token)],
      );
      await tx.query(`insert into audit_log (shop_id, user_id, action, entity, entity_id, at) values ($1, null, 'connection.plaid_connected', 'connection', null, $2)`, [shopId, now()]);
    });
    return { item: t.item_id };
  }

  async function esitle(shopId: string) {
    const conn = await withTenant(db, shopId, async (tx) => (await tx.query(`select * from connections where shop_id = $1 and provider = 'plaid'`, [shopId])).rows[0]);
    if (!conn || conn.status === 'disconnected') throw new Error('bank not connected');
    try {
      const token = await coz(a.kasaSecret, conn.access_token_enc);
      const s = await c.sync(token, conn.sync_cursor ?? '');
      const accounts = await c.accounts(token);
      const kasa = plaidKasa(accounts);
      const kayitlar = plaidDefter([...s.added, ...s.modified], accounts);
      const days = await withTenant(db, shopId, async (tx) => {
        const touched = new Set<string>();
        for (const id of s.removed) {
          const old = (await tx.query(`delete from import_rows where shop_id = $1 and provider = 'plaid' and kind = 'kayit' and external_id = $2 returning happened_on::text as d`, [shopId, `tx:${id}`])).rows[0];
          if (old) touched.add(old.d);
        }
        // A transaction that was pending, or reclassified, may stop being a ledger line.
        for (const t of s.modified) await tx.query(`delete from import_rows where shop_id = $1 and provider = 'plaid' and kind = 'kayit' and external_id = $2`, [shopId, `tx:${t.transaction_id}`]);
        for (const k of kayitlar) {
          const { dis, ...kayit } = k;
          await tx.query(
            `insert into import_rows (shop_id, provider, kind, external_id, happened_on, data) values ($1, 'plaid', 'kayit', $2, $3, $4)
             on conflict (shop_id, provider, kind, external_id) do update set happened_on = excluded.happened_on, data = excluded.data`,
            [shopId, dis, k.tarih, JSON.stringify(kayit)],
          );
          touched.add(k.tarih);
        }
        await bankaDefteri(tx, shopId, [...touched]);
        await tx.query(
          `update connections set sync_cursor = $2, meta = $3, last_sync_at = $4, last_error = null, status = 'connected' where shop_id = $1 and provider = 'plaid'`,
          [shopId, s.cursor || conn.sync_cursor, JSON.stringify({ kasa, durum: s.status }), now()],
        );
        return touched.size;
      });
      const tarihler = kayitlar.map((k) => k.tarih).sort();
      return { kayit: kayitlar.length, silinen: s.removed.length, gun: days, bas: tarihler[0] ?? '', son: tarihler[tarihler.length - 1] ?? '', kasa, hazir: s.status !== 'NOT_READY' };
    } catch (e) {
      const reconnect = e instanceof PlaidError && /ITEM_LOGIN_REQUIRED|INVALID_ACCESS_TOKEN|ITEM_NOT_FOUND/.test(e.code);
      await withTenant(db, shopId, (tx) =>
        tx.query(`update connections set last_error = $2, status = $3 where shop_id = $1 and provider = 'plaid'`, [shopId, String((e as Error).message).slice(0, 300), reconnect ? 'needs_reconnect' : 'error']),
      );
      throw e;
    }
  }

  return {
    sandbox: a.env === 'sandbox',
    linkToken: async (shopId: string) => {
      const shop = await withTenant(db, shopId, async (tx) => (await tx.query('select name, language from shops where id = $1', [shopId])).rows[0]);
      return c.linkToken(shopId, shop?.name ?? 'Usta', shop?.language ?? 'en');
    },
    bagla: (shopId: string, publicToken: string) => sakla(shopId, publicToken),
    /** Sandbox only: link Plaid's test bank without the Link window. */
    sandboxBagla: async (shopId: string) => {
      if (a.env !== 'sandbox') throw new Error('sandbox only');
      return sakla(shopId, await c.sandboxToken());
    },
    esitle,
    kopar: async (shopId: string) => {
      const conn = await withTenant(db, shopId, async (tx) => (await tx.query(`select access_token_enc from connections where shop_id = $1 and provider = 'plaid'`, [shopId])).rows[0]);
      if (conn?.access_token_enc) {
        try {
          await c.remove(await coz(a.kasaSecret, conn.access_token_enc));
        } catch {
          /* already removed at Plaid */
        }
      }
      await withTenant(db, shopId, (tx) =>
        tx.query(`update connections set status = 'disconnected', access_token_enc = null, sync_cursor = null where shop_id = $1 and provider = 'plaid'`, [shopId]),
      );
    },
  };
}

/** The days another source of income covers (a sales system, or the app's own books), if any. */
export async function gelirKapsami(tx: Queryable, shopId: string): Promise<{ bas: string; son: string } | null> {
  const r = (
    await tx.query(
      `select min(d)::text as bas, max(d)::text as son from (
         select happened_on as d from import_rows where shop_id = $1 and provider <> 'plaid' and kind = 'kayit' and data->>'tur' = 'gelir'
         union all
         select entry_date from book_entries where shop_id = $1 and kind = 'income' and source <> 'import') x`,
      [shopId],
    )
  ).rows[0];
  return r?.bas ? { bas: r.bas, son: r.son } : null;
}

/** Rewrites the books' bank lines for the given days: one per day and category. */
async function bankaDefteri(tx: Queryable, shopId: string, days: string[]) {
  if (!days.length) return;
  await tx.query(`delete from book_entries where shop_id = $1 and source = 'import' and external_ref like 'plaid:%' and entry_date = any($2::date[])`, [shopId, days]);
  const kapsam = await gelirKapsami(tx, shopId);
  const { rows } = await tx.query(`select data from import_rows where shop_id = $1 and provider = 'plaid' and kind = 'kayit' and happened_on = any($2::date[])`, [shopId, days]);
  const merged = new Map<string, { day: string; kind: 'income' | 'expense'; category: string; cents: number; n: number }>();
  for (const { data: k } of rows) {
    if (k.tur === 'cekis') continue; // the owner's money, not the business's expense
    if (k.tur === 'gelir' && !girisSayilir(k, kapsam)) continue;
    const kind = k.tur === 'gelir' ? 'income' : 'expense';
    const category = kind === 'income' ? 'other' : KITAP[k.kategori] ?? 'other';
    const key = `${k.tarih}:${kind}:${category}`;
    const e = merged.get(key) ?? { day: k.tarih, kind, category, cents: 0, n: 0 };
    e.cents += Math.round(Number(k.tutar) * 100);
    e.n += 1;
    merged.set(key, e);
  }
  for (const e of merged.values()) {
    if (e.cents <= 0) continue;
    const ad = e.kind === 'income' ? 'banka girişi' : AD[e.category];
    await tx.query(
      `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, source, external_ref) values ($1, $2, $3, $4, $5, $6, 'import', $7)`,
      [shopId, e.kind, e.category, e.cents, e.day, `Banka · ${e.n} ${ad}`, `plaid:${e.day}:${e.kind}:${e.category}`],
    );
  }
}
