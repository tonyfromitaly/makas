// Findings about people rather than prices: regulars who stopped coming, and bookings that never turned
// into a visit. They need a customer on the income lines (Square, booking-system exports, the app) and,
// for the second, the bookings themselves. Without them the report says so instead of guessing.
import type { Bulgu } from './motor';
import type { Kayit } from './kayit';
import { yuzdeEk } from './ek';

export interface RandevuKaydi {
  tarih: string; // YYYY-MM-DD
  durum: 'geldi' | 'gelmedi' | 'iptal-musteri' | 'iptal-isletme' | 'bekliyor';
  musteri?: string;
}

const gun = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function musteriBulgulari(kayitlar: Kayit[], randevular: RandevuKaydi[] | undefined, tl: (n: number) => string): { bulgular: Bulgu[]; yapilamayan: string[] } {
  const bulgular: Bulgu[] = [];
  const yapilamayan: string[] = [];
  const gelir = kayitlar.filter((k) => k.tur === 'gelir' && k.tutar > 0 && k.kategori !== 'bahsis');
  const bugun = kayitlar.reduce((m, k) => (k.tarih > m ? k.tarih : m), '');

  // Visits: one per customer per day, with what they spent that day.
  const ziyaret = new Map<string, Map<string, number>>();
  for (const k of gelir) {
    if (!k.karsiTaraf) continue;
    const m = ziyaret.get(k.karsiTaraf) ?? new Map<string, number>();
    m.set(k.tarih, (m.get(k.tarih) ?? 0) + k.tutar);
    ziyaret.set(k.karsiTaraf, m);
  }
  const musteriliPay = gelir.length ? gelir.filter((k) => k.karsiTaraf).length / gelir.length : 0;
  let ortalamaSepet = 0;

  if (ziyaret.size < 10 || musteriliPay < 0.3) {
    yapilamayan.push('Gelir kayıtlarının çoğunda müşteri yok: kayıp müşteri takibi yapılamadı.');
  } else {
    const kayip: { ad: string; aralik: number; gecen: number; aylik: number }[] = [];
    let sepetTop = 0;
    let sepetN = 0;
    for (const [ad, m] of ziyaret) {
      const gunler = [...m.keys()].sort();
      for (const v of m.values()) (sepetTop += v), sepetN++;
      if (gunler.length < 3) continue;
      const aralik = median(gunler.slice(1).map((d, i) => gun(gunler[i], d)));
      if (aralik < 7 || aralik > 120) continue; // daily walk-ins and once-a-season visitors are not "regulars"
      const gecen = gun(gunler[gunler.length - 1], bugun);
      if (gecen <= Math.max(aralik * 1.5, aralik + 14) || gecen > 365) continue;
      const sepet = [...m.values()].reduce((a, b) => a + b, 0) / m.size;
      kayip.push({ ad, aralik, gecen, aylik: (sepet * 30) / aralik });
    }
    ortalamaSepet = sepetN ? sepetTop / sepetN : 0;
    kayip.sort((a, b) => b.aylik - a.aylik);
    if (kayip.length >= 3) {
      const aylik = kayip.reduce((s, x) => s + x.aylik, 0);
      bulgular.push({
        id: 'musteri-kaybi',
        toplamaDahil: false,
        baslik: `${kayip.length} düzenli müşteri gelmeyi bıraktı`,
        ozet: `Bu müşteriler her ${Math.round(median(kayip.map((x) => x.aralik)))} günde bir gelirdi; şimdi her biri olağan aralığının bir buçuk katından uzun süredir uğramıyor. Gelmeye devam etselerdi ayda yaklaşık ${tl(aylik)} getirirlerdi.`,
        aylikEtki: aylik,
        oneri: 'Bu hafta listedekilere kısa bir "sizi özledik" mesajı gönder (yalnızca mesaj izni olanlara). Dönenleri ve dönmeyenleri gelecek ay yeniden bakarız.',
        ciddiyet: kayip.length >= 10 ? 'yuksek' : 'orta',
        kanit: kayip.slice(0, 6).map((x) => ({ etiket: x.ad, deger: `her ${Math.round(x.aralik)} günde bir · ${x.gecen} gündür yok` })),
      });
    }
  }

  if (!randevular?.length) {
    yapilamayan.push('Randevu kaydı yok: gelmeyen randevu oranı hesaplanmadı.');
  } else {
    const son90 = randevular.filter((r) => r.durum !== 'bekliyor' && r.durum !== 'iptal-isletme' && gun(r.tarih, bugun || r.tarih) <= 90 && gun(r.tarih, bugun || r.tarih) >= 0);
    const kayipR = son90.filter((r) => r.durum === 'gelmedi' || r.durum === 'iptal-musteri');
    const oran = son90.length ? kayipR.length / son90.length : 0;
    if (son90.length >= 30 && oran >= 0.08) {
      const gelmedi = kayipR.filter((r) => r.durum === 'gelmedi').length;
      const aylik = (kayipR.length / 3) * ortalamaSepet;
      bulgular.push({
        id: 'randevu-kaybi',
        toplamaDahil: false,
        baslik: `Randevuların ${yuzdeEk(oran, 'i')} boşa gidiyor`,
        ozet: `Son 90 günde ${son90.length} randevudan ${gelmedi} tanesine müşteri gelmedi, ${kayipR.length - gelmedi} tanesi müşteri tarafından iptal edildi.${ortalamaSepet ? ` Ortalama sepetle ayda yaklaşık ${tl(aylik)}.` : ''}`,
        aylikEtki: aylik,
        oneri: 'Randevudan bir gün önce ve birkaç saat önce hatırlatma gönder. Sık gelmeyenlerden kapora almayı düşün.',
        ciddiyet: oran >= 0.15 ? 'yuksek' : 'orta',
        kanit: [
          { etiket: 'Randevu (son 90 gün)', deger: String(son90.length) },
          { etiket: 'Gelmedi', deger: String(gelmedi) },
          { etiket: 'Müşteri iptali', deger: String(kayipR.length - gelmedi) },
        ],
      });
    }
  }
  return { bulgular, yapilamayan };
}
