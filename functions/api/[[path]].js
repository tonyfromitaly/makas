// Cloudflare Pages Function: /api/* is passed to the API server (API_ORIGIN, e.g. Render), the way the
// Netlify proxy rule did it. Same path and query, same method, headers and body; the API sees the
// visitor's address in X-Forwarded-For and HTTPS in X-Forwarded-Proto (it runs with TRUST_PROXY=true).
// Everything else on the site is static and never reaches this function.

const OFFLINE = { error: { code: 'API_OFFLINE', message: 'The app server is not connected yet' } };
// Hop-by-hop and Cloudflare-internal headers are not forwarded.
const DROP = ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip'];

export async function onRequest({ request, env }) {
  const origin = String(env.API_ORIGIN ?? '').replace(/\/$/, '');
  if (!origin) return Response.json(OFFLINE, { status: 503 });

  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const h of DROP) headers.delete(h);
  // Set, never appended: a visitor cannot pass a made-up address through to the API's rate limits.
  headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');
  headers.set('x-forwarded-proto', 'https');
  headers.set('x-forwarded-host', url.host);

  try {
    return await fetch(origin + url.pathname + url.search, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });
  } catch {
    return Response.json({ error: { code: 'API_OFFLINE', message: 'API not reachable' } }, { status: 502 });
  }
}
