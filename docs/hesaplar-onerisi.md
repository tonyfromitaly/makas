# Dükkân sahibi ve berber hesapları: öneri (taslak)

> Durum: öneri. Kod yazılmadı; çalışma modelleri sahada konuşulduktan sonra netleşecek.
> Mevcut altyapı hazır: kullanıcıların zaten `owner` ve `barber` rolü var, `barbers.user_id` alanı bu iş için ayrılmış.

## Sahada para nasıl dönüyor

Araştırma ve sektör bilgisi: küçük dükkânda üç model yan yana yaşıyor, çoğu zaman aynı dükkânda bile.

| Model | Nasıl işler | Kasa kimde | Kim neyi takip etmeli |
| --- | --- | --- | --- |
| **Yüzde / prim** (en yaygın) | Kalfa kestiği işin %30–60'ını alır; usta kirayı, malzemeyi, faturayı öder. Hesap çoğu zaman **cumartesi akşamı haftalık** kapanır. | Dükkânın kasası | Usta: kim ne kesti, yüzde, avans, ödenecek. Kalfa: kendi işleri, kendi hakkı. |
| **Koltuk kirası** | Berber haftalık ya da aylık sabit kira öder, kendi müşterisinin parasını kendisi alır, malzemesini kendisi alır. | Berberin kendi cebi | Usta: kira alındı mı. Berber: kendi geliri, gideri, kirası. |
| **Maaş + prim** | Sabit haftalık ya da aylık ücret, üstüne hedef aşınca prim. | Dükkânın kasası | Usta: maaş, prim hedefi. Berber: kendi işleri, primi. |

Her modelde ortak olanlar:
- **Bahşiş** berberindir; kasaya girse bile hakedişe ayrı satır olarak eklenir.
- **Avans** çok yaygın ("bu hafta 500 ver, cumartesi düşersin"). Hakedişten düşülmesi lazım.
- **Ürün satışı** (wax, şampuan) genelde dükkânındır, bazı yerlerde satana küçük prim verilir.
- **Kartla ödeme**: POS komisyonu kimden düşülecek, dükkândan dükkâna değişiyor.
- **Nakit ağırlıklı**: akşam kasa sayımı ve "kasada olması gereken" ile "kasada olan" farkı en büyük derttir.

Not: Türkiye'de 2026 itibarıyla büyükşehirlerdeki birçok basit usul esnafı gerçek usule geçti. Defter yükümlülüğü ve kalfanın SGK durumu bir mali müşavirle netleşmeli. Fade **muhasebe programının yerine geçmiyor**; mali müşavire verilecek temiz bir özet üretiyor.

## Önerilen ürün

### Hesaplar
- **Dükkân sahibi**: her şeyi görür: tüm berberlerin günü, kasa, hakedişler, dükkân notları.
- **Berber**: kendi randevuları, kendi müşteri notları, kendi kazancı ve hakedişi. Dükkânın toplam cirosunu ve başkasının kazancını **görmez**.
- Davet: usta "Ekip → Berber ekle" der, berbere link gider, berber şifresini belirler, uygulama açılır. Bu, web sitesindeki davet akışının aynısı.
- Koltuk kiracısı berberin isterse **kendi defteri** olur: kendi gelir-gideri, ustaya ödediği kira gider olarak yazılır.

### Çalışma şartları (berber başına)
`barber_terms`: model (`percent` | `chair_rent` | `salary`), yüzde oranı, kira tutarı ve dönemi, maaş, prim kuralı, hesap günü (örn. cumartesi), POS komisyonunu kim öder, ürün satış primi.

### Hakediş (haftalık kapanış)
Her hesap gününde asistan taslak hazırlar, usta onaylar:

```
Emre · 11–17 Ekim
  34 iş · ciro            $1.240
  yüzde %40               $496
  bahşiş                  + $85
  avans (Çarşamba)        − $100
  ödenecek                $481   [Ödendi olarak işaretle]
```

Koltuk kiracısı için tersi çıkar: "Bu hafta kira $220, ödendi mi?"

### Asistan ve hafıza
- Her kullanıcının sohbeti ve kişisel notları ayrı. Müşteri ve dükkân notları ortak.
- Berber "bu hafta ne kadar kazandım" der: yalnızca kendi hakkını görür.
- Usta "Emre'ye 100 avans verdim" der: avans taslağı çıkar.

## Netleşmesi gerekenler (sahada sorulacak)
1. Hangi model ne sıklıkta: yüzde mi, kira mı, karışık mı?
2. Yüzde neyin üzerinden: tüm hizmet mi, malzeme düşüldükten sonra mı?
3. Hesap günü ve avans alışkanlığı.
4. Kartla ödemede komisyon kimden düşüyor?
5. Berber kendi telefonundan randevu alıyor mu, yoksa her şeyi usta mı giriyor?

## Kaynaklar
- [Booth rental vs. commission: barbershop bookkeeping](https://beancount.io/blog/2026/07/26/booth-rental-vs-commission-barbershop-bookkeeping-guide)
- [Booth Rental vs. Commission (Squire)](https://getsquire.com/business-edge/booth-rental-vs-commission-barbershop)
- [Salon & barbershop booth rental bookkeeping](https://beancount.io/blog/2026/05/18/salon-barbershop-booth-rental-bookkeeping-schedule-c-vs-schedule-e-1099-shop-owners-booth-renters-self-employment-records-guide)
- [Esnaf muaflığı ve basit usul 2026](https://musavirlerkulubu.com.tr/tema-demo/defter/yazilar/esnaf-muafligi-ve-basit-usul-vergilendirme-2026-yeni-duzenleme-hadler-ornekler)
- [Gerçek usul vergi 2026](https://kobitime.com/gercek-usul-vergi-nedir-2026/)
- [Kuaför salonu aylık kazancı 2026](https://piyzi.com/blog/kuafor-salonu-aylik-kazanci/)
