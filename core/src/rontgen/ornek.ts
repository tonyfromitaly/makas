// A believable three-year ledger for a two-chair barber shop (Oct 2023 – Sep 2026), for demos and tests.
// Deliberately planted, as real shops have them: two prices not raised for ten months, supplies getting
// dearer faster than inflation, a forgotten subscription, card fees creeping up, a thin cash cushion.
// Inflation-driven costs follow the real TÜFE series. Deterministic (seeded).
import { endeks } from './tufe';
import type { Kayit } from './kayit';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const AYLAR = (() => {
  const out: string[] = [];
  for (let y = 2023, m = 10; y < 2026 || (y === 2026 && m <= 9); m === 12 ? ((m = 1), y++) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
  return out;
})();

/** Price list changes: [from month, price]. */
const FIYAT: Record<string, [string, number][]> = {
  'Saç kesimi': [['2023-10', 200], ['2024-03', 280], ['2024-09', 350], ['2025-04', 420], ['2025-12', 450]],
  Sakal: [['2023-10', 100], ['2024-03', 140], ['2024-09', 180], ['2025-04', 220], ['2026-01', 260], ['2026-06', 300]],
  'Saç + sakal': [['2023-10', 270], ['2024-03', 380], ['2024-09', 480], ['2025-04', 580], ['2025-12', 620]],
  'Çocuk tıraşı': [['2023-10', 150], ['2024-03', 200], ['2024-09', 250], ['2025-04', 300], ['2026-02', 340]],
};
const ADET: Record<string, number> = { 'Saç kesimi': 255, Sakal: 90, 'Saç + sakal': 150, 'Çocuk tıraşı': 48 };
const BAYRAM = new Set(['2024-04', '2024-06', '2025-03', '2025-06', '2026-03', '2026-05']);

const fiyat = (kalem: string, m: string) => [...FIYAT[kalem]].reverse().find(([from]) => from <= m)![1];
const cpi = (m: string, base = '2023-10') => endeks(m) / endeks(base);

export function ornekDukkan(seed = 7): { kayitlar: Kayit[]; acilisKasa: number; ad: string } {
  const r = rng(seed);
  const out: Kayit[] = [];
  const add = (k: Kayit) => out.push({ ...k, tutar: Math.round(k.tutar * 100) / 100 });

  AYLAR.forEach((m, i) => {
    const mm = Number(m.slice(5));
    const days = new Date(Number(m.slice(0, 4)), mm, 0).getDate();
    let season = 1;
    if (BAYRAM.has(m)) season += 0.18;
    if (mm === 1) season -= 0.12;
    if (mm === 8) season -= 0.08;
    if (mm === 9) season += 0.08;
    // Demand slips in the last year: fewer regulars, nobody noticed.
    const trend = i < 24 ? 1 : 1 - (i - 23) * 0.011;
    const cardShare = 0.45 + (0.3 * i) / (AYLAR.length - 1);
    let monthServices = 0;
    let monthServiceRevenue = 0;
    let cardSales = 0;

    for (let d = 1; d <= days; d++) {
      const date = `${m}-${String(d).padStart(2, '0')}`;
      const wd = new Date(date).getDay();
      if (wd === 1) continue; // closed on Mondays
      const dayFactor = wd === 6 ? 1.5 : wd === 0 ? 0.7 : 1;
      for (const kalem of Object.keys(FIYAT)) {
        const n = Math.max(0, Math.round(((ADET[kalem] * season * trend * dayFactor) / 26) * (0.8 + r() * 0.4)));
        if (!n) continue;
        const p = fiyat(kalem, m);
        const card = Math.round(n * cardShare);
        if (card) add({ tarih: date, tur: 'gelir', kategori: 'hizmet', kalem, adet: card, tutar: card * p, odeme: 'kart' });
        if (n - card) add({ tarih: date, tur: 'gelir', kategori: 'hizmet', kalem, adet: n - card, tutar: (n - card) * p, odeme: 'nakit' });
        monthServices += n;
        monthServiceRevenue += n * p;
        cardSales += card * p;
      }
    }
    const last = `${m}-${String(days).padStart(2, '0')}`;
    const mid = `${m}-15`;
    add({ tarih: last, tur: 'gelir', kategori: 'urun', kalem: 'Wax, şampuan, kolonya', tutar: monthServiceRevenue * (0.03 + r() * 0.01), odeme: 'kart' });
    add({ tarih: last, tur: 'gelir', kategori: 'bahsis', tutar: monthServiceRevenue * 0.035, odeme: 'nakit' });

    // Rent: raised every October in line with the legal cap (twelve-month average inflation).
    const rent = m < '2024-10' ? 15000 : m < '2025-10' ? 22500 : 30400;
    add({ tarih: `${m}-01`, tur: 'gider', kategori: 'kira', tutar: rent, aciklama: 'Dükkân kirası' });
    const winter = [11, 12, 1, 2, 3].includes(mm);
    add({ tarih: `${m}-10`, tur: 'gider', kategori: 'elektrik', tutar: 1800 * cpi(m) * (winter ? 1.25 : 1) * (0.95 + r() * 0.1) });
    add({ tarih: `${m}-12`, tur: 'gider', kategori: 'su', tutar: 320 * cpi(m) * (0.9 + r() * 0.2) });
    add({ tarih: `${m}-14`, tur: 'gider', kategori: 'dogalgaz', tutar: (winter ? 2600 : 280) * cpi(m) * (0.9 + r() * 0.2) });
    // Supplies: per service, and getting dearer about 0.8% a month on top of inflation.
    add({ tarih: mid, tur: 'gider', kategori: 'malzeme', tutar: monthServices * 7.5 * cpi(m) * (1 + 0.014 * i), aciklama: 'Jilet, havlu, kolonya, şampuan' });
    // Staff wage (Emre).
    const wage = m < '2024-01' ? 13000 : m < '2024-07' ? 20000 : m < '2025-01' ? 22000 : m < '2025-07' ? 27000 : m < '2026-01' ? 29000 : 35000;
    add({ tarih: last, tur: 'gider', kategori: 'maas', tutar: wage, aciklama: 'Emre maaş' });
    // Card fees: the bank raised the rate twice.
    const rate = m < '2025-01' ? 0.024 : m < '2026-01' ? 0.027 : 0.031;
    add({ tarih: last, tur: 'gider', kategori: 'pos', tutar: cardSales * rate, aciklama: 'POS komisyonu' });
    add({ tarih: `${m}-20`, tur: 'gider', kategori: 'muhasebe', tutar: m < '2025-01' ? 2000 : m < '2026-01' ? 3000 : 4000 });
    add({ tarih: `${m}-26`, tur: 'gider', kategori: 'vergi', tutar: 5200 * cpi(m) });
    // Subscriptions: a booking app, music; in June 2025 a second booking app nobody uses.
    add({ tarih: `${m}-05`, tur: 'gider', kategori: 'abonelik', tutar: 600 * cpi(m), aciklama: 'Randevu programı' });
    add({ tarih: `${m}-05`, tur: 'gider', kategori: 'abonelik', tutar: 350, aciklama: 'Müzik' });
    if (m >= '2025-11') add({ tarih: `${m}-05`, tur: 'gider', kategori: 'abonelik', tutar: 1290, aciklama: 'İkinci randevu uygulaması' });
    add({ tarih: `${m}-22`, tur: 'gider', kategori: 'diger', tutar: 6500 * cpi(m) * (0.85 + r() * 0.3), aciklama: 'Temizlik, çay, bakım' });
    // What the owner takes home: whatever seems to be there, most months.
    add({ tarih: last, tur: 'cekis', kategori: 'sahip', tutar: 66000 * cpi(m) * (0.96 + r() * 0.08), aciklama: 'Halil eve' });
  });
  return { kayitlar: out.sort((a, b) => a.tarih.localeCompare(b.tarih)), acilisKasa: 40000, ad: 'Berber Halil' };
}
