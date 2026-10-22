import { z } from 'zod';
import { CATEGORIES } from '../parse/note';

// What the assistant understood. Both the local rule engine and the LLM produce exactly this;
// the server then resolves names to ids and computes every number with SQL.
export const METRICS = ['summary', 'cash', 'team', 'income', 'expense', 'net', 'payables', 'receivables', 'appointments', 'top_service', 'client_balance', 'reminders', 'voids'] as const;
export const PERIODS = ['today', 'yesterday', 'tomorrow', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year'] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const cents = z.number().int().min(1).max(100_000_000);

export const planItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('appointment'),
    client_name: z.string().max(80).nullable(),
    phone: z.string().max(40).nullable().optional(),
    service: z.string().max(80).nullable().optional(),
    barber: z.string().max(80).nullable().optional(),
    date,
    time: time.nullable(),
  }),
  z.object({
    type: z.literal('client'),
    name: z.string().min(1).max(80),
    phone: z.string().max(40).nullable(),
    language: z.enum(['tr', 'en', 'es']).nullable().optional(),
  }),
  z.object({
    type: z.literal('book'),
    kind: z.enum(['income', 'expense']),
    amount_cents: cents,
    category: z.enum(CATEGORIES as [string, ...string[]]),
    entry_date: date,
    note: z.string().max(200).default(''),
  }),
  z.object({
    type: z.literal('reminder'),
    kind: z.enum(['reminder', 'payment']),
    title: z.string().min(1).max(200),
    due_date: date,
    due_time: time.nullable().optional(),
    amount_cents: cents.nullable().optional(),
  }),
  z.object({
    type: z.literal('ledger'),
    client_name: z.string().min(1).max(80),
    kind: z.enum(['charge', 'payment']),
    amount_cents: cents,
    note: z.string().max(200).nullable().optional(),
  }),
  z.object({
    type: z.literal('query'),
    metric: z.enum(METRICS),
    period: z.enum(PERIODS).default('this_month'),
    /** A month named by the owner ("ekim ayının hesabı"): its most recent occurrence, overriding period. */
    month: z.number().int().min(1).max(12).nullable().optional(),
    client_name: z.string().max(80).nullable().optional(),
    /** A team member named in a question about the team ("Ahmet bu ay ne kadar sattı"). */
    staff_name: z.string().max(80).nullable().optional(),
  }),
  z.object({ type: z.literal('chat'), question: z.string().min(1).max(600) }),
  z.object({ type: z.literal('cancel') }),
  // "aklında tut: Ahmet kısa sevmez" → a long-term note (core/agent/AGENT.md); "bunu unut" drops the last one.
  z.object({
    type: z.literal('remember'),
    kind: z.enum(['client', 'money', 'team', 'shop', 'preference']),
    subject: z.string().max(80).nullable().optional(),
    text: z.string().min(1).max(200),
  }),
  z.object({ type: z.literal('forget') }), // "boşver", "never mind": drop the draft being discussed
  z.object({ type: z.literal('unknown') }),
]);

export const planSchema = z.object({ items: z.array(planItem).min(1).max(12) });
export type Plan = z.infer<typeof planSchema>;
export type PlanItem = z.infer<typeof planItem>;
