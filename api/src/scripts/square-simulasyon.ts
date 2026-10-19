// Three months of a Square seller (simulated, in Square's shapes) through the same path as a real
// connection: squareDefter → Röntgen. Writes rontgen/square-simulasyon.html.
//   npm run square:sim -w api
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { raporHtml, rontgen, squareDefter, squareSimulasyon } from '@makas/core';

const now = new Date();
const { ham, ad } = squareSimulasyon({ now });
const t0 = performance.now();
const { kayitlar, musteriler, randevular } = squareDefter(ham, now);
const r = rontgen(kayitlar, { ad, para: 'USD', randevular });
const ms = Math.round(performance.now() - t0);
const banner = `<div style="background:#fff3a1;color:#2a2a24;padding:10px 16px;font:600 14px system-ui;text-align:center">SİMÜLASYON · Square veri biçiminde üretilmiş 3 aylık örnek dükkân. Gerçek bir işletmenin verisi değildir.</div>`;
const root = new URL('../../../', import.meta.url);
mkdirSync(new URL('rontgen/', root), { recursive: true });
const out = new URL('rontgen/square-simulasyon.html', root);
writeFileSync(out, raporHtml(r).replace(/<body([^>]*)>/, `<body$1>${banner}`));
console.log(`${ham.orders.length} sipariş · ${ham.payments.length} ödeme · ${musteriler.length} müşteri · ${randevular.length} randevu → ${kayitlar.length} defter satırı · ${r.bulgular.length} bulgu · ${ms} ms`);
for (const b of r.bulgular) console.log(`  [${b.ciddiyet}] ${b.baslik} — ${b.ozet}`);
for (const y of r.yapilamayan) console.log(`  (yapılamadı) ${y}`);
console.log(`→ ${fileURLToPath(out)}`);
