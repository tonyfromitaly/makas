// Reads the spreadsheets shops actually have: Turkish or English headers, ";" or "," or tab,
// "1.250,50" or "1250.50", "15.10.2023" or "2023-10-15", one amount column or borç/alacak pairs.
// Anything it cannot read is reported, never guessed.
import { fold } from '../parse/text';
import type { Kayit, Tur } from './kayit';

export interface IceAktarim {
  kayitlar: Kayit[];
  rapor: { satir: number; okunan: number; atlanan: { satir: number; sebep: string }[]; eslesen: Record<string, string>; donem: [string, string] | null; eksikAylar: string[] };
}

const ALAN: Record<string, string[]> = {
  tarih: ['tarih', 'date', 'islem tarihi', 'fatura tarihi', 'fecha'],
  tur: ['tur', 'tip', 'type', 'islem turu', 'gelir gider'],
  kategori: ['kategori', 'category', 'hesap', 'gider turu', 'gelir turu'],
  kalem: ['kalem', 'hizmet', 'urun', 'item', 'service', 'product'],
  adet: ['adet', 'miktar', 'qty', 'quantity'],
  tutar: ['tutar', 'amount', 'toplam', 'tutar tl', 'tutar (tl)', 'total', 'importe'],
  borc: ['borc', 'cikan', 'debit', 'gider tutari'],
  alacak: ['alacak', 'giren', 'credit', 'gelir tutari'],
  odeme: ['odeme', 'odeme sekli', 'payment', 'odeme turu'],
  aciklama: ['aciklama', 'description', 'not', 'note', 'detay'],
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

const turOku = (s: string): Tur | null => {
  const f = fold(s);
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
    if (tutar === null || tutar === 0) {
      atlanan.push({ satir: li + 1, sebep: 'Tutar okunamadı' });
      continue;
    }
    if (!tur) tur = tutar < 0 ? 'gider' : 'gelir';
    const kat = idx.kategori !== undefined ? fold(c[idx.kategori] ?? '').replace(/[^a-z_]/g, '') : '';
    const odeme = idx.odeme !== undefined ? fold(c[idx.odeme] ?? '') : '';
    kayitlar.push({
      tarih: t,
      tur,
      tutar: Math.abs(tutar),
      kategori: kat || (tur === 'gelir' ? 'hizmet' : 'diger'),
      kalem: idx.kalem !== undefined ? c[idx.kalem] || undefined : undefined,
      adet: idx.adet !== undefined ? sayi(c[idx.adet] ?? '') ?? undefined : undefined,
      odeme: /kart|card|pos|kredi/.test(odeme) ? 'kart' : odeme ? 'nakit' : undefined,
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
    rapor: { satir: lines.length - 1, okunan: kayitlar.length, atlanan, eslesen, donem: months.length ? [months[0], months[months.length - 1]] : null, eksikAylar },
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
