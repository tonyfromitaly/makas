// Screenshots of every look (skin) on the in-browser demo, for the customisation board.
// Usage: node scripts/theme-shots.mjs http://localhost:5180 out-dir
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5180';
const out = (process.argv[3] ?? 'tasarim/temalar').replace(/\/$/, '') + '/';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--lang=tr-TR'],
});
const looks = [
  ['adisyon', null, 'berber'],
  ['karbon', null, 'berber'],
  ['defter', null, 'berber'],
  ['cini', null, 'kuafor'],
  ['pudra', null, 'kuafor'],
  ['buyuk', null, 'berber'],
  ['adisyon', 'bordo', 'berber'],
  ['cini', 'zumrut', 'kuafor'],
];
for (const [skin, accent, kind] of looks) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument((look) => {
    localStorage.setItem('makas.lang', 'tr');
    localStorage.setItem('makas.look', JSON.stringify(look));
  }, { skin, accent });
  await page.goto(`${base}/?ornek=${kind}&shot=1`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.tabbar', { timeout: 60000 });
  await sleep(1500);
  const name = `${skin}${accent ? '-' + accent : ''}`;
  await page.screenshot({ path: `${out}${name}-bugun.png` });
  const tab = async (i) => {
    await page.evaluate((n) => document.querySelectorAll('.tabbar button')[n].click(), i);
    await sleep(1000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
  };
  if (!accent) {
    await tab(3);
    await page.screenshot({ path: `${out}${name}-defter.png` });
  }
  if (skin === 'adisyon' && !accent) {
    await tab(4);
    await page.evaluate(() => {
      const c = document.querySelector('.skins').closest('.card');
      window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 64);
    });
    await sleep(300);
    await page.screenshot({ path: `${out}secici.png` });
  }
  console.log(name);
  await page.close();
}
await browser.close();
