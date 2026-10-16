import type { Queryable } from './db';
import { sha256 } from './auth';

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
    await tx.query(`insert into shops (name, country, timezone, language, currency) values ($1, $2, $3, $4, $5) returning id`, [
      p.shopName,
      p.country,
      p.timezone,
      p.language,
      p.currency,
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
  await tx.query('insert into barbers (shop_id, name) values ($1, $2)', [shop.id, p.ownerName]);
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
  return `FADE-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** "fade xxxx-xxxx xxxx" and "FADE-XXXX-XXXX-XXXX" are the same key. */
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
