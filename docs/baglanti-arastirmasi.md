# Bağlantı araştırması (Ekim 2026)

Küçük işletmelerin en çok kullandığı sekiz sisteme nasıl bağlanırız, ne öderiz, kimden onay alırız?
Kaynaklar en altta. Firmaların resmî sayfası bulunamadığında bu açıkça yazıldı. Şartlar değişebilir;
müşteriye söz vermeden önce ilgili sayfaya tekrar bakılmalı.

## Özet

| Sistem | Nasıl bağlanırız | Bize maliyeti | Onay / şart | Pilot için |
| --- | --- | --- | --- | --- |
| **Square** | API (OAuth) | Ücretsiz | Listelenmeden bağlanılabiliyor gibi görünüyor (forum yanıtları; resmî belge doğrulanmalı). Mağaza listesi için ortaklık başvurusu, 14 iş günü içinde yanıt | **Hemen** |
| **QuickBooks Online** | API (OAuth) | Builder katmanı ücretsiz. Veri okuma çağrıları işletme başına ayda 500 bin; aşınca engelleniyor. Silver 300 $/ay, Gold 1.700 $/ay, Platinum 4.500 $/ay | Program ABD, Birleşik Krallık, Avustralya ve Kanada'daki geliştiricilere açık | **Hemen** |
| **Jobber** | API (OAuth + GraphQL) | Ücretsiz geliştirici hesabı | Taslak uygulama en fazla 5 ücretli Jobber hesabına bağlanabilir; fazlası için Jobber incelemesi ve onayı | **Hemen** (5 işletmeye kadar) |
| **Plaid** (banka) | API | Deneme ücretsiz, 10 bağlantıya kadar. Sonra kullandıkça öde. Hesap hareketleri bağlantı başına aylık abonelik; fiyat başvuru formunda görünüyor | Üretim erişimi için panelden başvuru. Deneme ABD ve Kanada için | **Hemen** (10 işletme) |
| **Vagaro** | API, ama işletme açar | Webhook eklentisi işletmeye ayda 10 $ (5.000 çağrı) | İşletme Vagaro'nun kart ödemesini ve ücretli plan kullanmalı, deneme sürümünde olmamalı. Başvuru formu, 7 iş gününe kadar. Bir sayfada "Enterprise satış ekibine yazın" deniyor | Sonra. Şimdilik dosya |
| **Fresha** | Dosya (CSV/Excel) | Yok | API yalnızca ortaklara. Müşteri listesi, randevular ve raporlar panelden indiriliyor | **Hemen** (dosyayla) |
| **Booksy** | Dosya (kısmen) | Yok | API ortaklara özel, davetle (bilgiler üçüncü taraf kaynaklarından). Müşteri listesi CSV olarak iniyor; randevu geçmişi için Booksy desteğinden dosya istemek gerekiyor | Dosyayla, eksik veriyle |
| **Toast** | Dosya; sonra ortak programı | Ortak ücretleri açıklanmıyor. Restoran entegrasyon başına ayda 25 $/şube ödüyor | Ortak programı başvuru ve sertifikasyonla. Ayrıca yalnızca okuma için "standart API erişimi" diye bir tür var; şartlarını göremedik | Dosyayla |

## Ne anlama geliyor

1. **Doğrudan başlayabileceğimiz dört bağlantı var: Square, QuickBooks, Jobber ve Plaid.** Dördünün de
   başlangıcı ücretsiz. Onay ya hiç gerekmiyor ya da pilot ölçeğinde gerekmiyor: Jobber'da 5, Plaid'de
   10 işletmeye kadar. Pilot için yeterli.
2. **Kuaför ve güzellik tarafının büyük oyuncuları (Booksy, Fresha) dışarıya kapalı.** Bunlar için dosya
   yolunu sağlamlaştırmak gerekiyor. Röntgen'in dosya okuyucusu zaten Türkçe ve İngilizce başlıkları,
   farklı ayraçları ve sayı biçimlerini tanıyor. Bu iki sistemin dışa aktarma dosyaları için hazır
   eşleştirme eklemek yeterli. Ayda bir dosya istemek sihirbazda uyarı olarak çıkıyor.
3. **Vagaro'da API var ama anahtarı işletme açıyor.** Bizim tarafta bağlantı kodu, işletme tarafında
   başvuru ve ücretli eklenti gerekiyor. Pilotta dosyayla başlayıp isteyen işletmeye API'yi açtırırız.
