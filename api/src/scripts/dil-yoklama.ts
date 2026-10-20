// Language probe: everyday sentences through the local understanding engine, one line each.
//   npx tsx src/scripts/dil-yoklama.ts   (run inside api/)
import { DateTime } from 'luxon';
import { understandLocal } from '@makas/core';
const ctx = { now: DateTime.fromISO('2026-10-20T10:00', { zone: 'America/Chicago' }), lang: 'tr' as const, services: [{ id: 's', name: 'Saç kesimi' }], barbers: [{ id: 'b', name: 'Halil' }], clients: [{ id: 'c', name: 'Ahmet Yılmaz' }] };
const lines = `geçen ayın hesabını getir
bu ayın hesabı ne
geçen ayın dökümünü çıkar
bu hafta nasıl geçti
geçen ay nasıldı
geçen ay kâr ettik mi
bu ay zarardayız mı
bu ay ne kadar para kazandık
bu ay kaç para yaptık
bugün kasada ne var
bugün kasa ne durumda
dün ne kadar girdi
geçen hafta ne kadar harcadık
masraflar ne kadar tuttu
geçen ayın raporunu ver
aylık özet
bu ayın özetini göster
geçen aya göre nasılız
geçen ayla karşılaştır
en çok hangi hizmeti yaptık
bu ay en çok ne sattık
bu yıl ne kadar kazandık
geçen ayın gelir gider tablosu
kâr zarar durumu
elimde ne kaldı bu ay
bu ay ne kadar kaldı cebimizde
bu ayın cirosu
ekim ayının hesabı
eylül ne kadar kazandırdı
bu hafta kaç müşteri geldi
geçen hafta kaç randevu vardı
yarın kimler var
bugün kaç randevu var
ödemeler ne durumda
bu ay hangi faturalar var
how did last month go
give me last month's numbers
what did we make this week
monthly summary
show me the p&l for last month
how much did we spend last month
are we profitable this month
how are we doing compared to last month
what's in the till today
¿cómo nos fue el mes pasado?
dame el resumen del mes
¿cuánto ganamos esta semana?`.split('\n');
for (const l of lines) {
  const p = understandLocal(l, { ...ctx, lang: /[¿ñ]|dame|ganamos/.test(l) ? 'es' : /^[a-z' &?]+$/i.test(l) && !/[ığüşöç]/.test(l) && /\b(the|did|we|me|how|what|are|monthly)\b/.test(l) ? 'en' : 'tr' } as any);
  const i: any = p.items[0];
  console.log(`${(i.type === 'query' ? `${i.metric}/${i.month ? `ay ${i.month}` : i.period}` : i.type).padEnd(22)} ${l}`);
}
