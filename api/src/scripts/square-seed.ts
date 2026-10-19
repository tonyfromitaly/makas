// Fills a Square SANDBOX seller with a believable day: services and products, customers, card and cash
// sales with tips, one refund. Square stamps every order and payment with the current time (they cannot
// be backdated), so this is "today"; the three-month picture comes from npm run square:sim.
//   SQUARE_SEED_TOKEN=<sandbox token with write permissions for the test seller> in .env
//   npm run square:seed -w api
// Refuses to run against production.
export {};
for (const f of ['.env', '../.env']) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* not present */
  }
}

const token = process.env.SQUARE_SEED_TOKEN ?? '';
if (!token) {
  console.error('SQUARE_SEED_TOKEN is empty: see docs/square-baglantisi.md (Sandbox verisi).');
  process.exit(1);
}
if (process.env.SQUARE_ENV === 'production') {
  console.error('This script only writes to the Square sandbox.');
  process.exit(1);
}
const base = 'https://connect.squareupsandbox.com/v2';
const run = Date.now().toString(36);
let n = 0;
const key = () => `usta-seed-${run}-${++n}`;

async function sq(method: string, path: string, body?: object): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j: any = await res.json().catch(() => ({}));
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${j?.errors?.map((e: any) => `${e.code} ${e.detail ?? ''}`).join('; ')}`);
    return j;
  }
}

const seed = (s: number) => () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const r = seed(42);
const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];

const merchant = (await sq('GET', '/merchants/me')).merchant;
const sube = (await sq('GET', '/locations')).locations.find((l: any) => l.status === 'ACTIVE');
console.log(`seller: ${merchant.business_name ?? merchant.id} (${merchant.id}) · location ${sube.name} · ${sube.currency}`);
// The token decides which test seller gets the data; it must be the one the app is connected to.
const expected = process.env.SQUARE_SEED_MERCHANT;
if (expected && expected !== merchant.id) {
  console.error(`This token belongs to ${merchant.id}, but the app is connected to ${expected}. Nothing written.`);
  process.exit(1);
}
if (!expected) console.log('  (set SQUARE_SEED_MERCHANT to the connected seller id, shown in Settings › Connections, to guard against the wrong seller)');

// Catalog: services as "appointment services" when the seller allows it, otherwise plain items.
const HIZMET = [
  ['Haircut', 3500],
  ['Skin fade', 4200],
  ['Cut + beard', 5500],
  ['Beard trim', 2000],
  ['Kids cut', 2500],
] as const;
const URUN = [
  ['Pomade', 1800],
  ['Beard oil', 1400],
] as const;
const item = (name: string, price: number, i: number, service: boolean) => ({
  type: 'ITEM',
  id: `#i${i}`,
  item_data: {
    name,
    ...(service ? { product_type: 'APPOINTMENTS_SERVICE' } : {}),
    variations: [
      {
        type: 'ITEM_VARIATION',
        id: `#v${i}`,
        item_variation_data: { item_id: `#i${i}`, name: 'Regular', pricing_type: 'FIXED_PRICING', price_money: { amount: price, currency: sube.currency }, ...(service ? { service_duration: 30 * 60_000, available_for_booking: true } : {}) },
      },
    ],
  },
});
async function upsert(service: boolean) {
  const objects = [...HIZMET.map(([a, p], i) => item(a, p, i, service)), ...URUN.map(([a, p], i) => item(a, p, i + 10, false))];
  return sq('POST', '/catalog/batch-upsert', { idempotency_key: key(), batches: [{ objects }] });
}
let cat: any;
try {
  cat = await upsert(true);
} catch (e) {
  console.log(`  services as plain items (${String((e as Error).message).slice(0, 120)})`);
  cat = await upsert(false);
}
const vid = (tmp: string) => cat.id_mappings.find((m: any) => m.client_object_id === tmp).object_id;
const hizmetler = HIZMET.map((_, i) => vid(`#v${i}`));
const urunler = URUN.map((_, i) => vid(`#v${i + 10}`));
console.log(`catalog: ${hizmetler.length} services, ${urunler.length} products`);

const ADLAR = ['James', 'Marcus', 'Diego', 'Andre', 'Tyler', 'Luis', 'Kevin', 'Omar', 'Brandon', 'Carlos'];
const SOYADLAR = ['Johnson', 'Garcia', 'Williams', 'Martinez', 'Brown', 'Lopez', 'Davis', 'Hernandez'];
const customers: string[] = [];
for (let i = 0; i < 24; i++) {
  const c = await sq('POST', '/customers', { idempotency_key: key(), given_name: pick(ADLAR), family_name: pick(SOYADLAR), reference_id: `usta-seed-${i}` });
  customers.push(c.customer.id);
}
console.log(`customers: ${customers.length}`);

const payments: string[] = [];
let cash = 0;
let card = 0;
for (let i = 0; i < 26; i++) {
  const line_items: any[] = [{ catalog_object_id: pick(hizmetler), quantity: '1' }];
  if (r() < 0.2) line_items.push({ catalog_object_id: pick(urunler), quantity: '1' });
  const customer_id = r() < 0.85 ? pick(customers) : undefined;
  const order = (await sq('POST', '/orders', { idempotency_key: key(), order: { location_id: sube.id, customer_id, line_items } })).order;
  const amount = order.total_money.amount;
  const kart = r() < 0.8;
  const tip = kart ? Math.round((amount * (0.15 + r() * 0.08)) / 25) * 25 : 0;
  const body: any = { idempotency_key: key(), amount_money: { amount, currency: sube.currency }, order_id: order.id, location_id: sube.id, customer_id };
  if (kart) Object.assign(body, { source_id: 'cnon:card-nonce-ok', tip_money: { amount: tip, currency: sube.currency } });
  else Object.assign(body, { source_id: 'CASH', cash_details: { buyer_supplied_money: { amount: Math.ceil(amount / 500) * 500, currency: sube.currency } } });
  const p = (await sq('POST', '/payments', body)).payment;
  payments.push(p.id);
  kart ? card++ : cash++;
}
console.log(`sales: ${payments.length} (${card} card, ${cash} cash)`);

const refund = await sq('POST', '/refunds', { idempotency_key: key(), payment_id: payments[3], amount_money: { amount: 1000, currency: sube.currency }, reason: 'Usta seed: partial refund' });
console.log(`refund: ${refund.refund.status}`);
console.log('done. Now sync: Settings › Connections › Sync now (or POST /connections/square/sync).');
