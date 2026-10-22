// Builds monamilelab.com into lab-dist/ for its own Cloudflare Pages project: the Mona Mile autumn banner
// (lab/: a still frame, then the living three.js landscape in lab/world/ fading in over it) and one word.
// Static only. No forms, no cookies, no API: the shared functions/ folder is kept out by _routes.json.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const out = 'lab-dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync('lab', out, { recursive: true });

// The landscape's import map is an inline script; the CSP allows exactly that script by its hash.
const world = readFileSync('lab/world/index.html', 'utf8');
const inline = [...world.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
const csp = (frame) =>
  [
    "default-src 'self'",
    `script-src 'self' ${inline.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' data: blob:",
    "media-src 'self'",
    "frame-src 'self'",
    `frame-ancestors ${frame}`,
    "form-action 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

writeFileSync(`${out}/_routes.json`, JSON.stringify({ version: 1, include: ['/_no-functions'], exclude: [] }, null, 2) + '\n');
writeFileSync(
  `${out}/_headers`,
  [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    `  Content-Security-Policy: ${csp("'none'")}`,
    '  X-Frame-Options: DENY',
    '',
    // The landscape is shown inside the banner page, so it may be framed by this site only.
    '/world/*',
    '  ! Content-Security-Policy',
    '  ! X-Frame-Options',
    `  Content-Security-Policy: ${csp("'self'")}`,
    '  X-Frame-Options: SAMEORIGIN',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=86400',
    '/world/assets/*',
    '  Cache-Control: public, max-age=86400',
    '/world/vendor/*',
    '  Cache-Control: public, max-age=604800',
    '',
  ].join('\n'),
);
writeFileSync(
  `${out}/404.html`,
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Mona Mile Lab</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:300 18px/1.5 Georgia,serif;letter-spacing:.3em;background:#302f33;color:#f4ece0}a{color:inherit;text-decoration:none}</style></head>' +
    '<body><a href="/">mona mile lab</a></body></html>\n',
);
console.log(`\n${out} ready (${inline.length} inline script hash${inline.length === 1 ? '' : 'es'})`);
