// Daily job: removes shops whose subscription was cancelled more than RETENTION_DAYS (default 90) ago,
// and assistant conversations older than ASSISTANT_RETENTION_DAYS (default 90).
import { runRetention, withSystem } from '@makas/core';
import { env } from '../config';
import { openDatabase } from '../db';

const days = Number(process.env.RETENTION_DAYS ?? 90);
const chatDays = Number(process.env.ASSISTANT_RETENTION_DAYS ?? 90);
const db = await openDatabase(env.databaseUrl);
// System mode: row-level security is forced, so a plain owner connection would see no rows to remove.
// The API runs the same every hour (api/src/main.ts); this is for running it by hand.
const r = await withSystem(db, (tx) => runRetention(tx, new Date(), { days, chatDays }));
console.log(`retention: removed ${r.shops} shop(s) cancelled more than ${days} days ago, ${r.turns} assistant turn(s) older than ${chatDays} days, ${r.notes} expired memory note(s)`);
await db.close();
