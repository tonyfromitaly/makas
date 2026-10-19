# Hatırlatma gönderimi (WhatsApp ve SMS)

Randevu açılınca API iki hatırlatma satırı yazar: biri bir gün önce, biri randevu saatinden birkaç saat
önce. Sunucunun içindeki gönderici her 30 saniyede bir zamanı gelenleri alır, gönderir ve sonucunu
kaydeder. Kod: `api/src/messaging.ts` (gönderici, sağlayıcılar) ve `api/src/messaging-routes.ts`
(STOP yanıtları). Testler: `api/test/messaging.test.ts`.

## Kurallar

- **İzin:** Müşteri kaydında izin işaretli değilse hiç satır yazılmaz. Gönderimden hemen önce izin,
  randevunun durumu ve dükkânın aboneliği bir kez daha kontrol edilir.
- **Geç kalan mesaj:** Saati geçmiş bir hatırlatma gönderilmez, "atlandı" olarak kaydedilir. Gece yarısı
  "yarın randevunuz var" gibi bir mesaj gitmez.
- **Kanal:** Müşteri WhatsApp istiyor ama WhatsApp kurulu değilse mesaj SMS ile gider. Tersi de geçerli.
- **Hatalar:**
  - Kalıcı hata (numara geçersiz, şablon reddedildi): mesaj hemen "başarısız" olarak kaydedilir.
  - Geçici hata (zaman aşımı, 429, 5xx): mesaj 5 dakika sonra yeniden denenir. 3 denemeden sonra
    "başarısız" kaydedilir.
- **Çift gönderim yok:** Her satır gönderilirken 5 dakikalığına kilitlenir. Aynı mesaj iki kez gitmez.
- **STOP:** Müşteri "STOP", "dur", "durdur", "mesaj istemiyorum" ya da "baja" yazarsa:
  - izni kalkar;
  - bekleyen mesajları iptal edilir.

  "iptal" kelimesi bilerek STOP sayılmaz: müşteri bunu yazınca büyük ihtimalle randevuyu kastediyordur.

## Denemek (gerçek mesaj gitmez)

`.env` dosyasına `SENDER_DRY_RUN=true` yaz ve sunucuyu başlat. Mesajlar terminale yazılır ve gönderilmiş
sayılır. Bu ayar üretimde (NODE_ENV=production) dikkate alınmaz.

## WhatsApp (Meta Cloud API)

1. developers.facebook.com'da bir uygulama aç ve WhatsApp ürününü ekle. Bir telefon numarası bağla:
   bu, mesajların gideceği işletme numarası olur. İşletme doğrulamasını tamamla.
2. Kalıcı bir erişim anahtarı al (System User token) → `WHATSAPP_TOKEN`.
   Numaranın kimliği → `WHATSAPP_PHONE_NUMBER_ID`.
3. Aşağıdaki iki şablonu **Utility** kategorisinde onaya gönder. Her biri Türkçe, İngilizce (en_US)
   ve İspanyolca dillerinde, aynı adla olmalı. Değişkenler bu sırada olmalı:

   **randevu_hatirlatma_onceki_gun**: `{{1}}` ad, `{{2}}` saat, `{{3}}` dükkân, `{{4}}` hizmet

   > Merhaba {{1}}, yarın {{2}} için {{3}} randevunuz var ({{4}}). Görüşmek üzere!
   > Mesaj almak istemiyorsanız STOP yazın.

   **randevu_hatirlatma_bugun**: `{{1}}` ad, `{{2}}` saat, `{{3}}` dükkân

   > {{1}}, bugün {{2}} randevunuzu hatırlatırız. {{3}}
   > Çıkmak için STOP yazın.

   Farklı adlar kullanırsan `WHATSAPP_TEMPLATE_DAY_BEFORE` ve `WHATSAPP_TEMPLATE_DAY_OF` ayarlarına yaz.
4. Webhook ayarı: Uygulama → WhatsApp → Configuration.
   - Adres: `https://<site>/api/webhooks/whatsapp`
   - Doğrulama anahtarı: kendin uydur → `WHATSAPP_VERIFY_TOKEN`
   - Abone olunacak alan: `messages`
   - Uygulamanın App Secret değeri → `WHATSAPP_APP_SECRET`. İmzası tutmayan istek reddedilir.

## SMS (Twilio)

1. Bir Twilio hesabı aç. Bir numara ya da Messaging Service al → `TWILIO_FROM` (`+1…` ya da `MG…`).
   Hesap bilgileri → `TWILIO_ACCOUNT_SID` ve `TWILIO_AUTH_TOKEN`.
2. Numaranın "A message comes in" adresi: `https://<site>/api/webhooks/twilio` (POST). Bu adres tam
   olarak `PUBLIC_URL` + `/api/webhooks/twilio` olmalı, çünkü Twilio imzayı bu adresle hesaplıyor.
3. ABD'de toplu SMS göndermek için A2P 10DLC kaydı gerekiyor. Türkiye'de gönderici adı kaydı ve
   operatör kuralları var. İkisini de canlıya çıkmadan önce sağlayıcıyla netleştir.

## Canlıya çıkmadan önce

- **Sunucu sürekli açık olmalı.** Render'ın ücretsiz planı boşta kalınca uyuyor ve uyuyan sunucu
  hatırlatma göndermiyor. En az starter plan gerekiyor.
- **Yasal metin (avukatla netleştir):**
  - Müşteri kaydındaki izin metni.
  - KVKK aydınlatma metni.
  - ABD için TCPA ve A2P kuralları.
  - Türkiye'de bu mesajların İYS kapsamında olup olmadığı. Randevu hatırlatması bilgilendirme mesajıdır,
    ama kampanya içerirse ticari ileti sayılır.
- **Maliyet:** WhatsApp Utility şablonları ve SMS mesaj başına ücretlendiriliyor. Fiyatı ülkeye göre
  sağlayıcının güncel tarifesinden kontrol et. Müşteri kullanımına göre faturalanır.
