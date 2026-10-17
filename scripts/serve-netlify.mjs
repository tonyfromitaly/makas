// Serves netlify-dist/ locally with the same headers and redirects as netlify.toml / _redirects,
// so CSP and routing can be checked before deploying. Usage: node scripts/serve-netlify.mjs [port]
import { createServer } from 'node:http';
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

createServer((req, res) => {
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
