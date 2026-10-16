import { DEMO_LOGIN, migrate, seedDemo } from '@makas/core';
import { env } from '../config';
import { openDatabase } from '../db';
import { argon2Deps } from '../server';

const db = await openDatabase(env.databaseUrl);
await migrate(db);
const r = await seedDemo(db, { hashPassword: argon2Deps.hashPassword, now: new Date() });
console.log(r.created ? `demo shop created, login: ${DEMO_LOGIN.email}` : 'demo shop already exists');
await db.close();
