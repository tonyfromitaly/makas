// İşletme Röntgeni: reads a ledger of any length and finds where the money goes, in today's lira.
// Every number here is computed from the records and the official inflation series; a language model
// may later word the findings, but it never produces a figure.
import { DEGISKEN, KATEGORI_ADI, SABIT, ay, type Kayit } from './kayit';
import { birikmis, bugununParasi, sonAy, TUFE_KAYNAK } from './tufe';

export interface Bulgu {
  id: string;
  baslik: string;
  ozet: string;
  /** Monthly effect in today's lira (positive = money being lost or at stake). */
  aylikEtki: number;
  /** The headline (real growth) overlaps the others; it is not added to the total. */
  toplamaDahil?: boolean;
  oneri: string;
  ciddiyet: 'yuksek' | 'orta' | 'bilgi';
  kanit: { etiket: string; deger: string }[];
}

export interface Rontgen {
  ad: string;
  donem: { bas: string; son: string; ay: number; fiyatAyi: string };
  kaynak: string;
  ozet: {
    ciroNominal: [number, number, number];
    ciroReel: [number, number, number];
    reelBuyume: number; // last 12 months vs the 12 before, in today's lira
    nominalBuyume: number;
    isAdedi: [number, number];
    kasa: number;
    nakitOmruGun: number; // days the till lasts with no income at all
    basabasCiro: number; // monthly
    basabasGunu: number; // day of the month the takings cover the fixed costs
    sabitGider: number; // monthly, today's lira
    enBuyukGider: { kategori: string; pay: number };
  };
  aylik: { ay: string; gelir: number; gider: number; cekis: number; gelirReel: number; kasa: number }[];
  bulgular: Bulgu[];
  /** Money a month that the actions could bring back, today's lira (headline and cash findings excluded). */
  geriKazanilabilir: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const tl = (n: number) => `${Math.round(n).toLocaleString('tr-TR')} TL`;
const pct = (n: number) => `%${(n * 100).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`;
const AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const ayAdi = (m: string) => `${AY_ADI[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

export function rontgen(kayitlar: Kayit[], opts: { ad: string; acilisKasa?: number }): Rontgen {
  const months = [...new Set(kayitlar.map((k) => ay(k.tarih)))].sort();
  const son = months[months.length - 1];
  // Prices are expressed in the last month that has both records and published inflation.
  const fiyatAyi = son <= sonAy() ? son : sonAy();
  const real = (n: number, m: string) => bugununParasi(n, m, fiyatAyi);
  const byMonth = new Map(months.map((m) => [m, kayitlar.filter((k) => ay(k.tarih) === m)]));
  const total = (m: string, f: (k: Kayit) => boolean) => sum((byMonth.get(m) ?? []).filter(f).map((k) => k.tutar));

  // Month by month, with the till carried forward.
  let kasa = opts.acilisKasa ?? 0;
  const aylik = months.map((m) => {
    const gelir = total(m, (k) => k.tur === 'gelir');
    const gider = total(m, (k) => k.tur === 'gider');
    const cekis = total(m, (k) => k.tur === 'cekis');
    kasa += gelir - gider - cekis;
    return { ay: m, gelir, gider, cekis, gelirReel: real(gelir, m), kasa };
  });

  // Three twelve-month windows ending with the last month (older windows may be partial).
  const last12 = months.slice(-12);
  const prev12 = months.slice(-24, -12);
  const first12 = months.slice(-36, -24);
  const ciro = (ms: string[]) => sum(ms.map((m) => total(m, (k) => k.tur === 'gelir')));
  const ciroR = (ms: string[]) => sum(ms.map((m) => real(total(m, (k) => k.tur === 'gelir'), m)));
  const adet = (ms: string[]) => sum(ms.flatMap((m) => (byMonth.get(m) ?? []).filter((k) => k.kategori === 'hizmet').map((k) => k.adet ?? 0)));
  const reelBuyume = prev12.length ? ciroR(last12) / ciroR(prev12) - 1 : 0;
  const nominalBuyume = prev12.length ? ciro(last12) / ciro(prev12) - 1 : 0;

  const bulgular: Bulgu[] = [];

  // 1. Nominal growth that is really shrinkage.
  if (prev12.length) {
    const kayip = (ciroR(prev12) - ciroR(last12)) / 12;
    bulgular.push({
      id: 'reel-buyume',
      toplamaDahil: false,
      baslik: reelBuyume < 0 ? 'Ciro büyüyor görünüyor, gerçekte küçülüyor' : 'Ciro enflasyonun üstünde büyüyor',
      ozet: `Son 12 ayda ciro ${pct(nominalBuyume)} arttı; enflasyondan arındırınca ${reelBuyume < 0 ? `${pct(-reelBuyume)} küçüldü` : `${pct(reelBuyume)} büyüdü`}.`,
      aylikEtki: Math.max(0, kayip),
      oneri: reelBuyume < 0 ? 'Fiyatları enflasyona göre güncelle ve kaybedilen düzenli müşterileri geri çağır (aşağıdaki iki bulgu).' : 'Bu hızı korumak için fiyatları her çeyrek enflasyonla karşılaştır.',
      ciddiyet: reelBuyume < -0.03 ? 'yuksek' : 'bilgi',
      kanit: [
        { etiket: 'Önceki 12 ay (bugünün parasıyla)', deger: tl(ciroR(prev12)) },
        { etiket: 'Son 12 ay (bugünün parasıyla)', deger: tl(ciroR(last12)) },
        { etiket: 'Önceki 12 ay (o günkü fiyatlarla)', deger: tl(ciro(prev12)) },
        { etiket: 'Son 12 ay (o günkü fiyatlarla)', deger: tl(ciro(last12)) },
      ],
    });
  }

  // 2. Prices eaten by inflation since the last raise.
  const kalemler = [...new Set(kayitlar.filter((k) => k.kategori === 'hizmet' && k.kalem && k.adet).map((k) => k.kalem!))];
  const erime: { kalem: string; fiyat: number; sonZam: string; erime: number; gereken: number; aylikAdet: number }[] = [];
  for (const kalem of kalemler) {
    const unit = months
      .map((m) => {
        const rows = (byMonth.get(m) ?? []).filter((k) => k.kalem === kalem && k.adet);
        const n = sum(rows.map((k) => k.adet!));
        return { m, p: n ? sum(rows.map((k) => k.tutar)) / n : 0, n };
      })
      .filter((x) => x.n);
    if (!unit.length) continue;
    const price = unit[unit.length - 1].p;
    let sonZam = unit[0].m;
    for (let i = 1; i < unit.length; i++) if (unit[i].p > unit[i - 1].p * 1.02) sonZam = unit[i].m;
    const e = birikmis(sonZam, fiyatAyi);
    const aylikAdet = sum(unit.slice(-3).map((x) => x.n)) / Math.min(3, unit.length);
    erime.push({ kalem, fiyat: price, sonZam, erime: e, gereken: price * (1 + e), aylikAdet });
  }
  const eriyen = erime.filter((x) => x.erime > 0.1).sort((a, b) => (b.gereken - b.fiyat) * b.aylikAdet - (a.gereken - a.fiyat) * a.aylikAdet);
  if (eriyen.length) {
    const etki = sum(eriyen.map((x) => (x.gereken - x.fiyat) * x.aylikAdet));
    const top = eriyen[0];
    bulgular.push({
      id: 'fiyat-erimesi',
      baslik: 'Fiyatların enflasyona eriyor',
      ozet: `${top.kalem} fiyatı ${ayAdi(top.sonZam)}'den beri ${tl(top.fiyat)}; o günden bu yana enflasyon ${pct(top.erime)}. ${eriyen.length > 1 ? `${eriyen.length} hizmette aynı durum var.` : ''}`.trim(),
      aylikEtki: etki,
      oneri: `Zammı bir kerede değil, iki adımda yap: şimdi ${eriyen.map((x) => `${x.kalem} ${tl(Math.ceil((x.fiyat + (x.gereken - x.fiyat) / 2) / 10) * 10)}`).join(', ')}; üç ay sonra kalanı.`,
      ciddiyet: etki > 5000 ? 'yuksek' : 'orta',
      kanit: eriyen.map((x) => ({ etiket: `${x.kalem} · son zam ${ayAdi(x.sonZam)}`, deger: `${tl(x.fiyat)} → olması gereken ${tl(x.gereken)} · ayda ~${Math.round(x.aylikAdet)} iş` })),
    });
  }

  // 3. Demand: fewer jobs done, independent of price.
  if (prev12.length) {
    const a1 = adet(prev12);
    const a2 = adet(last12);
    const ch = a2 / a1 - 1;
    if (ch < -0.03) {
      const avgTicket = ciro(last12) / Math.max(1, a2);
      bulgular.push({
        id: 'is-adedi',
        baslik: 'Daha az müşteri geliyor',
        ozet: `Son 12 ayda yapılan iş sayısı ${pct(-ch)} azaldı (${a1.toLocaleString('tr-TR')} → ${a2.toLocaleString('tr-TR')}).`,
        aylikEtki: (((a1 - a2) / 12) * avgTicket * (1 + birikmis(last12[0], fiyatAyi) / 2)),
        oneri: 'Altı haftadır gelmeyen düzenli müşterilere tek tek hatırlatma gönder; randevu hatırlatmalarını aç.',
        ciddiyet: ch < -0.06 ? 'yuksek' : 'orta',
        kanit: [
          { etiket: 'Önceki 12 ay iş sayısı', deger: a1.toLocaleString('tr-TR') },
          { etiket: 'Son 12 ay iş sayısı', deger: a2.toLocaleString('tr-TR') },
        ],
      });
    }
  }

  // 4. Costs that grow faster than inflation (supplies measured per job).
  const kategoriler = [...new Set(kayitlar.filter((k) => k.tur === 'gider').map((k) => k.kategori))];
  for (const kat of kategoriler) {
    if (!prev12.length) break;
    const sR = (ms: string[]) => sum(ms.map((m) => real(total(m, (k) => k.tur === 'gider' && k.kategori === kat), m)));
    let a = sR(prev12);
    let b = sR(last12);
    let birim = '';
    if (kat === 'malzeme') {
      a /= Math.max(1, adet(prev12));
      b /= Math.max(1, adet(last12));
      birim = ' (iş başına)';
    }
    if (kat === 'pos') {
      const kart = (ms: string[]) => sum(ms.map((m) => total(m, (k) => k.tur === 'gelir' && k.odeme === 'kart')));
      const r1 = sum(prev12.map((m) => total(m, (k) => k.kategori === 'pos'))) / Math.max(1, kart(prev12));
      const r2 = sum(last12.map((m) => total(m, (k) => k.kategori === 'pos'))) / Math.max(1, kart(last12));
      if (r2 > r1 * 1.08) {
        const kartAylik = sum(last12.slice(-3).map((m) => total(m, (k) => k.tur === 'gelir' && k.odeme === 'kart'))) / 3;
        bulgular.push({
          id: 'pos',
          baslik: 'Kart komisyonu sessizce arttı',
          ozet: `POS komisyon oranı %${(r1 * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} → %${(r2 * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}. Kartla ödeme payı da büyüdüğü için bu kalem hızla şişiyor.`,
          aylikEtki: kartAylik * (r2 - 0.022),
          oneri: 'Bankandan oranı yazılı iste; iki farklı bankadan teklif al. %2,2 bugün pazarlıkla ulaşılabilir bir oran olarak hedeflenebilir.',
          ciddiyet: 'orta',
          kanit: [
            { etiket: 'Önceki 12 ay oran', deger: `%${(r1 * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}` },
            { etiket: 'Son 12 ay oran', deger: `%${(r2 * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}` },
            { etiket: 'Aylık kart cirosu (son 3 ay)', deger: tl(kartAylik) },
          ],
        });
      }
      continue;
    }
    const ch = b / a - 1;
    if (a > 0 && ch > (kat === 'malzeme' ? 0.1 : 0.15)) {
      const aylikFark = kat === 'malzeme' ? (b - a) * (adet(last12) / 12) : (b - a) / 12;
      const isAbonelik = kat === 'abonelik';
      const yeni = isAbonelik
        ? [...new Set(last12.flatMap((m) => (byMonth.get(m) ?? []).filter((k) => k.kategori === kat).map((k) => k.aciklama ?? '')))].filter(
            (d) => d && !prev12.some((m) => (byMonth.get(m) ?? []).some((k) => k.kategori === kat && k.aciklama === d)),
          )
        : [];
      bulgular.push({
        id: `gider-${kat}`,
        baslik: isAbonelik ? 'Abonelik gideri ikiye katlandı' : `${KATEGORI_ADI[kat] ?? kat} enflasyondan hızlı artıyor`,
        ozet: `${KATEGORI_ADI[kat] ?? kat}${birim} bugünün parasıyla ${pct(ch)} arttı.${yeni.length ? ` Yeni eklenen: ${yeni.join(', ')}.` : ''}`,
        aylikEtki: aylikFark,
        oneri: isAbonelik
          ? `Kullanılmayan aboneliği iptal et${yeni.length ? ` (${yeni[0]})` : ''}.`
          : kat === 'malzeme'
            ? 'Toptancıdan üç aylık toplu alım ve ikinci bir tedarikçi teklifi iste; en çok harcanan üç kalemi karşılaştır.'
            : 'Bu kalemi aylık takip listesine al; artışın sebebini bir sonraki ziyarette konuşalım.',
        ciddiyet: aylikFark > 3000 ? 'orta' : 'bilgi',
        kanit: [
          { etiket: `Önceki 12 ay${birim}`, deger: tl(a) },
          { etiket: `Son 12 ay${birim}`, deger: tl(b) },
        ],
      });
    }
  }

  // 5. The cash calendar: which months squeeze, from every year on record.
  const takvim = Array.from({ length: 12 }, (_, i) => {
    const ms = months.filter((m) => Number(m.slice(5)) === i + 1);
    const net = ms.map((m) => real(total(m, (k) => k.tur === 'gelir') - total(m, (k) => k.tur !== 'gelir'), m));
    return { ay: i + 1, net: net.length ? sum(net) / net.length : 0, n: ms.length };
  }).filter((x) => x.n);
  const sikisan = takvim.filter((x) => x.net < 0).sort((a, b) => a.net - b.net);
  if (sikisan.length) {
    bulgular.push({
      id: 'nakit-takvimi',
      baslik: 'Kasanın sıkıştığı aylar belli',
      ozet: `Geçmiş yıllarda ${sikisan.map((x) => AY_ADI[x.ay - 1]).join(', ')} aylarında giren para, çıkanı karşılamadı.`,
      aylikEtki: 0,
      oneri: `Diğer aylarda her hafta ${tl((-sum(sikisan.map((x) => x.net)) / Math.max(1, 12 - sikisan.length)) / 4.3)} kenara ayır; bu aylar geldiğinde kasa açık vermez.`,
      ciddiyet: 'orta',
      kanit: sikisan.map((x) => ({ etiket: AY_ADI[x.ay - 1], deger: `${tl(x.net)} (ortalama, bugünün parasıyla)` })),
    });
  }

  // The till, fixed costs, break-even, runway.
  const last3 = months.slice(-3);
  const avg3 = (f: (k: Kayit) => boolean) => sum(last3.map((m) => real(total(m, f), m))) / last3.length;
  const sabit = avg3((k) => k.tur === 'gider' && SABIT.has(k.kategori));
  const degisken = avg3((k) => k.tur === 'gider' && DEGISKEN.has(k.kategori));
  const gelir3 = avg3((k) => k.tur === 'gelir');
  const cekis3 = avg3((k) => k.tur === 'cekis');
  const katkiOrani = gelir3 > 0 ? 1 - degisken / gelir3 : 1;
  const basabasCiro = sabit / Math.max(0.05, katkiOrani);
  const basabasGunu = Math.min(31, Math.ceil((basabasCiro / Math.max(1, gelir3)) * 30));
  const kasaSon = aylik[aylik.length - 1]?.kasa ?? 0;
  const nakitOmruGun = Math.max(0, Math.round((kasaSon / Math.max(1, sabit + cekis3)) * 30));
  const giderKat = kategoriler
    .map((kat) => ({ kategori: kat, t: sum(last12.map((m) => total(m, (k) => k.tur === 'gider' && k.kategori === kat))) }))
    .sort((a, b) => b.t - a.t);
  const toplamGider = sum(giderKat.map((x) => x.t));

  // 6. Taking out more than the shop earns.
  const isletmeKari3 = avg3((k) => k.tur === 'gelir') - avg3((k) => k.tur === 'gider');
  const kasa6 = aylik.slice(-6);
  if (cekis3 > isletmeKari3 && kasa6.length >= 4 && kasa6[kasa6.length - 1].kasa < Math.max(...kasa6.map((x) => x.kasa))) {
    const tepe = kasa6.reduce((a, b) => (b.kasa > a.kasa ? b : a));
    bulgular.push({
      id: 'cekis',
      toplamaDahil: false,
      baslik: 'Kasadan kazandığından fazlasını çekiyorsun',
      ozet: `Son 3 ayda dükkân ayda ortalama ${tl(isletmeKari3)} kazandı, eve ${tl(cekis3)} gitti. Kasa ${ayAdi(tepe.ay)}'dan bu yana ${tl(tepe.kasa - kasaSon)} azaldı.`,
      aylikEtki: cekis3 - isletmeKari3,
      oneri: `Kendine sabit bir maaş belirle: ayda ${tl(Math.floor((isletmeKari3 * 0.9) / 1000) * 1000)}. Fazlası kasada kalsın; zam ve geri çağırma işe yarayınca maaşını yükseltirsin.`,
      ciddiyet: 'yuksek',
      kanit: [
        { etiket: 'Aylık dükkân kârı (son 3 ay)', deger: tl(isletmeKari3) },
        { etiket: 'Aylık eve giden (son 3 ay)', deger: tl(cekis3) },
        { etiket: `Kasa · ${ayAdi(tepe.ay)}`, deger: tl(tepe.kasa) },
        { etiket: `Kasa · ${ayAdi(son)}`, deger: tl(kasaSon) },
      ],
    });
  }

  if (nakitOmruGun < 45) {
    bulgular.push({
      id: 'nakit-omru',
      baslik: 'Kasa bir aydan kısa dayanır',
      ozet: `Bugün kasada ${tl(kasaSon)} var. Hiç gelir olmasa sabit giderler ve eve götürdüğün parayla ${nakitOmruGun} gün dayanır.`,
      aylikEtki: 0,
      oneri: `Hedef: en az 60 gün. Bunun için ${tl(Math.max(0, ((60 * (sabit + cekis3)) / 30 - kasaSon) / 6))} kadarını altı ay boyunca her ay kenara ayır.`,
      ciddiyet: nakitOmruGun < 21 ? 'yuksek' : 'orta',
      kanit: [
        { etiket: 'Kasa', deger: tl(kasaSon) },
        { etiket: 'Aylık sabit gider', deger: tl(sabit) },
        { etiket: 'Aylık eve giden', deger: tl(cekis3) },
      ],
    });
  }

  const ciddiyetSira = { yuksek: 0, orta: 1, bilgi: 2 };
  bulgular.sort((a, b) => ciddiyetSira[a.ciddiyet] - ciddiyetSira[b.ciddiyet] || b.aylikEtki - a.aylikEtki);

  return {
    ad: opts.ad,
    donem: { bas: months[0], son, ay: months.length, fiyatAyi },
    kaynak: TUFE_KAYNAK,
    ozet: {
      ciroNominal: [ciro(first12), ciro(prev12), ciro(last12)],
      ciroReel: [ciroR(first12), ciroR(prev12), ciroR(last12)],
      reelBuyume,
      nominalBuyume,
      isAdedi: [adet(prev12), adet(last12)],
      kasa: kasaSon,
      nakitOmruGun,
      basabasCiro,
      basabasGunu,
      sabitGider: sabit,
      enBuyukGider: { kategori: KATEGORI_ADI[giderKat[0]?.kategori] ?? '-', pay: toplamGider ? giderKat[0].t / toplamGider : 0 },
    },
    aylik,
    bulgular,
    geriKazanilabilir: sum(bulgular.filter((b) => b.toplamaDahil !== false).map((b) => b.aylikEtki)),
  };
}
