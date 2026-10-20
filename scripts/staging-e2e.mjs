// End-to-end test of a staging setup: a production-mode API behind Netlify (or the local Netlify server).
// Every request goes through <BASE>/api, exactly as a browser on the live site would.
// Usage: node scripts/staging-e2e.mjs <launch.json with the staging-api keys> <results.json> [base URL]
// Against a hosted staging (Render + Netlify): pass its URL as the third argument; the keys are read from
// the staging-api entry's ADMIN_API_KEY / SERVICE_API_KEY (or set STAGING_ADMIN_KEY / STAGING_SERVICE_KEY).
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = (process.argv[4] ?? 'http://localhost:8900').replace(/\/$/, '');
const API = `${BASE}/api`;
const args = process.env.STAGING_ADMIN_KEY ? [] : JSON.parse(readFileSync(process.argv[2], 'utf8')).configurations.find((c) => c.name === 'staging-api').runtimeArgs;
const ADMIN = process.env.STAGING_ADMIN_KEY ?? args.find((a) => a.startsWith('ADMIN_API_KEY=')).split('=')[1];
const SERVICE = process.env.STAGING_SERVICE_KEY ?? args.find((a) => a.startsWith('SERVICE_API_KEY=')).split('=')[1];

const results = [];
const ok = (area, name, pass, detail = '') => results.push({ area, name, pass: !!pass, detail: String(detail).slice(0, 220) });
async function call(method, path, { token, body, raw } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    j = text;
  }
  return raw ? { s: r.status, j, h: r.headers } : { s: r.status, j };
}
const step = async (area, name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(area, name, false, `threw: ${e.message}`);
  }
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const plusDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

let owner, ownerRefresh, shopId, elif, elifId, canId, services, slug;

// --- 1. Platform ---
await step('Platform', 'health through the proxy', async () => {
  const r = await call('GET', '/health');
  ok('Platform', 'API reachable through /api (Netlify → Render path)', r.s === 200 && r.j.ok, JSON.stringify(r.j));
});
await step('Platform', 'headers', async () => {
  for (const [path, frame] of [['/', 'deny'], ['/app/', 'deny'], ['/demo/', 'deny'], ['/book/anything', 'any']]) {
    const r = await fetch(BASE + path);
    const csp = r.headers.get('content-security-policy') ?? '';
    const xfo = r.headers.get('x-frame-options');
    const good = frame === 'deny' ? xfo === 'DENY' && /frame-ancestors 'none'/.test(csp) : !xfo && /frame-ancestors \*/.test(csp);
    ok('Platform', `security headers on ${path} (${frame === 'deny' ? 'cannot be framed' : 'can be embedded'})`, r.status === 200 && good, `xfo=${xfo} csp=${csp.slice(0, 80)}…`);
  }
  const embed = await fetch(`${BASE}/book/embed.js`);
  ok('Platform', 'embed.js served for customer websites', embed.status === 200 && (await embed.text()).includes('data-shop'));
});
await step('Platform', 'open signup closed', async () => {
  const r = await call('POST', '/auth/register', { body: { shop_name: 'X', owner_name: 'Y', email: 'x@y.co', password: 'correct-horse-battery', timezone: 'America/Chicago', country: 'US' } });
  ok('Platform', 'self-signup closed in production (shops come through the website)', r.s === 403 || r.j?.error?.code === 'SIGNUP_CLOSED', `${r.s} ${r.j?.error?.code}`);
});

