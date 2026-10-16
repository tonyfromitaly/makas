import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { fromPGlite, type Database, type Queryable } from '@makas/core';

// Dates stay 'YYYY-MM-DD' strings; bigints become numbers (cents fit comfortably).
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

export async function openDatabase(url: string): Promise<Database & { close(): Promise<void> }> {
  if (url.startsWith('pglite:')) {
    const dir = url.slice('pglite:'.length);
    if (dir && dir !== 'memory') mkdirSync(dir, { recursive: true });
    const lite = await PGlite.create({
      dataDir: dir && dir !== 'memory' ? dir : undefined,
      extensions: { btree_gist },
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    });
    return Object.assign(fromPGlite(lite as any), { close: () => lite.close() });
  }
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL ?? 10) });
  const wrap = (c: pg.PoolClient | pg.Pool): Queryable => ({
    query: (sql, params) => c.query(sql, params as any[]) as any,
    exec: (sql) => c.query(sql),
  });
  return {
    ...wrap(pool),
    exec: (sql) => pool.query(sql),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
