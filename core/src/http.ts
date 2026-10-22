import type { Focus, Turn } from './assistant/memory';
import { z } from 'zod';
import type { Queryable } from './db';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (message: string, code = 'BAD_REQUEST') => new ApiError(400, code, message);
export const unauthorized = (message = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Not allowed') => new ApiError(403, 'FORBIDDEN', message);
export const conflict = (message: string, code = 'CONFLICT') => new ApiError(409, code, message);

export type AuthKind = 'public' | 'user' | 'service' | 'admin';

export interface Deps {
  hashPassword(plain: string): Promise<string>;
  verifyPassword(hash: string, plain: string): Promise<boolean>;
  /** Tony's parse service (DeepSeek behind it). Optional: the local rule parser is the fallback. */
  parseNote?(input: { text: string; lang: string; today: string; timezone: string }): Promise<unknown>;
  /** LLM that turns a sentence into a Plan (see assistant/plan.ts). Optional: the local engine is the fallback. */
  assistant?(input: AssistantInput): Promise<unknown>;
  /** LLM that answers an open question in words, grounded on a SQL snapshot. Optional: local advice is the fallback.
   *  soul: the shop's own agent (SOUL.md + AGENT.md written by the setup wizard), when it has one. */
  chat?(input: { question: string; lang: string; shop: string; currency: string; snapshot: unknown; history?: Turn[]; memory?: string[]; soul?: string }): Promise<string>;
  /** LLM that reviews a quiet conversation and edits the long-term notes (core/agent/AGENT.md). Optional. */
  reflect?(input: { lang: string; shop: string; today: string; notes: { id: string; kind: string; subject: string | null; text: string; source: string }[]; turns: Turn[]; soul?: string }): Promise<unknown>;
  /** Tells the operator about something that needs a person (a demo request). Set by the server. */
  notifyOperator?(subject: string, lines: string[]): Promise<void>;
  /** What the health checks need from the running server (core/src/watch.ts). Set by the server. */
  health?(): { sending: boolean; errors5xx: number; jobs: string[] };
  /** Connections to the systems a business already uses. Set by the server when configured. */
  baglanti?: {
    square?: {
      yetkiUrl(state: string): string;
      bagla(shopId: string, code: string): Promise<{ merchant: string }>;
      esitle(shopId: string): Promise<{ kayit: number; musteri: number; randevu: number; gun: number; bas: string; son: string }>;
      kopar(shopId: string): Promise<void>;
    };
    plaid?: {
      sandbox: boolean;
      linkToken(shopId: string): Promise<string>;
      bagla(shopId: string, publicToken: string): Promise<{ item: string }>;
      sandboxBagla(shopId: string): Promise<{ item: string }>;
      esitle(shopId: string): Promise<{ kayit: number; silinen: number; gun: number; bas: string; son: string; kasa: { tutar: number; para: string; hesap: number } | null; hazir: boolean }>;
      kopar(shopId: string): Promise<void>;
    };
  };
}

export interface AssistantInput {
  text: string;
  lang: string;
  today: string;
  weekday: string;
  timezone: string;
  currency: string;
  services: string[];
  barbers: string[];
  clients: string[];
  /** The conversation so far (assistant/memory.ts), when there is one. */
  context?: { focus: Focus; earlier: string[]; recent: Turn[]; memory?: string[] };
}

export interface Config {
  jwtSecret: string;
  serviceApiKey: string;
  adminApiKey: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  trialDays: number;
  now: () => Date;
  /** false when shops can only be bought on the website (production). */
  allowSignup?: boolean;
  /** Public base URL of the website and app, e.g. https://fade.onrender.com */
  publicUrl?: string;
  /** Stripe checkout is configured. */
  billingEnabled?: boolean;
  /** Base32 TOTP secret: when set, the operator panel needs a 6-digit code as well as the admin key. */
  adminTotpSecret?: string;
}

export interface Ctx {
  db: Queryable;
  config: Config;
  deps: Deps;
  now: Date;
  shopId: string;
  userId: string;
  role: 'owner' | 'barber' | 'service' | 'admin' | 'public';
}

export interface Input<B = any, Q = any> {
  params: Record<string, string>;
  query: Q;
  body: B;
  ip?: string;
}

export interface Result {
  status: number;
  body?: unknown;
}

export interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  auth: AuthKind;
  /** Locked when the shop's subscription is not trial/active. */
  gated?: boolean;
  ownerOnly?: boolean;
  /** Handler gets a system transaction (still authenticated, must filter by ctx.shopId itself). */
  system?: boolean;
  /**
   * No transaction around the handler: for routes that wait on the network (connections). Each ctx.db
   * query runs in its own short tenant transaction, so row-level security still applies.
   */
  outside?: boolean;
  /** Admin routes run by scripts and monitors: the raw admin key still works when sign-in needs a code. */
  machine?: boolean;
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  handler(ctx: Ctx, input: Input): Promise<unknown | Result>;
}

export class Res implements Result {
  constructor(public status: number, public body?: unknown) {}
}
export const ok = (body: unknown, status = 200) => new Res(status, body);
export const noContent = () => new Res(204);

// --- shared validators ---
export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const lang = z.enum(['tr', 'en', 'es']);
export const cents = z.number().int().min(0).max(100_000_000);
export const positiveCents = z.number().int().min(1).max(100_000_000);
export const phone = z
  .string()
  .transform((s) => s.replace(/[\s\-()]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164, e.g. +905551234567'));

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export function paged<T>(rows: (T & { total_count?: number | string })[], page: number, pageSize: number) {
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    data: rows.map(({ total_count, ...r }: any) => r as T),
    page,
    page_size: pageSize,
    total,
  };
}

export async function audit(ctx: Ctx, action: string, entity: string, entityId: string | null) {
  await ctx.db.query(
    'insert into audit_log (shop_id, user_id, action, entity, entity_id, at) values ($1, $2, $3, $4, $5, $6)',
    [ctx.shopId, ctx.userId || null, action, entity, entityId, ctx.now],
  );
}

export function maskPhone(p: string) {
  if (p.length < 7) return '••••';
  return p.slice(0, 3) + ' ••• ••• ' + p.slice(-2);
}

/** Postgres errors surface as ApiErrors with a stable code instead of leaking internals. */
export function mapPgError(e: any): ApiError | null {
  const code = e?.code;
  if (code === '23P01')
    return e?.constraint === 'appointments_station_no_overlap'
      ? conflict('That station is taken at this time', 'STATION_TAKEN')
      : conflict('That barber already has an appointment at this time', 'SLOT_TAKEN');
  if (code === '23505') return conflict('Duplicate value', 'DUPLICATE');
  if (code === '23503') return notFound('Related record');
  if (code === '23514' || code === '22P02' || code === '22007' || code === '22008')
    return badRequest('Invalid value', 'VALIDATION_ERROR');
  if (code === '42501') return notFound();
  return null;
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}
