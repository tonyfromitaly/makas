# Square bağlantısı

İşletmenin Square hesabındaki satışlar, ödemeler, müşteriler ve randevular yalnızca okuma izniyle
okunur ve bizim tek defterimize çevrilir.

- **Kod:**
  - `core/src/baglanti/square.ts`: Square'den okuma ve deftere çevirme.
  - `core/src/baglanti/esitle.ts`: eşitleme, şifreli anahtar saklama, Röntgen verisi.
  - `core/src/routes/connections.ts`: uç noktalar.
- **Testler:** `api/test/square.test.ts`. Sahte bir Square'e karşı çalışır; sayfalama, tarih filtresi
  ve OAuth gerçek API'deki gibi.

## Veri nereye gidiyor

| Square'de | Bizde |
| --- | --- |
| Tamamlanan siparişin her satırı | Gelir. Katalogda "randevu hizmeti" ise *hizmet*, değilse *ürün* (katalogsuz satış: *satış*). Müşterisi ve ödeme şekli (kart/nakit) ile |
| Bahşiş | Gelir · bahşiş |
| Square işlem ücreti | Gider · POS komisyonu |
| İade | Gelirden düşülür |
| Müşteriler | Ad ve ilk kayıt tarihi. Telefon ve e-posta alınmaz |
| Randevular | Tarih ve durum: geldi, gelmedi, müşteri iptali, işletme iptali, bekliyor |

- **Röntgen** bu satırları uygulamanın kendi defteri ve randevularıyla birlikte okur. Square'den gelen
  verilerle iki yeni bulgu çalışıyor:
  - *düzenli müşteri gelmeyi bıraktı*: olağan aralığının 1,5 katını geçen müşteriler;
  - *randevuların yüzde kaçı boşa gidiyor*: son 90 gün.
- **Uygulamanın defterinde** her gün için kategori başına tek satır görünür ("Square · 23 hizmet, 4
  bahşiş"). Ayrıntı Röntgen'de kalır.
- **Saat dilimi:** Tarihler Square şubesinin yerel saatine göre gün olarak yazılır.
- **Eşitleme sıklığı:**
  - İlk eşitleme son 2 yılı alır.
  - Sonraki eşitlemeler son 3 günü yeniden okur; geç gelen iadeler ve düzeltmeler böyle yakalanır.
  - Aynı kayıt hiçbir zaman iki kez yazılmaz.
  - Sunucu bağlı dükkânları her saat eşitler; aboneliği bitmiş dükkânlar atlanır.

## Güvenlik

- **İzinler:** Yalnızca okuma izinleri isteniyor: `MERCHANT_PROFILE_READ`, `ORDERS_READ`,
  `PAYMENTS_READ`, `CUSTOMERS_READ`, `ITEMS_READ`, `APPOINTMENTS_READ`, `APPOINTMENTS_ALL_READ`.
- **Anahtarlar:** Erişim ve yenileme anahtarları veritabanında AES-GCM ile şifreli durur. Şifreleme
  anahtarı `CONNECTION_SECRET` ayarında. Uygulamaya hiçbir zaman gönderilmez.
- **Yenileme:** Erişim anahtarı 30 gün geçerli; bitmesine bir hafta kala kendiliğinden yenilenir.
- **Giriş dönüşü:** OAuth "state" değeri imzalı ve 15 dakika geçerli. Bağlantıyı başlatan dükkândan
  başkası bağlantıyı tamamlayamaz.
- **Bağlantıyı kesmek:** Square'deki izin geri alınır ve anahtarlar silinir. İstenirse okunan veriler
  de silinir (`DELETE /connections/square?data=delete`).

## Kurulum (sandbox ile deneme)

1. developer.squareup.com'da hesap aç ve bir uygulama (Application) oluştur.
2. **Sandbox** sekmesinden Application ID ve Application Secret değerlerini al.
3. OAuth ayarlarında Redirect URL olarak uygulamanın adresini yaz:
   - yerelde `http://localhost:5173/`
   - canlıda `https://<site>/app/`

   Square dönüşte bu adrese `?code=…&state=…` ekler, uygulama gerisini kendisi tamamlar.
4. `.env` dosyasına şunları sen yaz (bana yapıştırma):

   ```
   SQUARE_APP_ID=sandbox-sq0idb-...
   SQUARE_APP_SECRET=sandbox-sq0csb-...
   SQUARE_ENV=sandbox
   CONNECTION_SECRET=<en az 32 karakter rastgele>
   ```
5. Sandbox'ta bir test satıcısında birkaç satış, müşteri ve randevu oluştur (Square'in sandbox
   panelinden).
6. Uygulamada **Ayarlar › Bağlantılar › Square'e bağlan** → izin ver → geri dönünce ilk eşitleme
   çalışır.
7. **Röntgen raporunu aç** ile sonucu gör.

## Canlıya geçerken

- **Ortam ayarları:** `SQUARE_ENV=production`, canlı Application ID ve Secret, canlı Redirect URL.
- **Ortaklık başvurusu:** Square App Marketplace'te listelenmek isteğe bağlı. Ortaklık başvurusu
  gerektiriyor ve yanıt 14 iş günü içinde geliyor (docs/baglanti-arastirmasi.md).
- **Randevu izni:** Randevuları okumak için satıcı tarafında randevu verisine erişim gerekiyor. İzin
  yoksa satışlar ve müşteriler yine okunur, randevular boş kalır ve Röntgen bunu "yapılamayanlar"
  listesine yazar.

## Sandbox verisi

Square sipariş ve ödemelerin tarihini kendisi atıyor; geçmişe tarih yazılamıyor. Bu yüzden iki araç var:

- `npm run square:seed -w api`: Test satıcısına bugünlük dolu bir gün yazar:
  - katalog: 5 hizmet, 2 ürün
  - 24 müşteri
  - 26 satış (kartla ve nakit, kartlılarda bahşiş)
  - 1 iade

  Yazma izinli bir sandbox anahtarı gerekir: Developer Console → uygulama → **OAuth** → **Authorize
  test account** → bağlanan test satıcısını seç → `CUSTOMERS_WRITE`, `ORDERS_WRITE`, `PAYMENTS_WRITE`,
  `ITEMS_WRITE` (ve okuma) izinlerini işaretle → çıkan erişim anahtarını `.env` içindeki
  `SQUARE_SEED_TOKEN` satırına yaz. Betik canlı ortamda çalışmayı reddeder.
- `npm run square:sim -w api`: Square biçiminde 3 aylık simüle bir dükkânı gerçek bağlantıyla aynı
  yoldan (squareDefter → Röntgen) geçirir ve `rontgen/square-simulasyon.html` raporunu yazar. Raporun
  üstünde simülasyon olduğu yazar.
