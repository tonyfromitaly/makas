// İşletme Röntgeni from a spreadsheet.
//   npm run rontgen -w api -- dosya.csv "İşletme adı" [açılış kasası]
//   npm run rontgen -w api -- --ornek        (the three-year sample barber shop)
// Writes rontgen/<ad>.html (and with --ornek also docs/ornek/berber-halil-3-yil.csv).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { csvOku, csvYaz, ornekDukkan, raporHtml, rontgen } from '@makas/core';

const root = new URL('../../../', import.meta.url);
const args = process.argv.slice(2);
let csv: string;
let ad: string;
let acilis = 0;
if (args[0] === '--ornek' || !args.length) {
  const o = ornekDukkan();
  csv = csvYaz(o.kayitlar);
  mkdirSync(new URL('docs/ornek/', root), { recursive: true });
  writeFileSync(new URL('docs/ornek/berber-halil-3-yil.csv', root), csv);
  ad = o.ad;
  acilis = o.acilisKasa;
} else {
  csv = readFileSync(args[0], 'utf8');
  ad = args[1] ?? 'İşletme';
  acilis = Number(args[2] ?? 0);
}
const t0 = performance.now();
const ice = csvOku(csv);
const r = rontgen(ice.kayitlar, { ad, acilisKasa: acilis });
const ms = Math.round(performance.now() - t0);
mkdirSync(new URL('rontgen/', root), { recursive: true });
const slug = ad.toLocaleLowerCase('tr').replace(/[^a-z0-9ğüşıöç]+/g, '-');
const out = new URL(`rontgen/${slug}.html`, root);
writeFileSync(out, raporHtml(r, ice.rapor));
console.log(`${ice.rapor.okunan} kayıt · ${r.donem.ay} ay · ${r.bulgular.length} bulgu · ayda ~${Math.round(r.geriKazanilabilir).toLocaleString('tr-TR')} TL · ${ms} ms`);
for (const b of r.bulgular) console.log(`  [${b.ciddiyet}] ${b.baslik}`);
console.log(`→ ${fileURLToPath(out)}`);
