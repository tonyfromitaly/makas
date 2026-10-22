import { z } from 'zod';
import type { Queryable } from './db';

// A voided sale or a cancelled visit leaves a record with its reason, so the books can be explained later
// ("3 cancelled today: 2 clients cancelled, 1 wrong entry") and Mona can answer from the record.

export const VOID_REASONS = ['client_cancelled', 'no_show', 'wrong_entry', 'refund', 'duplicate', 'shop_cancelled', 'other'] as const;
export type VoidReason = (typeof VOID_REASONS)[number] | 'not_given';

export const voidBody = z.object({
  reason: z.enum(VOID_REASONS),
  note: z.string().trim().max(200).optional(),
});

export async function recordVoid(
  db: Queryable,
  v: {
    shopId: string;
    userId: string | null;
    kind: 'sale' | 'appointment';
    refId: string;
    reason: VoidReason;
    note?: string | null;
    amountCents?: number;
    clientName?: string | null;
    staffName?: string | null;
    happenedAt: Date | string;
    /** When it was voided (the request's clock). */
    at: Date;
  },
) {
  await db.query(
    `insert into voids (shop_id, kind, ref_id, reason, note, amount_cents, client_name, staff_name, happened_at, voided_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [v.shopId, v.kind, v.refId, v.reason, v.note || null, v.amountCents ?? 0, v.clientName?.slice(0, 80) ?? null, v.staffName?.slice(0, 80) ?? null, v.happenedAt, v.userId, v.at],
  );
}
