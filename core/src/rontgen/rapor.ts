// The X-ray as one printable page, in the app's Adisyon language: a till receipt with stamps.
// Standalone HTML (inline CSS and SVG), so it can be e-mailed, printed or opened offline.
import type { Rontgen } from './motor';
import type { IceAktarim } from './ice-aktar';
import { metin, type Metin } from './metin';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const yuzde = (M: Metin, n: number | null) => (n === null ? '—' : `${n < 0 ? '−' : '+'}${M.pct(Math.abs(n))}`);

function grafik(r: Rontgen, M: Metin) {
  const W = 720;
  const H = 230;
  const P = { l: 64, r: 16, t: 18, b: 34 };
  // Income when there is any, otherwise spending.
  const gelirli = r.ozet.toplamGelir > 0;
  const xs = r.aylik.map((a) => (gelirli ? a : { ...a, gelir: a.gider, gelirReel: a.giderReel }));
  const max = Math.max(...xs.map((a) => Math.max(a.gelir, a.gelirReel))) * 1.08 || 1;
  const R = M.rapor;
  const kisa = (v: number) => (v >= 1e9 ? `${Math.round(v / 1e9)}${R.milyar}` : v >= 1e6 ? `${Math.round(v / 1e6)}${R.milyon}` : `${Math.round(v / 1000)}${R.bin}`);
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, xs.length - 1);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  // Whole months are one line; a part month at either end joins it with a dotted stub, labelled.
  const tam = xs.map((a, i) => ({ a, i })).filter(({ a }) => !a.eksik);
  const path = (f: (a: (typeof xs)[number]) => number) => tam.map(({ a, i }, j) => `${j ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(a)).toFixed(1)}`).join(' ');
  const stub = (f: (a: (typeof xs)[number]) => number) =>
    xs
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.eksik)
      .map(({ a, i }) => {
        const k = i === 0 ? 1 : i - 1;
        if (!xs[k] || xs[k].eksik) return '';
        return `<path d="M${x(k).toFixed(1)},${y(f(xs[k])).toFixed(1)} L${x(i).toFixed(1)},${y(f(a)).toFixed(1)}" class="eksik"/><text x="${x(i)}" y="${y(f(a)) - 8}" class="ax" text-anchor="${i === 0 ? 'start' : 'end'}">${R.eksikAy}</text>`;
      })
      .join('');
  const kisaDonem = xs.length <= 12 && r.donemTipi === 'ay';
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
  const yillik = r.donemTipi === 'yil';
  const yearMarks = xs
    .map((a, i) => ({ a, i }))
    .filter(({ a, i }) => (yillik ? true : a.ay.endsWith('-01') || (i === 0 && !xs.slice(1, 4).some((x) => x.ay.endsWith('-01')))));
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(R.grafikEtiket)}">
    ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${P.l - 8}" y="${y(v) + 4}" class="ax" text-anchor="end">${kisa(v)}</text>`).join('')}
    ${
      kisaDonem
        ? xs.map((a, i) => `<text x="${x(i)}" y="${H - 12}" class="ax" text-anchor="middle">${M.ayKisa(Number(a.ay.slice(5)))}</text>`).join('')
        : yearMarks.map(({ a, i }) => `<line x1="${x(i)}" x2="${x(i)}" y1="${P.t}" y2="${H - P.b}" class="g y"/><text x="${x(i)}" y="${H - 12}" class="ax" text-anchor="middle">${a.ay.slice(0, 4)}</text>`).join('')
    }
    ${r.kaynak ? `<path d="${path((a) => a.gelirReel)}" class="real"/>` : ''}
    <path d="${path((a) => a.gelir)}" class="${r.kaynak ? 'nom' : 'real'}"/>
    ${stub((a) => a.gelir)}
  </svg>`;
}

export function raporHtml(r: Rontgen, ice?: IceAktarim['rapor']) {
  const o = r.ozet;
  const dil = r.dil ?? 'tr';
  const M = metin(dil, r.para);
  const R = M.rapor;
  const { tl } = M;
  const ayda = r.donemTipi !== 'yil';
  const gelirli = o.toplamGelir > 0;
  const acil = r.bulgular.filter((b) => b.ciddiyet === 'yuksek').length;
  const dahil = r.bulgular.filter((b) => b.toplamaDahil !== false && b.aylikEtki > 0);
  const hero = r.geriKazanilabilir > 0
    ? { lbl: R.geriKazan(ayda), big: `~${tl(r.geriKazanilabilir)}`, alt: R.geriKazanAlt(dahil.length, r.kaynak ? r.donem.fiyatAyi : null) }
    : { lbl: R.enOnemli, big: r.bulgular[0] ? esc(r.bulgular[0].baslik) : R.sorunYok, alt: r.bulgular[0] ? esc(r.bulgular[0].ozet) : '' };
  const tiles: string[] = [];
  const tamAylar = r.aylik.filter((a) => !a.eksik);
  if (gelirli && o.reelBuyume === null && o.nominalBuyume === null && tamAylar.length)
    tiles.push(`<div class="tile"><span class="lbl">${R.aylikGelir}</span><b>${tl(tamAylar.reduce((s, a) => s + a.gelir, 0) / tamAylar.length)}</b><small>${R.tamAyOrt(tamAylar.length)}</small></div>`);
  else if (gelirli) tiles.push(`<div class="tile"><span class="lbl">${r.kaynak ? R.gercekBuyume : R.buyume}</span><b class="${(o.reelBuyume ?? o.nominalBuyume ?? 0) < 0 ? 'neg' : 'pos'}">${yuzde(M, o.reelBuyume ?? o.nominalBuyume)}</b><small>${r.kaynak && o.nominalBuyume !== null ? R.gorunen(yuzde(M, o.nominalBuyume)) : r.donemTipi === 'yil' ? `${r.donem.bas.slice(0, 4)} → ${r.donem.son.slice(0, 4)}` : R.son12ay}</small></div>`);
  tiles.push(`<div class="tile"><span class="lbl">${gelirli ? R.toplamGelir : R.toplamGider}</span><b>${tl(gelirli ? o.toplamGelir : o.toplamGider)}</b><small>${R.aySayisi(r.donem.ay, ayda)}</small></div>`);
  if (o.kasa !== null) tiles.push(`<div class="tile"><span class="lbl">${R.kasa}</span><b>${tl(o.kasa)}</b><small>${o.nakitOmruGun !== null ? R.dayanir(o.nakitOmruGun) : ''}</small></div>`);
  if (o.basabasCiro !== null) tiles.push(`<div class="tile"><span class="lbl">${R.basabas}</span><b>${tl(o.basabasCiro)}</b><small>${R.basabasGun(o.basabasGunu ?? 0)}</small></div>`);
  if (o.enBuyukGider) tiles.push(`<div class="tile"><span class="lbl">${R.enBuyukGider}</span><b class="small-b">${esc(o.enBuyukGider.kategori)}</b><small>${R.giderPay(o.enBuyukGider.pay)}</small></div>`);
  const ciddi = R.ciddiyet;
  return `<!doctype html>
