// The X-ray as one printable page, in the app's Adisyon language: a till receipt with stamps.
// Standalone HTML (inline CSS and SVG), so it can be e-mailed, printed or opened offline.
import { ayAdi, type Rontgen } from './motor';
import type { IceAktarim } from './ice-aktar';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const tl = (n: number) => `${Math.round(n).toLocaleString('tr-TR')} TL`;
const yuzde = (n: number) => `${n < 0 ? '−' : '+'}%${Math.abs(Math.round(n * 100))}`;

function grafik(r: Rontgen) {
  const W = 720;
  const H = 230;
  const P = { l: 64, r: 16, t: 18, b: 34 };
  const xs = r.aylik;
  const max = Math.max(...xs.map((a) => Math.max(a.gelir, a.gelirReel))) * 1.08;
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, xs.length - 1);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const path = (f: (a: (typeof xs)[number]) => number) => xs.map((a, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(a)).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => max * t);
  const yearMarks = xs.map((a, i) => ({ a, i })).filter(({ a }) => a.ay.endsWith('-01'));
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Aylık ciro: o günkü fiyatlarla ve bugünün parasıyla">
    ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${P.l - 8}" y="${y(v) + 4}" class="ax" text-anchor="end">${Math.round(v / 1000)}b</text>`).join('')}
    ${yearMarks.map(({ a, i }) => `<line x1="${x(i)}" x2="${x(i)}" y1="${P.t}" y2="${H - P.b}" class="g y"/><text x="${x(i)}" y="${H - 12}" class="ax" text-anchor="middle">${a.ay.slice(0, 4)}</text>`).join('')}
    <path d="${path((a) => a.gelirReel)}" class="real"/>
    <path d="${path((a) => a.gelir)}" class="nom"/>
  </svg>`;
}

export function raporHtml(r: Rontgen, ice?: IceAktarim['rapor']) {
  const o = r.ozet;
  const ciddi = { yuksek: 'Acil', orta: 'Önemli', bilgi: 'Not' } as const;
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>İşletme Röntgeni · ${esc(r.ad)}</title>
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
svg{width:100%;height:auto;margin-top:10px}.g{stroke:rgba(29,36,51,.12)}.g.y{stroke-dasharray:3 4}.ax{font:400 11px 'JetBrains Mono',monospace;fill:#636b7b}
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
@media (max-width:640px){.roll{padding:26px 18px 30px}.tiles{grid-template-columns:1fr 1fr}.hero .big{font-size:2.4rem}.find h3{padding-right:0}.find .stamp{position:static;display:inline-block;margin-bottom:8px}}
@media print{body{background:#fff;padding:0}.roll{box-shadow:none}}
</style></head><body>
<main class="roll">
  <h1>İşletme Röntgeni</h1>
  <div class="meta">${esc(r.ad)} · ${ayAdi(r.donem.bas)} – ${ayAdi(r.donem.son)} · ${r.donem.ay} ay${ice ? ` · ${ice.okunan.toLocaleString('tr-TR')} kayıt` : ''}</div>
  <hr>
  <section class="hero">
    <div class="lbl">Ayda geri kazanılabilecek para</div>
    <div class="big">~${tl(Math.round(r.geriKazanilabilir / 1000) * 1000)}</div>
    <p>Aşağıdaki ${r.bulgular.filter((b) => b.toplamaDahil !== false && b.aylikEtki > 0).length} düzeltmenin toplamı. Tüm tutarlar ${ayAdi(r.donem.fiyatAyi)} parasıyla.</p>
    <span class="stamp" style="right:-6px;top:-8px">${r.bulgular.filter((b) => b.ciddiyet === 'yuksek').length} acil bulgu</span>
  </section>
  <hr>
  <section class="tiles">
    <div class="tile"><span class="lbl">Gerçek büyüme</span><b class="${o.reelBuyume < 0 ? 'neg' : 'pos'}">${yuzde(o.reelBuyume)}</b><small>görünen ${yuzde(o.nominalBuyume)}</small></div>
    <div class="tile"><span class="lbl">Kasa</span><b>${tl(o.kasa)}</b><small>${o.nakitOmruGun} gün dayanır</small></div>
    <div class="tile"><span class="lbl">Başabaş</span><b>${tl(o.basabasCiro)}</b><small>ayın ${o.basabasGunu}. gününde</small></div>
    <div class="tile"><span class="lbl">En büyük gider</span><b>${esc(o.enBuyukGider.kategori)}</b><small>giderlerin %${Math.round(o.enBuyukGider.pay * 100)}'i</small></div>
  </section>
  <section>
    ${grafik(r)}
    <div class="legend"><span><i></i>Bugünün parasıyla</span><span><i class="n"></i>O günkü fiyatlarla</span></div>
  </section>
  <hr>
  <h2>Bulgular ve yapılacaklar</h2>
  ${r.bulgular
    .map(
      (b) => `<article class="find">
    <span class="stamp ${b.ciddiyet}">${ciddi[b.ciddiyet]}</span>
    <h3>${esc(b.baslik)}</h3>
    ${b.aylikEtki > 0 ? `<div class="etki ${b.ciddiyet === 'yuksek' ? 'neg' : ''}">${b.toplamaDahil === false ? '' : 'Ayda '}${tl(b.aylikEtki)}${b.toplamaDahil === false ? ' / ay fark' : ''}</div>` : ''}
    <p>${esc(b.ozet)}</p>
    <div class="oneri"><b>Yapılacak</b>${esc(b.oneri)}</div>
    <table>${b.kanit.map((k) => `<tr><td>${esc(k.etiket)}</td><td>${esc(k.deger)}</td></tr>`).join('')}</table>
  </article>`,
    )
    .join('')}
  <hr>
  <section class="foot">
    <p><b>Nasıl hesaplandı.</b> Bütün rakamlar işletmenin kendi kayıtlarından hesaplandı; yapay zekâ rakam üretmedi. Enflasyon düzeltmesi: ${esc(r.kaynak)}. "Bugünün parası", her ayın tutarının ${ayAdi(r.donem.fiyatAyi)} fiyatlarına çevrilmiş hâlidir.</p>
    ${ice ? `<p><b>Veri.</b> ${ice.satir.toLocaleString('tr-TR')} satır okundu, ${ice.okunan.toLocaleString('tr-TR')} kayıt alındı${ice.atlanan.length ? `, ${ice.atlanan.length} satır okunamadı` : ''}${ice.eksikAylar.length ? `; eksik aylar: ${ice.eksikAylar.join(', ')}` : '; eksik ay yok'}.</p>` : ''}
    <p>Bu rapor bir ön teşhistir; vergi ve hukuki konular için mali müşavirinize danışın.</p>
  </section>
</main>
</body></html>`;
}
