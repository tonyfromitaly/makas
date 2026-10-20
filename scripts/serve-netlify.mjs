// Serves netlify-dist/ locally with the same headers and redirects as netlify.toml / _redirects,
// so CSP and routing can be checked before deploying. Usage: node scripts/serve-netlify.mjs [port]
// With API_ORIGIN set (e.g. http://127.0.0.1:3100) /api/* is proxied there the way Netlify proxies to
// Render: same path, over "HTTPS" (x-forwarded-proto), so a production-mode API can sit behind it.
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = 'netlify-dist';
const port = Number(process.argv[2] ?? 8888);
const toml = readFileSync('netlify.toml', 'utf8');
// [[headers]] blocks → [{ pattern, values }]
const blocks = [...toml.matchAll(/\[\[headers\]\]\s*for = "([^"]+)"\s*\[headers\.values\]([\s\S]*?)(?=\n\[\[|\n#|$)/g)].map((m) => ({
  pattern: m[1],
  values: Object.fromEntries([...m[2].matchAll(/^\s*([\w-]+) = "([^"]*)"/gm)].map((v) => [v[1], v[2]])),
}));
const match = (pattern, path) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(path);
const redirects = readFileSync(join(root, '_redirects'), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.data': 'application/octet-stream', '.gz': 'application/gzip', '.webmanifest': 'application/manifest+json' };

const apiOrigin = (process.env.API_ORIGIN ?? '').replace(/\/$/, '');

function proxy(req, res) {
  const target = new URL(req.url, apiOrigin);
  const up = httpRequest(
    target,
    {
      method: req.method,
      headers: { ...req.headers, host: target.host, 'x-forwarded-proto': 'https', 'x-forwarded-for': req.socket.remoteAddress ?? '' },
    },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  up.on('error', () => res.writeHead(502, { 'content-type': 'application/json' }).end('{"error":{"code":"API_OFFLINE","message":"API not reachable"}}'));
  req.pipe(up);
}

createServer((req, res) => {
  if (apiOrigin && req.url.startsWith('/api/')) return proxy(req, res);
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // Netlify combines every matching rule; do the same so overlapping policies show up here.
  const merged = {};
  for (const b of blocks) if (match(b.pattern, path)) for (const [k, v] of Object.entries(b.values)) merged[k] = merged[k] ? `${merged[k]}, ${v}` : v;
  for (const [k, v] of Object.entries(merged)) res.setHeader(k, v);
  let file = join(root, path.endsWith('/') ? path + 'index.html' : path);
  let status = 200;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (existsSync(join(file, 'index.html'))) file = join(file, 'index.html');
    else {
      const r = redirects.find(([from]) => match(from, path));
      if (!r) return res.writeHead(404).end('not found');
      file = join(root, r[1]);
      status = Number(r[2]);
    }
  }
  res.writeHead(status, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`netlify-dist on http://localhost:${port}`));