<html lang="${dil}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(R.baslik)} · ${esc(r.ad)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@700&family=JetBrains+Mono:wght@400;600;800&family=Hanken+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--counter:#c9cfd3;--paper:#fbfbf8;--paper2:#f0f1ed;--ink:#1d2433;--ink2:#485164;--ink3:#636b7b;--stamp:#c8322b;--carbon:#2b4fd8;--pos:#1d7446;--note:#fff3a1}
*{box-sizing:border-box}body{margin:0;background:var(--counter);color:var(--ink);font:16px/1.5 'Hanken Grotesk',system-ui,sans-serif;padding:32px 16px 60px}
.roll{max-width:820px;margin:0 auto;background:var(--paper);padding:40px 44px 46px;position:relative;box-shadow:0 30px 60px -40px rgba(16,22,34,.6)}
.roll:after{content:'';position:absolute;left:0;right:0;bottom:-13px;height:14px;background:linear-gradient(-45deg,transparent 7px,var(--paper) 0) 0 0/14px 14px,linear-gradient(45deg,transparent 7px,var(--paper) 0) 0 0/14px 14px}
h1,h2,h3,.lbl{font-family:'Archivo Narrow',sans-serif;text-transform:uppercase;letter-spacing:.06em;margin:0}
h1{font-size:2.6rem;text-align:center;line-height:1}
.meta{font:400 .74rem 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);text-align:center;margin-top:8px}
hr{border:0;border-top:2px dashed rgba(29,36,51,.35);margin:26px 0}
.hero{position:relative;text-align:center;padding:6px 0}
.hero .lbl{font-size:.82rem;letter-spacing:.16em;color:var(--ink2)}
.hero .big{font:800 3.4rem/1.05 'JetBrains Mono',monospace;letter-spacing:-.03em;margin:6px 0}
.hero p{margin:0 auto;max-width:56ch;color:var(--ink2)}
.stamp{position:absolute;border:4px solid var(--stamp);color:var(--stamp);font:700 1rem 'Archivo Narrow',sans-serif;letter-spacing:.16em;text-transform:uppercase;padding:6px 12px 5px;border-radius:7px;transform:rotate(-8deg);opacity:.88;mix-blend-mode:multiply;white-space:nowrap}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.tile{background:var(--paper2);border:1px dashed rgba(29,36,51,.3);padding:12px 14px}
.tile .lbl{font-size:.7rem;letter-spacing:.14em;color:var(--ink3)}
.tile b{display:block;font:800 1.45rem 'JetBrains Mono',monospace;margin-top:4px;letter-spacing:-.02em}
.tile small{color:var(--ink3);font-size:.78rem}
.neg{color:var(--stamp)}.pos{color:var(--pos)}
svg{width:100%;height:auto;margin-top:10px}.eksik{fill:none;stroke:#636b7b;stroke-width:2;stroke-dasharray:2 5}.g{stroke:rgba(29,36,51,.12)}.g.y{stroke-dasharray:3 4}.ax{font:400 11px 'JetBrains Mono',monospace;fill:#636b7b}
.nom{fill:none;stroke:#9aa1ad;stroke-width:2.2;stroke-dasharray:6 5}.real{fill:none;stroke:var(--ink);stroke-width:3}
.legend{display:flex;gap:18px;font:400 .76rem 'JetBrains Mono',monospace;color:var(--ink3);text-transform:uppercase;margin-top:4px}
.legend i{display:inline-block;width:22px;border-top:3px solid var(--ink);vertical-align:middle;margin-right:6px}.legend i.n{border-top:2px dashed #9aa1ad}
.find{position:relative;border-top:1px dotted rgba(29,36,51,.3);padding:22px 0 20px}
.find h3{font-size:1.25rem;padding-right:120px}
.find .etki{font:800 1.1rem 'JetBrains Mono',monospace;margin:6px 0 8px}
.find p{margin:6px 0}
.find .oneri{border-left:4px solid var(--carbon);background:#eef2fd;padding:10px 14px;color:var(--ink)}
.find .oneri b{font-family:'Archivo Narrow',sans-serif;letter-spacing:.12em;color:var(--carbon);font-size:.8rem;display:block}
.find .stamp{right:0;top:22px;font-size:.82rem}
.find .stamp.orta{border-color:var(--carbon);color:var(--carbon)}.find .stamp.bilgi{border-color:var(--ink3);color:var(--ink3)}
table{width:100%;border-collapse:collapse;margin-top:10px;font:400 .82rem 'JetBrains Mono',monospace}
td{padding:5px 0;border-bottom:1px dotted rgba(29,36,51,.22)}td:last-child{text-align:right}
.foot{font-size:.82rem;color:var(--ink3)}
.hero .big.txt{font:700 2rem/1.15 'Archivo Narrow',sans-serif;text-transform:uppercase;letter-spacing:.03em;max-width:24ch;margin:8px auto}
.tile b.small-b{font:700 1.05rem/1.2 'Hanken Grotesk',sans-serif;letter-spacing:0}
ul.eksik{margin:10px 0 0;padding-left:20px;color:var(--ink2)}ul.eksik li{margin:4px 0}
@media (max-width:640px){.roll{padding:26px 18px 30px}.tiles{grid-template-columns:1fr 1fr}.hero .big{font-size:2.4rem}.find h3{padding-right:0}.find .stamp{position:static;display:inline-block;margin-bottom:8px}}
@media print{body{background:#fff;padding:0}.roll{box-shadow:none}}
</style></head><body>
<main class="roll">
  <h1>${esc(R.baslik)}</h1>
  <div class="meta">${esc(r.ad)} · ${r.donemTipi === 'yil' ? `${r.donem.bas.slice(0, 4)} – ${r.donem.son.slice(0, 4)}` : `${M.ay(r.donem.bas)} – ${M.ay(r.donem.son)}`} · ${r.para}${ice ? ` · ${R.kayit(ice.okunan)}` : ''}</div>
  <hr>
  <section class="hero">
    <div class="lbl">${hero.lbl}</div>
    <div class="big${r.geriKazanilabilir > 0 ? '' : ' txt'}">${hero.big}</div>
    <p>${hero.alt}</p>
    ${acil ? `<span class="stamp" style="right:-6px;top:-8px">${R.acil(acil)}</span>` : ''}
  </section>
  <hr>
  <section class="tiles" style="grid-template-columns:repeat(${Math.min(4, tiles.length)},1fr)">${tiles.join('')}</section>
  <section>
    ${grafik(r, M)}
    <div class="legend">${r.kaynak ? `<span><i></i>${R.lejantReel(gelirli)}</span><span><i class="n"></i>${R.lejantNom}</span>` : `<span><i></i>${R.lejantTek(gelirli)}</span>`}</div>
  </section>
  <hr>
  <h2>${R.bulgular}</h2>
  ${r.bulgular
    .map(
      (b) => `<article class="find">
    <span class="stamp ${b.ciddiyet}">${ciddi[b.ciddiyet]}</span>
    <h3>${esc(b.baslik)}</h3>
    ${b.aylikEtki > 0 ? `<div class="etki ${b.ciddiyet === 'yuksek' ? 'neg' : ''}">${b.toplamaDahil === false ? `${tl(b.aylikEtki)} ${R.fark(ayda)}` : `${ayda ? R.ayda : R.yilda} ${tl(b.aylikEtki)}`}</div>` : ''}
    <p>${esc(b.ozet)}</p>
    <div class="oneri"><b>${R.yapilacak}</b>${esc(b.oneri)}</div>
    <table>${b.kanit.map((k) => `<tr><td>${esc(k.etiket)}</td><td>${esc(k.deger)}</td></tr>`).join('')}</table>
  </article>`,
    )
    .join('')}
  <hr>
  ${r.yapilamayan.length ? `<h2>${R.yapilamayanlar}</h2><ul class="eksik">${r.yapilamayan.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><hr>` : ''}
  <section class="foot">
    <p><b>${R.nasil}</b> ${esc(R.nasilMetin(r.kaynak, r.donem.fiyatAyi))}</p>
    ${ice ? `<p><b>${R.veri}</b> ${R.veriMetin(ice.satir, ice.okunan, ice.atlananSayi, r.donemTipi === 'yil' ? '' : R.eksikAylar(ice.eksikAylar))}</p>` : ''}
    <p>${R.uyari}</p>
  </section>
</main>
</body></html>`;
}
