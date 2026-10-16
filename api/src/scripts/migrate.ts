import { migrate } from '@makas/core';
import { env } from '../config';
import { openDatabase } from '../db';

const db = await openDatabase(env.databaseUrl);
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
await db.close();
