import { describe, expect, it } from 'vitest';
import { TUFE, birikmis, bugununParasi, csvOku, csvYaz, ornekDukkan, raporHtml, rontgen, sayi, tarihOku } from '@makas/core';

// İşletme Röntgeni: the inflation series, the spreadsheet reader and the findings engine.
describe('röntgen', () => {
  it('the monthly TÜFE series compounds to the annual rates the central bank publishes', () => {
    const byMonth = new Map(TUFE.map(([m, mo, yr]) => [m, { mo, yr }]));
    for (const [m, , annual] of TUFE) {
      const [y, mm] = m.split('-').map(Number);
      const yearAgo = `${y - 1}-${String(mm).padStart(2, '0')}`;
      if (!byMonth.has(yearAgo)) continue;
      const compounded = birikmis(yearAgo, m) * 100;
      expect(Math.abs(compounded - annual), m).toBeLessThan(0.6);
    }
    expect(Math.round(bugununParasi(100, '2024-12', '2025-12'))).toBe(131); // 2025 inflation 30.89%
  });

  it('reads Turkish and English numbers and dates', () => {
    expect(sayi('1.250,50')).toBe(1250.5);
    expect(sayi('1,250.50')).toBe(1250.5);
    expect(sayi('₺18.000')).toBe(18000);
    expect(sayi('-300')).toBe(-300);
    expect(sayi('12,5')).toBe(12.5);
    expect(sayi('abc')).toBeNull();
    expect(tarihOku('15.10.2023')).toBe('2023-10-15');
    expect(tarihOku('5/3/24')).toBe('2024-03-05');
    expect(tarihOku('2025-01-31')).toBe('2025-01-31');
    expect(tarihOku('dün')).toBeNull();
  });

  it('reads a bank-statement style sheet: borç/alacak columns, commas, quotes, bad rows reported', () => {
    const csv = [
      'İşlem Tarihi,Açıklama,Borç,Alacak',
      '01.02.2025,"Kira, Şubat",22.500,00,',
      '03.02.2025,POS tahsilat,,"4.120,50"',
      'yarın,bozuk satır,10,',
      '05.04.2025,Elektrik,"1.950,00",',
    ].join('\n');
    // Commas inside amounts need quotes in a comma-separated file; the reader keeps quoted fields whole.
    const fixed = csv.replace('22.500,00,', '"22.500,00",');
    const r = csvOku(fixed);
    expect(r.rapor.eslesen.borc).toBe('Borç');
    expect(r.kayitlar).toHaveLength(3);
    expect(r.kayitlar[0]).toMatchObject({ tarih: '2025-02-01', tur: 'gider', tutar: 22500, aciklama: 'Kira, Şubat' });
    expect(r.kayitlar[1]).toMatchObject({ tur: 'gelir', tutar: 4120.5 });
    expect(r.rapor.atlanan).toEqual([{ satir: 4, sebep: 'Tarih okunamadı: "yarın"' }]);
    expect(r.rapor.eksikAylar).toEqual(['2025-03']);
  });

  it('says what it could not find instead of guessing', () => {
    const r = csvOku('Ad;Soyad\nAli;Kaya');
    expect(r.kayitlar).toHaveLength(0);
    expect(r.rapor.atlanan.map((a) => a.sebep)).toEqual(['Tarih sütunu bulunamadı', 'Tutar sütunu bulunamadı']);
  });

  it('finds every problem planted in the three-year sample shop, through the spreadsheet round trip', () => {
    const o = ornekDukkan();
    const ice = csvOku(csvYaz(o.kayitlar));
    expect(ice.rapor.okunan).toBe(o.kayitlar.length);
    expect(ice.rapor.atlanan).toEqual([]);
    const r = rontgen(ice.kayitlar, { ad: o.ad, acilisKasa: o.acilisKasa });
    expect(r.donem).toMatchObject({ bas: '2023-10', son: '2026-09', ay: 36 });
    const ids = r.bulgular.map((b) => b.id);
    for (const id of ['reel-buyume', 'fiyat-erimesi', 'cekis', 'is-adedi', 'pos', 'nakit-takvimi', 'gider-malzeme', 'gider-abonelik']) expect(ids, id).toContain(id);
    expect(r.ozet.reelBuyume).toBeLessThan(0);
    expect(r.ozet.nominalBuyume).toBeGreaterThan(0);
    const fiyat = r.bulgular.find((b) => b.id === 'fiyat-erimesi')!;
    expect(fiyat.kanit.map((k) => k.etiket).join(' ')).toContain('Saç kesimi · son zam Aralık 2025');
    expect(fiyat.kanit.map((k) => k.etiket).join(' ')).not.toContain('Sakal ·'); // beard prices kept up
    expect(r.bulgular.find((b) => b.id === 'gider-abonelik')!.ozet).toContain('İkinci randevu uygulaması');
    expect(r.geriKazanilabilir).toBeGreaterThan(30000);
    // The report renders and carries the method note.
    const html = raporHtml(r, ice.rapor);
    expect(html).toContain('İşletme Röntgeni');
    expect(html).toContain('yapay zekâ rakam üretmedi');
  });

  it('a short or clean ledger does not invent findings', () => {
    const k = Array.from({ length: 3 }, (_, i) => ({ tarih: `2026-0${i + 4}-10`, tur: 'gelir' as const, tutar: 100000, kategori: 'hizmet' }));
    const r = rontgen(k, { ad: 'Kısa', acilisKasa: 500000 });
    expect(r.bulgular).toEqual([]);
    expect(r.geriKazanilabilir).toBe(0);
  });
});
