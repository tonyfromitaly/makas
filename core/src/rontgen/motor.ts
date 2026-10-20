// İşletme Röntgeni: reads a ledger of any length and finds where the money goes, in today's money.
// Every number is computed here from the records and an official inflation series; a language model
// may later word the findings, but it never produces a figure. One pass over the records builds the
// totals, so a million lines take seconds. What the data cannot support is listed, not guessed.
import { DEGISKEN, KATEGORI_ADI, SABIT, type Kayit } from './kayit';
import { enflasyon } from './enflasyon';
import { ek, yuzdeEk } from './ek';
import { musteriBulgulari, type RandevuKaydi } from './musteri';

export interface Bulgu {
  id: string;
  baslik: string;
  ozet: string;
  /** Effect per period (month, or year for yearly data) in today's money; positive = lost or at stake. */
  aylikEtki: number;
  /** Headline and cash findings overlap the others; they are not added to the total. */
  toplamaDahil?: boolean;
  oneri: string;
  ciddiyet: 'yuksek' | 'orta' | 'bilgi';
  kanit: { etiket: string; deger: string }[];
}

export interface Rontgen {
  ad: string;
  para: string;
  donemTipi: 'ay' | 'yil';
  donem: { bas: string; son: string; ay: number; fiyatAyi: string; eksikSonAy: boolean };
  /** Inflation source, or null when the data falls outside every series we have (then nominal). */
  kaynak: string | null;
  ozet: {
    ciroNominal: [number, number, number];
    ciroReel: [number, number, number];
    reelBuyume: number | null;
    nominalBuyume: number | null;
    isAdedi: [number, number];
    kasa: number | null;
    nakitOmruGun: number | null;
    basabasCiro: number | null;
    basabasGunu: number | null;
    sabitGider: number | null;
    enBuyukGider: { kategori: string; pay: number } | null;
    toplamGelir: number;
    toplamGider: number;
  };
  aylik: { ay: string; gelir: number; gider: number; cekis: number; gelirReel: number; giderReel: number; kasa: number | null; eksik?: boolean }[];
  bulgular: Bulgu[];
  /** Analyses this data could not support, and why. */
  yapilamayan: string[];
  geriKazanilabilir: number;
}

