// Every sentence Röntgen and the agent's notes say, in Turkish, English and Spanish. The engine computes
// the numbers; these functions only word them, so a finding reads the same way in every language and no
// figure is ever produced here. Turkish keeps its suffix rules (2024'ten, %35'ini); English and Spanish
// their own plurals and number formats.
import { ek, yuzdeEk } from './ek';

export type Dil = 'tr' | 'en' | 'es';

const LOCALE: Record<Dil, string> = { tr: 'tr-TR', en: 'en-US', es: 'es-ES' };
const AYLAR: Record<Dil, string[]> = {
  tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
};
const AYLAR_KISA: Record<Dil, string[]> = {
  tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};

export const KATEGORI: Record<Dil, Record<string, string>> = {
  tr: {
    hizmet: 'Hizmet', urun: 'Ürün satışı', bahsis: 'Bahşiş', kira: 'Kira', elektrik: 'Elektrik', su: 'Su', dogalgaz: 'Doğalgaz', malzeme: 'Malzeme',
    maas: 'Maaş', pos: 'POS komisyonu', muhasebe: 'Muhasebe', vergi: 'Vergi ve Bağ-Kur', abonelik: 'Abonelikler', diger: 'Diğer', satis: 'Satış',
    genel: 'Genel giderler', finansman: 'Faiz ve finansman', sahip: 'Sahibin çektiği',
  },
  en: {
    hizmet: 'Services', urun: 'Product sales', bahsis: 'Tips', kira: 'Rent', elektrik: 'Electricity', su: 'Water', dogalgaz: 'Gas', malzeme: 'Supplies',
    maas: 'Payroll', pos: 'Card processing fees', muhasebe: 'Accounting', vergi: 'Taxes', abonelik: 'Subscriptions', diger: 'Other', satis: 'Sales',
    genel: 'Overheads', finansman: 'Interest and financing', sahip: 'Owner draws',
  },
  es: {
    hizmet: 'Servicios', urun: 'Venta de productos', bahsis: 'Propinas', kira: 'Alquiler', elektrik: 'Electricidad', su: 'Agua', dogalgaz: 'Gas', malzeme: 'Insumos',
    maas: 'Nómina', pos: 'Comisiones de tarjeta', muhasebe: 'Contabilidad', vergi: 'Impuestos', abonelik: 'Suscripciones', diger: 'Otros', satis: 'Ventas',
    genel: 'Gastos generales', finansman: 'Intereses y financiación', sahip: 'Retiros del dueño',
  },
};

const KAYNAK: Record<Dil, Record<string, string>> = {
  tr: {},
  en: {
    'ABD Çalışma İstatistikleri Bürosu, CPI-U (FRED CPIAUCNS)': 'US Bureau of Labor Statistics, CPI-U (FRED CPIAUCNS)',
    'Birleşik Krallık ONS, CPI endeksi (D7BT)': 'UK Office for National Statistics, CPI index (D7BT)',
    'TCMB, Tüketici Fiyatları (TÜFE) aylık % değişim': 'Central Bank of Türkiye, consumer prices (CPI), monthly % change',
  },
  es: {
    'ABD Çalışma İstatistikleri Bürosu, CPI-U (FRED CPIAUCNS)': 'Oficina de Estadísticas Laborales de EE. UU., CPI-U (FRED CPIAUCNS)',
    'Birleşik Krallık ONS, CPI endeksi (D7BT)': 'Oficina Nacional de Estadística del Reino Unido, IPC (D7BT)',
    'TCMB, Tüketici Fiyatları (TÜFE) aylık % değişim': 'Banco Central de Turquía, precios al consumo (IPC), variación mensual',
  },
};

/** The shared formatting for one language and currency. */
function bicim(dil: Dil, para: string) {
  // Spanish in dollars is US Spanish ($1,483 · 6%); in euros, Spain's (1483 € · 6 %).
  const usEs = dil === 'es' && para === 'USD';
  const loc = usEs ? 'es-US' : LOCALE[dil];
  const n = (x: number, frac = 0) => x.toLocaleString(loc, { maximumFractionDigits: frac });
  const sym: Record<string, string> = { TRY: 'TL', USD: '$', GBP: '£', EUR: '€' };
  const s = sym[para] ?? para;
  const big = { tr: ['milyar', 'milyon'], en: ['bn', 'm'], es: ['mil M', 'M'] }[dil];
  const tl = (x: number) => {
    const a = Math.abs(x);
    const t =
      a >= 1e9
        ? `${(a / 1e9).toLocaleString(loc, { maximumFractionDigits: 1 })}${dil === 'tr' ? ' ' : ' '}${big[0]}`
        : a >= 1e7
          ? `${(a / 1e6).toLocaleString(loc, { maximumFractionDigits: 1 })}${dil === 'en' ? '' : ' '}${big[1]}`
          : a < 100 && a % 1 !== 0
            ? a.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : Math.round(a).toLocaleString(loc);
    return `${x < 0 ? '−' : ''}${para === 'TRY' ? `${t} ${s}` : `${s}${t}`}`;
  };
  // Turkish puts the sign first (%35); English and Spanish after (35%, 35 %).
  const pctS = (v: string) => (dil === 'tr' ? `%${v}` : dil === 'es' && !usEs ? `${v} %` : `${v}%`);
  const pct = (f: number) => pctS(Math.round(f * 100).toLocaleString(loc));
  const pct1 = (f: number) => pctS((f * 100).toLocaleString(loc, { maximumFractionDigits: 1 }));
  const ay = (m: string) => `${AYLAR[dil][Number(m.slice(5)) - 1]}${dil === 'es' ? ' de' : ''} ${m.slice(0, 4)}`;
  const ayAdi = (i: number) => AYLAR[dil][i - 1];
  const ayKisa = (i: number) => AYLAR_KISA[dil][i - 1];
  /** "20 Ekim", "October 20", "20 de octubre". */
  const gunAy = (iso: string) => {
    const d = Number(iso.slice(8, 10));
    const m = AYLAR[dil][Number(iso.slice(5, 7)) - 1];
    return dil === 'en' ? `${m} ${d}` : dil === 'es' ? `${d} de ${m}` : `${d} ${m}`;
  };
  const tarih = (iso: string) => (dil === 'en' ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : iso.split('-').reverse().join(dil === 'tr' ? '.' : '/'));
  const liste = (xs: string[]) => {
    if (xs.length < 2) return xs.join('');
    const ve = { tr: 've', en: 'and', es: 'y' }[dil];
    return `${xs.slice(0, -1).join(', ')} ${ve} ${xs[xs.length - 1]}`;
  };
  const kategori = (k: string) => KATEGORI[dil][k] ?? k;
  /** The inflation series' name in this language (the series are named in Turkish at the source). */
  const kaynak = (k: string) => KAYNAK[dil][k] ?? k;
  return { dil, n, tl, pct, pct1, ay, ayAdi, ayKisa, gunAy, tarih, liste, kategori, kaynak };
}

export type Bicim = ReturnType<typeof bicim>;

/** All of Röntgen's words for one language. */
export function metin(dil: Dil, para: string) {
  const b = bicim(dil, para);
  return { ...b, ...TEXTS[dil](b) };
}
export type Metin = ReturnType<typeof metin>;

// ---------- the texts ----------

