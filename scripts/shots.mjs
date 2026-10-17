// Captures app screenshots for the website from the in-browser demo with sample data.
// Usage: node scripts/shots.mjs http://localhost:4175   (serve the demo build there first)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:4175';
const out = fileURLToPath(new URL('../site/public/shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--lang=tr-TR'],
});

for (const [kind, slug] of [['berber', 'barber'], ['kuafor', 'salon']]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(() => localStorage.setItem('makas.lang', 'tr'));
  await page.goto(`${base}/?ornek=${kind}&shot=1`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.tabbar', { timeout: 60000 });
  await sleep(1500);
  const tab = async (i) => {
    await page.evaluate((n) => document.querySelectorAll('.tabbar button')[n].click(), i);
    await sleep(1200);
  };
  const shot = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    await page.screenshot({ path: `${out}${slug}-${name}.png` });
    console.log(`${slug}-${name}.png`);
  };
  await shot('today');
  await tab(1);
  await shot('clients');
  await tab(3);
  await page.evaluate(() => [...document.querySelectorAll('.segmented button')].find((b) => b.textContent === 'Ay')?.click());
  await sleep(1000);
  await shot('books');
  await tab(2);
  const ask = async (q) => {
    await page.type('.composer input', q, { delay: 5 });
    await page.keyboard.press('Enter');
    await sleep(1800);
  };
  await ask('Bu ay ne kadar ödemem var?');
  await ask('100 dolar kazandım, 300 dolar kira ödedim');
  await page.evaluate(() => document.querySelector('.chat')?.lastElementChild?.scrollIntoView({ block: 'end' }));
  await sleep(500);
  await page.screenshot({ path: `${out}${slug}-assistant.png` });
  console.log(`${slug}-assistant.png`);
  await page.close();
}
await browser.close();
