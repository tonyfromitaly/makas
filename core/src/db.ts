import { migrations } from './migrations';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Multi-statement SQL without parameters. */
  exec?(sql: string): Promise<unknown>;
}

export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<unknown>;
}

/** Runs fn inside a transaction as the restricted tenant role, scoped to one shop. */
export async function withTenant<T>(db: Database, shopId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query('set local role makas_tenant');
    await tx.query(`select set_config('app.shop_id', $1, true)`, [shopId]);
    return fn(tx);
  });
}

/** Runs fn as the system (owner) role. Only auth, the message worker and the operator use this. */
export async function withSystem<T>(db: Database, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

export async function migrate(db: Database): Promise<string[]> {
  await db.exec(`create table if not exists schema_migrations (
    id text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ id: string }>('select id from schema_migrations')).rows.map((r) => r.id));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      if (tx.exec) await tx.exec(m.sql);
      else await tx.query(m.sql);
      await tx.query('insert into schema_migrations (id) values ($1)', [m.id]);
    });
    applied.push(m.id);
  }
  return applied;
}

/** Structural adapter for PGlite (server dev mode, tests and the in-browser demo). */
export function fromPGlite(pg: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  exec: (sql: string) => Promise<unknown>;
  transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
}): Database {
  return {
    query: (sql, params) => pg.query(sql, params) as any,
    exec: (sql) => pg.exec(sql),
    transaction: (fn) =>
      pg.transaction((tx: any) =>
        fn({ query: (sql: string, params?: unknown[]) => tx.query(sql, params), exec: (sql: string) => tx.exec(sql) }),
      ),
  };
}