function tr(b: Bicim) {
  const { n, tl, pct, pct1, ay, ayAdi, kategori } = b;
  const artti = (f: number) => (f >= 0 ? `${pct(f)} arttı` : `${pct(-f)} azaldı`);
  const sene = (m: string) => Number(m.slice(0, 4));
  return {
    yapilamayan: {
      baskaPara: (k: number) => `${n(k)} kayıt başka para biriminde olduğu için ayrı tutuldu.`,
      enflasyonKapsamaz: (kaynak: string) => `Enflasyon serisi (${kaynak}) bu dönemi kapsamıyor; tutarlar o günkü fiyatlarla.`,
      enflasyonYok: (para: string) => `${para} için resmî enflasyon serisi eklenmedi; tutarlar o günkü fiyatlarla.`,
      gelirYok: 'Gelir kaydı yok: ciro, fiyat, başabaş ve kâr bulguları çalışmadı.',
      giderYok: 'Gider kaydı yok: gider, başabaş ve nakit takvimi bulguları çalışmadı.',
      sadecePos: 'Giderlerin tamamı kart işlem ücretleri: kira, maaş, malzeme gibi giderler için banka hesabını ya da muhasebe programını bağla; başabaş ve nakit takvimi ancak o zaman çalışır.',
      kasaYok: 'Kasa ve banka bakiyesi verilmedi: nakit ömrü hesaplanmadı.',
      cekisYok: 'Sahibin çektiği para ayrı kayıtlı değil: "kazandığından fazla çekiyorsun" bulgusu test edilemedi.',
      eksikSonAy: (m: string, gun: number) => `${ay(m)} eksik (son kayıt: ${gun} ${ayAdi(Number(m.slice(5)))}); karşılaştırmalara katılmadı.`,
      kisaVeri: '24 aydan kısa veri: yıllık karşılaştırmalar yapılmadı.',
      buyumeYok: 'Gelir kayıtları iki yılın ikisini de kapsamıyor: yıllık büyüme hesaplanmadı.',
      erimeYok: 'Enflasyon serisi olmadığı için fiyat erimesi hesaplanmadı.',
      yatirim: (k: number) => `${k} yatırım ve borç anaparası kalemi (inşaat, araç, sistem, tahvil gibi) gider artışı analizine katılmadı; bunlar israf değil, yatırım kararıdır.`,
      sabitDegisken: 'Giderler sabit ve değişken diye ayrılamadı (kategori eşleştirmesi gerekiyor): başabaş hesaplanmadı.',
      yillik: 'Yıllık özet veri: aylık mevsim, fiyat, müşteri ve tedarikçi bulguları için işlem bazında kayıt gerekir.',
      musteriYok: 'Gelir kayıtlarının çoğunda müşteri yok: kayıp müşteri takibi yapılamadı.',
      randevuYok: 'Randevu kaydı yok: gelmeyen randevu oranı hesaplanmadı.',
    },
    etiket: {
      fiyatAyi: (m: string) => ` (${ay(m)} parasıyla)`,
      onceki12: 'Önceki 12 ay',
      son12: 'Son 12 ay',
      onceki12Nom: 'Önceki 12 ay (o günkü fiyatlarla)',
      son12Nom: 'Son 12 ay (o günkü fiyatlarla)',
      adet: 'Satılan adet (önceki → son)',
      onceki12Adet: 'Önceki 12 ay adet',
      son12Adet: 'Son 12 ay adet',
      onceki12Birim: 'Önceki 12 ay (birim başına)',
      son12Birim: 'Son 12 ay (birim başına)',
      onceki12Oran: 'Önceki 12 ay oran',
      son12Oran: 'Son 12 ay oran',
      kartAylik: 'Aylık kart cirosu (son 3 ay)',
      karAylik: 'Aylık kâr (son 3 ay)',
      cekisAylik: 'Aylık çekilen (son 3 ay)',
      kasaAy: (m: string) => `Kasa · ${ay(m)}`,
      kasa: 'Kasa',
      sabitAylik: 'Aylık sabit gider',
      randevu90: 'Randevu (son 90 gün)',
      gelmedi: 'Gelmedi',
      musteriIptal: 'Müşteri iptali',
    },
    reelBuyume: {
      baslik: (reelVar: boolean, kucul: boolean, nominalArti: boolean): string =>
        reelVar ? (kucul ? (nominalArti ? 'Ciro büyüyor görünüyor, gerçekte küçülüyor' : 'Ciro küçülüyor') : 'Ciro enflasyonun üstünde büyüyor') : kucul ? 'Ciro küçülüyor' : 'Ciro büyüyor',
      ozet: (nom: number, reel: number, reelVar: boolean, ayrim: { adet: number; fiyat: number } | null) =>
        `Son 12 ayda ciro ${artti(nom)}` +
        (reelVar ? `; enflasyondan arındırınca ${reel < 0 ? `${pct(-reel)} küçüldü` : `${pct(reel)} büyüdü`}.` : '.') +
        (ayrim ? ` Satılan adet ${artti(ayrim.adet)}, adet başına gelir${reelVar ? ' (gerçek)' : ''} ${artti(ayrim.fiyat)}.` : ''),
      oneriAdet: 'Düşüşün asıl kaynağı daha az satış: kaybedilen müşterileri ve terk edilen ürünleri aşağıdaki bulgularda incele.',
      oneriFiyat: 'Düşüşün asıl kaynağı fiyat: fiyat listesini enflasyon ve rakiplerle karşılaştır.',
      oneriBuyu: 'Bu hızı korumak için fiyatları her çeyrek enflasyonla karşılaştır.',
    },
    fiyatErimesi: {
      baslik: 'Fiyatların enflasyona eriyor',
      ozet: (kalem: string, fiyat: number, sonZam: string, erime: number, top: number, eriyen: number) =>
        `${kalem} fiyatı ${ay(sonZam)}${ek(sene(sonZam), 'den')} beri ${tl(fiyat)}; o günden bu yana enflasyon ${pct(erime)}. ${top > 5 ? `En çok satan ${top} üründen ${eriyen} tanesinde` : `${eriyen} kalemde`} aynı durum var.`,
      oneri: (ilkler: string) => `Zammı iki adımda yap: önce erimenin yarısı, üç ay sonra kalanı. İlk sıradakiler: ${ilkler}.`,
      kanitEtiket: (kalem: string, sonZam: string) => `${kalem} · son zam ${ay(sonZam)}`,
      kanitDeger: (fiyat: number, olmasi: number, adet: number) => `${tl(fiyat)} → olması gereken ${tl(olmasi)} · ayda ~${n(Math.round(adet))} adet`,
    },
    fiyatIndirim: {
      baslik: 'Çok satan ürünlerde fiyat düşmüş',
      ozet: (top: number, dusen: number, reelVar: boolean) => `En çok satan ${top} ürünün ${dusen} tanesi bugün ilk satıldığı fiyatın altında satılıyor${reelVar ? '; enflasyon da eklenince gerçek kayıp daha büyük' : ''}.`,
      oneri: 'İndirimler bilinçli mi (stok eritme, kampanya) yoksa unutulmuş mu? Bilinçli değilse eski fiyata dön; toptan ve perakende fiyatı ayrı listelerde tut.',
    },
    urunTerk: {
      baslik: 'Satışı tamamen duran ürünler',
      ozet: (k: number, pay: number) => `Önceki yıl satılıp son 12 ayda hiç satılmayan ${n(k)} ürün var; önceki yıl cironun ${yuzdeEk(pay, 'ini')} getiriyorlardı.`,
      oneri: 'Bir kısmı mevsimlik ya da bilerek kaldırılmış olabilir. İlk 10 ürüne tek tek bak: tedarik mi bitti, yoksa unutuldu mu? Kâr bırakanları geri getir.',
      kanit: (once: number) => `önceki yıl ${tl(once)}`,
    },
    urunYogunlasma: {
      baslik: 'Ciro birkaç ürüne dayanıyor',
      ozet: (k: number, pay: number) => `${n(k)} üründen en çok satan 10 tanesi cironun ${yuzdeEk(pay, 'ini')} getiriyor.`,
      oneri: 'Bu 10 ürünün tedarikini garantiye al (ikinci tedarikçi, güvenlik stoğu); fiyatlarını her ay kontrol et.',
    },
    isAdedi: {
      baslik: 'Daha az satış yapılıyor',
      ozet: (ch: number, a1: number, a2: number) => `Son 12 ayda satılan adet ${pct(-ch)} azaldı (${n(Math.round(a1))} → ${n(Math.round(a2))}).`,
      oneri: 'Düzenli müşterilere hatırlatma gönder; en çok satan ürünlerin stokta olduğundan emin ol.',
    },
    mevsim: {
      baslik: 'Yılın parasının büyük kısmı üç ayda geliyor',
      ozet: (pay: number, guclu: number[], zayif: number[]) => `Son 12 ayın cirosunun ${yuzdeEk(pay, 'i')} ${guclu.map(ayAdi).join(', ')} aylarında geldi. En zayıf aylar: ${zayif.map(ayAdi).join(', ')}.`,
      oneri: 'Güçlü aylarda gelirin bir kısmını zayıf aylar için ayır; stok alımını ve izinleri bu takvime göre planla.',
    },
    giderMalzeme: {
      baslik: 'Malzeme maliyeti enflasyondan hızlı artıyor',
      ozet: (ch: number, reelVar: boolean) => `Satılan her birim için malzeme maliyeti${reelVar ? ' bugünün parasıyla' : ''} ${pct(ch)} arttı.`,
      oneri: 'Toptancıdan toplu alım ve ikinci bir tedarikçi teklifi iste; en çok harcanan üç kalemi karşılaştır.',
    },
    giderArtis: {
      baslik: (k: number, ilk: string) => (k === 1 ? `${kategori(ilk)} enflasyondan hızlı artıyor` : `${k} gider kalemi enflasyondan hızlı artıyor`),
      ozet: (k: number, reelVar: boolean, fark: number) => `${k} gider kalemi${reelVar ? ' enflasyondan arındırılmış olarak' : ''} %15'ten fazla arttı; toplam fark yılda ${tl(fark)}.`,
      oneri: 'İlk üç kalem için sebebi bul: fiyat mı arttı, miktar mı? Fiyatsa yeni teklif al; miktarsa kullanımı gözden geçir.',
    },
    pos: {
      baslik: 'Kart komisyonu sessizce arttı',
      ozet: (r1: number, r2: number) => `POS komisyon oranı ${pct1(r1)} → ${pct1(r2)}. Kartla ödeme payı da büyüdüğü için bu kalem hızla şişiyor.`,
      oneri: 'Bankandan oranı yazılı iste; iki farklı bankadan teklif al. %2,2 pazarlıkla ulaşılabilir bir hedef.',
    },
    abonelik: {
      baslik: 'Abonelik gideri büyüdü',
      ozet: (ch: number, reelVar: boolean, yeni: string[]) =>
        `Abonelikler${reelVar ? ' bugünün parasıyla' : ''} ${pct(ch)} arttı.${yeni.length ? ` Yeni eklenen: ${yeni.slice(0, 3).join(', ')}${yeni.length > 3 ? ` ve ${yeni.length - 3} tane daha` : ''}.` : ''}`,
      oneri: (ilk: string | null) => `Kullanılmayan aboneliği iptal et${ilk ? ` (${ilk})` : ''}.`,
    },
    tedarikci: {
      baslik: 'Giderler birkaç tedarikçide toplanıyor',
      ozet: (ayS: number, k: number, top5: number, ilk: number) => `Son ${ayS} ayda ${n(k)} tedarikçiye ödeme yapıldı; ilk 5'i giderlerin ${yuzdeEk(top5, 'ini')}, en büyüğü tek başına ${yuzdeEk(ilk, 'ini')} alıyor.`,
      oneri: 'En büyük beş tedarikçi için sözleşme bitiş tarihlerini ve fiyat maddelerini çıkar; her biri için en az bir alternatif teklif al.',
    },
    mukerrer: {
      baslik: 'Kontrol edilmesi gereken olası mükerrer ödemeler',
      ozet: (k: number, fazla: number) => `Aynı gün, aynı tedarikçiye, aynı açıklamayla, kuruşu kuruşuna aynı tutarda birden fazla ödeme: ${n(k)} grup, fazladan ödenmiş olabilecek toplam ${tl(fazla)}.`,
      oneri: 'Bir kısmı meşru olabilir (taksit, aynı gün birden çok fatura). En büyük 10 grubu faturalarla karşılaştır; hatalı olanlar için tedarikçiden iade iste.',
    },
    nakitTakvimi: {
      baslik: 'Kasanın sıkıştığı aylar belli',
      ozet: (aylar: number[]) => `Geçmiş yıllarda ${aylar.map(ayAdi).join(', ')} aylarında giren para, çıkanı karşılamadı.`,
      oneri: (haftalik: number) => `Diğer aylarda her hafta ${tl(haftalik)} kenara ayır; bu aylar geldiğinde kasa açık vermez.`,
      kanit: (net: number, reelVar: boolean) => `${tl(net)} (ortalama${reelVar ? ', bugünün parasıyla' : ''})`,
    },
    cekis: {
      baslik: 'Kasadan kazandığından fazlasını çekiyorsun',
      ozet: (kar: number, cekis: number, tepe: string, fark: number) =>
        `Son 3 ayda işletme ayda ortalama ${tl(kar)} kazandı, ${tl(cekis)} çekildi. Kasa ${ay(tepe)}${ek(sene(tepe), 'den')} bu yana ${tl(fark)} azaldı.`,
      oneri: (maas: number) => `Kendine sabit bir maaş belirle: ayda ${tl(maas)}. Fazlası kasada kalsın; zam ve geri çağırma işe yarayınca maaşını yükseltirsin.`,
    },
    nakitOmru: {
      baslik: 'Kasa bir aydan kısa dayanır',
      ozet: (kasa: number, gun: number) => `Bugün kasada ${tl(kasa)} var. Hiç gelir olmasa sabit giderler ve çekilen parayla ${gun} gün dayanır.`,
      oneri: 'Hedef en az 60 gün: altı ay boyunca her ay bir miktar kenara ayır.',
    },
    musteriKaybi: {
      baslik: (k: number) => `${k} düzenli müşteri gelmeyi bıraktı`,
      ozet: (aralik: number, aylik: number) =>
        `Bu müşteriler her ${aralik} günde bir gelirdi; şimdi her biri olağan aralığının bir buçuk katından uzun süredir uğramıyor. Gelmeye devam etselerdi ayda yaklaşık ${tl(aylik)} getirirlerdi.`,
      oneri: 'Bu hafta listedekilere kısa bir "sizi özledik" mesajı gönder (yalnızca mesaj izni olanlara). Dönenleri ve dönmeyenleri gelecek ay yeniden bakarız.',
      kanit: (aralik: number, gecen: number) => `her ${aralik} günde bir · ${gecen} gündür yok`,
    },
    randevuKaybi: {
      baslik: (oran: number) => `Randevuların ${yuzdeEk(oran, 'i')} boşa gidiyor`,
      ozet: (k: number, gelmedi: number, iptal: number, aylik: number | null) =>
        `Son 90 günde ${k} randevudan ${gelmedi} tanesine müşteri gelmedi, ${iptal} tanesi müşteri tarafından iptal edildi.${aylik ? ` Ortalama sepetle ayda yaklaşık ${tl(aylik)}.` : ''}`,
      oneri: 'Randevudan bir gün önce ve birkaç saat önce hatırlatma gönder. Sık gelmeyenlerden kapora almayı düşün.',
    },
    yillikDusus: {
      baslik: 'Satışlar yıllardır düşüyor',
      ozet: (y1: string, y2: string, nomDus: number, reelDus: number | null, hepsi: boolean, k: number, dusen: number, cagr: number) =>
        `${y1}${ek(Number(y1), 'den')} ${y2}${ek(Number(y2), 'e')} satışlar ${pct(nomDus)} azaldı${reelDus !== null ? `; enflasyondan arındırınca ${pct(reelDus)}` : ''}. ${hepsi ? `${k} yılın hepsinde` : `${k} yıldan ${dusen} tanesinde`} düşüş var; yılda ortalama ${pct(cagr)} küçülme.`,
      oneri: 'Küçülen bir satış hacminde sabit giderler aynı hızda küçülmezse zarar kaçınılmazdır. Mağaza, kadro ve kira yapısı satışla birlikte küçültülmeli.',
    },
    brutMarj: {
      baslik: 'Brüt kâr marjı daralıyor',
      ozet: (m1: number, m2: number) => `Satılan malın maliyeti düşüldükten sonra kalan pay ${pct1(m1)} → ${pct1(m2)}. Her 100 birimlik satıştan ${n((m1 - m2) * 100, 1)} birim daha az kalıyor.`,
      oneri: 'Fiyat, indirim ve ürün karışımını incele: marjı düşük ürünler satışın içinde büyüyor mu, alış fiyatları satışa yansıtılıyor mu?',
    },
    genelOran: {
      baslik: 'Genel giderler satıştan yavaş küçülüyor',
      ozet: (o1: number, o2: number, satisDus: number, genelDus: number) => `Genel giderlerin satışa oranı ${pct1(o1)} → ${pct1(o2)}. Satış ${pct(satisDus)} düşerken genel giderler ${pct(genelDus)} düştü.`,
      oneri: 'Sabit giderlerin hangi kısmı satışla birlikte küçülebilir (kira, şube, kadro)? Satışın taşıyamayacağı yapıyı erken küçült.',
    },
    faizYuku: {
      baslik: 'Faiz yükü katlanıyor',
      ozet: (f1: number, f2: number, r1: number, r2: number, reelVar: boolean) => `Faiz gideri${reelVar ? ' (gerçek)' : ''} ${tl(f1)} → ${tl(f2)}; satışa oranı ${pct1(r1)} → ${pct1(r2)}.`,
      oneri: 'Borç, işletmenin ürettiği nakitten hızlı büyüyor. Yeni borçla eski borcu kapatmak yerine borcu küçültme planı gerekiyor.',
    },
    faaliyetZarari: {
      baslik: 'Ana faaliyet zarar ediyor',
      ozet: (yillar: string[]) => `Satıştan malın maliyeti ve genel giderler düşülünce ${yillar.join(', ')} yıllarında zarar var. Faiz bunun üstüne eklenir.`,
      oneri: 'Zarar eden birimleri (şube, ürün grubu) ayrı ayrı çıkar; nakit yakan yapıları kapatmak, satışı büyütmeye çalışmaktan hızlı sonuç verir.',
    },
    // The agent's cash notes (the forecast from the bank balance).
    nakit: {
      bugunKasada: 'Bugün kasada',
      gunlukOrtalama: 'Günlük ortalama (son 8 hafta)',
      sabitEtiket: (karsi: string, gun: number) => `${karsi} · her ayın ${gun}${ek(gun, 'i')}`,
      eksiBaslik: (iso: string) => `Bu gidişle ${b.gunAy(iso)} günü kasa eksiye düşer`,
      eksiOzet: (kasa: number, sebep: string | null, enDusukIso: string, enDusuk: number) =>
        `Bugün kasada ${tl(kasa)} var.${sebep ? ` O gün ${sebep} ödemesi çıkıyor.` : ''} Önümüzdeki 4 haftanın en düşük noktası ${b.gunAy(enDusukIso)}: ${tl(enDusuk)}.`,
      eksiOneri: 'Ödemeden önce bekleyen tahsilatları iste, ertelenebilecek bir ödemeyi kaydır ya da o hafta için kısa vadeli bir tampon ayarla.',
      eksiGorev: (iso: string) => `Tahsilatları iste: ${b.gunAy(iso)} kasa sıkışıyor`,
      inceBaslikBugun: 'Kasada aylık sabit ödemelerin dörtte birinden az para var',
      inceBaslik: (iso: string, tutar: number) => `Kasa ${b.gunAy(iso)} civarı ${tl(tutar)}${ek(Math.round(tutar), 'e')} kadar iner`,
      inceOzetBugun: (kasa: number, sabit: number) => `Bugün kasada ${tl(kasa)} var; her ay ${tl(sabit)} sabit ödeme çıkıyor. Önümüzdeki 4 hafta eksiye düşmüyor ama tampon ince.`,
      inceOzet: (sebep: string | null) => `Eksiye düşmüyor ama sabit ödemelerin dörtte birinin altına iniyor.${sebep ? ` Sebep: ${sebep} ödemesi.` : ''}`,
      inceOneriBugun: 'Her hafta küçük bir miktarı kenara ayır; hedef bir aylık sabit ödeme kadar tampon.',
      inceOneri: 'O haftaya denk gelen büyük alımları sonraya bırak.',
    },
    rapor: {
      baslik: 'İşletme Röntgeni',
      kayit: (k: number) => `${n(k)} kayıt`,
      ayda: 'Ayda',
      yilda: 'Yılda',
      geriKazan: (birimAy: boolean) => `${birimAy ? 'Ayda' : 'Yılda'} geri kazanılabilecek para`,
      geriKazanAlt: (k: number, fiyatAyi: string | null) => `Aşağıdaki ${k} düzeltmenin toplamı.${fiyatAyi ? ` Tutarlar ${ay(fiyatAyi)} parasıyla.` : ''}`,
      enOnemli: 'En önemli bulgu',
      sorunYok: 'Belirgin bir sorun bulunmadı',
      aylikGelir: 'Aylık gelir',
      tamAyOrt: (k: number) => `tam ${k} ayın ortalaması`,
      gercekBuyume: 'Gerçek büyüme',
      buyume: 'Büyüme',
      gorunen: (s: string) => `görünen ${s}`,
      son12ay: 'son 12 ay',
      toplamGelir: 'Toplam gelir',
      toplamGider: 'Toplam gider',
      aySayisi: (k: number, birimAy: boolean) => `${k} ${birimAy ? 'ay' : 'kayıt ayı'}`,
      kasa: 'Kasa',
      dayanir: (g: number) => `${g} gün dayanır`,
      basabas: 'Başabaş',
      basabasGun: (g: number) => `ayın ${g}. gününde`,
      enBuyukGider: 'En büyük gider',
      giderPay: (p: number) => `giderlerin ${yuzdeEk(p, 'i')}`,
      ciddiyet: { yuksek: 'Acil', orta: 'Önemli', bilgi: 'Not' },
      acil: (k: number) => `${k} acil bulgu`,
      grafikEtiket: 'Aylık ciro: o günkü fiyatlarla ve bugünün parasıyla',
      eksikAy: 'eksik ay',
      bin: 'b',
      milyon: 'm',
      milyar: 'mr',
      lejantReel: (gelirli: boolean) => `${gelirli ? 'Gelir' : 'Gider'}, bugünün parasıyla`,
      lejantNom: 'O günkü fiyatlarla',
      lejantTek: (gelirli: boolean) => `${gelirli ? 'Gelir' : 'Gider'} (o günkü fiyatlarla)`,
      bulgular: 'Bulgular ve yapılacaklar',
      fark: (birimAy: boolean) => `/ ${birimAy ? 'ay' : 'yıl'} fark`,
      yapilacak: 'Yapılacak',
      yapilamayanlar: 'Bu veriyle yapılamayanlar',
      nasil: 'Nasıl hesaplandı.',
      nasilMetin: (kaynak: string | null, fiyatAyi: string) =>
        `Bütün rakamlar işletmenin kendi kayıtlarından hesaplandı; yapay zekâ rakam üretmedi. ${kaynak ? `Enflasyon düzeltmesi: ${kaynak}. "Bugünün parası", her ayın tutarının ${ay(fiyatAyi)} fiyatlarına çevrilmiş hâlidir.` : 'Enflasyon düzeltmesi yapılmadı.'}`,
      veri: 'Veri.',
      veriMetin: (satir: number, okunan: number, atlanan: number, eksik: string) =>
        `${n(satir)} satır okundu, ${n(okunan)} kayıt alındı${atlanan ? `, ${n(atlanan)} satır okunamadı` : ''}${eksik}.`,
      eksikAylar: (xs: string[]) => (xs.length ? `; kaydı olmayan aylar: ${xs.length > 6 ? `${xs.length} ay` : xs.join(', ')}` : '; eksik ay yok'),
      uyari: 'Bu rapor bir ön teşhistir; vergi ve hukuki konular için mali müşavirinize danışın.',
    },
  };
}

