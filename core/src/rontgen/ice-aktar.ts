// Reads the spreadsheets shops actually have: Turkish or English headers, ";" or "," or tab,
// "1.250,50" or "1250.50", "15.10.2023" or "2023-10-15", one amount column or borç/alacak pairs.
// Anything it cannot read is reported, never guessed.
import { fold } from '../parse/text';
import { kategoriAnahtari, type Kayit, type Tur } from './kayit';

export interface IceAktarim {
  kayitlar: Kayit[];
  rapor: {
    satir: number;
    okunan: number;
    atlanan: { satir: number; sebep: string }[];
    eslesen: Record<string, string>;
    donem: [string, string] | null;
    eksikAylar: string[];
    paraBirimleri: string[];
    iade: number;
    atlananSayi: number;
  };
}

const ALAN: Record<string, string[]> = {
  tarih: ['tarih', 'date', 'islem tarihi', 'fatura tarihi', 'fecha'],
  tur: ['tur', 'tip', 'type', 'islem turu', 'gelir gider'],
  kategori: ['kategori', 'category', 'hesap', 'gider turu', 'gelir turu'],
  kalem: ['kalem', 'hizmet', 'urun', 'urun adi', 'item', 'service', 'product', 'description'],
  adet: ['adet', 'miktar', 'qty', 'quantity'],
  birim: ['birimfiyat', 'birim fiyat', 'fiyat', 'unit price', 'unitprice', 'price'],
  karsi: ['tedarikci', 'musteri', 'cari', 'firma', 'vendor', 'vendor name', 'supplier', 'customer', 'customer id', 'karsi taraf'],
  para: ['parabirimi', 'para birimi', 'doviz', 'currency'],
  tutar: ['tutar', 'amount', 'toplam', 'tutar tl', 'tutar (tl)', 'total', 'importe'],
  borc: ['borc', 'cikan', 'debit', 'gider tutari'],
  alacak: ['alacak', 'giren', 'credit', 'gelir tutari'],
  odeme: ['odeme', 'odeme sekli', 'payment', 'odeme turu'],
  aciklama: ['aciklama', 'not', 'note', 'detay', 'memo'],
};

