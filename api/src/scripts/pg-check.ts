// Checks what only a real Postgres can show, on the staging database in STAGING_DATABASE_URL:
// migrations applied, row-level security forced on every tenant table, the no-overlap rules present
// (btree_gist), and one shop unable to read or write another's rows. Prints a checklist; changes
// nothing except two throwaway shops it creates and removes. Usage: npm run pg:check -w api
import { migrate, withSystem, withTenant } from '@makas/core';
import { openDatabase } from '../db';

for (const f of ['.env', '../.env']) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* not present */
  }
}
const url = process.env.STAGING_DATABASE_URL;
if (!url) {
  console.error('STAGING_DATABASE_URL is not set in .env');
  process.exit(1);
}

// A database reached over the internet (Render's external URL) needs TLS; a local one does not.
if (/^postgres/.test(url) && !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) process.env.PGSSLMODE ??= 'require';
const db = await openDatabase(url);
const rows: [boolean, string, string][] = [];
const check = (pass: boolean, name: string, detail = '') => rows.push([pass, name, detail]);
const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as any[];

try {
  const v = (await q('select version() as v, current_user as u'))[0];
  check(true, 'connected', `${String(v.v).split(',')[0]} · user ${v.u}`);
  const applied = await migrate(db);
  const all = (await q('select id from schema_migrations order by id')).map((r) => r.id);
  check(all.includes('014_owner_on_team'), 'all migrations applied', `${all.length} applied${applied.length ? ` (${applied.join(', ')} just now)` : ''}`);

  const me = (await q(`select rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = current_user`))[0];
  const tenantRole = (await q(`select 1 from pg_roles where rolname = 'makas_tenant'`)).length > 0;
  // A superuser bypasses row-level security; the API then switches to the restricted makas_tenant role
  // for every shop's queries. A managed database (Render) gives a plain owner, which FORCE covers.
  const switches = me.rolsuper && tenantRole;
  check(!me.rolbypassrls || switches, 'row-level security applies to the app’s queries', switches ? 'superuser: queries run as makas_tenant' : `owner without bypass · ${JSON.stringify(me)}`);

  const ext = (await q(`select extname from pg_extension where extname = 'btree_gist'`)).length > 0;
  check(ext, 'btree_gist extension installed (database-level no-overlap rules)', ext ? '' : 'missing: the API still checks overlaps, but the database does not');
  const cons = (await q(`select conname from pg_constraint where conname in ('appointments_no_overlap', 'appointments_station_no_overlap')`)).map((r) => r.conname);
  check(cons.length === 2, 'no-overlap constraints present (person, chair/room)', cons.join(', ') || 'none');

  const tables = [
    'users', 'refresh_tokens', 'services', 'barbers', 'clients', 'appointments', 'ledger_entries', 'book_entries', 'reminder_queue', 'audit_log',
    'shop_tasks', 'access_keys', 'assistant_turns', 'assistant_notes', 'connections', 'import_rows', 'agent_signals',
    'stations', 'products', 'sales', 'sale_items', 'staff_payouts',
  ];
  const rls = await q(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1::text[]) and relkind = 'r'`, [tables]);
  const weak = tables.filter((t) => {
    const r = rls.find((x) => x.relname === t);
    return !r || !r.relrowsecurity || !r.relforcerowsecurity;
  });
  check(!weak.length, `row-level security forced on ${tables.length} tenant tables`, weak.length ? `not forced: ${weak.join(', ')}` : '');

  // Two throwaway shops: each must see only its own rows, and must not be able to write into the other.
  const mk = (name: string) =>
    withSystem(db, async (tx) => {
      const s = (await tx.query(`insert into shops (name, country, timezone, language, currency) values ($1, 'US', 'America/Chicago', 'en', 'USD') returning id`, [name])).rows[0];
      await tx.query(`insert into clients (shop_id, name, phone_e164, consent_status) values ($1, $2, '+13125550100', 'granted')`, [s.id, `${name} client`]);
      await tx.query(`insert into stations (shop_id, name, kind) values ($1, 'Chair 1', 'chair')`, [s.id]);
      return s.id as string;
    });
  const a = await mk('pgcheck-A');
  const b = await mk('pgcheck-B');
  try {
    const seen = await withTenant(db, a, async (tx) => (await tx.query(`select shop_id from clients`)).rows.map((r: any) => r.shop_id));
    check(seen.length === 1 && seen[0] === a, 'a shop sees only its own clients', `${seen.length} visible`);
    const st = await withTenant(db, a, async (tx) => (await tx.query(`select count(*)::int as n from stations`)).rows[0].n);
    check(st === 1, 'a shop sees only its own chairs (new team tables)', `${st} visible`);
    let blocked = false;
    try {
      await withTenant(db, a, (tx) => tx.query(`insert into clients (shop_id, name, phone_e164, consent_status) values ($1, 'intruder', '+13125550199', 'granted')`, [b]));
    } catch {
      blocked = true;
    }
    check(blocked, 'a shop cannot write into another shop');
    const upd = await withTenant(db, a, async (tx) => (await tx.query(`update clients set name = 'x' where shop_id = $1 returning id`, [b])).rows.length);
    check(upd === 0, 'a shop cannot change another shop’s rows', `${upd} changed`);
    if (!switches) {
      const noScope = await db.query(`select count(*)::int as n from clients where name like 'pgcheck-%'`).then((r: any) => r.rows[0].n).catch(() => -1);
      check(noScope === 0 || noScope === -1, 'without a shop in scope, nothing is visible', `${noScope} visible`);
    }
  } finally {
    await withSystem(db, (tx) => tx.query(`delete from shops where id = any($1::uuid[])`, [[a, b]]));
  }
} catch (e) {
  check(false, 'check run', (e as Error).message);
} finally {
  await db.close();
}

for (const [pass, name, detail] of rows) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  · ${detail}` : ''}`);
const failed = rows.filter((r) => !r[0]).length;
console.log(`\n${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
