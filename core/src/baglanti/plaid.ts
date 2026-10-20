// Plaid: the business's bank account, read only. Transactions arrive through /transactions/sync (a cursor
// that only returns what changed), balances through /accounts/get. Field names follow plaid.com/docs.
// Plaid's sign: a positive amount is money leaving the account, a negative one money coming in.
// fetch is injected so tests run against a fake Plaid.
import type { Kayit } from '../rontgen/kayit';

export type PlaidEnv = 'sandbox' | 'production';
type Fetch = typeof fetch;

export const plaidBase = (env: PlaidEnv) => (env === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com');

export class PlaidError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

export function plaidClient(o: { env: PlaidEnv; clientId: string; secret: string; fetch?: Fetch }) {
  const f = o.fetch ?? fetch;
  async function post(path: string, body: object): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const res = await f(`${plaidBase(o.env)}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PLAID-CLIENT-ID': o.clientId, 'PLAID-SECRET': o.secret },
        body: JSON.stringify(body),
      });
      const j: any = await res.json().catch(() => ({}));
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new PlaidError(`plaid ${res.status}: ${j.error_code ?? ''} ${j.error_message ?? ''}`.trim(), res.status, j.error_code ?? '');
      return j;
    }
  }
  return {
    linkToken: (userId: string, clientName: string, lang: string) =>
      post('/link/token/create', {
        client_name: clientName.slice(0, 30),
        language: ['en', 'es', 'fr', 'de', 'nl'].includes(lang) ? lang : 'en',
        country_codes: ['US'],
        user: { client_user_id: userId },
        products: ['transactions'],
        transactions: { days_requested: 730 },
      }).then((r) => r.link_token as string),
    exchange: (publicToken: string) => post('/item/public_token/exchange', { public_token: publicToken }) as Promise<{ access_token: string; item_id: string }>,
    /** Sandbox only: a linked test bank without the Link window (Plaid's small-business persona by default). */
    sandboxToken: (username = 'user_small_business') =>
      post('/sandbox/public_token/create', {
        institution_id: 'ins_109508',
        initial_products: ['transactions'],
        options: { override_username: username, override_password: 'pass_good', transactions: { days_requested: 730 } },
      }).then((r) => r.public_token as string),
    accounts: (accessToken: string) => post('/accounts/get', { access_token: accessToken }).then((r) => r.accounts as any[]),
    remove: (accessToken: string) => post('/item/remove', { access_token: accessToken }),
    /**
     * Everything since `cursor` (all history when empty). If the data changes while paging, Plaid asks
     * to start over from the first cursor; we do, a few times.
     */
    async sync(accessToken: string, cursor: string) {
      for (let restart = 0; ; restart++) {
        const added: any[] = [];
        const modified: any[] = [];
        const removed: string[] = [];
        let c = cursor;
        let status = '';
        try {
          for (;;) {
            const r = await post('/transactions/sync', { access_token: accessToken, cursor: c || undefined, count: 500 });
            added.push(...r.added);
            modified.push(...r.modified);
            removed.push(...r.removed.map((x: any) => x.transaction_id));
            status = r.transactions_update_status ?? status;
            c = r.next_cursor;
            if (!r.has_more) break;
          }
          return { added, modified, removed, cursor: c, status };
        } catch (e) {
          if (e instanceof PlaidError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && restart < 3) continue;
          throw e;
        }
      }
    },
  };
}

/** Plaid's personal finance categories (detailed first, then primary) to our ledger's. */
const DETAY: [RegExp, string][] = [
  [/^RENT_AND_UTILITIES_RENT$/, 'kira'],
  [/^RENT_AND_UTILITIES_GAS_AND_ELECTRICITY$/, 'elektrik'],
  [/^RENT_AND_UTILITIES_WATER$/, 'su'],
  [/^RENT_AND_UTILITIES_/, 'abonelik'], // phone, internet, cable, sewage, trash
  [/^GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING$/, 'muhasebe'],
  [/^GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT$/, 'vergi'],
  [/^LOAN_PAYMENTS_/, 'finansman'],
  [/^BANK_FEES_/, 'diger'],
  [/^GENERAL_MERCHANDISE_|^HOME_IMPROVEMENT_/, 'malzeme'],
  [/^GENERAL_SERVICES_/, 'diger'],
];

export interface PlaidKayit extends Kayit {
  dis: string;
  /** Money in: kept apart so it is not counted twice when a sales system is connected too. */
  giris?: boolean;
}

/** "GENERAL_SERVICES_INSURANCE" → "General services · insurance": Plaid's codes, readable. */
export function plaidEtiket(primary: string, detailed: string) {
  const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');
  if (!detailed) return primary ? words(primary).replace(/^./, (c) => c.toUpperCase()) : '';
  const rest = primary && detailed.startsWith(`${primary}_`) ? detailed.slice(primary.length + 1) : detailed;
  return `${words(primary || '').replace(/^./, (c) => c.toUpperCase())}${primary ? ' · ' : ''}${words(rest)}`;
}

// Plaid files payroll runs under transfers; the payee's name says what they are.
const BORDRO = /payroll|paychex|\badp\b|gusto|paylocity|rippling|justworks|trinet|onpay|patriot pay/i;
// Money in that is income: customer payments, wires, deposits. Not loans, not own-account moves, not refunds.
const GELIR = /^INCOME_|^TRANSFER_IN_(DEPOSIT|WIRE|OTHER_TRANSFER_IN)/;

/**
 * Bank transactions as ledger lines, account by account:
 * - checking/savings, money out: an expense in its category; payroll by the payee's name; cash
 *   withdrawals are the owner taking money; transfers between own accounts are left out; card and loan
 *   payments are left out when the card or loan is linked too (its own lines carry the spending and
 *   the interest, and a principal repayment is not a cost);
 * - checking/savings, money in: income only for customer payments, wires and deposits;
 * - card and loan accounts: purchases and interest are expenses; payments into them are not income.
 * Pending transactions wait until they post.
 */
export function plaidDefter(txs: any[], accounts: any[] = []): PlaidKayit[] {
  const tip = new Map<string, string>(accounts.map((a) => [a.account_id, a.type]));
  const kartVar = accounts.some((a) => a.type === 'credit');
  const krediVar = accounts.some((a) => a.type === 'loan');
  const out: PlaidKayit[] = [];
  for (const t of txs) {
    if (t.pending) continue;
    const pfc = t.personal_finance_category ?? {};
    const detay = String(pfc.detailed ?? '');
    const ana = String(pfc.primary ?? '');
    const tutar = Math.abs(Number(t.amount));
    if (!tutar) continue;
    const ad = `${t.merchant_name ?? ''} ${t.name ?? ''}`;
    const hesap = tip.get(t.account_id) ?? 'depository';
    const base = { dis: `tx:${t.transaction_id}`, tarih: t.date as string, tutar, para: t.iso_currency_code ?? undefined, karsiTaraf: t.merchant_name || t.name || undefined, kategoriAdi: plaidEtiket(ana, detay) || undefined, aciklama: t.name };
    const giris = Number(t.amount) < 0;

    if (hesap !== 'depository') {
      if (giris) continue; // a payment into the card or loan, or a refund on it
      out.push({ ...base, tur: 'gider', kategori: /INTEREST/.test(detay) ? 'finansman' : kategori(detay, ana) });
      continue;
    }
    if (giris) {
      if (GELIR.test(detay) || (ana === 'INCOME' && !/LOAN/.test(detay))) out.push({ ...base, tur: 'gelir', kategori: 'satis', giris: true });
      continue;
    }
    if (BORDRO.test(ad) && !/TAX/.test(detay)) {
      out.push({ ...base, tur: 'gider', kategori: 'maas', kategoriAdi: 'Payroll' }); // not Plaid's "account transfer"
      continue;
    }
    if (/ACCOUNT_TRANSFER/.test(detay)) continue;
    if (ana === 'TRANSFER_OUT' && /WITHDRAWAL/.test(detay)) {
      out.push({ ...base, tur: 'cekis', kategori: 'sahip' });
      continue;
    }
    if (detay === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' && kartVar) continue;
    if (ana === 'LOAN_PAYMENTS' && detay !== 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' && krediVar) continue;
    out.push({ ...base, tur: 'gider', kategori: kategori(detay, ana) });
  }
  return out;
}

function kategori(detay: string, _ana: string) {
  return DETAY.find(([re]) => re.test(detay))?.[1] ?? 'diger';
}

/** Card processors and marketplaces: their deposits are payouts of sales a sales system already counts. */
export const ODEME_KURULUSU = /square|stripe|paypal|shopify|clover|toast|venmo|zelle from square|sq \*|etsy|amazon payments/i;

/**
 * A bank deposit counts as income unless the same money is already counted: a processor's payout, or
 * a deposit on a day the sales system (or the app's own books) covers.
 */
export function girisSayilir(k: { giris?: boolean; tarih: string; karsiTaraf?: string; aciklama?: string }, kapsam: { bas: string; son: string } | null) {
  if (!k.giris) return true;
  if (ODEME_KURULUSU.test(`${k.karsiTaraf ?? ''} ${k.aciklama ?? ''}`)) return !kapsam;
  return !kapsam || k.tarih < kapsam.bas || k.tarih > kapsam.son;
}

/** Cash today: the current balance of checking and savings accounts. */
export function plaidKasa(accounts: any[]) {
  const dep = accounts.filter((a) => a.type === 'depository');
  if (!dep.length) return null;
  return { tutar: dep.reduce((s, a) => s + Number(a.balances?.current ?? 0), 0), para: dep[0].balances?.iso_currency_code ?? 'USD', hesap: dep.length };
}
