// Runs the API in production mode against a real Postgres: the staging database in
// STAGING_DATABASE_URL (written to .env by the owner, never printed). Same server as `npm start`;
// only the database differs from the PGlite staging run. See docs/postgres-dogrulama.md.
for (const f of ['.env', '../.env']) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* not present */
  }
}
const url = process.env.STAGING_DATABASE_URL;
if (!url) {
  console.error('STAGING_DATABASE_URL is not set in .env (see docs/postgres-dogrulama.md)');
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error('STAGING_DATABASE_URL must start with postgres:// or postgresql://');
  process.exit(1);
}
// A database reached over the internet (Render's external URL) needs TLS; a local one does not.
if (/^postgres/.test(url) && !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) process.env.PGSSLMODE ??= 'require';
process.env.DATABASE_URL = url;
console.log(`staging database: ${new URL(url).hostname}`);
await import('../main');

export {};
