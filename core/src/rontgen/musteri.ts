// Findings about people rather than prices: regulars who stopped coming, and bookings that never turned
// into a visit. They need a customer on the income lines (Square, booking-system exports, the app) and,
// for the second, the bookings themselves. Without them the report says so instead of guessing.
import type { Bulgu } from './motor';
import type { Kayit } from './kayit';
import type { Metin } from './metin';

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

export function musteriBulgulari(kayitlar: Kayit[], randevular: RandevuKaydi[] | undefined, M: Metin): { bulgular: Bulgu[]; yapilamayan: string[] } {
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
    yapilamayan.push(M.yapilamayan.musteriYok);
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
        baslik: M.musteriKaybi.baslik(kayip.length),
        ozet: M.musteriKaybi.ozet(Math.round(median(kayip.map((x) => x.aralik))), aylik),
        aylikEtki: aylik,
        oneri: M.musteriKaybi.oneri,
        ciddiyet: kayip.length >= 10 ? 'yuksek' : 'orta',
        kanit: kayip.slice(0, 6).map((x) => ({ etiket: x.ad, deger: M.musteriKaybi.kanit(Math.round(x.aralik), x.gecen) })),
      });
    }
  }

  if (!randevular?.length) {
    yapilamayan.push(M.yapilamayan.randevuYok);
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
        baslik: M.randevuKaybi.baslik(oran),
        ozet: M.randevuKaybi.ozet(son90.length, gelmedi, kayipR.length - gelmedi, ortalamaSepet ? aylik : null),
        aylikEtki: aylik,
        oneri: M.randevuKaybi.oneri,
        ciddiyet: oran >= 0.15 ? 'yuksek' : 'orta',
        kanit: [
          { etiket: M.etiket.randevu90, deger: String(son90.length) },
          { etiket: M.etiket.gelmedi, deger: String(gelmedi) },
          { etiket: M.etiket.musteriIptal, deger: String(kayipR.length - gelmedi) },
        ],
      });
    }
  }
  return { bulgular, yapilamayan };
}