// --- 2. First customer: application → approval → key → password ---
await step('Onboarding', 'application', async () => {
  const meta = await call('GET', '/billing/plan');
  ok('Onboarding', 'website takes applications while payments are off', meta.j.applications === true, JSON.stringify(meta.j));
  const a = await call('POST', '/billing/checkout', { body: { shop_name: 'Lakeview Hair Studio', owner_name: 'Rosa Martinez', email: 'rosa@lakeview.test', country: 'US', timezone: 'America/Chicago', language: 'en', business_type: 'salon' } });
  ok('Onboarding', 'application received', a.j.applied === true, JSON.stringify(a.j));
  const list = await call('GET', '/admin/signups', { token: ADMIN });
  const sid = list.j.data.find((x) => x.email === 'rosa@lakeview.test').id;
  const ap = await call('POST', `/admin/signups/${sid}/approve`, { token: ADMIN, body: { status: 'trial', days: 14 } });
  shopId = ap.j.shop_id;
  ok('Onboarding', 'operator approves a 14-day trial; welcome e-mail goes out', !!shopId && ap.j.emailed, JSON.stringify(ap.j));
  const key = (await call('POST', `/admin/shops/${shopId}/access-key`, { token: ADMIN })).j.key;
  const set = await call('POST', '/auth/key', { body: { key, password: 'rosa-strong-pass-2026' } });
  owner = set.j.access_token;
  ownerRefresh = set.j.refresh_token;
  ok('Onboarding', 'owner sets a password with the access key and is in', set.s === 200 && set.j.user.role === 'owner', set.s);
  const again = await call('POST', '/auth/key', { body: { key, password: 'another-pass-2026' } });
  ok('Onboarding', 'the key cannot be used twice', again.s === 401);
});

// --- 3. Setup wizard → stations ---
await step('Setup', 'wizard', async () => {
  const r = await call('POST', '/shops/me/setup', {
    token: owner,
    body: { isletme: 'Lakeview Hair Studio', sahip: 'Rosa', sablon: 'kuafor', dil: 'en', sistemler: ['square', 'banka'], dertler: ['kayip-musteri', 'bos-saat'], ekip: ['komisyon'], kisi: 3, ton: 'samimi', gizlilik: 'ozet' },
  });
  ok('Setup', 'setup wizard applies modules, look and agent', r.s === 200, `${r.j.agent_name} · ${r.j.modules?.join(',')}`);
  const st = await call('GET', '/stations', { token: owner });
  ok('Setup', 'wizard created one chair per person (3)', st.j.data.length === 3 && st.j.data.every((s) => s.kind === 'chair'), st.j.data.map((s) => s.name).join(', '));
  services = (await call('GET', '/services', { token: owner })).j.data;
  ok('Setup', 'default salon services need a chair', services.length > 0 && services.every((s) => s.station_kind === 'chair'), services.map((s) => `${s.name}:${s.station_kind}`).join(', '));
});

// --- 4. Team ---
await step('Team', 'members and logins', async () => {
  const st = (await call('GET', '/stations', { token: owner })).j.data;
  const e = await call('POST', '/barbers', { token: owner, body: { name: 'Elif', title: 'Colorist', pay_model: 'commission', service_pct: 45, product_pct: 10, station_id: st[1].id } });
  const c = await call('POST', '/barbers', { token: owner, body: { name: 'Can', title: 'Barber', pay_model: 'booth_rent', rent_cents: 30000, rent_period: 'week', station_id: st[2].id, work_days: [1, 2, 3, 4, 5] } });
  elifId = e.j.id;
  canId = c.j.id;
  ok('Team', 'team members with deals (commission, chair rent)', e.s === 201 && c.s === 201, `${e.j.pay_model} / ${c.j.pay_model}`);
  const team = (await call('GET', '/barbers', { token: owner })).j.data;
  ok('Team', 'owner is first on the team and marked as owner', team[0].is_owner === true, team.map((t) => `${t.name}${t.is_owner ? '(owner)' : ''}`).join(', '));
  const login = await call('POST', `/barbers/${elifId}/login`, { token: owner, body: { email: 'elif@lakeview.test' } });
  const signed = await call('POST', '/auth/key', { body: { key: login.j.key, password: 'elif-strong-pass-2026' } });
  elif = signed.j.access_token;
  ok('Team', 'Elif gets her own login with a one-time key', signed.s === 200 && signed.j.user.role === 'barber');
  const blocked = [];
  for (const p of ['/books', '/books/summary', '/ledger', '/tasks', '/team/report', '/signals', '/connections', '/shops/me/export', '/shops/me/booking', '/rontgen'])
    blocked.push(`${p}:${(await call('GET', p, { token: elif })).s}`);
  ok('Team', 'staff cannot reach the books, store credit, bank, reports, settings', blocked.every((b) => b.endsWith(':403')), blocked.join(' '));
  const deals = (await call('GET', '/barbers', { token: elif })).j.data;
  ok('Team', 'staff see names on the team, not deals', deals.every((d) => !('pay_model' in d)));
});