function splitLine(line: string, sep: string) {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') (cur += '"'), i++;
      else q = !q;
    } else if (c === sep && !q) out.push(cur), (cur = '');
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** "1.250,50" → 1250.5 · "1,250.50" → 1250.5 · "-300" → -300 · "₺300" → 300 */
export function sayi(s: string): number | null {
  let t = s.replace(/[^\d.,-]/g, '');
  if (!t || !/\d/.test(t)) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma >= 0) t = t.replace(/,/g, '');
  else if (lastDot >= 0 && /\.\d{3}$/.test(t) && !/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "15.10.2023", "15/10/2023", "2023-10-15", "15.10.23" → "2023-10-15" */
export function tarih(s: string): string | null {
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const tr = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (tr) {
    const y = tr[3].length === 2 ? `20${tr[3]}` : tr[3];
    return `${y}-${tr[2].padStart(2, '0')}-${tr[1].padStart(2, '0')}`;
  }
  return null;
}

const IADE = /iade|return|refund|devolucion/;
const turOku = (s: string): Tur | null => {
  const f = fold(s);
  if (IADE.test(f)) return 'gelir';
  if (/gelir|giris|income|alacak|satis|tahsilat|ingreso/.test(f)) return 'gelir';
  if (/cekis|sahip|ozel|withdraw|draw/.test(f)) return 'cekis';
  if (/gider|cikis|expense|borc|odeme|gasto/.test(f)) return 'gider';
  return null;
};

export function csvOku(text: string): IceAktarim {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0] ?? '';
  const sep = [';', '\t', ','].sort((a, b) => head.split(b).length - head.split(a).length)[0];
  const cols = splitLine(head, sep).map((c) => fold(c).replace(/[^a-z0-9 ()]/g, '').trim());
  const idx: Record<string, number> = {};
  const eslesen: Record<string, string> = {};
  for (const [alan, adlar] of Object.entries(ALAN)) {
    const i = cols.findIndex((c) => adlar.includes(c));
    if (i >= 0) (idx[alan] = i), (eslesen[alan] = splitLine(head, sep)[i]);
  }
  const atlanan: { satir: number; sebep: string }[] = [];
  const kayitlar: Kayit[] = [];
  let iade = 0;
  if (idx.tarih === undefined) atlanan.push({ satir: 1, sebep: 'Tarih sütunu bulunamadı' });
  if (idx.tutar === undefined && idx.borc === undefined && idx.alacak === undefined) atlanan.push({ satir: 1, sebep: 'Tutar sütunu bulunamadı' });

  for (let li = 1; li < lines.length && idx.tarih !== undefined; li++) {
    const c = splitLine(lines[li], sep);
    const t = tarih(c[idx.tarih] ?? '');
    if (!t) {
      atlanan.push({ satir: li + 1, sebep: `Tarih okunamadı: "${c[idx.tarih] ?? ''}"` });
      continue;
    }
    let tutar = idx.tutar !== undefined ? sayi(c[idx.tutar] ?? '') : null;
    let tur: Tur | null = idx.tur !== undefined ? turOku(c[idx.tur] ?? '') : null;
    if (tutar === null && (idx.borc !== undefined || idx.alacak !== undefined)) {
      const b = idx.borc !== undefined ? sayi(c[idx.borc] ?? '') : null;
      const a = idx.alacak !== undefined ? sayi(c[idx.alacak] ?? '') : null;
      if (a) (tutar = a), (tur ??= 'gelir');
      else if (b) (tutar = b), (tur ??= 'gider');
    }
    if ((tutar === null || tutar === 0) && idx.birim !== undefined && idx.adet !== undefined) {
      const b = sayi(c[idx.birim] ?? '');
      const a = sayi(c[idx.adet] ?? '');
      if (b !== null && a !== null) tutar = Math.round(a * b * 100) / 100;
    }
    if (tutar === null || tutar === 0) {
      atlanan.push({ satir: li + 1, sebep: 'Tutar okunamadı' });
      continue;
    }
    if (!tur) tur = tutar < 0 ? 'gider' : 'gelir';
    // A return (iade) is income going back: it lowers the takings.
    if (idx.tur !== undefined && IADE.test(fold(c[idx.tur] ?? ''))) tutar = -Math.abs(tutar);
    // Negative amounts on an income line are returns; they lower the takings of that month.
    if (tur === 'gelir' && tutar < 0) iade++;
    const katHam = idx.kategori !== undefined ? (c[idx.kategori] ?? '').trim() : '';
    const odeme = idx.odeme !== undefined ? fold(c[idx.odeme] ?? '') : '';
    const para = idx.para !== undefined ? (c[idx.para] ?? '').trim().toUpperCase() : '';
    kayitlar.push({
      tarih: t,
      tur,
      tutar: tur === 'gelir' ? tutar : Math.abs(tutar),
      kategori: kategoriAnahtari(katHam, tur),
      kategoriAdi: katHam || undefined,
      karsiTaraf: idx.karsi !== undefined ? (c[idx.karsi] ?? '').trim() || undefined : undefined,
      para: para || undefined,
      kalem: idx.kalem !== undefined ? c[idx.kalem] || undefined : undefined,
      adet: idx.adet !== undefined ? sayi(c[idx.adet] ?? '') ?? undefined : undefined,
      // "Bilinmiyor", "unknown" or empty: not known, and not assumed to be cash.
      odeme: /kart|card|pos|kredi/.test(odeme) ? 'kart' : /nakit|cash|efectivo/.test(odeme) ? 'nakit' : undefined,
      aciklama: idx.aciklama !== undefined ? c[idx.aciklama] || undefined : undefined,
    });
  }
  const months = [...new Set(kayitlar.map((k) => k.tarih.slice(0, 7)))].sort();
  const eksikAylar: string[] = [];
  if (months.length) {
    let [y, m] = months[0].split('-').map(Number);
    const end = months[months.length - 1];
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (key > end) break;
      if (!months.includes(key)) eksikAylar.push(key);
      m === 12 ? ((m = 1), y++) : m++;
    }
  }
  return {
    kayitlar,
    rapor: {
      satir: lines.length - 1,
      okunan: kayitlar.length,
      // Long lists of unreadable lines are summarised to their first 50.
      atlanan: atlanan.slice(0, 50),
      eslesen,
      donem: months.length ? [months[0], months[months.length - 1]] : null,
      eksikAylar,
      paraBirimleri: [...new Set(kayitlar.map((k) => k.para ?? 'TRY'))],
      iade,
      atlananSayi: atlanan.length,
    },
  };
}

/** The ledger as a Turkish spreadsheet (";" and "1.250,50"), the way most shops' exports look. */
export function csvYaz(kayitlar: Kayit[]) {
  const n = (x: number) => x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}`;
  const TUR = { gelir: 'Gelir', gider: 'Gider', cekis: 'Sahip çekişi' } as const;
  const rows = kayitlar.map((k) => [d(k.tarih), TUR[k.tur], k.kategori, k.kalem ?? '', k.adet ?? '', n(k.tutar), k.odeme === 'kart' ? 'Kart' : k.odeme === 'nakit' ? 'Nakit' : '', (k.aciklama ?? '').replace(/;/g, ',')].join(';'));
  return ['Tarih;Tür;Kategori;Kalem;Adet;Tutar;Ödeme;Açıklama', ...rows].join('\n');
}