function en(b: Bicim): Texts {
  const { n, tl, pct, pct1, ay, ayAdi, liste, kategori } = b;
  const updown = (f: number) => (f >= 0 ? `rose ${pct(f)}` : `fell ${pct(-f)}`);
  const s = (k: number, one: string, many: string) => (k === 1 ? one : many);
  return {
    yapilamayan: {
      baskaPara: (k: number) => `${n(k)} records in another currency were kept apart.`,
      enflasyonKapsamaz: (kaynak: string) => `The inflation series (${b.kaynak(kaynak)}) does not cover this period; amounts are at the prices of the day.`,
      enflasyonYok: (para: string) => `No official inflation series for ${para} yet; amounts are at the prices of the day.`,
      gelirYok: 'No income records: sales, price, break-even and profit findings could not run.',
      giderYok: 'No expense records: cost, break-even and cash-calendar findings could not run.',
      sadecePos: 'All expenses are card processing fees: connect the bank account or accounting software for rent, payroll and supplies; break-even and the cash calendar need them.',
      kasaYok: 'No cash or bank balance given: cash runway was not worked out.',
      cekisYok: 'Owner draws are not recorded separately: "you take out more than you make" could not be tested.',
      eksikSonAy: (m: string, gun: number) => `${ay(m)} is incomplete (last record: ${ayAdi(Number(m.slice(5)))} ${gun}); left out of comparisons.`,
      kisaVeri: 'Less than 24 months of data: no year-on-year comparisons.',
      buyumeYok: 'Income records do not cover both years: yearly growth was not worked out.',
      erimeYok: 'No inflation series, so price erosion was not worked out.',
      yatirim: (k: number) => `${k} investment and loan-principal lines (construction, vehicles, systems, bonds) were left out of cost growth; they are investment decisions, not waste.`,
      sabitDegisken: 'Expenses could not be split into fixed and variable (categories need matching): break-even was not worked out.',
      yillik: 'Yearly summary data: monthly seasonality, price, customer and supplier findings need transaction-level records.',
      musteriYok: 'Most income records have no customer: lapsed-customer tracking could not run.',
      randevuYok: 'No appointment records: the no-show rate was not worked out.',
    },
    etiket: {
      fiyatAyi: (m: string) => ` (in ${ay(m)} money)`,
      onceki12: 'Previous 12 months',
      son12: 'Last 12 months',
      onceki12Nom: 'Previous 12 months (prices of the day)',
      son12Nom: 'Last 12 months (prices of the day)',
      adet: 'Units sold (previous → last)',
      onceki12Adet: 'Units, previous 12 months',
      son12Adet: 'Units, last 12 months',
      onceki12Birim: 'Previous 12 months (per unit)',
      son12Birim: 'Last 12 months (per unit)',
      onceki12Oran: 'Rate, previous 12 months',
      son12Oran: 'Rate, last 12 months',
      kartAylik: 'Monthly card sales (last 3 months)',
      karAylik: 'Monthly profit (last 3 months)',
      cekisAylik: 'Monthly draws (last 3 months)',
      kasaAy: (m: string) => `Cash · ${ay(m)}`,
      kasa: 'Cash',
      sabitAylik: 'Monthly fixed costs',
      randevu90: 'Appointments (last 90 days)',
      gelmedi: 'No-shows',
      musteriIptal: 'Cancelled by the client',
    },
    reelBuyume: {
      baslik: (reelVar: boolean, kucul: boolean, nominalArti: boolean) =>
        reelVar ? (kucul ? (nominalArti ? 'Sales look like they grow, but really shrink' : 'Sales are shrinking') : 'Sales grow faster than inflation') : kucul ? 'Sales are shrinking' : 'Sales are growing',
      ozet: (nom: number, reel: number, reelVar: boolean, ayrim: { adet: number; fiyat: number } | null) =>
        `Over the last 12 months sales ${updown(nom)}` +
        (reelVar ? `; adjusted for inflation they ${reel < 0 ? `shrank ${pct(-reel)}` : `grew ${pct(reel)}`}.` : '.') +
        (ayrim ? ` Units sold ${updown(ayrim.adet)}; income per unit${reelVar ? ' (real)' : ''} ${updown(ayrim.fiyat)}.` : ''),
      oneriAdet: 'The drop comes mainly from selling less: look at lost customers and dropped products in the findings below.',
      oneriFiyat: 'The drop comes mainly from price: compare your price list with inflation and competitors.',
      oneriBuyu: 'To keep this pace, check prices against inflation every quarter.',
    },
    fiyatErimesi: {
      baslik: 'Inflation is eating your prices',
      ozet: (kalem: string, fiyat: number, sonZam: string, erime: number, top: number, eriyen: number) =>
        `${kalem} has cost ${tl(fiyat)} since ${ay(sonZam)}; inflation since then is ${pct(erime)}. ${top > 5 ? `${eriyen} of your ${top} best sellers` : `${eriyen} ${s(eriyen, 'item', 'items')}`} ${s(eriyen, 'is', 'are')} in the same spot.`,
      oneri: (ilkler: string) => `Raise in two steps: half the erosion now, the rest in three months. First in line: ${ilkler}.`,
      kanitEtiket: (kalem: string, sonZam: string) => `${kalem} · last raise ${ay(sonZam)}`,
      kanitDeger: (fiyat: number, olmasi: number, adet: number) => `${tl(fiyat)} → should be ${tl(olmasi)} · ~${n(Math.round(adet))} a month`,
    },
    fiyatIndirim: {
      baslik: 'Best sellers now sell for less',
      ozet: (top: number, dusen: number, reelVar: boolean) => `${dusen} of your ${top} best sellers now sell below their first price${reelVar ? '; with inflation the real loss is bigger' : ''}.`,
      oneri: 'Are the discounts deliberate (clearing stock, a promotion) or forgotten? If not deliberate, go back to the old price; keep wholesale and retail prices on separate lists.',
    },
    urunTerk: {
      baslik: 'Products that stopped selling',
      ozet: (k: number, pay: number) => `${n(k)} ${s(k, 'product', 'products')} sold the year before and not once in the last 12 months; they brought in ${pct(pay)} of sales.`,
      oneri: 'Some may be seasonal or dropped on purpose. Look at the top 10 one by one: did supply run out, or were they forgotten? Bring back the profitable ones.',
      kanit: (once: number) => `${tl(once)} the year before`,
    },
    urunYogunlasma: {
      baslik: 'Sales depend on a few products',
      ozet: (k: number, pay: number) => `Of ${n(k)} products, the top 10 bring in ${pct(pay)} of sales.`,
      oneri: 'Secure supply for these 10 (a second supplier, safety stock); check their prices every month.',
    },
    isAdedi: {
      baslik: 'You are selling less',
      ozet: (ch: number, a1: number, a2: number) => `Units sold fell ${pct(-ch)} over the last 12 months (${n(Math.round(a1))} → ${n(Math.round(a2))}).`,
      oneri: 'Send regulars a reminder; make sure your best sellers are in stock.',
    },
    mevsim: {
      baslik: 'Most of the year’s money comes in three months',
      ozet: (pay: number, guclu: number[], zayif: number[]) => `${pct(pay)} of the last 12 months’ sales came in ${liste(guclu.map(ayAdi))}. The weakest months: ${liste(zayif.map(ayAdi))}.`,
      oneri: 'Put part of the strong months’ income aside for the weak ones; plan stock and time off around this calendar.',
    },
    giderMalzeme: {
      baslik: 'Supply costs grow faster than inflation',
      ozet: (ch: number, reelVar: boolean) => `Supplies per unit sold rose ${pct(ch)}${reelVar ? ' in today’s money' : ''}.`,
      oneri: 'Ask your wholesaler for a bulk price and get a second supplier’s quote; compare the three biggest lines.',
    },
    giderArtis: {
      baslik: (k: number, ilk: string) => (k === 1 ? `${kategori(ilk)} grows faster than inflation` : `${k} cost lines grow faster than inflation`),
      ozet: (k: number, reelVar: boolean, fark: number) => `${k} cost ${s(k, 'line', 'lines')} rose more than 15%${reelVar ? ' after inflation' : ''}; ${tl(fark)} more a year in total.`,
      oneri: 'For the top three, find out why: higher price or more use? If price, get new quotes; if use, review it.',
    },
    pos: {
      baslik: 'Card fees crept up',
      ozet: (r1: number, r2: number) => `Card processing rate ${pct1(r1)} → ${pct1(r2)}. With more customers paying by card, this line grows fast.`,
      oneri: 'Ask your processor for the rate in writing and get two competing quotes. 2.2% is a reachable target.',
    },
    abonelik: {
      baslik: 'Subscriptions grew',
      ozet: (ch: number, reelVar: boolean, yeni: string[]) =>
        `Subscriptions rose ${pct(ch)}${reelVar ? ' in today’s money' : ''}.${yeni.length ? ` New: ${yeni.slice(0, 3).join(', ')}${yeni.length > 3 ? ` and ${yeni.length - 3} more` : ''}.` : ''}`,
      oneri: (ilk: string | null) => `Cancel what you don’t use${ilk ? ` (${ilk})` : ''}.`,
    },
    tedarikci: {
      baslik: 'Spending is concentrated on a few suppliers',
      ozet: (ayS: number, k: number, top5: number, ilk: number) => `In the last ${ayS} months you paid ${n(k)} suppliers; the top 5 take ${pct(top5)} of spending and the largest alone ${pct(ilk)}.`,
      oneri: 'List contract end dates and price terms for your five biggest suppliers; get at least one alternative quote for each.',
    },
    mukerrer: {
      baslik: 'Possible duplicate payments to check',
      ozet: (k: number, fazla: number) => `More than one payment on the same day, to the same supplier, with the same description and the exact same amount: ${n(k)} ${s(k, 'group', 'groups')}, up to ${tl(fazla)} possibly paid twice.`,
      oneri: 'Some may be legitimate (instalments, several invoices on one day). Check the 10 largest groups against invoices; ask for refunds on mistakes.',
    },
    nakitTakvimi: {
      baslik: 'You know which months are tight',
      ozet: (aylar: number[]) => `In past years, money coming in did not cover money going out in ${liste(aylar.map(ayAdi))}.`,
      oneri: (haftalik: number) => `In the other months put ${tl(haftalik)} aside every week, so the till doesn’t run short when these months come.`,
      kanit: (net: number, reelVar: boolean) => `${tl(net)} (average${reelVar ? ', today’s money' : ''})`,
    },
    cekis: {
      baslik: 'You take out more than the business makes',
      ozet: (kar: number, cekis: number, tepe: string, fark: number) => `Over the last 3 months the business made ${tl(kar)} a month and ${tl(cekis)} was taken out. Cash is down ${tl(fark)} since ${ay(tepe)}.`,
      oneri: (maas: number) => `Pay yourself a fixed amount: ${tl(maas)} a month. Leave the rest in the business; raise it once prices and win-backs pay off.`,
    },
    nakitOmru: {
      baslik: 'Cash lasts less than a month',
      ozet: (kasa: number, gun: number) => `There is ${tl(kasa)} in the bank today. With no income at all, fixed costs and draws would use it up in ${gun} ${s(gun, 'day', 'days')}.`,
      oneri: 'Aim for at least 60 days: put a little aside every month for six months.',
    },
    musteriKaybi: {
      baslik: (k: number) => `${k} regular ${s(k, 'client', 'clients')} stopped coming`,
      ozet: (aralik: number, aylik: number) =>
        `These clients came every ${aralik} days; each has now been away more than one and a half times their usual gap. Had they kept coming they would bring in about ${tl(aylik)} a month.`,
      oneri: 'This week send them a short “we miss you” message (only those who agreed to messages). We’ll look again next month at who came back.',
      kanit: (aralik: number, gecen: number) => `every ${aralik} days · away ${gecen} ${s(gecen, 'day', 'days')}`,
    },
    randevuKaybi: {
      baslik: (oran: number) => `${pct(oran)} of appointments go to waste`,
      ozet: (k: number, gelmedi: number, iptal: number, aylik: number | null) =>
        `In the last 90 days ${gelmedi} of ${k} appointments were no-shows and ${iptal} were cancelled by the client.${aylik ? ` At the average ticket that is about ${tl(aylik)} a month.` : ''}`,
      oneri: 'Send a reminder a day before and a few hours before. Consider a deposit for frequent no-shows.',
    },
    yillikDusus: {
      baslik: 'Sales have fallen for years',
      ozet: (y1: string, y2: string, nomDus: number, reelDus: number | null, hepsi: boolean, k: number, dusen: number, cagr: number) =>
        `From ${y1} to ${y2} sales fell ${pct(nomDus)}${reelDus !== null ? `; ${pct(reelDus)} after inflation` : ''}. ${hepsi ? `They fell in all ${k} years` : `They fell in ${dusen} of ${k} years`}; ${pct(cagr)} a year on average.`,
      oneri: 'When sales shrink and fixed costs don’t shrink with them, losses follow. Stores, staff and rent need to shrink with sales.',
    },
    brutMarj: {
      baslik: 'Gross margin is narrowing',
      ozet: (m1: number, m2: number) => `What is left after the cost of goods: ${pct1(m1)} → ${pct1(m2)}. Every 100 of sales now leaves ${n((m1 - m2) * 100, 1)} less.`,
      oneri: 'Look at prices, discounts and product mix: are low-margin products growing, are cost increases passed on?',
    },
    genelOran: {
      baslik: 'Overheads shrink slower than sales',
      ozet: (o1: number, o2: number, satisDus: number, genelDus: number) => `Overheads as a share of sales ${pct1(o1)} → ${pct1(o2)}. Sales fell ${pct(satisDus)} while overheads fell ${pct(genelDus)}.`,
      oneri: 'Which fixed costs can shrink with sales (rent, branches, staff)? Cut what sales can no longer carry, early.',
    },
    faizYuku: {
      baslik: 'Interest is piling up',
      ozet: (f1: number, f2: number, r1: number, r2: number, reelVar: boolean) => `Interest${reelVar ? ' (real)' : ''} ${tl(f1)} → ${tl(f2)}; as a share of sales ${pct1(r1)} → ${pct1(r2)}.`,
      oneri: 'Debt grows faster than the cash the business makes. Instead of paying old debt with new, it needs a plan to bring it down.',
    },
    faaliyetZarari: {
      baslik: 'The core business loses money',
      ozet: (yillar: string[]) => `After the cost of goods and overheads, ${liste(yillar)} ${yillar.length === 1 ? 'shows' : 'show'} a loss. Interest comes on top.`,
      oneri: 'Break out the loss-making units (branches, product groups); closing what burns cash works faster than trying to grow sales.',
    },
    nakit: {
      bugunKasada: 'In the bank today',
      gunlukOrtalama: 'Daily average (last 8 weeks)',
      sabitEtiket: (karsi: string, gun: number) => `${karsi} · every month on the ${ordinal(gun)}`,
      eksiBaslik: (iso: string) => `At this pace the bank goes below zero on ${b.gunAy(iso)}`,
      eksiOzet: (kasa: number, sebep: string | null, enDusukIso: string, enDusuk: number) =>
        `There is ${tl(kasa)} in the bank today.${sebep ? ` ${sebep} is due that day.` : ''} The lowest point in the next 4 weeks is ${b.gunAy(enDusukIso)}: ${tl(enDusuk)}.`,
      eksiOneri: 'Before that payment, ask for money you are owed, move a payment that can wait, or line up a short-term cushion for that week.',
      eksiGorev: (iso: string) => `Collect what you are owed: cash is tight on ${b.gunAy(iso)}`,
      inceBaslikBugun: 'The bank holds less than a quarter of a month’s fixed payments',
      inceBaslik: (iso: string, tutar: number) => `The bank dips to about ${tl(tutar)} around ${b.gunAy(iso)}`,
      inceOzetBugun: (kasa: number, sabit: number) => `There is ${tl(kasa)} in the bank today; ${tl(sabit)} of fixed payments go out every month. It doesn’t go below zero in the next 4 weeks, but the cushion is thin.`,
      inceOzet: (sebep: string | null) => `It doesn’t go below zero, but it drops under a quarter of your fixed payments.${sebep ? ` Because of: ${sebep}.` : ''}`,
      inceOneriBugun: 'Put a small amount aside every week; aim for a cushion of one month’s fixed payments.',
      inceOneri: 'Push big purchases that fall in that week to later.',
    },
    rapor: {
      baslik: 'Business X-ray',
      kayit: (k: number) => `${n(k)} records`,
      ayda: 'A month',
      yilda: 'A year',
      geriKazan: (birimAy: boolean) => `Money to win back ${birimAy ? 'each month' : 'each year'}`,
      geriKazanAlt: (k: number, fiyatAyi: string | null) => `The total of the ${k} fixes below.${fiyatAyi ? ` Amounts in ${ay(fiyatAyi)} money.` : ''}`,
      enOnemli: 'The most important finding',
      sorunYok: 'No clear problem found',
      aylikGelir: 'Monthly income',
      tamAyOrt: (k: number) => `average of ${k} full months`,
      gercekBuyume: 'Real growth',
      buyume: 'Growth',
      gorunen: (x: string) => `${x} on paper`,
      son12ay: 'last 12 months',
      toplamGelir: 'Total income',
      toplamGider: 'Total expenses',
      aySayisi: (k: number, birimAy: boolean) => `${k} ${birimAy ? s(k, 'month', 'months') : s(k, 'month of records', 'months of records')}`,
      kasa: 'Cash',
      dayanir: (g: number) => `lasts ${g} ${s(g, 'day', 'days')}`,
      basabas: 'Break-even',
      basabasGun: (g: number) => `reached on day ${g} of the month`,
      enBuyukGider: 'Largest expense',
      giderPay: (p: number) => `${pct(p)} of expenses`,
      ciddiyet: { yuksek: 'Urgent', orta: 'Important', bilgi: 'Note' },
      acil: (k: number) => `${k} urgent`,
      grafikEtiket: 'Monthly sales: at the prices of the day and in today’s money',
      eksikAy: 'part month',
      bin: 'k',
      milyon: 'm',
      milyar: 'bn',
      lejantReel: (gelirli: boolean) => `${gelirli ? 'Income' : 'Expenses'}, today’s money`,
      lejantNom: 'Prices of the day',
      lejantTek: (gelirli: boolean) => `${gelirli ? 'Income' : 'Expenses'} (prices of the day)`,
      bulgular: 'Findings and what to do',
      fark: (birimAy: boolean) => `/ ${birimAy ? 'month' : 'year'} difference`,
      yapilacak: 'What to do',
      yapilamayanlar: 'What this data could not show',
      nasil: 'How it was worked out.',
      nasilMetin: (kaynak: string | null, fiyatAyi: string) =>
        `Every number comes from the business’s own records; no AI produced a figure. ${kaynak ? `Inflation adjustment: ${b.kaynak(kaynak)}. “Today’s money” is each month’s amount converted to ${ay(fiyatAyi)} prices.` : 'No inflation adjustment was made.'}`,
      veri: 'Data.',
      veriMetin: (satir: number, okunan: number, atlanan: number, eksik: string) =>
        `${n(satir)} rows read, ${n(okunan)} records taken${atlanan ? `, ${n(atlanan)} rows unreadable` : ''}${eksik}.`,
      eksikAylar: (xs: string[]) => (xs.length ? `; months without records: ${xs.length > 6 ? `${xs.length} months` : xs.join(', ')}` : '; no missing months'),
      uyari: 'This report is a first diagnosis; ask your accountant about tax and legal matters.',
    },
  };
}

