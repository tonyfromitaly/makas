import { DateTime } from 'luxon';
import type { Queryable } from '../db';
import { fold } from '../parse/text';

// A payment reminder ("rent $1,800 on the 1st") is money that will leave. Ticking it as paid writes the
// expense to the books; reopening it takes the expense back out. One reminder, at most one book entry.

const RULES: [string, RegExp][] = [
  ['rent', /(kira|rent|alquiler|lease)/],
  ['wages', /(maas|ucret|prim|wage|salary|payroll|sueldo|nomina)/],
  ['utilities', /(fatura|elektrik|dogalgaz|su |su$|internet|telefon|bill|electric|water|gas|utility|utilities|phone|factura|luz|agua)/],
  ['supplies', /(malzeme|tedarik|urun|stok|supplier|supplies|supply|product|stock|insumo|proveedor|producto)/],
];

/** "Kira ödemesi" → rent, "Water bill" → utilities; other when nothing fits. */
export function categoryOf(title: string): string {
  const f = fold(title);
  return RULES.find(([, r]) => r.test(f))?.[0] ?? 'other';
}

/** Brings the book entry in line with the task: paid → one expense, open → none. */
export async function syncPaidTask(db: Queryable, shopId: string, userId: string | null, taskId: string, now: Date) {
  const task = (
    await db.query(`select id, kind, title, amount_cents, status, done_at from shop_tasks where id = $1 and shop_id = $2`, [taskId, shopId])
  ).rows[0];
  const entry = (await db.query(`select id, amount_cents from book_entries where task_id = $1 and shop_id = $2`, [taskId, shopId])).rows[0];
  const paid = task && task.kind === 'payment' && task.status === 'done' && task.amount_cents;
  if (!paid) {
    if (entry) await db.query('delete from book_entries where id = $1 and shop_id = $2', [entry.id, shopId]);
    return null;
  }
  if (entry) {
    if (entry.amount_cents !== task.amount_cents)
      await db.query('update book_entries set amount_cents = $3 where id = $1 and shop_id = $2', [entry.id, shopId, task.amount_cents]);
    return entry.id as string;
  }
  const tz = (await db.query('select timezone from shops where id = $1', [shopId])).rows[0]?.timezone ?? 'UTC';
  const day = DateTime.fromJSDate(new Date(task.done_at ?? now), { zone: tz }).toISODate();
  const row = (
    await db.query(
      `insert into book_entries (shop_id, kind, category, amount_cents, entry_date, note, source, task_id, created_by)
       values ($1, 'expense', $2, $3, $4, $5, 'task', $6, $7) returning id`,
      [shopId, categoryOf(task.title), task.amount_cents, day, String(task.title).slice(0, 200), task.id, userId],
    )
  ).rows[0];
  return row.id as string;
}
