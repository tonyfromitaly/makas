// Daily job: removes shops whose subscription was cancelled more than RETENTION_DAYS (default 90) ago,
// and assistant conversations older than ASSISTANT_RETENTION_DAYS (default 90).
import { withSystem } from '@makas/core';
import { env } from '../config';
import { openDatabase } from '../db';

const days = Number(process.env.RETENTION_DAYS ?? 90);
const chatDays = Number(process.env.ASSISTANT_RETENTION_DAYS ?? 90);
const db = await openDatabase(env.databaseUrl);
// System mode: row-level security is forced, so a plain owner connection would see no rows to remove.
await withSystem(db, async (tx) => {
  const { rows } = await tx.query(
    `delete from shops s using subscriptions sub
      where sub.shop_id = s.id and sub.status = 'cancelled'
        and sub.cancelled_at < now() - make_interval(days => $1)
    returning s.id`,
    [days],
  );
  console.log(`retention: removed ${rows.length} shop(s) cancelled more than ${days} days ago`);
  // Conversations hold client names and phone numbers; keep them only as long as they are useful.
  const chat = await tx.query(`delete from assistant_turns where created_at < now() - make_interval(days => $1) returning id`, [chatDays]);
  console.log(`retention: removed ${chat.rows.length} assistant turn(s) older than ${chatDays} days`);
});
await db.close();