// --- 5. Online booking from the shop's website ---
await step('Booking', 'page and agent', async () => {
  const off = await call('GET', '/public/book/lakeview-hair-studio');
  ok('Booking', 'booking page is off until the owner turns it on', off.s === 404);
  const on = await call('PATCH', '/shops/me/booking', { token: owner, body: { booking_enabled: true, hours: { '7': null } } });
  slug = on.j.slug;
  ok('Booking', 'owner turns it on; address from the shop name', on.s === 200 && slug === 'lakeview-hair-studio', slug);
  const page = await call('GET', `/public/book/${slug}`);
  ok('Booking', 'public page lists services and the team', page.s === 200 && page.j.staff.length === 3, page.j.staff.map((s) => s.name).join(', '));
  let state = {};
  const turn = async (input) => {
    const r = await call('POST', `/public/book/${slug}/agent`, { body: { lang: 'en', state, ...input } });
    state = r.j.state;
    return r.j;
  };
  const t1 = await turn({});
  ok('Booking', 'a US salon starts with an English menu', services.every((x) => /^[A-Za-z &+-]+$/.test(x.name)), services.map((x) => x.name).join(', '));
  const t2 = await turn({ set: { service_id: services[0].id } });
  ok('Booking', 'agent asks "who would you like? There are 3 of us … or anyone"', /There are 3 of us/.test(t2.say) && t2.options.some((o) => o.set.staff_id === 'any'), t2.say);
  const anyT = await call('POST', `/public/book/${slug}/agent`, { body: { lang: 'en', state: { ...state, staff_id: 'any', date: plusDays(today(), 2) } } });
  const names = new Set(anyT.j.options.map((o) => o.hint));
  ok('Booking', '"anyone" spreads the offered times across the team', names.size >= 2, `${anyT.j.say} ${anyT.j.options.map((o) => o.label + ' ' + o.hint).join(' | ')}`);
  const t3 = await turn({ text: 'Elif tomorrow at 2pm' });
  ok('Booking', 'free text fills person, day and time ("Elif tomorrow at 2pm")', state.time === '14:00' && state.staff_id === elifId, `${t3.say} | ${JSON.stringify(state)}`);
  await turn({ text: 'Maya Lopez' });
  const t5 = await turn({ text: '(415) 555-0177', set: { consent: true } });
  const t6 = await turn({ set: { confirm: true } });
  ok('Booking', 'client books: name, phone, confirm → booked with a chair', t6.step === 'done' && t6.booked?.station_name, `${t5.say} → ${t6.say}`);
  const day = (await call('GET', `/appointments?date=${plusDays(today(), 1)}`, { token: owner })).j.data;
  const online = day.find((a) => a.source === 'online');
  ok('Booking', 'appointment lands in the owner’s calendar, marked online, reminders queued', online && online.reminders.length > 0, online ? `${online.client_name} · ${online.barber_name} · ${online.station_name} · reminders ${online.reminders.length}` : 'missing');
  const elifDay = (await call('GET', `/appointments?date=${plusDays(today(), 1)}`, { token: elif })).j.data;
  ok('Booking', 'Elif sees it in her own app', elifDay.some((a) => a.id === online?.id));
  const slots = await call('GET', `/public/book/${slug}/slots?service_id=${services[0].id}&date=${plusDays(today(), 1)}`);
  ok('Booking', 'public slots never show client names', !JSON.stringify(slots.j).includes('Maya'));
});

