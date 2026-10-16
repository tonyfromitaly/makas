// Daily job: removes shops whose subscription was cancelled more than RETENTION_DAYS (default 90) ago.
import { env } from '../config';
import { openDatabase } from '../db';

const days = Number(process.env.RETENTION_DAYS ?? 90);
const db = await openDatabase(env.databaseUrl);
const { rows } = await db.query(
  `delete from shops s using subscriptions sub
    where sub.shop_id = s.id and sub.status = 'cancelled'
      and sub.cancelled_at < now() - make_interval(days => $1)
  returning s.id`,
  [days],
);
console.log(`retention: removed ${rows.length} shop(s) cancelled more than ${days} days ago`);
await db.close();
