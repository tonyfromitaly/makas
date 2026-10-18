// The one shape every source is turned into (Excel, bank statement, e-Fatura, Z report, the app itself).

export type Tur = 'gelir' | 'gider' | 'cekis';

export interface Kayit {
  tarih: string; // YYYY-MM-DD
  tur: Tur; // income, expense, or the owner taking money out (not an expense of the business)
  tutar: number; // TL, positive
  kategori: string; // hizmet, urun, bahsis · kira, elektrik, su, dogalgaz, malzeme, maas, pos, muhasebe, vergi, abonelik, finansman, diger · sahip
  kategoriAdi?: string; // the category as written in the source ("Materials and Supplies Outside")
  karsiTaraf?: string; // supplier or customer
  para?: string; // ISO currency, TRY when absent
  kalem?: string; // service or product name
  adet?: number;
  odeme?: 'nakit' | 'kart';
  aciklama?: string;
}

export const ay = (tarih: string) => tarih.slice(0, 7);

export const KATEGORI_ADI: Record<string, string> = {
  hizmet: 'Hizmet',
  urun: 'Ürün satışı',
  bahsis: 'Bahşiş',
  kira: 'Kira',
  elektrik: 'Elektrik',
  su: 'Su',
  dogalgaz: 'Doğalgaz',
  malzeme: 'Malzeme',
  maas: 'Maaş',
  pos: 'POS komisyonu',
  muhasebe: 'Muhasebe',
  vergi: 'Vergi ve Bağ-Kur',
  abonelik: 'Abonelikler',
  diger: 'Diğer',
  satis: 'Satış',
  genel: 'Genel giderler',
  finansman: 'Faiz ve finansman',
  sahip: 'Sahibin çektiği',
};

/** Costs that come every month whatever the takings; the rest move with the work done. */
export const SABIT = new Set(['kira', 'elektrik', 'su', 'dogalgaz', 'maas', 'muhasebe', 'vergi', 'abonelik']);
export const DEGISKEN = new Set(['malzeme', 'pos']);

/** Turns a source's own category wording into ours; the original wording is kept for display. */
const ANAHTAR: [string, RegExp][] = [
  ['kira', /kira|rent|lease|alquiler/],
  ['maas', /maas|ucret|personel|salar|wage|payroll|staff|sueldo/],
  ['elektrik', /elektrik|electric|power/],
  ['su', /(^|\s)su(\s|$)|water/],
  ['dogalgaz', /dogalgaz|natural gas|(^|\s)gas(\s|$)/],
  ['pos', /(^|\s)pos(\s|$)|komisyon|card fee|merchant fee|processing fee/],
  ['muhasebe', /muhasebe|accounting|bookkeep|mali musavir/],
  ['vergi', /vergi|sgk|bag ?kur|tax|stopaj/],
  ['abonelik', /abonelik|subscription|software|lisans|license/],
  ['finansman', /faiz|interest|finansman|kredi|loan|debt service/],
  ['malzeme', /malzeme|sarf|material|suppl|cost of goods|satilan mal|cogs|inventory|stok/],
  ['genel', /genel|general|admin|sg&a|overhead/],
];
export function kategoriAnahtari(ham: string, tur: Tur): string {
  const f = ham
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]/g, ' ');
  if (tur === 'cekis') return 'sahip';
  if (tur === 'gelir') {
    if (/bahsis|tip/.test(f)) return 'bahsis';
    if (/hizmet|service/.test(f)) return 'hizmet';
    if (/urun|product|satis|sales|revenue|gelir/.test(f)) return 'satis';
    return f.trim() ? 'satis' : 'hizmet';
  }
  if (KATEGORI_ADI[f.trim()]) return f.trim();
  return ANAHTAR.find(([, r]) => r.test(f))?.[0] ?? 'diger';
}