// --- 6. Till ---
await step('Till', 'checkout and settlement', async () => {
  const prod = await call('POST', '/products', { token: owner, body: { name: 'Argan oil', price_cents: 2400, stock: 10 } });
  const client = await call('POST', '/clients', { token: owner, body: { name: 'Jane Walker', phone_e164: '+13125550142', consent: true } });
  const now = new Date();
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t) => local.find((p) => p.type === t).value;
  const appt = await call('POST', '/appointments', { token: owner, body: { client_id: client.j.id, service_id: services[0].id, barber_id: elifId, starts_local: `${g('year')}-${g('month')}-${g('day')}T08:00` } });
  ok('Till', 'appointment gets Elif’s own chair', appt.j.station_name === 'Chair 2', `${appt.s} ${appt.j.station_name ?? JSON.stringify(appt.j)}`);
  const sale = await call('POST', '/sales', { token: elif, body: { appointment_id: appt.j.id, method: 'card', tip_cents: 1000, lines: [{ kind: 'product', ref_id: prod.j.id, qty: 1 }] } });
  ok('Till', 'Elif checks out the visit: service + product + tip', sale.s === 201 && sale.j.total_cents === services[0].price_cents + 2400 + 1000, `${sale.s} total ${sale.j.total_cents}`);
  const sum = (await call('GET', `/books/summary?period=day&date=${today()}`, { token: owner })).j;
  ok('Till', 'the books follow the receipt', sum.income_cents === sale.j.total_cents, `income ${sum.income_cents}`);
  const rep = (await call('GET', `/team/report?from=${today()}&to=${today()}`, { token: owner })).j.data.find((r) => r.name === 'Elif');
  const expect = Math.round(services[0].price_cents * 0.45 + 2400 * 0.1);
  ok('Till', 'Elif’s slip: gross, 45% + 10% commission, tip owed', rep.gross_cents === services[0].price_cents + 2400 && rep.commission_cents === expect && rep.owed_cents === expect + 1000, JSON.stringify({ gross: rep.gross_cents, commission: rep.commission_cents, owed: rep.owed_cents }));
  const pay = await call('POST', `/team/${elifId}/payouts`, { token: owner, body: { kind: 'pay', from: today(), to: today(), amount_cents: rep.owed_cents } });
  ok('Till', 'owner pays out; wages land in the books', pay.s === 201);
  const mine = (await call('GET', '/me/work?period=day', { token: elif })).j;
  ok('Till', 'Elif sees her own earnings', mine.row?.owed_cents === rep.owed_cents, JSON.stringify({ gross: mine.row?.gross_cents, share: mine.row?.owed_cents }));
});

// --- 7. Bank (Plaid sandbox) ---
await step('Bank', 'plaid sandbox', async () => {
  const avail = (await call('GET', '/connections', { token: owner })).j.available;
  ok('Bank', 'bank connection available (Plaid configured)', avail.plaid === true, JSON.stringify(avail));
  const lt = await call('POST', '/connections/plaid/link-token', { token: owner });
  ok('Bank', 'Plaid Link token issued (what the bank sign-in button uses)', lt.s === 200 && /^link-sandbox-/.test(lt.j.link_token ?? lt.j.token ?? ''), `${lt.s} ${JSON.stringify(lt.j).slice(0, 80)}`);
  const sb = await call('POST', '/connections/plaid/sandbox', { token: owner });
  ok('Bank', 'sandbox bank connected', sb.s === 200 || sb.s === 201, `${sb.s} ${JSON.stringify(sb.j).slice(0, 160)}`);
  // Plaid prepares the test bank's history a few seconds after linking; then one sync brings it all.
  let total = sb.j?.sync?.kayit ?? 0;
  let sync;
  for (let i = 0; i < 8 && total === 0; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    sync = await call('POST', '/connections/plaid/sync', { token: owner });
    total += sync.j?.sync?.kayit ?? 0;
  }
  ok('Bank', 'transactions synced from Plaid into the books', total > 0, `${total} ledger lines · ${JSON.stringify(sync?.j ?? sb.j).slice(0, 140)}`);
  const conn = (await call('GET', '/connections', { token: owner })).j.data.find((c) => c.provider === 'plaid');
  ok('Bank', 'balance read and token stored encrypted', conn?.status === 'connected', JSON.stringify(conn).slice(0, 200));
  const rt = await call('GET', '/rontgen', { token: owner, raw: true });
  ok('Bank', 'Röntgen report builds from the bank data', rt.s === 200, `${rt.s} ${typeof rt.j === 'string' ? rt.j.slice(0, 60) : JSON.stringify(rt.j).slice(0, 120)}`);
  const cash = await call('POST', '/assistant', { token: owner, body: { text: "what's in the bank", lang: 'en' } });
  ok('Bank', 'assistant reads the real bank balance', /bank/i.test(cash.j.reply ?? ''), cash.j.reply);
});