type MonthAgg = {
  gelir: number;
  gider: number;
  cekis: number;
  kart: number;
  adet: number;
  pos: number;
  ilkGun: number;
  sonGun: number;
  kat: Map<string, number>;
  katAdi: Map<string, number>;
};
type ItemMonth = { n: number; t: number; fiyat: Map<number, number> };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Lines that are not goods or services: postage, fees, discounts, manual adjustments. */
/** Investment and debt repayment: they grow for reasons other than waste, so they are not "cost creep". */
const YATIRIM = /bond|principal|capital|construction|vehicle|equipment|system|asset|land|building|yatirim|demirbas|insaat|arac alim|anapara/i;
const URUN_DEGIL = /postage|carriage|shipping|delivery charge|kargo|nakliye|manual|bank charge|amazon fee|commission|komisyon|discount|indirim|adjust|sample|numune|cruk/;
const NOT_SUPPLIER = new Set(['maas', 'vergi', 'sahip']);
const AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const ayAdi = (m: string) => `${AY_ADI[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

export function paraBicim(para: string) {
  const sym: Record<string, string> = { TRY: 'TL', USD: '$', GBP: '£', EUR: '€' };
  const s = sym[para] ?? para;
  return (n: number) => {
    const a = Math.abs(n);
    const t =
      a >= 1e9
        ? `${(a / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyar`
        : a >= 1e7
          ? `${(a / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyon`
          : a < 100 && a % 1 !== 0
            ? a.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : Math.round(a).toLocaleString('tr-TR');
    return `${n < 0 ? '−' : ''}${para === 'TRY' ? `${t} ${s}` : `${s}${t}`}`;
  };
}
const pct = (n: number) => `%${Math.round(n * 100).toLocaleString('tr-TR')}`;
const pct1 = (n: number) => `%${(n * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;

export function rontgen(tum: Kayit[], opts: { ad: string; acilisKasa?: number; para?: string; randevular?: RandevuKaydi[] }): Rontgen {
  // One currency per X-ray: the most common one unless told.
  const sayim = new Map<string, number>();
  for (const k of tum) sayim.set(k.para ?? 'TRY', (sayim.get(k.para ?? 'TRY') ?? 0) + 1);
  const para = opts.para ?? [...sayim.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'TRY';
  const kayitlar = tum.filter((k) => (k.para ?? 'TRY') === para);
  const tl = paraBicim(para);
  const yapilamayan: string[] = [];
  if (kayitlar.length < tum.length) yapilamayan.push(`${(tum.length - kayitlar.length).toLocaleString('tr-TR')} kayıt başka para biriminde olduğu için ayrı tutuldu.`);

  // ---- one pass
  const M = new Map<string, MonthAgg>();
  const items = new Map<string, Map<string, ItemMonth>>();
  const vendors = new Map<string, Map<string, number>>();
  const dup = new Map<string, { n: number; tutar: number; karsi: string; tarih: string }>();
  const subs = new Map<string, Set<string>>();
  for (const k of kayitlar) {
    const m = k.tarih.slice(0, 7);
    let a = M.get(m);
    if (!a) M.set(m, (a = { gelir: 0, gider: 0, cekis: 0, kart: 0, adet: 0, pos: 0, ilkGun: 31, sonGun: 0, kat: new Map(), katAdi: new Map() }));
    a.sonGun = Math.max(a.sonGun, Number(k.tarih.slice(8, 10)));
    a.ilkGun = Math.min(a.ilkGun, Number(k.tarih.slice(8, 10)));
    if (k.tur === 'gelir') {
      a.gelir += k.tutar;
      if (k.odeme === 'kart') a.kart += k.tutar;
      if (k.adet && k.adet > 0) a.adet += k.adet;
      if (k.kalem && k.adet && k.adet > 0 && k.tutar > 0 && !URUN_DEGIL.test(k.kalem.toLowerCase())) {
        let im = items.get(k.kalem);
        if (!im) items.set(k.kalem, (im = new Map()));
        let x = im.get(m);
        if (!x) im.set(m, (x = { n: 0, t: 0, fiyat: new Map() }));
        x.n += k.adet;
        x.t += k.tutar;
        const p = Math.round((k.tutar / k.adet) * 100) / 100;
        x.fiyat.set(p, (x.fiyat.get(p) ?? 0) + 1);
      }
    } else if (k.tur === 'gider') {
      a.gider += k.tutar;
      a.kat.set(k.kategori, (a.kat.get(k.kategori) ?? 0) + k.tutar);
      const ad = k.kategoriAdi ?? KATEGORI_ADI[k.kategori] ?? k.kategori;
      a.katAdi.set(ad, (a.katAdi.get(ad) ?? 0) + k.tutar);
      if (k.kategori === 'pos') a.pos += k.tutar;
      if (k.kategori === 'abonelik' && k.aciklama) {
        if (!subs.has(k.aciklama)) subs.set(k.aciklama, new Set());
        subs.get(k.aciklama)!.add(m);
      }
      if (k.karsiTaraf) {
        // Wages, taxes and the owner are not suppliers; they stay out of the dependency count.
        if (!NOT_SUPPLIER.has(k.kategori)) {
          let v = vendors.get(k.karsiTaraf);
          if (!v) vendors.set(k.karsiTaraf, (v = new Map()));
          v.set(m, (v.get(m) ?? 0) + k.tutar);
        }
        const key = `${k.karsiTaraf}|${k.tarih}|${k.tutar.toFixed(2)}|${k.aciklama ?? ''}`;
        const d = dup.get(key);
        if (d) d.n++;
        else dup.set(key, { n: 1, tutar: k.tutar, karsi: k.karsiTaraf, tarih: k.tarih });
      }
    } else a.cekis += k.tutar;
  }
  const months = [...M.keys()].sort();
  const g = (m: string) => M.get(m)!;
  const son = months[months.length - 1];

  // ---- time shape: monthly, or one figure a year (annual reports)
  const yillar = new Map<string, string[]>();
  for (const m of months) yillar.set(m.slice(0, 4), [...(yillar.get(m.slice(0, 4)) ?? []), m]);
  const donemTipi: 'ay' | 'yil' = yillar.size >= 3 && [...yillar.values()].every((xs) => xs.length <= 2) ? 'yil' : 'ay';

  // ---- inflation
  const e = enflasyon(para);
  const fiyatAyi = e && son > e.son ? e.son : son;
  const reelVar = !!e && months[0] >= e.ilk && fiyatAyi <= e.son && !!e.endeks(fiyatAyi);
  if (!reelVar)
    yapilamayan.push(e ? `Enflasyon serisi (${e.kaynak}) bu dönemi kapsamıyor; tutarlar o günkü fiyatlarla.` : `${para} için resmî enflasyon serisi eklenmedi; tutarlar o günkü fiyatlarla.`);
  const real = (n: number, m: string) => {
    if (!reelVar) return n;
    const a = e!.endeks(m);
    return a ? (n * e!.endeks(fiyatAyi)!) / a : n;
  };
  const birikmis = (from: string) => (reelVar && e!.endeks(from) ? e!.endeks(fiyatAyi)! / e!.endeks(from)! - 1 : null);

  // ---- month by month, with the till when it is known
  const kasaBilinir = opts.acilisKasa !== undefined;
  let kasa = opts.acilisKasa ?? 0;
  const aylik = months.map((m) => {
    const a = g(m);
    kasa += a.gelir - a.gider - a.cekis;
    // A first month that starts late or a last month that ends early is a part month: drawn apart, never read as a dip.
    const eksik = months.length > 1 && ((m === months[0] && a.ilkGun > 5) || (m === months[months.length - 1] && a.sonGun < 25));
    return { ay: m, gelir: a.gelir, gider: a.gider, cekis: a.cekis, gelirReel: real(a.gelir, m), giderReel: real(a.gider, m), kasa: kasaBilinir ? kasa : null, eksik };
  });

  const toplamGelir = sum(months.map((m) => g(m).gelir));
  const toplamGider = sum(months.map((m) => g(m).gider));
  const gelirVar = toplamGelir > 0;
  const giderVar = toplamGider > 0;
  const cekisVar = sum(months.map((m) => g(m).cekis)) > 0;
  const bulgular: Bulgu[] = [];
  const ciddiyetSira = { yuksek: 0, orta: 1, bilgi: 2 };

  if (!gelirVar) yapilamayan.push('Gelir kaydı yok: ciro, fiyat, başabaş ve kâr bulguları çalışmadı.');
  if (!giderVar) yapilamayan.push('Gider kaydı yok: gider, başabaş ve nakit takvimi bulguları çalışmadı.');
  else if (kayitlar.every((k) => k.tur !== 'gider' || k.kategori === 'pos'))
    yapilamayan.push('Giderlerin tamamı kart işlem ücretleri: kira, maaş, malzeme gibi giderler için banka hesabını ya da muhasebe programını bağla; başabaş ve nakit takvimi ancak o zaman çalışır.');
  if (!kasaBilinir && donemTipi === 'ay') yapilamayan.push('Kasa ve banka bakiyesi verilmedi: nakit ömrü hesaplanmadı.');
  if (!cekisVar && gelirVar && giderVar && donemTipi === 'ay') yapilamayan.push('Sahibin çektiği para ayrı kayıtlı değil: "kazandığından fazla çekiyorsun" bulgusu test edilemedi.');

  if (donemTipi === 'yil') return yillik();

  // ---- monthly analysis windows; a last month with only a few days is left out of comparisons
  const eksikSonAy = months.length > 13 && g(son).sonGun < 25;
  const ms = eksikSonAy ? months.slice(0, -1) : months;
  if (eksikSonAy) yapilamayan.push(`${ayAdi(son)} eksik (son kayıt: ${g(son).sonGun} ${AY_ADI[Number(son.slice(5)) - 1]}); karşılaştırmalara katılmadı.`);
  const last12 = ms.slice(-12);
  const prev12 = ms.length >= 24 ? ms.slice(-24, -12) : [];
  const first12 = ms.length >= 36 ? ms.slice(-36, -24) : [];
  const S = (w: string[], f: (a: MonthAgg) => number, r = false) => sum(w.map((m) => (r ? real(f(g(m)), m) : f(g(m)))));
  const ciro = (w: string[]) => S(w, (a) => a.gelir);
  const ciroR = (w: string[]) => S(w, (a) => a.gelir, true);
  const adet = (w: string[]) => S(w, (a) => a.adet);
  if (!prev12.length) yapilamayan.push('24 aydan kısa veri: yıllık karşılaştırmalar yapılmadı.');

  // Growth needs takings in both years; a year with none (records that start late) gives no ratio.
  const buyumeVar = prev12.length > 0 && gelirVar && ciro(prev12) > 0 && ciro(last12) > 0;
  const reelBuyume = buyumeVar ? ciroR(last12) / ciroR(prev12) - 1 : null;
  const nominalBuyume = buyumeVar ? ciro(last12) / ciro(prev12) - 1 : null;
  if (prev12.length && gelirVar && !buyumeVar) yapilamayan.push('Gelir kayıtları iki yılın ikisini de kapsamıyor: yıllık büyüme hesaplanmadı.');
  const fiyatEtiketi = reelVar ? ` (${ayAdi(fiyatAyi)} parasıyla)` : '';

  // 1. Growth: nominal versus real, and how much is volume versus price.
  if (reelBuyume !== null && nominalBuyume !== null) {
    const a1 = adet(prev12);
    const a2 = adet(last12);
    const ayrim = a1 > 0 && a2 > 0 ? { adet: a2 / a1 - 1, fiyat: ciroR(last12) / a2 / (ciroR(prev12) / a1) - 1 } : null;
    const kucul = reelBuyume < 0;
    bulgular.push({
      id: 'reel-buyume',
      toplamaDahil: false,
      baslik: reelVar ? (kucul ? (nominalBuyume > 0 ? 'Ciro büyüyor görünüyor, gerçekte küçülüyor' : 'Ciro küçülüyor') : 'Ciro enflasyonun üstünde büyüyor') : kucul ? 'Ciro küçülüyor' : 'Ciro büyüyor',
      ozet:
        `Son 12 ayda ciro ${nominalBuyume >= 0 ? `${pct(nominalBuyume)} arttı` : `${pct(-nominalBuyume)} azaldı`}` +
        (reelVar ? `; enflasyondan arındırınca ${kucul ? `${pct(-reelBuyume)} küçüldü` : `${pct(reelBuyume)} büyüdü`}.` : '.') +
        (ayrim ? ` Satılan adet ${ayrim.adet >= 0 ? `${pct(ayrim.adet)} arttı` : `${pct(-ayrim.adet)} azaldı`}, adet başına gelir${reelVar ? ' (gerçek)' : ''} ${ayrim.fiyat >= 0 ? `${pct(ayrim.fiyat)} arttı` : `${pct(-ayrim.fiyat)} azaldı`}.` : ''),
      aylikEtki: Math.max(0, (ciroR(prev12) - ciroR(last12)) / 12),
      oneri: kucul
        ? ayrim && ayrim.adet < ayrim.fiyat
          ? 'Düşüşün asıl kaynağı daha az satış: kaybedilen müşterileri ve terk edilen ürünleri aşağıdaki bulgularda incele.'
          : 'Düşüşün asıl kaynağı fiyat: fiyat listesini enflasyon ve rakiplerle karşılaştır.'
        : 'Bu hızı korumak için fiyatları her çeyrek enflasyonla karşılaştır.',
      ciddiyet: kucul && reelBuyume < -0.03 ? 'yuksek' : 'bilgi',
      kanit: [
        { etiket: `Önceki 12 ay${fiyatEtiketi}`, deger: tl(ciroR(prev12)) },
        { etiket: `Son 12 ay${fiyatEtiketi}`, deger: tl(ciroR(last12)) },
        ...(reelVar ? [{ etiket: 'Önceki 12 ay (o günkü fiyatlarla)', deger: tl(ciro(prev12)) }, { etiket: 'Son 12 ay (o günkü fiyatlarla)', deger: tl(ciro(last12)) }] : []),
        ...(ayrim ? [{ etiket: 'Satılan adet (önceki → son)', deger: `${Math.round(a1).toLocaleString('tr-TR')} → ${Math.round(a2).toLocaleString('tr-TR')}` }] : []),
      ],
    });
  }

  // 2. Prices eaten by inflation since the last raise; and prices quietly cut.
  if (items.size) {
    const sonAylar = new Set(last12);
    const msSet = new Set(ms);
    const rows: { kalem: string; fiyat: number; ilk: number; sonZam: string; erime: number | null; aylikAdet: number; ciro12: number }[] = [];
    for (const [kalem, im] of items) {
      const aylar = [...im.keys()].filter((m) => msSet.has(m)).sort();
      if (aylar.length < 6) continue;
      const mod = aylar.map((m) => {
        const f = [...im.get(m)!.fiyat.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
        return { m, p: f, n: im.get(m)!.n };
      });
      let sonZam = mod[0].m;
      for (let i = 1; i < mod.length; i++) if (mod[i].p > mod[i - 1].p * 1.02) sonZam = mod[i].m;
      const last3 = mod.slice(-3);
      rows.push({
        kalem,
        fiyat: mod[mod.length - 1].p,
        ilk: mod[0].p,
        sonZam,
        erime: birikmis(sonZam),
        aylikAdet: sum(last3.map((x) => x.n)) / last3.length,
        ciro12: sum(aylar.filter((m) => sonAylar.has(m)).map((m) => real(im.get(m)!.t, m))),
      });
    }
    const top = [...rows].sort((a, b) => b.ciro12 - a.ciro12).slice(0, 40);
    const esik = para === 'TRY' ? 0.1 : 0.04;
    const eriyen = top.filter((x) => x.erime !== null && x.erime > esik).sort((a, b) => b.erime! * b.fiyat * b.aylikAdet - a.erime! * a.fiyat * a.aylikAdet);
    if (eriyen.length) {
      const etki = sum(eriyen.map((x) => x.fiyat * x.erime! * x.aylikAdet));
      const t = eriyen[0];
      bulgular.push({
        id: 'fiyat-erimesi',
        baslik: 'Fiyatların enflasyona eriyor',
        ozet: `${t.kalem} fiyatı ${ayAdi(t.sonZam)}${ek(Number(t.sonZam.slice(0, 4)), 'den')} beri ${tl(t.fiyat)}; o günden bu yana enflasyon ${pct(t.erime!)}. ${top.length > 5 ? `En çok satan ${top.length} üründen ${eriyen.length} tanesinde` : `${eriyen.length} kalemde`} aynı durum var.`,
        aylikEtki: etki,
        oneri: `Zammı iki adımda yap: önce erimenin yarısı, üç ay sonra kalanı. İlk sıradakiler: ${eriyen
          .slice(0, 3)
          .map((x) => `${x.kalem} ${tl(x.fiyat)} → ${tl(x.fiyat * (1 + x.erime! / 2))}`)
          .join(', ')}.`,
        ciddiyet: etki > (ciro(last12) / 12) * 0.02 ? 'yuksek' : 'orta',
        kanit: eriyen.slice(0, 8).map((x) => ({ etiket: `${x.kalem} · son zam ${ayAdi(x.sonZam)}`, deger: `${tl(x.fiyat)} → olması gereken ${tl(x.fiyat * (1 + x.erime!))} · ayda ~${Math.round(x.aylikAdet).toLocaleString('tr-TR')} adet` })),
      });
    } else if (!reelVar) yapilamayan.push('Enflasyon serisi olmadığı için fiyat erimesi hesaplanmadı.');
    const dusen = top.filter((x) => x.fiyat < x.ilk * 0.95);
    if (top.length >= 10 && dusen.length >= Math.max(3, top.length * 0.2)) {
      bulgular.push({
        id: 'fiyat-indirim',
        baslik: 'Çok satan ürünlerde fiyat düşmüş',
        ozet: `En çok satan ${top.length} ürünün ${dusen.length} tanesi bugün ilk satıldığı fiyatın altında satılıyor${reelVar ? '; enflasyon da eklenince gerçek kayıp daha büyük' : ''}.`,
        aylikEtki: sum(dusen.map((x) => (x.ilk - x.fiyat) * x.aylikAdet)),
        oneri: 'İndirimler bilinçli mi (stok eritme, kampanya) yoksa unutulmuş mu? Bilinçli değilse eski fiyata dön; toptan ve perakende fiyatı ayrı listelerde tut.',
        ciddiyet: 'orta',
        kanit: dusen.slice(0, 8).map((x) => ({ etiket: x.kalem, deger: `${tl(x.ilk)} → ${tl(x.fiyat)}` })),
      });
    }

    // Products that stopped selling.
    if (prev12.length) {
      const prevSet = new Set(prev12);
      const terk = [...items.entries()]
        .map(([kalem, im]) => ({
          kalem,
          once: sum([...im.entries()].filter(([m]) => prevSet.has(m)).map(([m, x]) => real(x.t, m))),
          simdi: sum([...im.entries()].filter(([m]) => sonAylar.has(m)).map(([, x]) => x.t)),
        }))
        .filter((x) => x.once > 0 && x.simdi === 0)
        .sort((a, b) => b.once - a.once);
      const pay = sum(terk.map((x) => x.once)) / Math.max(1, ciroR(prev12));
      if (terk.length && pay > 0.03) {
        bulgular.push({
          id: 'urun-terk',
          // Much of this is seasonal or deliberate; shown, but not counted as money to win back.
          toplamaDahil: false,
          baslik: 'Satışı tamamen duran ürünler',
          ozet: `Önceki yıl satılıp son 12 ayda hiç satılmayan ${terk.length.toLocaleString('tr-TR')} ürün var; önceki yıl cironun ${yuzdeEk(pay, 'ini')} getiriyorlardı.`,
          aylikEtki: sum(terk.map((x) => x.once)) / 12,
          oneri: 'Bir kısmı mevsimlik ya da bilerek kaldırılmış olabilir. İlk 10 ürüne tek tek bak: tedarik mi bitti, yoksa unutuldu mu? Kâr bırakanları geri getir.',
          ciddiyet: pay > 0.08 ? 'yuksek' : 'orta',
          kanit: terk.slice(0, 8).map((x) => ({ etiket: x.kalem, deger: `önceki yıl ${tl(x.once)}` })),
        });
      }
    }

    // Concentration on a few products.
    const ilk10 = [...rows].sort((a, b) => b.ciro12 - a.ciro12).slice(0, 10);
    if (items.size > 30 && ciroR(last12) > 0 && sum(ilk10.map((x) => x.ciro12)) / ciroR(last12) > 0.3) {
      bulgular.push({
        id: 'urun-yogunlasma',
        baslik: 'Ciro birkaç ürüne dayanıyor',
        ozet: `${items.size.toLocaleString('tr-TR')} üründen en çok satan 10 tanesi cironun ${yuzdeEk(sum(ilk10.map((x) => x.ciro12)) / ciroR(last12), 'ini')} getiriyor.`,
        aylikEtki: 0,
        oneri: 'Bu 10 ürünün tedarikini garantiye al (ikinci tedarikçi, güvenlik stoğu); fiyatlarını her ay kontrol et.',
        ciddiyet: 'bilgi',
        kanit: ilk10.map((x) => ({ etiket: x.kalem, deger: tl(x.ciro12) })),
      });
    }
  }

  // 3. Fewer jobs or units sold.
  if (prev12.length && adet(prev12) > 0) {
    const ch = adet(last12) / adet(prev12) - 1;
    const reel = bulgular.find((x) => x.id === 'reel-buyume');
    if (ch < -0.03) {
      if (reel && (reelBuyume ?? 0) < 0) reel.ciddiyet = 'yuksek';
      bulgular.push({
        id: 'is-adedi',
        baslik: 'Daha az satış yapılıyor',
        ozet: `Son 12 ayda satılan adet ${pct(-ch)} azaldı (${Math.round(adet(prev12)).toLocaleString('tr-TR')} → ${Math.round(adet(last12)).toLocaleString('tr-TR')}).`,
        aylikEtki: ((adet(prev12) - adet(last12)) / 12) * (ciroR(last12) / Math.max(1, adet(last12))),
        oneri: 'Düzenli müşterilere hatırlatma gönder; en çok satan ürünlerin stokta olduğundan emin ol.',
        ciddiyet: ch < -0.06 ? 'yuksek' : 'orta',
        kanit: [
          { etiket: 'Önceki 12 ay adet', deger: Math.round(adet(prev12)).toLocaleString('tr-TR') },
          { etiket: 'Son 12 ay adet', deger: Math.round(adet(last12)).toLocaleString('tr-TR') },
        ],
      });
    }
  }

  // 4. Seasonality: how much of the year comes in its three best months.
  // Seasonality needs takings in (nearly) every month of the year, not a handful of lines.
  if (gelirVar && last12.length === 12 && last12.filter((m) => g(m).gelir > 0).length >= 10) {
    const sirali = [...last12].sort((a, b) => g(b).gelir - g(a).gelir);
    const pay = sum(sirali.slice(0, 3).map((m) => g(m).gelir)) / Math.max(1, ciro(last12));
    if (pay > 0.35) {
      const zayif = sirali.slice(-3);
      bulgular.push({
        id: 'mevsim',
        baslik: 'Yılın parasının büyük kısmı üç ayda geliyor',
        ozet: `Son 12 ayın cirosunun ${yuzdeEk(pay, 'i')} ${sirali.slice(0, 3).map((m) => AY_ADI[Number(m.slice(5)) - 1]).join(', ')} aylarında geldi. En zayıf aylar: ${zayif.map((m) => AY_ADI[Number(m.slice(5)) - 1]).join(', ')}.`,
        aylikEtki: 0,
        oneri: 'Güçlü aylarda gelirin bir kısmını zayıf aylar için ayır; stok alımını ve izinleri bu takvime göre planla.',
        ciddiyet: 'orta',
        kanit: sirali.slice(0, 3).concat(zayif).map((m) => ({ etiket: ayAdi(m), deger: tl(g(m).gelir) })),
      });
    }
  }

  // 5. Costs that grow faster than inflation. Small books use our categories; big ones their own.
  if (giderVar && prev12.length) {
    const kendiAdlari = new Set(months.flatMap((m) => [...g(m).katAdi.keys()]));
    const bizim = new Set(months.flatMap((m) => [...g(m).kat.keys()]));
    const kaynakAdi = kendiAdlari.size > bizim.size + 3;
    const keys = kaynakAdi ? kendiAdlari : bizim;
    const val = (m: string, k: string) => (kaynakAdi ? g(m).katAdi.get(k) : g(m).kat.get(k)) ?? 0;
    const toplam12 = S(last12, (a) => a.gider, true);
    const artan: { k: string; a: number; b: number }[] = [];
    let yatirimAtlandi = 0;
    for (const k of keys) {
      if (!kaynakAdi && (k === 'pos' || k === 'abonelik')) continue;
      if (YATIRIM.test(k)) {
        yatirimAtlandi++;
        continue;
      }
      const a = sum(prev12.map((m) => real(val(m, k), m)));
      const b = sum(last12.map((m) => real(val(m, k), m)));
      if (!kaynakAdi && k === 'malzeme' && adet(prev12) > 0) {
        const perA = a / adet(prev12);
        const perB = b / adet(last12);
        if (perA > 0 && perB / perA - 1 > 0.1) {
          bulgular.push({
            id: 'gider-malzeme',
            baslik: 'Malzeme maliyeti enflasyondan hızlı artıyor',
            ozet: `Satılan her birim için malzeme maliyeti${reelVar ? ' bugünün parasıyla' : ''} ${pct(perB / perA - 1)} arttı.`,
            aylikEtki: (perB - perA) * (adet(last12) / 12),
            oneri: 'Toptancıdan toplu alım ve ikinci bir tedarikçi teklifi iste; en çok harcanan üç kalemi karşılaştır.',
            ciddiyet: 'orta',
            kanit: [
              { etiket: 'Önceki 12 ay (birim başına)', deger: tl(perA) },
              { etiket: 'Son 12 ay (birim başına)', deger: tl(perB) },
            ],
          });
        }
        continue;
      }
      if (a > 0 && b / a - 1 > 0.15 && b - a > toplam12 * 0.005) artan.push({ k, a, b });
    }
    if (yatirimAtlandi) yapilamayan.push(`${yatirimAtlandi} yatırım ve borç anaparası kalemi (inşaat, araç, sistem, tahvil gibi) gider artışı analizine katılmadı; bunlar israf değil, yatırım kararıdır.`);
    artan.sort((x, y) => y.b - y.a - (x.b - x.a));
    if (artan.length) {
      const fark = sum(artan.map((x) => x.b - x.a));
      bulgular.push({
        id: 'gider-artis',
        // A cost that grew is a question, not money found: shown, not added to the total.
        toplamaDahil: false,
        baslik: artan.length === 1 ? `${KATEGORI_ADI[artan[0].k] ?? artan[0].k} enflasyondan hızlı artıyor` : `${artan.length} gider kalemi enflasyondan hızlı artıyor`,
        ozet: `${artan.length} gider kalemi${reelVar ? ' enflasyondan arındırılmış olarak' : ''} %15'ten fazla arttı; toplam fark yılda ${tl(fark)}.`,
        aylikEtki: fark / 12,
        oneri: 'İlk üç kalem için sebebi bul: fiyat mı arttı, miktar mı? Fiyatsa yeni teklif al; miktarsa kullanımı gözden geçir.',
        ciddiyet: fark > toplam12 * 0.05 ? 'yuksek' : 'orta',
        kanit: artan.slice(0, 8).map((x) => ({ etiket: KATEGORI_ADI[x.k] ?? x.k, deger: `${tl(x.a)} → ${tl(x.b)} (${pct(x.b / x.a - 1)})` })),
      });
    }

    // Card fees.
    const kart = (w: string[]) => S(w, (a) => a.kart);
    if (kart(prev12) > 0 && kart(last12) > 0) {
      const r1 = S(prev12, (a) => a.pos) / kart(prev12);
      const r2 = S(last12, (a) => a.pos) / kart(last12);
      if (r1 > 0 && r2 > r1 * 1.08) {
        const kartAylik = kart(last12.slice(-3)) / 3;
        bulgular.push({
          id: 'pos',
          baslik: 'Kart komisyonu sessizce arttı',
          ozet: `POS komisyon oranı ${pct1(r1)} → ${pct1(r2)}. Kartla ödeme payı da büyüdüğü için bu kalem hızla şişiyor.`,
          aylikEtki: kartAylik * Math.max(0, r2 - 0.022),
          oneri: 'Bankandan oranı yazılı iste; iki farklı bankadan teklif al. %2,2 pazarlıkla ulaşılabilir bir hedef.',
          ciddiyet: 'orta',
          kanit: [
            { etiket: 'Önceki 12 ay oran', deger: pct1(r1) },
            { etiket: 'Son 12 ay oran', deger: pct1(r2) },
            { etiket: 'Aylık kart cirosu (son 3 ay)', deger: tl(kartAylik) },
          ],
        });
      }
    }

    // A subscription added in the last year.
    const prevSet = new Set(prev12);
    const yeniAbonelik = [...subs.entries()].filter(([, set]) => ![...set].some((m) => prevSet.has(m)) && last12.some((m) => set.has(m))).map(([d]) => d);
    const ab = (w: string[]) => sum(w.map((m) => real(g(m).kat.get('abonelik') ?? 0, m)));
    if (ab(prev12) > 0 && ab(last12) / ab(prev12) - 1 > 0.15) {
      bulgular.push({
        id: 'gider-abonelik',
        baslik: 'Abonelik gideri büyüdü',
        ozet: `Abonelikler${reelVar ? ' bugünün parasıyla' : ''} ${pct(ab(last12) / ab(prev12) - 1)} arttı.${yeniAbonelik.length ? ` Yeni eklenen: ${yeniAbonelik.slice(0, 3).join(', ')}${yeniAbonelik.length > 3 ? ` ve ${yeniAbonelik.length - 3} tane daha` : ''}.` : ''}`,
        aylikEtki: (ab(last12) - ab(prev12)) / 12,
        oneri: `Kullanılmayan aboneliği iptal et${yeniAbonelik.length ? ` (${yeniAbonelik[0]})` : ''}.`,
        ciddiyet: 'bilgi',
        kanit: [
          { etiket: 'Önceki 12 ay', deger: tl(ab(prev12)) },
          { etiket: 'Son 12 ay', deger: tl(ab(last12)) },
        ],
      });
    }
  }

  // 6. Suppliers: how dependent, and payments that look like duplicates.
  if (vendors.size) {
    const v12 = [...vendors.entries()]
      .map(([ad, mm]) => ({ ad, t: sum(last12.map((m) => mm.get(m) ?? 0)) }))
      .filter((x) => x.t > 0)
      .sort((a, b) => b.t - a.t);
    const top = sum(v12.slice(0, 5).map((x) => x.t));
    const tum12 = sum(v12.map((x) => x.t));
    // Concentration only means something with several suppliers (a card processor alone is not one).
    if (tum12 > 0 && v12.length >= 5 && (v12[0].t / tum12 > 0.2 || top / tum12 > 0.5)) {
      bulgular.push({
        id: 'tedarikci',
        baslik: 'Giderler birkaç tedarikçide toplanıyor',
        ozet: `Son ${Math.min(12, last12.length)} ayda ${v12.length.toLocaleString('tr-TR')} tedarikçiye ödeme yapıldı; ilk 5'i giderlerin ${yuzdeEk(top / tum12, 'ini')}, en büyüğü tek başına ${yuzdeEk(v12[0].t / tum12, 'ini')} alıyor.`,
        aylikEtki: 0,
        oneri: 'En büyük beş tedarikçi için sözleşme bitiş tarihlerini ve fiyat maddelerini çıkar; her biri için en az bir alternatif teklif al.',
        ciddiyet: 'orta',
        kanit: v12.slice(0, 5).map((x) => ({ etiket: x.ad, deger: `${tl(x.t)} (${pct(x.t / tum12)})` })),
      });
    }
    const supheli = [...dup.values()].filter((d) => d.n > 1 && d.tutar >= 100).sort((a, b) => (b.n - 1) * b.tutar - (a.n - 1) * a.tutar);
    if (supheli.length) {
      const fazla = sum(supheli.map((d) => (d.n - 1) * d.tutar));
      bulgular.push({
        id: 'mukerrer',
        baslik: 'Kontrol edilmesi gereken olası mükerrer ödemeler',
        ozet: `Aynı gün, aynı tedarikçiye, aynı açıklamayla, kuruşu kuruşuna aynı tutarda birden fazla ödeme: ${supheli.length.toLocaleString('tr-TR')} grup, fazladan ödenmiş olabilecek toplam ${tl(fazla)}.`,
        aylikEtki: 0,
        oneri: 'Bir kısmı meşru olabilir (taksit, aynı gün birden çok fatura). En büyük 10 grubu faturalarla karşılaştır; hatalı olanlar için tedarikçiden iade iste.',
        ciddiyet: fazla > toplamGider * 0.001 ? 'orta' : 'bilgi',
        kanit: supheli.slice(0, 8).map((d) => ({ etiket: `${d.karsi} · ${d.tarih.split('-').reverse().join('.')}`, deger: `${d.n} × ${tl(d.tutar)}` })),
      });
    }
  }

  // 7. The cash calendar, from every year on record. A month is "a tight month" only once a year of
  // records shows it; a few months of data cannot tell a season from a bad month.
  if (gelirVar && giderVar && ms.length >= 12) {
    const takvim = Array.from({ length: 12 }, (_, i) => {
      const xs = ms.filter((m) => Number(m.slice(5)) === i + 1);
      const net = xs.map((m) => real(g(m).gelir - g(m).gider - g(m).cekis, m));
      return { ay: i + 1, net: net.length ? sum(net) / net.length : 0, n: xs.length };
    }).filter((x) => x.n);
    const sikisan = takvim.filter((x) => x.net < 0).sort((a, b) => a.net - b.net);
    if (sikisan.length && sikisan.length < 12) {
      bulgular.push({
        id: 'nakit-takvimi',
        baslik: 'Kasanın sıkıştığı aylar belli',
        ozet: `Geçmiş yıllarda ${sikisan.map((x) => AY_ADI[x.ay - 1]).join(', ')} aylarında giren para, çıkanı karşılamadı.`,
        aylikEtki: 0,
        oneri: `Diğer aylarda her hafta ${tl(-sum(sikisan.map((x) => x.net)) / Math.max(1, 12 - sikisan.length) / 4.3)} kenara ayır; bu aylar geldiğinde kasa açık vermez.`,
        ciddiyet: 'orta',
        kanit: sikisan.map((x) => ({ etiket: AY_ADI[x.ay - 1], deger: `${tl(x.net)} (ortalama${reelVar ? ', bugünün parasıyla' : ''})` })),
      });
    }
  }

  // 8. The till: owner draws, runway, break-even.
  const last3 = ms.slice(-3);
  const avg3 = (f: (a: MonthAgg) => number) => S(last3, f, true) / Math.max(1, last3.length);
  const sabit = giderVar ? avg3((a) => sum([...a.kat.entries()].filter(([k]) => SABIT.has(k)).map(([, v]) => v))) : 0;
  const degisken = avg3((a) => sum([...a.kat.entries()].filter(([k]) => DEGISKEN.has(k)).map(([, v]) => v)));
  const gelir3 = avg3((a) => a.gelir);
  const cekis3 = avg3((a) => a.cekis);
  const sabitBilinir = sabit > 0;
  const yalnizPos = kayitlar.every((k) => k.tur !== 'gider' || k.kategori === 'pos');
  if (gelirVar && giderVar && !sabitBilinir && !yalnizPos) yapilamayan.push('Giderler sabit ve değişken diye ayrılamadı (kategori eşleştirmesi gerekiyor): başabaş hesaplanmadı.');
  const basabasCiro = gelirVar && sabitBilinir ? sabit / Math.max(0.05, 1 - degisken / Math.max(1, gelir3)) : null;
  const basabasGunu = basabasCiro !== null ? Math.min(31, Math.ceil((basabasCiro / Math.max(1, gelir3)) * 30)) : null;
  const kasaSon = kasaBilinir ? aylik[aylik.length - 1].kasa! : null;
  const nakitOmruGun = kasaSon !== null && sabitBilinir ? Math.max(0, Math.round((kasaSon / Math.max(1, sabit + cekis3)) * 30)) : null;

  if (cekisVar && gelirVar && kasaSon !== null) {
    const kar3 = avg3((a) => a.gelir - a.gider);
    const k6 = aylik.slice(-6);
    const tepe = k6.reduce((a, b) => (b.kasa! > a.kasa! ? b : a));
    if (cekis3 > kar3 && kasaSon < tepe.kasa!) {
      bulgular.push({
        id: 'cekis',
        toplamaDahil: false,
        baslik: 'Kasadan kazandığından fazlasını çekiyorsun',
        ozet: `Son 3 ayda işletme ayda ortalama ${tl(kar3)} kazandı, ${tl(cekis3)} çekildi. Kasa ${ayAdi(tepe.ay)}${ek(Number(tepe.ay.slice(0, 4)), 'den')} bu yana ${tl(tepe.kasa! - kasaSon)} azaldı.`,
        aylikEtki: cekis3 - kar3,
        oneri: `Kendine sabit bir maaş belirle: ayda ${tl(Math.floor((kar3 * 0.9) / 1000) * 1000)}. Fazlası kasada kalsın; zam ve geri çağırma işe yarayınca maaşını yükseltirsin.`,
        ciddiyet: 'yuksek',
        kanit: [
          { etiket: 'Aylık kâr (son 3 ay)', deger: tl(kar3) },
          { etiket: 'Aylık çekilen (son 3 ay)', deger: tl(cekis3) },
          { etiket: `Kasa · ${ayAdi(tepe.ay)}`, deger: tl(tepe.kasa!) },
          { etiket: `Kasa · ${ayAdi(son)}`, deger: tl(kasaSon) },
        ],
      });
    }
  }
  if (nakitOmruGun !== null && nakitOmruGun < 45) {
    bulgular.push({
      id: 'nakit-omru',
      toplamaDahil: false,
      baslik: 'Kasa bir aydan kısa dayanır',
      ozet: `Bugün kasada ${tl(kasaSon!)} var. Hiç gelir olmasa sabit giderler ve çekilen parayla ${nakitOmruGun} gün dayanır.`,
      aylikEtki: 0,
      oneri: 'Hedef en az 60 gün: altı ay boyunca her ay bir miktar kenara ayır.',
      ciddiyet: nakitOmruGun < 21 ? 'yuksek' : 'orta',
      kanit: [
        { etiket: 'Kasa', deger: tl(kasaSon!) },
        { etiket: 'Aylık sabit gider', deger: tl(sabit) },
      ],
    });
  }

  const insan = musteriBulgulari(kayitlar, opts.randevular, tl);
  bulgular.push(...insan.bulgular);
  yapilamayan.push(...insan.yapilamayan);
  bulgular.sort((a, b) => ciddiyetSira[a.ciddiyet] - ciddiyetSira[b.ciddiyet] || b.aylikEtki - a.aylikEtki);
  const t12 = new Map<string, number>();
  for (const m of last12) for (const [k, v] of g(m).katAdi) t12.set(k, (t12.get(k) ?? 0) + v);
  const enBuyuk = [...t12.entries()].sort((a, b) => b[1] - a[1])[0];
  const t12Top = sum([...t12.values()]);

  return {
    ad: opts.ad,
    para,
    donemTipi,
    donem: { bas: months[0], son, ay: months.length, fiyatAyi, eksikSonAy },
    kaynak: reelVar ? e!.kaynak : null,
    ozet: {
      ciroNominal: [ciro(first12), ciro(prev12), ciro(last12)],
      ciroReel: [ciroR(first12), ciroR(prev12), ciroR(last12)],
      reelBuyume: reelVar ? reelBuyume : null,
      nominalBuyume,
      isAdedi: [adet(prev12), adet(last12)],
      kasa: kasaSon,
      nakitOmruGun,
      basabasCiro,
      basabasGunu,
      sabitGider: sabitBilinir ? sabit : null,
      enBuyukGider: enBuyuk && t12Top ? { kategori: enBuyuk[0], pay: enBuyuk[1] / t12Top } : null,
      toplamGelir,
      toplamGider,
    },
    aylik,
    bulgular,
    yapilamayan,
    geriKazanilabilir: sum(bulgular.filter((b) => b.toplamaDahil !== false).map((b) => b.aylikEtki)),
  };

  // ---- yearly figures (annual reports): margins, overheads, interest, operating result
  function yillik(): Rontgen {
    const ys = [...yillar.keys()].sort();
    const Y = ys.map((y) => {
      const xs = yillar.get(y)!;
      const at = (f: (a: MonthAgg) => number) => sum(xs.map((m) => real(f(g(m)), m)));
      const katT = (k: string) => at((a) => a.kat.get(k) ?? 0);
      const satis = at((a) => a.gelir);
      const malzeme = katT('malzeme');
      const genel = katT('genel') + katT('maas') + katT('kira');
      const faiz = katT('finansman');
      return { y, satis, nominal: sum(xs.map((m) => g(m).gelir)), malzeme, genel, faiz, faaliyet: satis - malzeme - genel };
    });
    const a = Y[0];
    const z = Y[Y.length - 1];
    const n = Y.length - 1;
    const cagr = Math.pow(z.satis / a.satis, 1 / n) - 1;
    const dususYili = Y.slice(1).filter((x, i) => x.satis < Y[i].satis).length;
    const etiket = reelVar ? ` (${ayAdi(fiyatAyi)} parasıyla)` : '';
    if (a.satis > 0 && z.satis < a.satis) {
      bulgular.push({
        id: 'yillik-dusus',
        toplamaDahil: false,
        baslik: 'Satışlar yıllardır düşüyor',
        ozet: `${a.y}${ek(Number(a.y), 'den')} ${z.y}${ek(Number(z.y), 'e')} satışlar ${pct(1 - z.nominal / a.nominal)} azaldı${reelVar ? `; enflasyondan arındırınca ${pct(1 - z.satis / a.satis)}` : ''}. ${dususYili === n ? `${n} yılın hepsinde` : `${n} yıldan ${dususYili} tanesinde`} düşüş var; yılda ortalama ${pct(-cagr)} küçülme.`,
        aylikEtki: a.satis - z.satis,
        oneri: 'Küçülen bir satış hacminde sabit giderler aynı hızda küçülmezse zarar kaçınılmazdır. Mağaza, kadro ve kira yapısı satışla birlikte küçültülmeli.',
        ciddiyet: 'yuksek',
        kanit: Y.map((x) => ({ etiket: x.y, deger: `${tl(x.satis)}${etiket}` })),
      });
    }
    if (a.malzeme > 0 && z.malzeme > 0) {
      const m1 = 1 - a.malzeme / a.satis;
      const m2 = 1 - z.malzeme / z.satis;
      if (m2 < m1 - 0.01) {
        bulgular.push({
          id: 'brut-marj',
          baslik: 'Brüt kâr marjı daralıyor',
          ozet: `Satılan malın maliyeti düşüldükten sonra kalan pay ${pct1(m1)} → ${pct1(m2)}. Her 100 birimlik satıştan ${((m1 - m2) * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} birim daha az kalıyor.`,
          aylikEtki: (m1 - m2) * z.satis,
          oneri: 'Fiyat, indirim ve ürün karışımını incele: marjı düşük ürünler satışın içinde büyüyor mu, alış fiyatları satışa yansıtılıyor mu?',
          ciddiyet: 'yuksek',
          kanit: Y.map((x) => ({ etiket: x.y, deger: pct1(1 - x.malzeme / x.satis) })),
        });
      }
    }
    if (a.genel > 0 && z.genel > 0) {
      const o1 = a.genel / a.satis;
      const o2 = z.genel / z.satis;
      if (o2 > o1 * 1.08) {
        bulgular.push({
          id: 'genel-oran',
          baslik: 'Genel giderler satıştan yavaş küçülüyor',
          ozet: `Genel giderlerin satışa oranı ${pct1(o1)} → ${pct1(o2)}. Satış ${pct(1 - z.satis / a.satis)} düşerken genel giderler ${pct(1 - z.genel / a.genel)} düştü.`,
          aylikEtki: (o2 - o1) * z.satis,
          oneri: 'Sabit giderlerin hangi kısmı satışla birlikte küçülebilir (kira, şube, kadro)? Satışın taşıyamayacağı yapıyı erken küçült.',
          ciddiyet: 'yuksek',
          kanit: Y.map((x) => ({ etiket: x.y, deger: `${pct1(x.genel / x.satis)} · ${tl(x.genel)}` })),
        });
      }
    }
    if (a.faiz > 0 && z.faiz > 0 && z.faiz / z.satis > (a.faiz / a.satis) * 1.3) {
      bulgular.push({
        id: 'faiz-yuku',
        baslik: 'Faiz yükü katlanıyor',
        ozet: `Faiz gideri${reelVar ? ' (gerçek)' : ''} ${tl(a.faiz)} → ${tl(z.faiz)}; satışa oranı ${pct1(a.faiz / a.satis)} → ${pct1(z.faiz / z.satis)}.`,
        aylikEtki: z.faiz - (a.faiz / a.satis) * z.satis,
        oneri: 'Borç, işletmenin ürettiği nakitten hızlı büyüyor. Yeni borçla eski borcu kapatmak yerine borcu küçültme planı gerekiyor.',
        ciddiyet: 'yuksek',
        kanit: Y.map((x) => ({ etiket: x.y, deger: `${tl(x.faiz)} · ${pct1(x.faiz / x.satis)}` })),
      });
    }
    const zararYillari = Y.filter((x) => x.faaliyet < 0);
    if (zararYillari.length) {
      bulgular.push({
        id: 'faaliyet-zarari',
        toplamaDahil: false,
        baslik: 'Ana faaliyet zarar ediyor',
        ozet: `Satıştan malın maliyeti ve genel giderler düşülünce ${zararYillari.map((x) => x.y).join(', ')} yıllarında zarar var. Faiz bunun üstüne eklenir.`,
        aylikEtki: -zararYillari[zararYillari.length - 1].faaliyet,
        oneri: 'Zarar eden birimleri (şube, ürün grubu) ayrı ayrı çıkar; nakit yakan yapıları kapatmak, satışı büyütmeye çalışmaktan hızlı sonuç verir.',
        ciddiyet: 'yuksek',
        kanit: Y.map((x) => ({ etiket: x.y, deger: tl(x.faaliyet) })),
      });
    }
    bulgular.sort((p, q) => ciddiyetSira[p.ciddiyet] - ciddiyetSira[q.ciddiyet] || q.aylikEtki - p.aylikEtki);
    yapilamayan.push('Yıllık özet veri: aylık mevsim, fiyat, müşteri ve tedarikçi bulguları için işlem bazında kayıt gerekir.');
    return {
      ad: opts.ad,
      para,
      donemTipi: 'yil',
      donem: { bas: months[0], son, ay: months.length, fiyatAyi, eksikSonAy: false },
      kaynak: reelVar ? e!.kaynak : null,
      ozet: {
        ciroNominal: [a.nominal, 0, z.nominal],
        ciroReel: [a.satis, 0, z.satis],
        reelBuyume: reelVar ? z.satis / a.satis - 1 : null,
        nominalBuyume: z.nominal / a.nominal - 1,
        isAdedi: [0, 0],
        kasa: null,
        nakitOmruGun: null,
        basabasCiro: null,
        basabasGunu: null,
        sabitGider: null,
        enBuyukGider: null,
        toplamGelir,
        toplamGider,
      },
      aylik,
      bulgular,
      yapilamayan,
      geriKazanilabilir: 0,
    };
  }
}
