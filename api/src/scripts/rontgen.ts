// İşletme Röntgeni from a spreadsheet.
//   npm run rontgen -w api -- dosya.csv "İşletme adı" [açılış kasası] [--para=USD]
//   npm run rontgen -w api -- --ornek        (the three-year sample barber shop)
// Writes rontgen/<ad>.html (and with --ornek also docs/ornek/berber-halil-3-yil.csv).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { csvOku, csvYaz, ornekDukkan, raporHtml, rontgen } from '@makas/core';

const root = new URL('../../../', import.meta.url);
const all = process.argv.slice(2);
// --para=USD when the file has no currency column.
const paraArg = all.find((a) => a.startsWith('--para='))?.slice(7).toUpperCase();
const args = all.filter((a) => !a.startsWith('--para='));
let csv: string;
let ad: string;
let acilis: number | undefined;
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
  acilis = args[2] !== undefined ? Number(args[2]) : undefined;
}
const t0 = performance.now();
const ice = csvOku(csv);
const t1 = performance.now();
const r = rontgen(paraArg ? ice.kayitlar.map((k) => ({ ...k, para: k.para ?? paraArg })) : ice.kayitlar, { ad, acilisKasa: acilis, para: paraArg });
const ms = `okuma ${Math.round(t1 - t0)} ms, analiz ${Math.round(performance.now() - t1)} ms`;
mkdirSync(new URL('rontgen/', root), { recursive: true });
const slug = ad.toLocaleLowerCase('tr').replace(/[^a-z0-9ğüşıöç]+/g, '-');
const out = new URL(`rontgen/${slug}.html`, root);
writeFileSync(out, raporHtml(r, ice.rapor));
console.log(`${ice.rapor.okunan.toLocaleString('tr-TR')} kayıt · ${r.para} · ${r.donem.ay} ay · ${r.bulgular.length} bulgu · ${ms}`);
for (const y of r.yapilamayan) console.log(`  (yapılamadı) ${y}`);
for (const b of r.bulgular) console.log(`  [${b.ciddiyet}] ${b.baslik} — ${b.ozet}`);
console.log(`→ ${fileURLToPath(out)}`);
