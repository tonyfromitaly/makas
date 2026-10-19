// Keeping a shop's Square data in step with ours. Network calls happen outside any database transaction;
// each write is a short tenant transaction, so row-level security applies and nothing else waits.
//
// Where the data goes:
// - import_rows: every ledger line, customer and booking, with Square's id (re-syncs replace, never double).
//   Röntgen reads these.
// - book_entries: one line per day and category ("Square · 23 sales"), so the app's books show the takings.
// Tokens are stored encrypted (AES-GCM, key from the connection secret).
import { withTenant, type Database, type Queryable } from '../db';
import { squareAuthorizeUrl, squareCek, squareClient, squareDefter, squareToken, SquareError, type SquareEnv } from './square';
import type { Kayit } from '../rontgen/kayit';
import type { RandevuKaydi } from '../rontgen/musteri';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function aesKey(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`makas-connections:${secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sifrele(secret: string, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
export async function coz(secret: string, box: string) {
  const [v, iv, ct] = box.split('.');
  if (v !== 'v1') throw new Error('unknown token box');
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(secret), unb64(ct)));
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}
/** The OAuth "state": which shop started the connection, valid for 15 minutes, signed. */
export async function durumYaz(secret: string, shopId: string, now: Date) {
  const body = `${shopId}.${now.getTime() + 15 * 60_000}.${b64(crypto.getRandomValues(new Uint8Array(9)))}`;
  return `${body}.${await hmac(secret, body)}`;
}
export async function durumOku(secret: string, state: string, now: Date): Promise<string | null> {
  const i = state.lastIndexOf('.');
  if (i < 0) return null;
  const body = state.slice(0, i);
  if ((await hmac(secret, body)) !== state.slice(i + 1)) return null;
  const [shopId, exp] = body.split('.');
  return Number(exp) > now.getTime() ? shopId : null;
}

export interface SquareAyar {
  env: SquareEnv;
  clientId: string;
  clientSecret: string;
  /** Encrypts stored tokens. */
  secret: string;
  fetch?: typeof fetch;
  version?: string;
}

export interface EsitlemeOzeti {
  kayit: number;
  musteri: number;
  randevu: number;
  gun: number;
  bas: string;
  son: string;
}

const KATEGORI: Record<string, { kind: 'income' | 'expense'; category: string; ad: string }> = {
  hizmet: { kind: 'income', category: 'service', ad: 'hizmet' },
  urun: { kind: 'income', category: 'product', ad: 'ürün' },
  satis: { kind: 'income', category: 'service', ad: 'satış' },
  bahsis: { kind: 'income', category: 'tips', ad: 'bahşiş' },
  pos: { kind: 'expense', category: 'other', ad: 'işlem ücreti' },
};

/** Exchanges the OAuth code and stores the connection. */
export async function squareBagla(db: Database, shopId: string, code: string, a: SquareAyar, now: Date) {
  const t = await squareToken({ env: a.env, clientId: a.clientId, clientSecret: a.clientSecret, code, fetch: a.fetch });
  await withTenant(db, shopId, async (tx) => {
    await tx.query(
      `insert into connections (shop_id, provider, status, external_account, access_token_enc, refresh_token_enc, token_expires_at, last_error)
       values ($1, 'square', 'connected', $2, $3, $4, $5, null)
       on conflict (shop_id, provider) do update set status = 'connected', external_account = excluded.external_account,
         access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
         token_expires_at = excluded.token_expires_at, last_error = null`,
      [shopId, t.merchant_id, await sifrele(a.secret, t.access_token), await sifrele(a.secret, t.refresh_token), t.expires_at],
    );
    await tx.query(`insert into audit_log (shop_id, user_id, action, entity, entity_id, at) values ($1, null, 'connection.square_connected', 'connection', null, $2)`, [shopId, now]);
  });
  return { merchant: t.merchant_id };
}

/** Pulls what changed since the last sync (two years on the first run) and writes it. */
export async function squareEsitle(db: Database, shopId: string, a: SquareAyar, now: Date, gecmisAy = 24): Promise<EsitlemeOzeti> {
  const conn = await withTenant(db, shopId, async (tx) => (await tx.query(`select * from connections where shop_id = $1 and provider = 'square'`, [shopId])).rows[0]);
  if (!conn || conn.status === 'disconnected') throw new Error('square not connected');
  try {
    let token = await coz(a.secret, conn.access_token_enc);
    // Access tokens last 30 days; renew a week ahead.
    if (!conn.token_expires_at || new Date(conn.token_expires_at).getTime() - now.getTime() < 7 * 86_400_000) {
      const t = await squareToken({ env: a.env, clientId: a.clientId, clientSecret: a.clientSecret, refreshToken: await coz(a.secret, conn.refresh_token_enc), fetch: a.fetch });
      token = t.access_token;
      const [acc, ref] = [await sifrele(a.secret, t.access_token), await sifrele(a.secret, t.refresh_token)];
      await withTenant(db, shopId, (tx) =>
        tx.query(`update connections set access_token_enc = $2, refresh_token_enc = $3, token_expires_at = $4 where shop_id = $1 and provider = 'square'`, [shopId, acc, ref, t.expires_at]),
      );
    }
    const from = conn.last_sync_at
      ? new Date(new Date(conn.last_sync_at).getTime() - 3 * 86_400_000) // overlap: late edits and refunds
      : new Date(new Date(now).setMonth(now.getMonth() - gecmisAy));
    const ham = await squareCek(squareClient({ token, env: a.env, fetch: a.fetch, version: a.version }), from.toISOString(), now.toISOString());
    const { kayitlar, musteriler, randevular } = squareDefter(ham, now);

    const gunler = await withTenant(db, shopId, async (tx) => {
      const up = (kind: string, id: string, day: string | null, data: object) =>
        tx.query(
          `insert into import_rows (shop_id, provider, kind, external_id, happened_on, data) values ($1, 'square', $2, $3, $4, $5)
           on conflict (shop_id, provider, kind, external_id) do update set happened_on = excluded.happened_on, data = excluded.data`,
          [shopId, kind, id, day, JSON.stringify(data)],
        );
      for (const k of kayitlar) {
        const { dis, ...kayit } = k;
        await up('kayit', dis, k.tarih, kayit);
      }
      for (const m of musteriler) await up('musteri', m.id, m.ilk || null, m);
      for (const r of randevular) await up('randevu', r.id, r.tarih, r);
      const days = [...new Set(kayitlar.map((k) => k.tarih))];
      await gunlukDefter(tx, shopId, days);
      await tx.query(
        `update connections set last_sync_at = $2, last_error = null, status = 'connected' where shop_id = $1 and provider = 'square'`,
        [shopId, now],
      );
      return days.length;
    });
    const tarihler = kayitlar.map((k) => k.tarih);
    return { kayit: kayitlar.length, musteri: musteriler.length, randevu: randevular.length, gun: gunler, bas: tarihler[0] ?? '', son: tarihler[tarihler.length - 1] ?? '' };
  } catch (e) {
    const reconnect = e instanceof SquareError && e.status === 401;
    await withTenant(db, shopId, (tx) =>
      tx.query(`update connections set last_error = $2, status = $3 where shop_id = $1 and provider = 'square'`, [shopId, String((e as Error).message).slice(0, 300), reconnect ? 'needs_reconnect' : 'error']),
    );
    throw e;
  }
}

/** Rewrites the books' Square lines for the given days from the imported rows: one per day and category. */
async function gunlukDefter(tx: Queryable, shopId: string, days: string[]) {
  if (!days.length) return;
  await tx.query(`delete from book_entries where shop_id = $1 and source = 'import' and external_ref like 'square:%' and entry_date = any($2::date[])`, [shopId, days]);
  const { rows } = await tx.query(
    `select happened_on::text as day, data->>'kategori' as kat, sum((data->>'tutar')::numeric) as total, count(*)::int as n
       from import_rows where shop_id = $1 and provider = 'square' and kind = 'kayit' and happened_on = any($2::date[])
      group by 1, 2`,
    [shopId, days],
  );
  // Refunds are negative "satis" lines; a day's category total is what was kept.
  const merged = new Map<string, { day: string; kind: 'income' | 'expense'; category: string; cents: number; parts: string[] }>();
  for (const r of rows) {
    const m = KATEGORI[r.kat] ?? KATEGORI.satis;
    const key = `${r.day}:${m.kind}:${m.category}`;
    const e = merged.get(key) ?? { day: r.day, kind: m.kind, category: m.category, cents: 0, parts: [] as string[] };
    e.cents += Math.round(Number(r.total) * 100);
    e.parts.push(`${r.n} ${m.ad}`);
    merged.set(key, e);
  }
  for (const e of merged.values()) {
    if (e.cents <= 0) continue;
    await tx.query(
      `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, source, external_ref) values ($1, $2, $3, $4, $5, $6, 'import', $7)`,
      [shopId, e.kind, e.category, e.cents, e.day, `Square · ${e.parts.join(', ')}`.slice(0, 200), `square:${e.day}:${e.kind}:${e.category}`],
    );
  }
}

/** Revokes Square's access (best effort) and forgets the tokens. */
export async function squareKopar(db: Database, shopId: string, a: SquareAyar) {
  const conn = await withTenant(db, shopId, async (tx) => (await tx.query(`select access_token_enc from connections where shop_id = $1 and provider = 'square'`, [shopId])).rows[0]);
  if (conn?.access_token_enc) {
    try {
      const token = await coz(a.secret, conn.access_token_enc);
      await (a.fetch ?? fetch)(`${a.env === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com'}/oauth2/revoke`, {
        method: 'POST',
        headers: { authorization: `Client ${a.clientSecret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: a.clientId, access_token: token }),
      });
    } catch {
      /* the seller can also remove the app from their Square dashboard */
    }
  }
  await withTenant(db, shopId, (tx) =>
    tx.query(`update connections set status = 'disconnected', access_token_enc = null, refresh_token_enc = null, token_expires_at = null where shop_id = $1 and provider = 'square'`, [shopId]),
  );
}

/** What the server hands to the routes (Deps.baglanti.square). */
export function squareBaglanti(db: Database, a: SquareAyar, now: () => Date) {
  return {
    yetkiUrl: (state: string) => squareAuthorizeUrl({ env: a.env, clientId: a.clientId, state }),
    bagla: (shopId: string, code: string) => squareBagla(db, shopId, code, a, now()),
    esitle: (shopId: string) => squareEsitle(db, shopId, a, now()),
    kopar: (shopId: string) => squareKopar(db, shopId, a),
  };
}

const GERI: Record<string, string> = { service: 'hizmet', product: 'urun', tips: 'bahsis', rent: 'kira', supplies: 'malzeme', utilities: 'elektrik', wages: 'maas', other: 'diger' };

/**
 * Everything Röntgen can read for a shop: imported lines (all providers) plus the app's own books and
 * appointments. The books' import summaries are skipped, so nothing is counted twice.
 */
export async function rontgenVerisi(tx: Queryable, shopId: string): Promise<{ kayitlar: Kayit[]; randevular: RandevuKaydi[]; para: string; ad: string }> {
  const shop = (await tx.query('select name, currency from shops where id = $1', [shopId])).rows[0];
  const imported = (await tx.query(`select kind, data from import_rows where shop_id = $1 and kind in ('kayit', 'randevu') order by happened_on`, [shopId])).rows;
  const books = (
    await tx.query(
      `select b.kind, b.category, b.amount_cents, b.entry_date::text as day, b.note, c.name as client
         from book_entries b left join appointments a on a.id = b.appointment_id left join clients c on c.id = a.client_id
        where b.shop_id = $1 and b.source <> 'import'`,
      [shopId],
    )
  ).rows;
  const appts = (await tx.query(`select a.starts_at, a.status, c.name from appointments a join clients c on c.id = a.client_id where a.shop_id = $1`, [shopId])).rows;
  const kayitlar: Kayit[] = [
    ...imported.filter((r: any) => r.kind === 'kayit').map((r: any) => r.data as Kayit),
    ...books.map((b: any) => ({
      tarih: b.day,
      tur: b.kind === 'income' ? ('gelir' as const) : ('gider' as const),
      tutar: b.amount_cents / 100,
      para: shop.currency,
      kategori: GERI[b.category] ?? 'diger',
      karsiTaraf: b.client ?? undefined,
      aciklama: b.note ?? undefined,
    })),
  ].sort((a, b) => a.tarih.localeCompare(b.tarih));
  const DURUM: Record<string, RandevuKaydi['durum']> = { done: 'geldi', missed: 'gelmedi', cancelled: 'iptal-isletme', booked: 'bekliyor' };
  const randevular: RandevuKaydi[] = [
    ...imported.filter((r: any) => r.kind === 'randevu').map((r: any) => r.data as RandevuKaydi),
    ...appts.map((a: any) => ({ tarih: new Date(a.starts_at).toISOString().slice(0, 10), durum: DURUM[a.status] ?? 'bekliyor', musteri: a.name })),
  ];
  return { kayitlar, randevular, para: shop.currency, ad: shop.name };
}
