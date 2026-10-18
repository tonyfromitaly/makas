// The one shape every source is turned into (Excel, bank statement, e-Fatura, Z report, the app itself).

export type Tur = 'gelir' | 'gider' | 'cekis';

export interface Kayit {
  tarih: string; // YYYY-MM-DD
  tur: Tur; // income, expense, or the owner taking money out (not an expense of the business)
  tutar: number; // TL, positive
  kategori: string; // hizmet, urun, bahsis · kira, elektrik, su, dogalgaz, malzeme, maas, pos, muhasebe, vergi, abonelik, diger · sahip
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
  sahip: 'Sahibin çektiği',
};

/** Costs that come every month whatever the takings; the rest move with the work done. */
export const SABIT = new Set(['kira', 'elektrik', 'su', 'dogalgaz', 'maas', 'muhasebe', 'vergi', 'abonelik']);
export const DEGISKEN = new Set(['malzeme', 'pos']);
