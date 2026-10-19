// Walks the setup wizard (#kurulum) for three businesses and captures the result, for the board.
// Usage: node scripts/setup-shots.mjs http://localhost:5180 tasarim/kurulum
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5180';
const out = (process.argv[3] ?? 'tasarim/kurulum').replace(/\/$/, '') + '/';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--lang=tr-TR'] });

const cases = [
  { slug: 'kafe', isletme: 'Lale Kafe', sahip: 'Selin', sablon: 2, sistemler: ['Square', 'Banka hesabı', 'Kâğıt defter'], dertler: ['Stok bitiyor', 'Ay sonunu', 'Vergi zamanı'], kisi: 4, ekip: ['Maaşlı'], gizlilik: 0 },
  { slug: 'kuafor', isletme: 'Salon Elif', sahip: 'Elif', sablon: 0, sistemler: ['Booksy', 'Banka hesabı', 'Excel'], dertler: ['gelmeyi bırakıyor', 'Gelmeyen randevular', 'Fiyatı ne zaman', 'Ekibin hesabı'], kisi: 3, ekip: ['Komisyonla', 'Yer kiralayan'], gizlilik: 1 },
  { slug: 'tesisat', isletme: 'Usta Tesisat', sahip: 'Murat', sablon: 4, sistemler: ['Jobber', 'QuickBooks', 'Kâğıt defter'], dertler: ['Teklifler ve tahsilatlar', 'Para nereye', 'Vergi zamanı'], kisi: 1, ekip: [], gizlilik: 0 },
];

for (const k of cases) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(`${base}/#kurulum`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.setup-choice');
  const clickText = (sel, texts) =>
    page.evaluate((sel, texts) => {
      for (const t of texts) [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(t))?.click();
    }, sel, texts);
  const next = async () => {
    await page.click('.setup-nav .btn.primary');
    await sleep(250);
  };
  await page.type('.setup input', k.isletme);
  await page.type('.setup .field:nth-of-type(2) input', k.sahip);
  await page.evaluate((i) => document.querySelectorAll('.setup-choice')[i].click(), k.sablon);
  await sleep(200);
  await page.screenshot({ path: `${out}${k.slug}-1.png` });
  await next();
  await clickText('.setup-check', k.sistemler);
  await sleep(200);
  await page.screenshot({ path: `${out}${k.slug}-2.png` });
  await next();
  // Start from the template's picks, then set exactly ours.
  await page.evaluate(() => document.querySelectorAll('.setup-check input:checked').forEach((i) => i.click()));
  await clickText('.setup-check', k.dertler);
  await sleep(200);
  await page.screenshot({ path: `${out}${k.slug}-3.png` });
  await next();
  await page.evaluate((n) => {
    const i = document.querySelector('.setup input[type=number]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, String(n));
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, k.kisi);
  await sleep(200);
  await clickText('.setup-check', k.ekip);
  await next();
  await page.evaluate((g) => document.querySelectorAll('.setup-check input[type=radio]')[g].click(), k.gizlilik);
  await sleep(150);
  await page.screenshot({ path: `${out}${k.slug}-5.png` });
  await next();
  await sleep(300);
  for (const [i, tab] of ['adim', 'soul', 'agent', 'mod', 'bag'].entries()) {
    await page.evaluate((n) => document.querySelectorAll('.setup-tabs button')[n].click(), i);
    await sleep(250);
    await page.screenshot({ path: `${out}${k.slug}-sonuc-${tab}.png`, fullPage: true });
  }
  // The generated files themselves, for review.
  const files = await page.evaluate(async () => {
    const pick = async (n) => {
      document.querySelectorAll('.setup-tabs button')[n].click();
      await new Promise((r) => setTimeout(r, 200));
      return document.querySelector('.md')?.innerText ?? '';
    };
    return { soul: await pick(1), agent: await pick(2) };
  });
  writeFileSync(`${out}${k.slug}-SOUL.txt`, files.soul);
  writeFileSync(`${out}${k.slug}-AGENT.txt`, files.agent);
  console.log(k.slug);
  await page.close();
}
await browser.close();