function es(b: Bicim): Texts {
  const { n, tl, pct, pct1, ay, ayAdi, liste, kategori } = b;
  const subeBaja = (f: number) => (f >= 0 ? `subió un ${pct(f)}` : `bajó un ${pct(-f)}`);
  const subenBajan = (f: number) => (f >= 0 ? `subieron un ${pct(f)}` : `bajaron un ${pct(-f)}`);
  const s = (k: number, one: string, many: string) => (k === 1 ? one : many);
  return {
    yapilamayan: {
      baskaPara: (k: number) => `${n(k)} registros en otra moneda se dejaron aparte.`,
      enflasyonKapsamaz: (kaynak: string) => `La serie de inflación (${b.kaynak(kaynak)}) no cubre este periodo; los importes están a precios de cada momento.`,
      enflasyonYok: (para: string) => `Aún no hay serie oficial de inflación para ${para}; los importes están a precios de cada momento.`,
      gelirYok: 'No hay registros de ingresos: no se pudieron calcular ventas, precios, punto de equilibrio ni beneficio.',
      giderYok: 'No hay registros de gastos: no se pudieron calcular gastos, punto de equilibrio ni calendario de caja.',
      sadecePos: 'Todos los gastos son comisiones de tarjeta: conecta la cuenta bancaria o el programa contable para alquiler, nómina e insumos; el punto de equilibrio y el calendario de caja los necesitan.',
      kasaYok: 'No hay saldo de caja ni de banco: no se calculó cuánto dura la caja.',
      cekisYok: 'Los retiros del dueño no están registrados aparte: no se pudo comprobar si se retira más de lo que se gana.',
      eksikSonAy: (m: string, gun: number) => `${ay(m)} está incompleto (último registro: ${gun} de ${ayAdi(Number(m.slice(5)))}); no entra en las comparaciones.`,
      kisaVeri: 'Menos de 24 meses de datos: sin comparaciones anuales.',
      buyumeYok: 'Los ingresos no cubren los dos años: no se calculó el crecimiento anual.',
      erimeYok: 'Sin serie de inflación no se calculó la erosión de precios.',
      yatirim: (k: number) => `${k} partidas de inversión y amortización de deuda (obras, vehículos, sistemas, bonos) quedaron fuera del análisis de aumento de gastos; son decisiones de inversión, no derroche.`,
      sabitDegisken: 'No se pudieron separar gastos fijos y variables (faltan categorías): no se calculó el punto de equilibrio.',
      yillik: 'Datos de resumen anual: la estacionalidad, los precios, los clientes y los proveedores necesitan registros por operación.',
      musteriYok: 'La mayoría de los ingresos no tienen cliente: no se pudo seguir a los clientes perdidos.',
      randevuYok: 'No hay registros de citas: no se calculó la tasa de inasistencia.',
    },
    etiket: {
      fiyatAyi: (m: string) => ` (en dinero de ${ay(m)})`,
      onceki12: '12 meses anteriores',
      son12: 'Últimos 12 meses',
      onceki12Nom: '12 meses anteriores (precios de cada momento)',
      son12Nom: 'Últimos 12 meses (precios de cada momento)',
      adet: 'Unidades vendidas (antes → ahora)',
      onceki12Adet: 'Unidades, 12 meses anteriores',
      son12Adet: 'Unidades, últimos 12 meses',
      onceki12Birim: '12 meses anteriores (por unidad)',
      son12Birim: 'Últimos 12 meses (por unidad)',
      onceki12Oran: 'Tasa, 12 meses anteriores',
      son12Oran: 'Tasa, últimos 12 meses',
      kartAylik: 'Ventas con tarjeta al mes (últimos 3 meses)',
      karAylik: 'Beneficio al mes (últimos 3 meses)',
      cekisAylik: 'Retiros al mes (últimos 3 meses)',
      kasaAy: (m: string) => `Caja · ${ay(m)}`,
      kasa: 'Caja',
      sabitAylik: 'Gastos fijos al mes',
      randevu90: 'Citas (últimos 90 días)',
      gelmedi: 'No vinieron',
      musteriIptal: 'Canceladas por el cliente',
    },
    reelBuyume: {
      baslik: (reelVar: boolean, kucul: boolean, nominalArti: boolean) =>
        reelVar ? (kucul ? (nominalArti ? 'Las ventas parecen crecer, pero en realidad bajan' : 'Las ventas bajan') : 'Las ventas crecen por encima de la inflación') : kucul ? 'Las ventas bajan' : 'Las ventas crecen',
      ozet: (nom: number, reel: number, reelVar: boolean, ayrim: { adet: number; fiyat: number } | null) =>
        `En los últimos 12 meses la facturación ${subeBaja(nom)}` +
        (reelVar ? `; descontando la inflación ${reel < 0 ? `bajó un ${pct(-reel)}` : `creció un ${pct(reel)}`}.` : '.') +
        (ayrim ? ` Las unidades vendidas ${subenBajan(ayrim.adet)}; el ingreso por unidad${reelVar ? ' (real)' : ''} ${subeBaja(ayrim.fiyat)}.` : ''),
      oneriAdet: 'La caída viene sobre todo de vender menos: revisa los clientes perdidos y los productos abandonados más abajo.',
      oneriFiyat: 'La caída viene sobre todo del precio: compara tu lista de precios con la inflación y la competencia.',
      oneriBuyu: 'Para mantener este ritmo, compara los precios con la inflación cada trimestre.',
    },
    fiyatErimesi: {
      baslik: 'La inflación se come tus precios',
      ozet: (kalem: string, fiyat: number, sonZam: string, erime: number, top: number, eriyen: number) =>
        `${kalem} cuesta ${tl(fiyat)} desde ${ay(sonZam)}; la inflación desde entonces es del ${pct(erime)}. ${top > 5 ? `${eriyen} de tus ${top} productos más vendidos están` : `${eriyen} ${s(eriyen, 'partida está', 'partidas están')}`} igual.`,
      oneri: (ilkler: string) => `Sube en dos pasos: la mitad de la erosión ahora y el resto en tres meses. Los primeros: ${ilkler}.`,
      kanitEtiket: (kalem: string, sonZam: string) => `${kalem} · última subida ${ay(sonZam)}`,
      kanitDeger: (fiyat: number, olmasi: number, adet: number) => `${tl(fiyat)} → debería ser ${tl(olmasi)} · ~${n(Math.round(adet))} al mes`,
    },
    fiyatIndirim: {
      baslik: 'Los más vendidos se venden más baratos',
      ozet: (top: number, dusen: number, reelVar: boolean) => `${dusen} de tus ${top} productos más vendidos se venden hoy por debajo de su primer precio${reelVar ? '; con la inflación la pérdida real es mayor' : ''}.`,
      oneri: '¿Los descuentos son intencionados (liquidar stock, una promoción) u olvidados? Si no lo son, vuelve al precio anterior; lleva listas separadas para mayorista y minorista.',
    },
    urunTerk: {
      baslik: 'Productos que dejaron de venderse',
      ozet: (k: number, pay: number) => `${n(k)} ${s(k, 'producto se vendió', 'productos se vendieron')} el año anterior y ni una vez en los últimos 12 meses; aportaban el ${pct(pay)} de las ventas.`,
      oneri: 'Algunos pueden ser de temporada o retirados a propósito. Revisa los 10 primeros uno por uno: ¿se acabó el suministro o se olvidaron? Recupera los rentables.',
      kanit: (once: number) => `${tl(once)} el año anterior`,
    },
    urunYogunlasma: {
      baslik: 'Las ventas dependen de pocos productos',
      ozet: (k: number, pay: number) => `De ${n(k)} productos, los 10 más vendidos aportan el ${pct(pay)} de las ventas.`,
      oneri: 'Asegura el suministro de estos 10 (un segundo proveedor, stock de seguridad); revisa sus precios cada mes.',
    },
    isAdedi: {
      baslik: 'Se vende menos',
      ozet: (ch: number, a1: number, a2: number) => `Las unidades vendidas bajaron un ${pct(-ch)} en los últimos 12 meses (${n(Math.round(a1))} → ${n(Math.round(a2))}).`,
      oneri: 'Envía recordatorios a los clientes habituales; asegúrate de tener en stock lo que más se vende.',
    },
    mevsim: {
      baslik: 'La mayor parte del dinero del año llega en tres meses',
      ozet: (pay: number, guclu: number[], zayif: number[]) => `El ${pct(pay)} de las ventas de los últimos 12 meses llegó en ${liste(guclu.map(ayAdi))}. Los meses más flojos: ${liste(zayif.map(ayAdi))}.`,
      oneri: 'Guarda parte de los ingresos de los meses fuertes para los flojos; planifica compras y vacaciones con este calendario.',
    },
    giderMalzeme: {
      baslik: 'Los insumos suben más que la inflación',
      ozet: (ch: number, reelVar: boolean) => `El coste de insumos por unidad vendida subió un ${pct(ch)}${reelVar ? ' en dinero de hoy' : ''}.`,
      oneri: 'Pide precio por volumen a tu mayorista y un presupuesto a un segundo proveedor; compara las tres partidas mayores.',
    },
    giderArtis: {
      baslik: (k: number, ilk: string) => (k === 1 ? `${kategori(ilk)} sube más que la inflación` : `${k} partidas de gasto suben más que la inflación`),
      ozet: (k: number, reelVar: boolean, fark: number) => `${k} ${s(k, 'partida subió', 'partidas subieron')} más de un ${pct(0.15)}${reelVar ? ' descontada la inflación' : ''}; ${tl(fark)} más al año en total.`,
      oneri: 'Para las tres primeras, averigua por qué: ¿más precio o más consumo? Si es precio, pide presupuestos; si es consumo, revísalo.',
    },
    pos: {
      baslik: 'La comisión de tarjeta subió sin avisar',
      ozet: (r1: number, r2: number) => `Tasa de comisión de tarjeta ${pct1(r1)} → ${pct1(r2)}. Con más pagos con tarjeta, esta partida crece rápido.`,
      oneri: `Pide la tasa por escrito y dos ofertas de la competencia. Un ${pct1(0.022)} es un objetivo alcanzable.`,
    },
    abonelik: {
      baslik: 'Las suscripciones crecieron',
      ozet: (ch: number, reelVar: boolean, yeni: string[]) =>
        `Las suscripciones subieron un ${pct(ch)}${reelVar ? ' en dinero de hoy' : ''}.${yeni.length ? ` Nuevas: ${yeni.slice(0, 3).join(', ')}${yeni.length > 3 ? ` y ${yeni.length - 3} más` : ''}.` : ''}`,
      oneri: (ilk: string | null) => `Cancela lo que no uses${ilk ? ` (${ilk})` : ''}.`,
    },
    tedarikci: {
      baslik: 'El gasto se concentra en pocos proveedores',
      ozet: (ayS: number, k: number, top5: number, ilk: number) => `En los últimos ${ayS} meses pagaste a ${n(k)} proveedores; los 5 primeros se llevan el ${pct(top5)} del gasto y el mayor, solo, el ${pct(ilk)}.`,
      oneri: 'Anota fechas de fin de contrato y condiciones de precio de los cinco mayores; pide al menos una alternativa para cada uno.',
    },
    mukerrer: {
      baslik: 'Posibles pagos duplicados que revisar',
      ozet: (k: number, fazla: number) => `Más de un pago el mismo día, al mismo proveedor, con el mismo concepto y exactamente el mismo importe: ${n(k)} ${s(k, 'grupo', 'grupos')}, hasta ${tl(fazla)} quizá pagados dos veces.`,
      oneri: 'Algunos pueden ser legítimos (plazos, varias facturas el mismo día). Compara los 10 grupos mayores con las facturas; pide devolución de los errores.',
    },
    nakitTakvimi: {
      baslik: 'Ya sabes qué meses aprietan',
      ozet: (aylar: number[]) => `En años anteriores, en ${liste(aylar.map(ayAdi))} lo que entró no cubrió lo que salió.`,
      oneri: (haftalik: number) => `En los demás meses aparta ${tl(haftalik)} cada semana, para que la caja no quede corta cuando lleguen.`,
      kanit: (net: number, reelVar: boolean) => `${tl(net)} (media${reelVar ? ', dinero de hoy' : ''})`,
    },
    cekis: {
      baslik: 'Retiras más de lo que gana el negocio',
      ozet: (kar: number, cekis: number, tepe: string, fark: number) => `En los últimos 3 meses el negocio ganó ${tl(kar)} al mes y se retiraron ${tl(cekis)}. La caja bajó ${tl(fark)} desde ${ay(tepe)}.`,
      oneri: (maas: number) => `Fíjate un sueldo: ${tl(maas)} al mes. Deja el resto en la caja; súbelo cuando funcionen las subidas de precio y la recuperación de clientes.`,
    },
    nakitOmru: {
      baslik: 'La caja dura menos de un mes',
      ozet: (kasa: number, gun: number) => `Hoy hay ${tl(kasa)} en caja. Sin ningún ingreso, los gastos fijos y los retiros la agotarían en ${gun} ${s(gun, 'día', 'días')}.`,
      oneri: 'Objetivo: al menos 60 días. Aparta algo cada mes durante seis meses.',
    },
    musteriKaybi: {
      baslik: (k: number) => `${k} ${s(k, 'cliente habitual dejó', 'clientes habituales dejaron')} de venir`,
      ozet: (aralik: number, aylik: number) =>
        `Venían cada ${aralik} días; cada uno lleva ya más de una vez y media su intervalo habitual sin aparecer. Si siguieran viniendo aportarían unos ${tl(aylik)} al mes.`,
      oneri: 'Esta semana envíales un mensaje corto de “te echamos de menos” (solo a quienes aceptaron mensajes). El mes que viene vemos quién volvió.',
      kanit: (aralik: number, gecen: number) => `cada ${aralik} días · sin venir ${gecen} días`,
    },
    randevuKaybi: {
      baslik: (oran: number) => `El ${pct(oran)} de las citas se pierde`,
      ozet: (k: number, gelmedi: number, iptal: number, aylik: number | null) =>
        `En los últimos 90 días, de ${k} citas ${gelmedi} no se presentaron y ${iptal} las canceló el cliente.${aylik ? ` Con el ticket medio son unos ${tl(aylik)} al mes.` : ''}`,
      oneri: 'Envía un recordatorio el día antes y unas horas antes. Plantéate una señal para quienes faltan a menudo.',
    },
    yillikDusus: {
      baslik: 'Las ventas llevan años bajando',
      ozet: (y1: string, y2: string, nomDus: number, reelDus: number | null, hepsi: boolean, k: number, dusen: number, cagr: number) =>
        `De ${y1} a ${y2} las ventas bajaron un ${pct(nomDus)}${reelDus !== null ? `; un ${pct(reelDus)} descontada la inflación` : ''}. ${hepsi ? `Bajaron los ${k} años` : `Bajaron ${dusen} de ${k} años`}; un ${pct(cagr)} al año de media.`,
      oneri: 'Si las ventas bajan y los gastos fijos no bajan con ellas, llegan las pérdidas. Locales, plantilla y alquileres deben ajustarse a las ventas.',
    },
    brutMarj: {
      baslik: 'El margen bruto se estrecha',
      ozet: (m1: number, m2: number) => `Lo que queda tras el coste de la mercancía: ${pct1(m1)} → ${pct1(m2)}. Cada 100 de ventas deja ahora ${n((m1 - m2) * 100, 1)} menos.`,
      oneri: 'Revisa precios, descuentos y mezcla de productos: ¿crecen los de bajo margen?, ¿se trasladan las subidas de coste?',
    },
    genelOran: {
      baslik: 'Los gastos generales bajan más despacio que las ventas',
      ozet: (o1: number, o2: number, satisDus: number, genelDus: number) => `Gastos generales sobre ventas ${pct1(o1)} → ${pct1(o2)}. Las ventas bajaron un ${pct(satisDus)} y los gastos generales un ${pct(genelDus)}.`,
      oneri: '¿Qué gastos fijos pueden bajar con las ventas (alquiler, locales, plantilla)? Reduce pronto lo que las ventas ya no sostienen.',
    },
    faizYuku: {
      baslik: 'Los intereses se disparan',
      ozet: (f1: number, f2: number, r1: number, r2: number, reelVar: boolean) => `Intereses${reelVar ? ' (reales)' : ''} ${tl(f1)} → ${tl(f2)}; sobre ventas ${pct1(r1)} → ${pct1(r2)}.`,
      oneri: 'La deuda crece más rápido que la caja que genera el negocio. Hace falta un plan para reducirla en lugar de pagar deuda con deuda.',
    },
    faaliyetZarari: {
      baslik: 'La actividad principal pierde dinero',
      ozet: (yillar: string[]) => `Tras el coste de la mercancía y los gastos generales hay pérdidas en ${liste(yillar)}. Los intereses van aparte.`,
      oneri: 'Separa las unidades con pérdidas (locales, familias de producto); cerrar lo que quema caja da resultado antes que intentar vender más.',
    },
    nakit: {
      bugunKasada: 'Hoy en el banco',
      gunlukOrtalama: 'Media diaria (últimas 8 semanas)',
      sabitEtiket: (karsi: string, gun: number) => `${karsi} · el día ${gun} de cada mes`,
      eksiBaslik: (iso: string) => `A este ritmo el banco queda en negativo el ${b.gunAy(iso)}`,
      eksiOzet: (kasa: number, sebep: string | null, enDusukIso: string, enDusuk: number) =>
        `Hoy hay ${tl(kasa)} en el banco.${sebep ? ` Ese día vence ${sebep}.` : ''} El punto más bajo de las próximas 4 semanas es el ${b.gunAy(enDusukIso)}: ${tl(enDusuk)}.`,
      eksiOneri: 'Antes de ese pago, cobra lo pendiente, aplaza un pago que pueda esperar o prepara un colchón a corto plazo para esa semana.',
      eksiGorev: (iso: string) => `Cobrar lo pendiente: la caja aprieta el ${b.gunAy(iso)}`,
      inceBaslikBugun: 'El banco tiene menos de un cuarto de los pagos fijos del mes',
      inceBaslik: (iso: string, tutar: number) => `El banco baja a unos ${tl(tutar)} hacia el ${b.gunAy(iso)}`,
      inceOzetBugun: (kasa: number, sabit: number) => `Hoy hay ${tl(kasa)} en el banco; cada mes salen ${tl(sabit)} en pagos fijos. No queda en negativo en las próximas 4 semanas, pero el colchón es fino.`,
      inceOzet: (sebep: string | null) => `No queda en negativo, pero baja de un cuarto de los pagos fijos.${sebep ? ` Por: ${sebep}.` : ''}`,
      inceOneriBugun: 'Aparta una pequeña cantidad cada semana; el objetivo es un colchón de un mes de pagos fijos.',
      inceOneri: 'Aplaza las compras grandes que caigan esa semana.',
    },
    rapor: {
      baslik: 'Radiografía del negocio',
      kayit: (k: number) => `${n(k)} registros`,
      ayda: 'Al mes',
      yilda: 'Al año',
      geriKazan: (birimAy: boolean) => `Dinero que se puede recuperar ${birimAy ? 'al mes' : 'al año'}`,
      geriKazanAlt: (k: number, fiyatAyi: string | null) => `La suma de los ${k} arreglos de abajo.${fiyatAyi ? ` Importes en dinero de ${ay(fiyatAyi)}.` : ''}`,
      enOnemli: 'El hallazgo más importante',
      sorunYok: 'No se encontró ningún problema claro',
      aylikGelir: 'Ingreso mensual',
      tamAyOrt: (k: number) => `media de ${k} meses completos`,
      gercekBuyume: 'Crecimiento real',
      buyume: 'Crecimiento',
      gorunen: (x: string) => `${x} en apariencia`,
      son12ay: 'últimos 12 meses',
      toplamGelir: 'Ingresos totales',
      toplamGider: 'Gastos totales',
      aySayisi: (k: number, birimAy: boolean) => `${k} ${birimAy ? s(k, 'mes', 'meses') : s(k, 'mes con registros', 'meses con registros')}`,
      kasa: 'Caja',
      dayanir: (g: number) => `dura ${g} ${s(g, 'día', 'días')}`,
      basabas: 'Punto de equilibrio',
      basabasGun: (g: number) => `el día ${g} del mes`,
      enBuyukGider: 'Mayor gasto',
      giderPay: (p: number) => `el ${pct(p)} de los gastos`,
      ciddiyet: { yuksek: 'Urgente', orta: 'Importante', bilgi: 'Nota' },
      acil: (k: number) => `${k} ${s(k, 'urgente', 'urgentes')}`,
      grafikEtiket: 'Ventas mensuales: a precios de cada momento y en dinero de hoy',
      eksikAy: 'mes incompleto',
      bin: 'k',
      milyon: 'M',
      milyar: 'mil M',
      lejantReel: (gelirli: boolean) => `${gelirli ? 'Ingresos' : 'Gastos'}, dinero de hoy`,
      lejantNom: 'Precios de cada momento',
      lejantTek: (gelirli: boolean) => `${gelirli ? 'Ingresos' : 'Gastos'} (precios de cada momento)`,
      bulgular: 'Hallazgos y qué hacer',
      fark: (birimAy: boolean) => `/ ${birimAy ? 'mes' : 'año'} de diferencia`,
      yapilacak: 'Qué hacer',
      yapilamayanlar: 'Lo que estos datos no permitieron ver',
      nasil: 'Cómo se calculó.',
      nasilMetin: (kaynak: string | null, fiyatAyi: string) =>
        `Todas las cifras salen de los registros del propio negocio; ninguna IA produjo cifras. ${kaynak ? `Ajuste por inflación: ${b.kaynak(kaynak)}. “Dinero de hoy” es el importe de cada mes llevado a precios de ${ay(fiyatAyi)}.` : 'No se ajustó por inflación.'}`,
      veri: 'Datos.',
      veriMetin: (satir: number, okunan: number, atlanan: number, eksik: string) =>
        `${n(satir)} filas leídas, ${n(okunan)} registros tomados${atlanan ? `, ${n(atlanan)} filas ilegibles` : ''}${eksik}.`,
      eksikAylar: (xs: string[]) => (xs.length ? `; meses sin registros: ${xs.length > 6 ? `${xs.length} meses` : xs.join(', ')}` : '; no faltan meses'),
      uyari: 'Este informe es un primer diagnóstico; consulta los temas fiscales y legales con tu gestor.',
    },
  };
}

const ordinal = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;

type Texts = ReturnType<typeof tr>;
const TEXTS: Record<Dil, (b: Bicim) => Texts> = { tr, en, es };

export const dilOf = (x: string | null | undefined): Dil => (x === 'en' || x === 'es' ? x : 'tr');