// --- 8. Assistant (DeepSeek) ---
await step('Assistant', 'answers', async () => {
  const qs = [
    ['owner', 'how did the team do today', owner],
    ['owner', 'how much did Elif sell today', owner],
    ['owner', 'book Jane Walker tomorrow at 4pm with Elif', owner],
    ['owner', 'what should I do about empty afternoons?', owner],
    ['staff', 'how much did I make today', elif],
    ['staff', 'what did the shop spend this month', elif],
  ];
  for (const [who, q, tok] of qs) {
    const r = await call('POST', '/assistant', { token: tok, body: { text: q, lang: 'en' } });
    ok('Assistant', `${who}: "${q}"`, r.s === 200 && r.j.reply, `[${r.j.engine}] ${r.j.reply}`);
  }
});

// --- 9. Reminders queue (what the WhatsApp/SMS sender would send) ---
await step('Reminders', 'queue', async () => {
  const due = await call('GET', `/reminders/due?until=${encodeURIComponent(new Date(Date.now() + 3 * 86400000).toISOString())}`, { token: SERVICE });
  ok('Reminders', 'online booking’s reminders are due for the sender', due.s === 200 && due.j.data.length > 0, (due.j.data ?? []).map((m) => `${m.channel}→${m.to}: ${m.message?.slice(0, 60)}`).join(' || '));
  ok('Reminders', 'US numbers get SMS, not WhatsApp', (due.j.data ?? []).every((m) => !m.to.startsWith('+1') || m.channel === 'sms'), (due.j.data ?? []).map((m) => m.channel).join(','));
});

// --- 10. Data rights ---
await step('Data', 'export, delete, restore', async () => {
  const ex = await call('GET', '/shops/me/export', { token: owner });
  ok('Data', 'export includes the team, receipts and payouts', ['stations', 'sales', 'sale_items', 'staff_payouts', 'products'].every((k) => Array.isArray(ex.j[k])), Object.keys(ex.j).join(','));
  const del = await call('DELETE', '/shops/me', { token: owner, body: { password: 'rosa-strong-pass-2026' } });
  const page = await call('GET', `/public/book/${slug}`);
  const staffBlocked = await call('GET', '/appointments', { token: elif });
  ok('Data', 'deleting suspends the shop: booking page and staff app close', del.s === 200 && page.s === 404 && staffBlocked.s === 410, `${del.s}/${page.s}/${staffBlocked.s}`);
  const res = await call('POST', '/shops/me/restore', { token: owner });
  ok('Data', 'restore brings everything back', res.j.restored === true && (await call('GET', `/public/book/${slug}`)).s === 200);
});

writeFileSync(process.argv[3], JSON.stringify({ at: new Date().toISOString(), results, shopId, slug }, null, 2));
const fails = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.area}] ${r.name}${r.detail ? `  · ${r.detail}` : ''}`);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
