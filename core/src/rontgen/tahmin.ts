// The cash forecast: from today's balance, the next four weeks. Two kinds of money movement:
// - fixed monthly payments (rent, a lease, a loan, payroll runs): the same payee, about the same amount,
//   in at least three of the last four months; scheduled on their usual day of the month;
// - everything else, averaged per day over the last eight weeks.
// No model, no guess beyond those two; the evidence comes with the answer.
import type { Kayit } from './kayit';

export interface SabitOdeme {
  karsi: string;
  tutar: number;
  gun: number; // day of the month
}

export interface NakitTahmini {
  bugun: string;
  kasa: number;
  gunlukNet: number;
  sabit: SabitOdeme[];
  enDusuk: { tarih: string; tutar: number; sebep?: string };
  eksiGun: { tarih: string; sebep?: string } | null;
}

const gunEkle = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function sabitOdemeler(kayitlar: Kayit[], bugun: string): SabitOdeme[] {
  const bas = gunEkle(bugun, -124); // about four months
  const by = new Map<string, Kayit[]>();
  for (const k of kayitlar) {
    if (k.tur === 'gelir' || !k.karsiTaraf || k.tarih < bas || k.tarih > bugun) continue;
    by.set(k.karsiTaraf, [...(by.get(k.karsiTaraf) ?? []), k]);
  }
  const out: SabitOdeme[] = [];
  for (const [karsi, xs] of by) {
    // One amount per month (a payroll run twice a month adds up).
    const ay = new Map<string, { t: number; gunler: number[] }>();
    for (const k of xs) {
      const m = ay.get(k.tarih.slice(0, 7)) ?? { t: 0, gunler: [] };
      m.t += k.tutar;
      m.gunler.push(Number(k.tarih.slice(8, 10)));
      ay.set(k.tarih.slice(0, 7), m);
    }
    const aylar = [...ay.values()];
    if (aylar.length < 3) continue;
    const tutarlar = aylar.map((a) => a.t);
    if (Math.max(...tutarlar) > Math.min(...tutarlar) * 1.3) continue; // not steady: part of the daily average
    out.push({ karsi, tutar: median(tutarlar), gun: Math.round(median(aylar.flatMap((a) => a.gunler))) });
  }
  return out.sort((a, b) => b.tutar - a.tutar);
}

export function nakitTahmini(kayitlar: Kayit[], kasa: number, bugun: string, gun = 28): NakitTahmini {
  const sabit = sabitOdemeler(kayitlar, bugun);
  const sabitAd = new Set(sabit.map((s) => s.karsi));
  const bas = gunEkle(bugun, -56);
  let net = 0;
  for (const k of kayitlar) {
    if (k.tarih <= bas || k.tarih > bugun) continue;
    if (k.tur !== 'gelir' && k.karsiTaraf && sabitAd.has(k.karsiTaraf)) continue;
    net += k.tur === 'gelir' ? k.tutar : -k.tutar;
  }
  const gunlukNet = net / 56;
  let bakiye = kasa;
  let enDusuk: NakitTahmini['enDusuk'] = { tarih: bugun, tutar: kasa };
  let eksiGun: NakitTahmini['eksiGun'] = null;
  for (let i = 1; i <= gun; i++) {
    const tarih = gunEkle(bugun, i);
    const ayGunu = Number(tarih.slice(8, 10));
    const sonGun = new Date(Date.UTC(Number(tarih.slice(0, 4)), Number(tarih.slice(5, 7)), 0)).getUTCDate();
    bakiye += gunlukNet;
    let sebep: string | undefined;
    for (const s of sabit) {
      // A payment due on the 31st falls on the month's last day.
      if (Math.min(s.gun, sonGun) === ayGunu) {
        bakiye -= s.tutar;
        sebep = sebep ?? s.karsi;
      }
    }
    if (bakiye < enDusuk.tutar) enDusuk = { tarih, tutar: bakiye, sebep };
    if (bakiye < 0 && !eksiGun) eksiGun = { tarih, sebep };
  }
  return { bugun, kasa, gunlukNet, sabit, enDusuk, eksiGun };
}
