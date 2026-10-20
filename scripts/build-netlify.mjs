// Builds everything Netlify serves into netlify-dist/:
//   /        the website (site/)
//   /demo/   the in-browser demo (app in demo mode, incl. the sample shops)
//   /app/    the real app; its /api calls are proxied to the API server (API_ORIGIN, e.g. Render)
//   /book/   the public booking page shops embed on their websites (the same app, opened at /book/<slug>)
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts, env: { ...process.env, ...(opts.env ?? {}) } });
const out = 'netlify-dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out);

run('npm run build -w site');
cpSync('site/dist', out, { recursive: true });

run('npx vite build --mode demo --outDir dist-netlify/demo --emptyOutDir', { cwd: 'app', env: { VITE_BASE: '/demo/' } });
run('npx tsc --noEmit && npx vite build --outDir dist-netlify/app --emptyOutDir', { cwd: 'app', env: { VITE_BASE: '/app/' } });
run('npx vite build --outDir dist-netlify/book --emptyOutDir', { cwd: 'app', env: { VITE_BASE: '/book/' } });
cpSync('app/dist-netlify/demo', `${out}/demo`, { recursive: true });
cpSync('app/dist-netlify/book', `${out}/book`, { recursive: true });
cpSync('app/dist-netlify/app', `${out}/app`, { recursive: true });

// Routing. Proxy rules come first; single-page fallbacks last.
const api = (process.env.API_ORIGIN ?? '').replace(/\/$/, '');
const redirects = [
  api ? `/api/*  ${api}/api/:splat  200` : '/api/*  /api-offline.json  503',
  '/app/*   /app/index.html   200',
  '/demo/*  /demo/index.html  200',
  '/book/*  /book/index.html  200',
];
writeFileSync(`${out}/_redirects`, redirects.join('\n') + '\n');
writeFileSync(`${out}/api-offline.json`, JSON.stringify({ error: { code: 'API_OFFLINE', message: 'The app server is not connected yet' } }));
// The same security headers as netlify.toml, as a _headers file inside the publish folder, so they apply
// to CLI deploys of this folder too.
const toml = readFileSync('netlify.toml', 'utf8');
const headers = [...toml.matchAll(/\[\[headers\]\]\s*for = "([^"]+)"\s*\[headers\.values\]([\s\S]*?)(?=\n\[\[|\n#|$)/g)]
  .map((m) => [m[1], ...[...m[2].matchAll(/^\s*([\w-]+) = "([^"]*)"/gm)].map((v) => `  ${v[1]}: ${v[2]}`)].join('\n'))
  .join('\n\n');
writeFileSync(`${out}/_headers`, headers + '\n');
console.log(`\nnetlify-dist ready · api: ${api || 'not connected (set API_ORIGIN)'}`);
