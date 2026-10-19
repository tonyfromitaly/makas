import { describe, expect, it } from 'vitest';
import { kurulumUret, type Cevaplar } from '@makas/core';

// The setup wizard's generator: answers in, one business's agent, modules and connections out.

const base: Cevaplar = { isletme: 'X', sahip: 'Ada', sablon: 'kuafor', dil: 'tr', sistemler: [], dertler: [], ekip: [], kisi: 1, ton: 'samimi', gizlilik: 'yerel' };
const acik = (k: ReturnType<typeof kurulumUret>) => k.moduller.filter((m) => m.acik).map((m) => m.id);
const gorev = (k: ReturnType<typeof kurulumUret>) => k.gorevler.map((g) => g.id);

describe('setup generator', () => {
  it('a café with staff: sales and stock on, no appointments, no client messages, weekly pay settlement', () => {
    const k = kurulumUret({ ...base, isletme: 'Lale Kafe', sablon: 'kafe', sistemler: ['square', 'banka', 'defter-foto'], dertler: ['stok', 'nakit', 'vergi'], ekip: ['maas'], kisi: 4 });
    expect(acik(k)).toEqual(expect.arrayContaining(['defter', 'satis', 'stok', 'personel', 'rontgen', 'kasa-kocu']));
    expect(acik(k)).not.toContain('randevu');
    expect(acik(k)).not.toContain('hatirlatma');
    expect(gorev(k)).toEqual(expect.arrayContaining(['sabah-ozeti', 'aylik-karne', 'stok-uyari', 'nakit-takvimi', 'vergi-payi', 'hakedis']));
    expect(k.soulMd).toContain('Kimseye mesaj atmam');
    expect(k.soulMd).toContain('Veri bu bilgisayardan çıkmaz');
    expect(k.agentMd).toContain('dışarıya hiçbir şey çıkmaz');
    expect(k.agentMd).toContain('| Square | Doğrudan bağlantı |');
    expect(k.tema.skin).toBe('cini');
    expect(k.adimlar.map((a) => a.baslik)).toContain('Square bağla');
  });

  it('a salon on Booksy with commission and rent-a-space staff, summaries to the cloud', () => {
    const k = kurulumUret({ ...base, isletme: 'Salon Elif', sistemler: ['booksy', 'tablo'], dertler: ['kayip-musteri', 'bos-saat'], ekip: ['komisyon', 'kira'], kisi: 3, gizlilik: 'ozet' });
    expect(acik(k)).toEqual(expect.arrayContaining(['randevu', 'hatirlatma', 'musteri', 'personel', 'bahsis']));
    expect(gorev(k)).toEqual(expect.arrayContaining(['kayip-takibi', 'hatirlat', 'bos-saat-raporu', 'hakedis']));
    expect(k.uyarilar.join(' ')).toContain('Booksy için doğrudan bağlantı beklemiyoruz');
    expect(k.uyarilar.join(' ')).toContain('Banka bağlı değil');
    expect(k.soulMd).toContain('yalnızca isim ve telefon içermeyen özet');
    expect(k.soulMd).toContain('Herkes kendi hesabını görür');
    expect(k.agentMd).toContain('Komisyonla çalışan');
    expect(k.agentMd).toContain('Yer kiralayan bağımsız çalışan');
    expect(k.agentMd).toContain('izin veren müşterilere hatırlatma');
  });

  it('a tradesman working alone: no team modules, quotes and invoices tracked', () => {
    const k = kurulumUret({ ...base, isletme: 'Usta Tesisat', sablon: 'ev-hizmet', sistemler: ['jobber', 'quickbooks'], dertler: ['tahsilat'] });
    expect(acik(k)).toContain('is-teklif');
    expect(acik(k)).not.toContain('personel');
    expect(acik(k)).not.toContain('bahsis');
    expect(gorev(k)).toContain('acik-is');
    expect(gorev(k)).not.toContain('hakedis');
    expect(k.agentMd).toContain('**Ada:** Her şeyi görür ve onaylar.');
    expect(k.soulMd).not.toContain('Herkes kendi hesabını görür');
  });

  it('a booking module without a booking system says appointments live in our app', () => {
    const k = kurulumUret({ ...base, sablon: 'studyo', sistemler: ['banka'] });
    expect(k.uyarilar.join(' ')).toContain('randevular bu uygulamadan tutulacak');
  });

  it('speaks English when asked, and the same answers always give the same agent', () => {
    const a: Cevaplar = { ...base, dil: 'en', isletme: 'Corner Café', sablon: 'kafe', sistemler: ['toast'], dertler: ['gider'] };
    const k = kurulumUret(a);
    expect(k.soulMd).toContain('## What I never do');
    expect(k.soulMd).toContain('I work for Corner Café.');
    expect(k.uyarilar.join(' ')).toContain('monthly export file');
    expect(k.soulMd).not.toMatch(/[ğışİ]/);
    expect(kurulumUret(a)).toEqual(k);
  });
});
