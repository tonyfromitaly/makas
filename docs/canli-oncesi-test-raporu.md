# Canlı öncesi test raporu: test alanı (staging)

**Tarih:** 20 Ekim 2026 · **Kod:** `487cda8`

## Karar

**Kontrollü pilot (1 dükkân): evet.** Bunun için iki şart var: aşağıdaki "Mutlaka" listesindeki 2. madde (Render ve Netlify ortam değerleri) kapanmalı, Square ve banka bağlantıları da pilotta sandbox'ta kalmalı ya da kapalı tutulmalı.

**Genel açılış (ABD'de herkese): henüz hayır.** Kod tarafında engel kalmadı. Engeller iki türlü:

- **Sağlayıcı onayları:** Square canlı, Plaid canlı, SMS. Gerçek Postgres doğrulaması kapandı.
- ~~**Ürün açığı:** Röntgen bulguları ve ajan notları yalnızca Türkçe.~~ **Kapandı (`7216355`):** artık dükkânın dilinde (Türkçe, İngilizce, İspanyolca) yazılıyor.

## Test alanı nasıl kuruldu

Canlıdaki düzenin aynısı bilgisayarda kuruldu:

- **API, Render'daki gibi:**
  - üretim modu (`NODE_ENV=production`);
  - HTTPS zorunlu, vekil sunucuya (proxy) güven açık, `/api` öneki;
  - açık kayıt kapalı;
  - temiz bir veritabanı;
  - kalıcı gizli anahtarlar ve şifreli bağlantı anahtarı (`CONNECTION_SECRET`).
- **Ön yüz, Netlify'daki gibi:** `netlify-dist` paketi, `netlify.toml` güvenlik başlıklarıyla ve `/api/*` → API yönlendirmesiyle (Netlify → Render) sunuldu.
- **Bağlantılar:** gerçek sağlayıcılara bağlanıldı: Square sandbox, Plaid sandbox, DeepSeek.
- **Kapalı tutulanlar:** Ödeme (Stripe) ve gerçek e-posta (Resend). İkisi de dışarıya gerçek işlem yapar; e-posta konsola yazıldı.
- **Müşteri sitesi:** başka bir adreste örnek bir salon sitesi açıldı, tek satırlık `embed.js` ile randevu düğmesi eklendi.

Uçtan uca test betiği her isteği tarayıcının canlı sitede yapacağı yoldan, yani Netlify vekili üzerinden attı.

## Sonuçlar

Uçtan uca testte 55/55 geçti. Tarayıcı testleri ve sağlayıcı testleri de geçti.

**Platform**
- `/api` yönlendirmesi çalışıyor.
- Güvenlik başlıkları doğru: site, uygulama ve demo çerçevelenemiyor; yalnızca `/book/` çerçevelenebiliyor.
- `embed.js` sunuluyor.
- Açık kayıt kapalı.
- Dört sayfada CSP (güvenlik politikası) ihlali yok.

**İlk müşteri**
- Sitede başvuru → işletmeci onayı (14 gün deneme) → erişim anahtarı → şifre → giriş.
- Anahtar ikinci kez kullanılamıyor.

**Kurulum**
- Sihirbaz modülleri, görünümü ve ajanı kuruyor; kişi başına bir koltuk açıyor (3 koltuk).
- Hizmetler "koltuk gerekir" olarak ayarlanıyor.

**Ekip**
- Primli ve koltuk kiracısı çalışan tanımlanabiliyor; sahip listede başta ve "sahip" olarak işaretli.
- Çalışan kendi anahtarıyla giriyor.
- Çalışana 10 yasak uç 403 dönüyor: defter, veresiye, hatırlatmalar, ekip raporu, ajan notları, bağlantılar, dışa aktarma, randevu ayarları, Röntgen.
- Çalışan ekipteki kişilerin anlaşmalarını görmüyor.

**Online randevu**
- Sayfa sahip açana kadar kapalı (404).
- Adres dükkân adından üretiliyor.
- Ajan "Who would you like? There are 3 of us … or anyone" diye soruyor.
- "Elif tomorrow at 2pm" tek cümlede kişiyi, günü ve saati dolduruyor.
- Randevu koltukla birlikte veriliyor; sahibin takvimine "online" etiketiyle düşüyor; Elif'in uygulamasında da görünüyor.
- Hatırlatmalar kuyruğa giriyor.
- Önerilen saatlerde müşteri adı geçmiyor.
- "Fark etmez" denince saatler ekip arasında dağılıyor.

**Müşteri sitesine gömülü randevu (tarayıcı)**
- Başka bir adresteki sitede "Book now" düğmesi çıkıyor.
- Pencerede hizmet → kişi → gün → saat → ad → telefon → onay adımları tamamlanıyor; "BOOKED" kartı görünüyor.
- Randevu Can'a, Koltuk 3'e yazıldı. Konsolda hata yok.

**Kasa**
- Elif ziyaretin ödemesini aldı: hizmet + ürün + bahşiş.
- Defter fişle birebir tutuyor.
- Elif'in hakediş fişi doğru (%45 hizmet, %10 ürün, bahşiş onun).
- Sahip hakedişi ödedi; ödeme deftere maaş gideri olarak yazıldı.
- Elif kendi kazancını görüyor.

**Banka (Plaid sandbox)**
- Bağlantı jetonu alındı, test bankası bağlandı.
- 61 defter kaydı geldi; bakiye ($500) okundu; erişim anahtarı şifreli saklanıyor.
- Röntgen raporu ve ajan notları bu veriden üretildi.
- Asistan gerçek bakiyeyi söylüyor.
- **Tarayıcı:** "Bankanı bağla" düğmesi Plaid'in giriş penceresini canlı güvenlik kuralları altında açıyor ("Lakeview Hair Studio uses Plaid…").

**Square (sandbox)**
- İzin bağlantısı doğru oluşuyor; yalnızca okuma izinleri isteniyor.
- Gerçek Square sandbox'tan 67 satış kaydı ve 24 müşteri eşitlendi (1,2 saniye).
- Randevu sayısı 0: test satıcısında randevu verisine erişim açık değil.

**Asistan (DeepSeek)**
- Sahip: ekip özeti, kişi bazında satış ve randevu taslağı doğru; boş öğleden sonralar için öneri veriyor.
- Çalışan: kendi kazancını "Your commission" diye duyuyor; dükkân giderini sorunca "That's for the shop owner" cevabı geliyor.

**Hatırlatma**
- Online randevunun hatırlatmaları gönderim kuyruğunda.
- ABD numarasına SMS olarak hazırlanıyor.

**Veri hakları**
- Dışa aktarma ekip, fiş ve hakediş tablolarını içeriyor.
- Silme dükkânı askıya alıyor: randevu sayfası (404) ve çalışan uygulaması (410) kapanıyor. Geri alma her şeyi geri getiriyor.

## Test alanında bulunup düzeltilen hatalar

1. **Gömülü pencerede onay düğmesi görünmüyordu.** Son mesaj ve "Book it" yazı alanının arkasında kalıyordu; müşteri randevuyu onaylayamazdı. *Düzeltildi.*
2. **ABD'deki İngilizce salona hazır menü Türkçe geliyordu** ("Boya, Fön, Röfle"). Artık dükkânın dilinde geliyor (İngilizce ya da İspanyolca). *Düzeltildi.*
3. **ABD numaralarına hatırlatma WhatsApp'tan gidecekti.** +1 numaralar artık varsayılan olarak SMS alıyor. *Düzeltildi.*
4. **İngilizce sayfada başlık "LAKEVİEW" diye büyütülüyordu.** Sayfa dili artık seçilen dili izliyor; dükkân adı yazıldığı gibi gösteriliyor. *Düzeltildi.*
5. **Asistan çalışana üçüncü şahısla konuşuyordu** ("Their commission"). Bir de "1 jobs" gibi tekil/çoğul hatası vardı. *Düzeltildi.*
6. **"Fark etmez" saatleri hep aynı kişiye gidiyordu.** Artık o saatte boş olanlar arasında sırayla dağılıyor. *Düzeltildi.*
7. **İngilizce gün ifadeleri bozuktu** ("Free times on Tomorrow"). Artık "Free times tomorrow". *Düzeltildi.*

Hepsi kaydedildi; 204 otomatik testin hepsi geçiyor.

## Canlıya çıkmadan önce

### Mutlaka (bunlar kapanmadan canlıda çalışmaz)

1. ~~**Gerçek Postgres doğrulaması.**~~ **Kapandı (20 Ekim 2026).** Render'da deneme veritabanı açıldı: Frankfurt, PostgreSQL 16.15. Kullanıcı süper kullanıcı değil ve satır güvenliğini atlama yetkisi yok; canlıdaki durumla aynı.
   - `npm run pg:check -w api` **11/11** geçti:
     - 14 migration uygulandı;
     - 22 dükkân tablosunda satır güvenliği zorunlu;
     - `btree_gist` ve iki çakışma kuralı yerinde;
     - dükkânlar birbirinin müşterisini ve koltuğunu göremiyor, ötekine yazamıyor, ötekinin satırını değiştiremiyor;
     - dükkân seçilmeden sorgu atılınca hiçbir satır görünmüyor.
   - Üretim modu API bu veritabanıyla açıldı; Netlify vekili arkasında **uçtan uca test 55/55** geçti. Square sandbox eşitlemesi de çalıştı (67 kayıt, 24 müşteri).
   - Not: Eşitleme dizüstünden Frankfurt'a 13,5 saniye sürdü; her kayıt ayrı bir gidiş-dönüş yapıyor. Canlıda API ile veritabanı aynı Render bölgesinde olacağı için bu süre kısalır.
2. **Render ve Netlify ortam değerleri:**
   - Render'da `CONNECTION_SECRET` (32+ karakter) girilmeli. Square ya da Plaid ayarlıyken bu değer yoksa API açılmıyor; bu doğru ama girilmesi şart.
   - Render ücretli plana geçmeli. Ücretsiz sunucu boşta uyur; o sırada saatlik eşitleme, hatırlatma ve 30 günlük silme çalışmaz.
   - Netlify'da `API_ORIGIN` girilmeli.
3. **Square canlı:**
   - Square panelinde Redirect URL'i `https://usta-fade.netlify.app/app/` yapmak. Şu an `localhost:5173`; canlı sitede "Square'e bağlan" yerele döner ve bağlantı kurulamaz.
   - `SQUARE_ENV=production` ile canlı Application ID ve Secret girmek.
4. **Plaid canlı:**
   - Plaid'den üretim erişimi onayı almak (şirket bilgileri ve kullanım amacı istenir).
   - `PLAID_ENV=production` ile canlı secret girmek.
   - OAuth kullanan büyük bankalar (Chase vb.) için Plaid panelinde izinli yönlendirme adresi tanımlamak.
   - Şu an yalnızca test bankası bağlanır.
5. **Hatırlatma gönderimi:** WhatsApp ya da Twilio hesabı yok. Hatırlatmalar kuyruğa giriyor ama gitmiyor. ABD'de SMS için Twilio'da **A2P 10DLC kaydı** gerekir; bunun için şirket ve EIN lazım.
6. ~~**Röntgen ve ajan notlarının İngilizcesi.**~~ **Kapandı (`7216355`).** Bulgular, ajan notları, basılabilir rapor, enflasyon kaynağının adı ve sabah özeti dükkânın dilinde yazılıyor. Rakamlar, para, ay adları ve yüzdeler de o dile göre biçimleniyor: dolar kullanan İspanyolca dükkânda ABD biçimi ($1,483). Test alanında İngilizce dükkânda doğrulandı; raporda Türkçe karakter kalmadı.

### Önemli (pilotu engellemez)

7. **Resend alan adı doğrulaması.** Doğrulanmadan hoş geldin e-postası yalnızca hesap sahibine gider. Çalışan anahtarı uygulamadan "Ona gönder" ile elle iletilebiliyor.
8. **Ödeme (Stripe) bilinçli olarak kapalı.** Site başvuru topluyor ve bu yol test edildi. Stripe şirket ve yasal kurulum bitince açılacak.
9. **Gizlilik ve onay metinleri.** Özellikle randevu sayfasındaki SMS onayı. ABD'de TCPA kapsamında avukat kontrolü gerekir.

## Tekrar koşmak için

Test betiği ve kurulum yerelde duruyor:

- `.claude/launch.json` içinde: `staging-api`, `staging-web`, `customer-site`.
- Betik: `node scripts/staging-e2e.mjs .claude/launch.json sonuc.json`. Render + Netlify'daki bir deneme ortamına karşı da koşar: üçüncü argüman olarak adresini ver, anahtarları `STAGING_ADMIN_KEY` ve `STAGING_SERVICE_KEY` ile geç.
- Netlify yerel sunucusu artık `API_ORIGIN` ile `/api`'yi yönlendirebiliyor (`scripts/serve-netlify.mjs`).
