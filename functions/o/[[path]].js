// The private operator link: https://monacount.com/o/<OPS_PATH>/
// OPS_PATH is a long random value set in Cloudflare Pages → Settings → Variables (never in the repository).
// Any other address under /o/, or every address while OPS_PATH is unset, is a plain 404: typing /admin or
// guessing does not reveal that a panel exists. The page is the app's own index.html, marked as the panel;
// signing in still takes the admin key and an authenticator code (core/src/ops.ts).
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests";

const notFound = () =>
  new Response('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found</title><p>Not found.</p>', {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

/** Constant-time string comparison: the response time does not hint at how much of the path was right. */
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function onRequestGet({ request, env, params }) {
  const want = String(env.OPS_PATH ?? '').trim();
  const seg = (Array.isArray(params.path) ? params.path[0] : params.path) ?? '';
  if (want.length < 24 || !same(seg, want)) return notFound();
  const page = await env.ASSETS.fetch(new URL('/app/', request.url));
  if (!page.ok) return notFound();
  const html = (await page.text()).replace('<head>', '<head><meta name="monacount-ops" content="1"><meta name="robots" content="noindex, nofollow">');
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
      'x-frame-options': 'DENY',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    },
  });
}

export const onRequest = () => notFound();