4. **Toast'ta ortaklık uzun bir süreç.** Restoranlar için başlangıçta rapor dosyası. Restoran pilotları
   büyürse ortak başvurusu yapılır.
5. **Şirket şartı.** Plaid, Intuit ve Square ortaklığı için ABD'de bir şirket (ve vergi numarası, EIN)
   ile başvurmak gerekecek. Bu, şirket kuruluşu işiyle bağlantılı.

## Önerilen sıra

1. **Square bağlantısı:** satışlar, randevular, müşteriler, ödemeler. Ücretsiz; hem randevu hem kasa
   tarafını kapsıyor.
2. **Fresha, Booksy ve Vagaro dışa aktarma dosyaları için hazır eşleştirmeler:** mevcut dosya okuyucusunun
   üstüne.
3. **QuickBooks:** muhasebeci tarafı ve gelir-gider geçmişi.
4. **Plaid:** banka hareketleri ve nakit takvimi için gerçek bakiye.
5. **Jobber:** ev hizmetleri şablonu için.

## Kaynaklar

- Square: [App Marketplace genel şartları](https://developer.squareup.com/docs/app-marketplace/requirements/general) · [OAuth'u üretime taşıma](https://developer.squareup.com/docs/oauth-api/movetoprod) · [Forum: listelenmemiş uygulamaların OAuth sınırları](https://developer.squareup.com/forums/t/clarification-on-oauth-limits-for-unlisted-private-production-applications/25389) · [Forum: üretimde onay gerekir mi](https://developer.squareup.com/forums/t/do-we-need-to-get-approved-to-use-our-square-integration-in-production/8413)
- QuickBooks: [Intuit App Partner Program rehberi](https://static.developer.intuit.com/resources/Intuit_App_Partner_Program_Guide.pdf) · [Platform hizmet ücretleri](https://help.developer.intuit.com/s/article/platform-service-fees) · [Limitler](https://static.developer.intuit.com/output_html/qbo/docs/learn/limits-and-throttles.html) · [Duyuru](https://blogs.intuit.com/2025/05/15/introducing-the-intuit-app-partner-program/)
- Jobber: [Uygulama inceleme süreci](https://developer.getjobber.com/docs/publishing_your_app/app_review_process) · [Uygulamayı test etme](https://developer.getjobber.com/docs/building_your_app/testing_your_app) · [Özel entegrasyonlar](https://developer.getjobber.com/docs/custom_integrations/)
- Plaid: [Fiyatlandırma ve faturalama](https://plaid.com/docs/account/billing) · [Ürün faturalama modelleri](https://support.plaid.com/hc/en-us/articles/16194632655895)
- Vagaro: [Webhook kurulumu ve şartlar](https://support.vagaro.com/hc/en-us/articles/29521637950875-Set-Up-Webhooks-From-Vagaro) · [APIs & Webhooks](https://www.vagaro.com/pro/updates/webhooks) · [Geliştirici belgeleri](https://docs.vagaro.com/)
- Fresha: [Raporları dışa aktarma](https://www.fresha.com/help-center/knowledge-base/reports/191-export-reports) · [Müşteri listesini dışa aktarma](https://www.fresha.com/help-center/knowledge-base/clients/58-export-your-client-list) · [Veri bağlayıcı tabloları](https://www.fresha.com/help-center/knowledge-base/reports/101429-data-connector-tables)
- Booksy (resmî sayfa bulunamadı, üçüncü taraf kaynakları): [Supergood API değerlendirmesi](https://supergood.ai/api-report-card/booksy) · [apis.io](https://apis.io/providers/booksy/) · [Goldie: Booksy'den veri taşıma](https://support.heygoldie.com/en/articles/323740-importing-from-booksy)
- Toast: [API genel bakış](https://doc.toasttab.com/doc/devguide/apiOverview.html) · [Ortak entegrasyonu](https://doc.toasttab.com/doc/devguide/apiPartnerIntegrationOverview.html) · [Restoran tarafı entegrasyon aboneliği](https://intercom.help/toast-central/en/articles/14728223-add-or-remove-an-integration-with-toast-partner-integrations) · [POS API ücretleri analizi](https://www.katalystos.com/blog/pos-api-access-and-what-integrations-cost)
