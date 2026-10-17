// Full-page review screenshots (desktop 1440, mobile 390) and console errors.
// Usage: node scripts/review.mjs <url> <out-prefix> [en]
import puppeteer from 'puppeteer-core';
const [,, url, outPrefix, ...opts] = process.argv;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const sizes = { desktop: { width: 1440, height: 900, deviceScaleFactor: 1 }, mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const errors = [];
for (const [name, vp] of Object.entries(sizes)) {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.setViewport(vp);
  if (opts.includes('en')) await page.evaluateOnNewDocument(() => localStorage.setItem('usta.lang', 'en'));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2500));
  // scroll through so scroll-triggered reveals run, then back to top
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += vp.height / 2) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await new Promise((r) => setTimeout(r, 120));
  }
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${outPrefix}-${name}.png`, fullPage: true });
  await page.close();
}
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
