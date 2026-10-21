// Single-page fallback for Cloudflare Pages. Pages applies _redirects before it looks for a file, so a
// "/app/*  /app/  200" rule would also swallow /app/assets/*.js. Instead: serve the file if there is
// one; if not, and a browser is asking for a page (a deep link such as /app/settings), serve the app's
// index.html. A missing script or image stays a 404. _routes.json keeps the asset folders out of this
// function entirely, so most requests never reach it.
export const spa = (base) => async ({ request, next, env }) => {
  const res = await next();
  if (res.status !== 404 || request.method !== 'GET' || !(request.headers.get('accept') ?? '').includes('text/html')) return res;
  return env.ASSETS.fetch(new URL(base, request.url));
};
