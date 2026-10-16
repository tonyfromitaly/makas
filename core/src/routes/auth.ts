import { z } from 'zod';
import { IANAZone } from 'luxon';
import { issueTokens, sha256 } from '../auth';
import { normalizeKey, provisionShop } from '../provision';
import { ApiError, conflict, errorBody, lang, ok, noContent, unauthorized, type Route } from '../http';

const email = z.string().trim().toLowerCase().email().max(200);
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

let dummyHash: string | null = null;

const publicUser = (u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, shop_id: u.shop_id });

export const authRoutes: Route[] = [
  {
    method: 'POST',
    path: '/auth/register',
    auth: 'public',
    body: z.object({
      shop_name: z.string().trim().min(1).max(120),
      owner_name: z.string().trim().min(1).max(120),
      email,
      password,
      country: z.string().trim().length(2).toUpperCase(),
      timezone: z.string().refine((tz) => IANAZone.isValidZone(tz), 'Unknown timezone'),
      language: lang.default('en'),
      currency: z.string().trim().length(3).toUpperCase().default('USD'),
    }),
    async handler(ctx, { body }) {
      if (ctx.config.allowSignup === false)
        throw new ApiError(403, 'SIGNUP_CLOSED', 'New shops are opened by subscribing on the website');
      const taken = await ctx.db.query('select 1 from users where lower(email) = $1', [body.email]);
      if (taken.rows.length) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
      const trialEnd = new Date(ctx.now.getTime() + ctx.config.trialDays * 86400_000);
      const { shopId, user } = await provisionShop(ctx.db, {
        shopName: body.shop_name,
        ownerName: body.owner_name,
        email: body.email,
        passwordHash: await ctx.deps.hashPassword(body.password),
        country: body.country,
        timezone: body.timezone,
        language: body.language,
        currency: body.currency,
        subscription: { status: 'trial', planKey: 'basic', periodEnd: trialEnd },
        now: ctx.now,
      });
      const shop = { id: shopId, name: body.shop_name };
      const { tokens } = await issueTokens(ctx.db, ctx.config, user);
      return ok({ ...tokens, user: publicUser(user), shop: { id: shop.id, name: shop.name } }, 201);
    },
  },
  {
    method: 'POST',
    path: '/auth/login',
    auth: 'public',
    body: z.object({ email, password: z.string().min(1).max(128) }),
    async handler(ctx, { body }) {
      const user = (await ctx.db.query('select * from users where lower(email) = $1', [body.email])).rows[0];
      if (!user) {
        // Same work either way, so response time does not reveal which emails exist.
        dummyHash ??= await ctx.deps.hashPassword('makas-dummy-password');
        await ctx.deps.verifyPassword(dummyHash, body.password);
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      }
      if (!(await ctx.deps.verifyPassword(user.password_hash, body.password)))
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      const { tokens } = await issueTokens(ctx.db, ctx.config, user);
      return { ...tokens, user: publicUser(user) };
    },
  },
  {
    method: 'POST',
    path: '/auth/refresh',
    auth: 'public',
    body: z.object({ refresh_token: z.string().min(20).max(200) }),
    async handler(ctx, { body }) {
      const row = (
        await ctx.db.query(
          `select t.*, u.role from refresh_tokens t join users u on u.id = t.user_id where t.token_hash = $1`,
          [await sha256(body.refresh_token)],
        )
      ).rows[0];
      if (!row) throw unauthorized('Invalid refresh token');
      if (row.revoked_at) {
        // A rotated token came back: assume theft and end the whole session family.
        await ctx.db.query(
          'update refresh_tokens set revoked_at = coalesce(revoked_at, $2) where family_id = $1',
          [row.family_id, ctx.now],
        );
        // Returned, not thrown, so the revocation above commits.
        return ok(errorBody('TOKEN_REUSED', 'Session ended, please sign in again'), 401);
      }
      if (new Date(row.expires_at) <= ctx.now) throw unauthorized('Refresh token expired');
      const { tokens, refreshId } = await issueTokens(
        ctx.db,
        ctx.config,
        { id: row.user_id, shop_id: row.shop_id, role: row.role },
        row.family_id,
      );
      await ctx.db.query('update refresh_tokens set revoked_at = $2, replaced_by = $3 where id = $1', [
        row.id,
        ctx.now,
        refreshId,
      ]);
      return tokens;
    },
  },
  {
    // First login (or recovery) with the access key from the welcome e-mail: sets the password, then signs in.
    method: 'POST',
    path: '/auth/key',
    auth: 'public',
    body: z.object({ key: z.string().trim().min(10).max(40), password }),
    async handler(ctx, { body }) {
      const hash = await sha256(normalizeKey(body.key));
      const key = (
        await ctx.db.query(`select id, user_id, used_at, expires_at from access_keys where key_hash = $1`, [hash])
      ).rows[0];
      if (!key || key.used_at || new Date(key.expires_at) <= ctx.now)
        throw new ApiError(401, 'INVALID_KEY', 'This access key is invalid, used or expired');
      await ctx.db.query('update users set password_hash = $2 where id = $1', [key.user_id, await ctx.deps.hashPassword(body.password)]);
      await ctx.db.query('update access_keys set used_at = $2 where id = $1', [key.id, ctx.now]);
      const user = (await ctx.db.query('select * from users where id = $1', [key.user_id])).rows[0];
      const { tokens } = await issueTokens(ctx.db, ctx.config, user);
      return { ...tokens, user: publicUser(user) };
    },
  },
  {
    // What the app needs to know before sign-in: can it open shops itself, or does it send people to the website?
    method: 'GET',
    path: '/meta',
    auth: 'public',
    async handler(ctx) {
      return {
        signup: ctx.config.allowSignup === false ? 'subscribe' : 'open',
        billing: !!ctx.config.billingEnabled,
        site_url: ctx.config.publicUrl ?? null,
      };
    },
  },
  {
    method: 'POST',
    path: '/auth/logout',
    auth: 'public',
    body: z.object({ refresh_token: z.string().min(20).max(200) }),
    async handler(ctx, { body }) {
      const row = (
        await ctx.db.query('select family_id from refresh_tokens where token_hash = $1', [await sha256(body.refresh_token)])
      ).rows[0];
      if (row)
        await ctx.db.query(
          'update refresh_tokens set revoked_at = coalesce(revoked_at, $2) where family_id = $1',
          [row.family_id, ctx.now],
        );
      return noContent();
    },
  },
];
