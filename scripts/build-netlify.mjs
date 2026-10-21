// Builds the website, demo, app and booking page into one static folder:
//   netlify-dist/ for Netlify, or web-dist/ for Cloudflare Pages (WEB_HOST=cloudflare).
// What is in it:
//   /        the website (site/)
//   /demo/   the in-browser demo (app in demo mode, incl. the sample shops)
//   /app/    the real app; its /api calls are proxied to the API server (API_ORIGIN, e.g. Render)
//   /book/   the public booking page shops embed on their websites (the same app, opened at /book/<slug>)
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts, env: { ...process.env, ...(opts.env ?? {}) } });
const cloudflare = process.env.WEB_HOST === 'cloudflare';
const out = cloudflare ? 'web-dist' : 'netlify-dist';
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
// Netlify: proxy and single-page fallbacks as rewrite rules. Cloudflare Pages applies _redirects before it
// looks for a file, so there both are Pages Functions instead (functions/api, functions/{app,demo,book}),
// and _routes.json sends only those paths, minus their asset folders, to the functions.
const spas = ['app', 'demo', 'book'];
if (cloudflare) {
  const files = ['assets', 'media'].flatMap((f) => spas.map((d) => `/${d}/${f}/*`));
  const own = ['embed.js', 'icon.svg', 'manifest.webmanifest', 'sw.js'].flatMap((f) => spas.map((d) => `/${d}/${f}`));
  writeFileSync(`${out}/_routes.json`, JSON.stringify({ version: 1, include: ['/api/*', ...spas.map((d) => `/${d}/*`)], exclude: [...files, ...own] }, null, 2) + '\n');
} else {
  const redirects = [api ? `/api/*  ${api}/api/:splat  200` : '/api/*  /api-offline.json  503', ...spas.map((d) => `/${d}/*  /${d}/index.html  200`)];
  writeFileSync(`${out}/_redirects`, redirects.join('\n') + '\n');
}
// A real 404 for unknown paths: without one, Cloudflare Pages treats the site as a single-page app and serves
// the home page (without its headers) for any address.
const brand = JSON.parse(readFileSync('site/brand.json', 'utf8'));
writeFileSync(
  `${out}/404.html`,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Not found · ${brand.product}</title>` +
    `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f4ef;color:#1c1b19}main{padding:24px;text-align:center}a{color:inherit}</style></head>` +
    `<body><main><h1>${brand.product}</h1><p>This page doesn’t exist. · Bu sayfa yok.</p><p><a href="/">${brand.product} home · Ana sayfa</a></p></main></body></html>\n`,
);
writeFileSync(`${out}/api-offline.json`, JSON.stringify({ error: { code: 'API_OFFLINE', message: 'The app server is not connected yet' } }));
// The same security headers as netlify.toml, as a _headers file inside the publish folder, so they apply
// to CLI deploys of this folder too.
const toml = readFileSync('netlify.toml', 'utf8');
const headers = [...toml.matchAll(/\[\[headers\]\]\s*for = "([^"]+)"\s*\[headers\.values\]([\s\S]*?)(?=\n\[\[|\n#|$)/g)]
  .map((m) => [m[1], ...[...m[2].matchAll(/^\s*([\w-]+) = "([^"]*)"/gm)].map((v) => `  ${v[1]}: ${v[2]}`)].join('\n'))
  .join('\n\n');
writeFileSync(`${out}/_headers`, headers + '\n');
console.log(`\n${out} ready · api: ${cloudflare ? 'functions/api (API_ORIGIN at runtime)' : api || 'not connected (set API_ORIGIN)'}`);
