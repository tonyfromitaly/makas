# Ekip, kasa ve online randevu

Dükkân artık tek kişinin defteri değil: ekip, koltuklar, kasa ve müşterinin kendi aldığı randevu tek sistemde.

## Koltuklar ve odalar

- **Ayarlar › Koltuklar ve odalar**: işin yapıldığı yerler. Türü koltuk, oda, yatak, masa ya da diğer olabilir.
- Her hizmete **gereken yer** tanımlanır: saç → koltuk, masaj → oda. Hiç yer istemeyen hizmet de olur.
- Bir randevu iki şartla verilir: o kişi boş olacak, ve hizmet bir yer istiyorsa o türden bir yer boş olacak. Kişinin kendi koltuğu varsa önce o denenir. Üç berber iki koltuk varsa aynı saatte ancak iki kişi oturabilir.
- Veritabanı da çakışmayı reddeder: aynı yer aynı saatte iki kez dolamaz (`appointments_station_no_overlap`).
- **Bugün** ekranının üstünde koltuk şeridi var: kim oturuyor, ne zamana kadar, sıradaki kim.

## Ekip ve anlaşmalar

**Ayarlar › Ekip**'te her kişi için şunlar tanımlanır:

- **Prim**: hizmetin ve ürünün yüzdesi kişinin.
- **Koltuk kirası**: tahsilat kişinin; dükkânın geliri haftalık ya da aylık kira.
- **Maaş**: aylık maaş, istenirse üstüne prim. Maaş seçilen döneme göre orantılı hesaplanır.

Bunlara ek olarak her kişinin kendi koltuğu, çalıştığı günler ve online sayfada görünüp görünmeyeceği ayarlanır.

Dükkân sahibi de ekipte kayıtlıdır (kayıt sırasında girişine bağlanır). Yaptığı işler dükkânda kalır; onun için hakediş çıkmaz.

**Kendi girişi:** sahip e-posta yazar ve tek kullanımlık bir erişim anahtarı (14 gün geçerli) üretir. Çalışan bu anahtarla kendi şifresini belirler.

Çalışanın uygulaması yalnızca kendi işini gösterir:

- Kendi randevuları ve kendi müşterileri.
- Kendi fişleri; kazancı (brüt satış, bahşiş, kendi payı).
- Sınırlı bir asistan.

Defter, veresiye, dükkânın hatırlatmaları, bankalar, Röntgen ve başkalarının satışları ona kapalıdır. Bu kural sunucuda uygulanır: istek doğrudan atılsa bile 403 ya da 404 döner.

## Kasa

Kasa'da her tahsilat bir **fiştir**:

- Satırlar: hizmet, ürün ya da başka bir kalem. Her satır onu yapan kişiye yazılır.
- Bahşiş, fişi kesen kişiye yazılır.
- Ödeme yolu: nakit, kart ya da diğer.

**Randevudan tahsilat:** Bugün'de randevuya dokunup **Tamamlandı · ödeme** dendiğinde o ziyaretin fişi açılır. Fiyat değiştirilebilir; ürün ve bahşiş eklenebilir.

**Deftere etkisi:** dükkânın defteri fişlerden yazılır (hizmet, ürün, bahşiş ayrı satırlar).

- Koltuk kiracısının tahsilatı onundur; dükkânın gelirine girmez.
- Fiş iptali yalnızca sahipte. Randevu fişi iptal edilirse randevu yeniden "bekliyor" olur.
- Stok satışta düşer, iptalde geri gelir.

**Ekip** görünümü kişi başına bir hakediş fişidir: brüt satış, prim, maaş payı, bahşiş, ödenen, dükkâna kalan.

- **Hakediş öde** deftere maaş gideri yazar.
- **Kira alındı** deftere gelir yazar.

Bu özellikten önce tamamlanmış ziyaretler migration sırasında fişe çevrilir; böylece geçmiş de raporda görünür.

## Online randevu (müşteri sitesine)

**Ayarlar › Online randevu** açılınca dükkânın bir sayfası olur: `https://monacount.com/book/<adres>`.

Sayfada randevu ajanı konuşur:

1. Hangi hizmet?
2. **Kimi istersiniz? N kişiyiz**: kişiler ya da "fark etmez, ilk boş olan".
3. Hangi gün, hangi saat?
4. Ad ve telefon (hatırlatma onayıyla).
5. Özet ve onay.

**Serbest yazı:** "yarın 3'te Elif olsun" tek seferde gün, saat ve kişiyi doldurur.

**Ajan yalnızca gerçekten boş olan saatleri önerir.** Hesaba kattıkları:

- Çalışma saatleri.
- Kişinin çalıştığı günler.
- Koltuk ya da oda boşluğu.
- Bir saatlik ön süre (bir saatten yakın randevu verilmez).

"Fark etmez" seçilirse randevu o gün en az randevusu olan kişiye gider. Dolu bir saat istenirse ajan bunu söyler ve en yakın boş saatleri sunar.

**Siteye ekleme:**

```html
<script src="https://monacount.com/book/embed.js" data-shop="<adres>" async></script>
```

Sağ altta bir "Randevu al" düğmesi çıkar. `data-inline="true"` verilirse sayfa olduğu yerde açılır; `data-lang` ve `data-label` da verilebilir.

**Güvenlik:**

- Dükkân adresiyle bulunur; online randevu kapalıysa, dükkân silinmişse ya da aboneliği kilitliyse sayfa 404 döner.
- Sonrasında her sorgu o dükkânın satır güvenliği içinde çalışır.
- Önerilen saatlerde müşteri adı geçmez.
- Bir numaraya en fazla 3 açık online randevu verilir.
- Bot tuzağı (gizli alan) var.
- IP başına dakikada 60 istek sınırı var.
- Netlify'da başka sitelerin çerçeveleyebildiği tek sayfa `/book/`; uygulamanın geri kalanı `X-Frame-Options: DENY`.

## Uçlar

| Uç | Kim |
|---|---|
| `GET/POST/PATCH /stations` | okuma herkes, değiştirme sahip |
| `GET/POST/PATCH /barbers`, `POST/DELETE /barbers/:id/login` | anlaşmalar ve girişler yalnız sahip |
| `GET/POST/PATCH /products` | değiştirme sahip |
| `GET/POST /sales`, `DELETE /sales/:id` | çalışan yalnız kendi satışı; iptal sahip |
| `GET /team/report`, `GET/POST /team/:id/payouts` | sahip |
| `GET /me/work` | giriş yapan kişinin kendi kazancı |
| `GET/PATCH /shops/me/booking` | sahip |
| `GET /public/book/:slug`, `…/slots`, `POST …`, `POST …/agent` | herkese açık (hız sınırlı) |

Testler: `api/test/team.test.ts`, `api/test/booking.test.ts`.
