// Opens pages in Chrome and reports console errors and CSP violations. Usage: node scripts/csp-check.mjs <base> <path>...
import puppeteer from 'puppeteer-core';
const [, , base, ...paths] = process.argv;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
for (const p of paths) {
  const page = await browser.newPage();
  const problems = [];
  page.on('console', (m) => (m.type() === 'error' || /Content Security Policy/i.test(m.text())) && problems.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message.slice(0, 200)));
  await page.evaluateOnNewDocument(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
  const res = await page.goto(base + p, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 6000));
  const text = await page.evaluate(() => document.body.innerText.slice(0, 90).replace(/\n+/g, ' | '));
  console.log(`${p} → ${res.status()} · ${problems.length ? problems.length + ' problem(s)' : 'clean'}\n   ${text}`);
  problems.forEach((x) => console.log('   ! ' + x));
  await page.close();
}
await browser.close();
