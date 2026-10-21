import type { Queryable } from './db';
import { sha256 } from './auth';

export type BusinessType = 'barber' | 'salon' | 'beauty' | 'other';

/** Starting menus (name, USD, minutes). The owner edits them in Settings. */
export const DEFAULT_SERVICES: Record<BusinessType, [string, number, number][]> = {
  barber: [
    ['Saç kesimi', 30, 30],
    ['Sakal tıraşı', 15, 20],
    ['Saç + sakal', 40, 45],
    ['Çocuk tıraşı', 20, 25],
  ],
  salon: [
    ['Kesim & fön', 45, 60],
    ['Fön', 25, 30],
    ['Boya', 90, 120],
    ['Röfle', 120, 150],
    ['Keratin bakım', 150, 150],
  ],
  beauty: [
    ['Manikür', 25, 40],
    ['Pedikür', 35, 50],
    ['Kaş & bıyık', 10, 15],
    ['Cilt bakımı', 60, 60],
  ],
  other: [],
};

/** The same menus in the shop's own language: a US salon starts with "Cut & blow-dry", not "Kesim & fön". */
const NAMES: Record<'en' | 'es', Record<string, string>> = {
  en: {
    'Saç kesimi': 'Haircut',
    'Sakal tıraşı': 'Beard trim',
    'Saç + sakal': 'Haircut + beard',
    'Çocuk tıraşı': 'Kids cut',
    'Kesim & fön': 'Cut & blow-dry',
    Fön: 'Blow-dry',
    Boya: 'Color',
    Röfle: 'Highlights',
    'Keratin bakım': 'Keratin treatment',
    Manikür: 'Manicure',
    Pedikür: 'Pedicure',
    'Kaş & bıyık': 'Brow & lip',
    'Cilt bakımı': 'Facial',
  },
  es: {
    'Saç kesimi': 'Corte de pelo',
    'Sakal tıraşı': 'Arreglo de barba',
    'Saç + sakal': 'Corte + barba',
    'Çocuk tıraşı': 'Corte infantil',
    'Kesim & fön': 'Corte y secado',
    Fön: 'Secado',
    Boya: 'Color',
    Röfle: 'Mechas',
    'Keratin bakım': 'Tratamiento de keratina',
    Manikür: 'Manicura',
    Pedikür: 'Pedicura',
    'Kaş & bıyık': 'Cejas y labio',
    'Cilt bakımı': 'Limpieza facial',
  },
};

export function servicesIn(type: BusinessType, lang: 'tr' | 'en' | 'es'): [string, number, number][] {
  return DEFAULT_SERVICES[type].map(([name, usd, min]) => [lang === 'tr' ? name : NAMES[lang][name] ?? name, usd, min]);
}

export interface ProvisionInput {
  shopName: string;
  ownerName: string;
  email: string;
  /** null for shops bought on the website: the owner sets a password with their access key. */
  passwordHash: string | null;
  country: string;
  timezone: string;
  language: 'tr' | 'en' | 'es';
  currency: string;
  businessType?: BusinessType;
  /** Start with the menu for the business type (invited and website shops). */
  defaultServices?: boolean;
  subscription: {
    status: 'trial' | 'active' | 'past_due' | 'cancelled';
    planKey: string;
    periodEnd: Date | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  };
  now: Date;
}

/** Opens a shop: owner account, first barber (the owner), subscription and an audit entry. System transaction. */
export async function provisionShop(tx: Queryable, p: ProvisionInput) {
  const shop = (
    await tx.query(`insert into shops (name, country, timezone, language, currency, business_type) values ($1, $2, $3, $4, $5, $6) returning id`, [
      p.shopName,
      p.country,
      p.timezone,
      p.language,
      p.currency,
      p.businessType ?? 'barber',
    ])
  ).rows[0];
  const user = (
    await tx.query(`insert into users (shop_id, email, password_hash, role, name) values ($1, $2, $3, 'owner', $4) returning *`, [
      shop.id,
      p.email,
      // "!" can never verify, so the account is unusable until the access key sets a password.
      p.passwordHash ?? '!',
      p.ownerName,
    ])
  ).rows[0];
  await tx.query('update shops set owner_user_id = $1 where id = $2', [user.id, shop.id]);
  // The owner usually works the floor too: their place on the team is linked to their login.
  await tx.query('insert into barbers (shop_id, name, user_id) values ($1, $2, $3)', [shop.id, p.ownerName, user.id]);
  if (p.defaultServices)
    for (const [name, usd, min] of servicesIn(p.businessType ?? 'barber', p.language))
      await tx.query('insert into services (shop_id, name, price_cents, duration_min) values ($1, $2, $3, $4)', [shop.id, name, usd * 100, min]);
  await tx.query(
    `insert into subscriptions (shop_id, plan_key, status, current_period_end, stripe_customer_id, stripe_subscription_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [shop.id, p.subscription.planKey, p.subscription.status, p.subscription.periodEnd, p.subscription.stripeCustomerId ?? null, p.subscription.stripeSubscriptionId ?? null],
  );
  await tx.query(`insert into audit_log (shop_id, user_id, action, entity, entity_id, at) values ($1, $2, 'shop.register', 'shop', $1, $3)`, [
    shop.id,
    user.id,
    p.now,
  ]);
  return { shopId: shop.id as string, user };
}

// No 0/O, 1/I/L: keys are read out of e-mails and typed on phones.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateAccessKey() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `MONA-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** "mona xxxx-xxxx xxxx" and "MONA-XXXX-XXXX-XXXX" are the same key. */
export const normalizeKey = (key: string) => key.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Issues a one-time access key for the owner; only its hash is stored. */
export async function createAccessKey(tx: Queryable, shopId: string, userId: string, now: Date, days = 14) {
  const key = generateAccessKey();
  await tx.query(`insert into access_keys (shop_id, user_id, key_hash, expires_at) values ($1, $2, $3, $4)`, [
    shopId,
    userId,
    await sha256(normalizeKey(key)),
    new Date(now.getTime() + days * 86400_000),
  ]);
  return key;
}
