# Yasal olarak canlıya çıkış ve satış: yol haritası (Ekim 2026)

Bu doküman üç soruya cevap veriyor:

- Yasal olarak satışa çıkmak için ne eksik?
- Sistem teknik olarak nasıl ayakta kalacak? Veri nerede duruyor, sunucu lazım mı, uzun işleri nasıl hatırlıyor?
- Ürünü nasıl satacağız? Türkiye'de yerel bilgisayarcı esnafı üzerinden satış da buna dahil.

Hukuki maddeler bir kontrol listesidir, hukuki görüş değildir. Avukata ve mali müşavire bu listeyle gidilir.

## Kısaca

- **Kod, kapalı bir pilot için hazır.**
  - Test alanında 55/55 adım geçti, gerçek Postgres'te de 55/55.
  - Square ve Plaid sandbox'ta uçtan uca çalışıyor.
- **Eksik olan kod değil, şirket.** Square, Plaid ve Twilio'nun canlı onaylarının hepsi bir şirket istiyor: tüzel kişilik, vergi numarası (ABD'de EIN), banka hesabı ve yasal metinler.
- **Teknik tarafta 4 iş var:**
  1. Ücretli, sürekli açık sunucu.
  2. Yedek ve geri yükleme provası.
  3. Hata ve kesinti alarmı.
  4. Arka plan işlerinin tek kopyada koşmasını garanti etmek.
- **Uzun süre ayakta kalacak şey uygulama değil, veri katmanı ve dağıtım ağı.**
  - Randevu ve kasa uygulaması kalabalık bir pazar.
  - İşletmenin mevcut sistemlerini bağlayıp yıllarca hafızasını tutan, teşhis koyan katman öyle değil.
  - Bunu kuracak ve satacak bilgisayarcı esnafı ağı da kolay kopyalanmaz.

## 1. Bağlantılar tamam mı?

| Bağlantı | Kodda | Test | Canlı için eksik |
|---|---|---|---|
| Square (POS, randevu) | ✓ | Sandbox: 67 kayıt, 24 müşteri | Square'de production uygulaması, canlı redirect URL, şirket adına hesap |
| Plaid (banka) | ✓ | Sandbox: 61 hareket | Plaid production başvurusu: şirket, gizlilik politikası, güvenlik anketi |
| Twilio SMS (ABD) | ✓ | Sandbox | **A2P 10DLC kaydı**: şirket ve EIN olmadan ABD'de toplu SMS gitmez |
| WhatsApp Business | ✓ | Test numarası | Meta işletme doğrulaması, onaylı mesaj şablonları |
| Resend (e-posta) | ✓ | Test | Kendi alan adını doğrulama (SPF/DKIM) |
| Stripe (abonelik) | ✓, kapalı | Kapalı | Bilerek kapalı. Şirket kurulunca açılır. Türkiye'de Stripe yok; TR için iyzico ya da PayTR gerekir |
| Yapay zekâ (Claude) | ✓ | Sahte ağla test edildi | Anthropic API anahtarı ve faturalandırma. DeepSeek yalnızca yerel ve deneme için duruyor (`docs/legal/README.md`) |

Sonuç: bağlantıların teknik işi bitti. Kalan her madde şirket ve evrak işi.

## 2. Veri nerede ve nasıl duruyor?

**Bugünkü düzen:**

- Site ve uygulama Netlify'da.
- API ve Postgres veritabanı Render'da, Frankfurt bölgesinde.
- Her dükkânın verisi aynı veritabanında, satır güvenliğiyle (RLS) ayrılmış.
  - Bir dükkân ötekinin satırını göremez, değiştiremez.
  - Bu gerçek Postgres'te 11/11 kontrolle doğrulandı.

**Canlıdan önce karar verilecekler:**

- **Bölge.**
  - Ürün ABD-öncelikli, ama veritabanı Frankfurt'ta.
  - ABD müşterileri için Render'ın ABD bölgesi (Oregon ya da Ohio) daha hızlı. ABD'li işletmenin "verim ABD'de" beklentisine de uyar.
  - Türkiye müşterileri için de yurt dışı aktarım kuralı geçerli (bkz. 5. bölüm). Hangi bölge seçilirse seçilsin, standart sözleşme gerekiyor.
  - Öneri: bir pazar, bir bölge. Türkiye büyürse ayrı bir kurulum açılır. Kod bunu destekliyor: aynı blueprint, farklı veritabanı.
- **Yedek.**
  - Render'ın ücretsiz Postgres'inde yedek yok.
  - Ücretli planlarda günlük yedek ve belli bir süreye geri dönme var.
  - Ayrıca haftalık bir `pg_dump`'ı başka bir depoya (S3 ya da Backblaze) kopyalamak gerekiyor.
  - Ayda bir de **geri yükleme provası** yapılmalı. Denenmemiş yedek yedek sayılmaz.
- **Şifreleme.**
  - Bağlantı anahtarları (Square ve Plaid token'ları) veritabanında `CONNECTION_SECRET` ile şifreli duruyor.
  - Bu anahtar yalnızca Render ortam değişkeninde durur.
  - Kaybolursa bütün bağlantılar yeniden kurulur. Bu yüzden bir kopyası şifre yöneticisinde saklanmalı.

## 3. Sunucu lazım mı? Uzun işleri nasıl hatırlıyor?

**Evet, sürekli açık bir sunucu şart.** API sadece istek karşılamıyor, kendi içinde üç saat çalıştırıyor (`api/src/main.ts`):

| İş | Sıklık | Ne yapar |
|---|---|---|
| Hatırlatma gönderici | 30 saniyede bir | Zamanı gelen SMS ve WhatsApp hatırlatmalarını gönderir |
| Bağlantı eşitleme | Saatte bir | Abonesi aktif dükkânların Square ve banka verisini çeker |
| Bakım | Saatte bir | Silinen dükkânları 30 gün sonra temizler, asistan hafızasını toplar, eski notları siler |

Render'ın ücretsiz planı 15 dakika boşta kalınca uyur. Uyuyan sunucu hatırlatma göndermez, eşitleme yapmaz. Gerçek dükkânlar gelmeden önce web servisi ve veritabanı ücretli plana geçmeli. Güncel fiyatlar Render'ın fiyat sayfasından teyit edilir; başlangıçta aylık birkaç on dolar mertebesinde.

**Hatırlama sunucunun belleğinde değil, veritabanında.** Sunucu yeniden başlasa, güncellense ya da çökse bile hiçbir iş kaybolmaz:

- **Hatırlatmalar:** `reminder_queue` tablosunda durur.
  - Gönderici bir satırı alırken 5 dakikalık kilit koyar (`locked_until`, `for update skip locked`).
  - Sunucu yarıda çökerse kilit süresi dolar ve satır tekrar sıraya girer.
  - Aynı mesaj iki kez gitmez. Göndermeden hemen önce izin tekrar kontrol edilir.
- **Eşitleme:** Her bağlantının kaldığı yer `connections` tablosunda tutulur (`sync_cursor`, `last_sync_at`). Bir sonraki eşitleme oradan devam eder ve tüm geçmişi baştan çekmez.
- **Asistanın hafızası:**
  - Konuşmalar `assistant_turns` tablosunda durur.
  - Kalıcı notlar `assistant_notes` tablosunda durur. Her not 90 gün yaşar; tekrar duyulan not tazelenir, ustanın sabitlediği not hiç silinmez.
  - "Neyden bahsediyorduk" bilgisi 6 saat sessizlikten sonra sıfırlanır.
  - Modele her seferinde sınırlı bir görünüm gider, bu yüzden konuşma uzadıkça maliyet artmaz.
- **Röntgen:** Hesap her istendiğinde kayıtlardan yeniden yapılır. Saklanan bir ara sonuç yok, yani eskime riski de yok.

**Büyüyünce düzeltilecek iki zayıf nokta:**

1. **Tek kopya varsayımı.** ✓ Düzeltildi (21 Ekim).
   - Saatlik eşitleme ve bakım artık `job_runs` tablosundan bir kira alarak çalışıyor.
   - İki kopya açık olsa da her iş bir kez çalışır.
   - Ayrıntı: `docs/gozetim.md`.
2. **Sıralı eşitleme.**
   - Dükkânlar tek tek eşitleniyor. Onlarca dükkân için sorun değil.
   - Yüzlerce dükkân olunca bir saatlik döngüye sığmaz.
   - O zaman eşitleme ayrı bir "worker" servisine ve Postgres tabanlı bir iş kuyruğuna (ör. pg-boss) taşınır. Veritabanı yapısı buna hazır.

**Gözetim.** ✓ Eklendi (21 Ekim, `docs/gozetim.md`).

- 15 dakikada bir şunlar kontrol ediliyor:
  - veritabanı;
  - geciken ve başarısız hatırlatmalar;
  - eşitlenmeyen bağlantılar;
  - saatlik işler;
  - 5xx hataları.
- Sorunlar e-postana ya da Slack/Discord'a gelir. Düzelince "düzeldi" mesajı da gelir.
- Dışarıdan erişim kontrolü için `/api/health/ready` var. UptimeRobot ya da Better Stack'e senin eklemen gerekiyor.
- Hata ayrıntı takibi (Sentry) henüz yok.

## 4. Yasal olarak eksikler: ABD

ABD-öncelikli kararına göre sıralı:

1. **Şirket.**
   - Yabancı kurucu için en yaygın yol Delaware ya da Wyoming LLC (Stripe Atlas, Firstbase, doola gibi servisler).
   - Sonra EIN ve ABD banka hesabı (Mercury ya da Relay).
   - Bu olmadan Twilio A2P, Plaid production ve Stripe açılmaz. **Kritik yol bu.**
2. **Yasal metinler.** Taslaklar hazır: `docs/legal/` (21 Ekim). Avukat onayı bekliyor. Sitede şimdilik yalnızca KVKK metni ve kısa bir İngilizce gizlilik notu var.
   - **Terms of Service:** sorumluluk sınırı, abonelik ve iptal, kabul edilebilir kullanım.
   - **Privacy Policy (ABD):** CCPA/CPRA ve diğer eyalet yasaları. Hangi veriyi topluyoruz, kimlerle paylaşıyoruz (Plaid, Square, Twilio, yapay zekâ sağlayıcısı), silme hakkı. Plaid başvurusu bunu ister.
   - **Data Processing Agreement:** dükkân kendi müşterilerinin verisinin sahibi, biz işleyiciyiz.
   - **SMS Terms:** TCPA ve CTIA kuralları. Açık onay, STOP/HELP, mesaj sıklığı, "ücret uygulanabilir" notu. Kodda STOP ve onay var; metnin avukat onayı eksik.
3. **TCPA incelemesi.** Hatırlatma SMS'leri bilgilendirme mesajı sayılır, kampanya mesajı değil. Ama "uzun süredir gelmeyen müşteriyi geri çağır" mesajı pazarlamaya girer ve daha sıkı onay ister. Avukat bu ayrımı onaylamalı. TCPA davaları mesaj başına ceza öngördüğü için en pahalı risk bu.
4. **Satış vergisi.** Bazı eyaletler SaaS'ı vergilendiriyor (ör. Texas, New York, Washington). Stripe Tax ile otomatik hesaplanır.
5. **Sigorta.** Siber sorumluluk ve mesleki sorumluluk (E&O). Banka verisi tutan bir ürün için büyük müşteriler bunu soracaktır.

## 5. Yasal olarak eksikler: Türkiye

1. **Şirket.**
   - Şahıs şirketi hızlı ve ucuz.
   - Bayi ağı ve yatırım düşünülüyorsa Ltd. Şti. daha doğru.
   - Satış için e-fatura ya da e-arşiv şart.
2. **KVKK.**
   - Aydınlatma metni var (`site/gizlilik.html`). Avukata gözden geçirtilmeli.
   - Dükkânla **veri işleme sözleşmesi** gerekiyor. Dükkân veri sorumlusu, biz veri işleyeniz.
   - **Yurt dışına aktarım:** Render (Frankfurt ya da ABD) ve yapay zekâ sağlayıcısı yurt dışında. Haziran 2024'ten beri bunun yolu **standart sözleşme**; imzadan sonra kısa süre içinde Kurul'a bildirilmesi gerekiyor. Ya bu yapılır ya da Türkiye müşterileri için Türkiye'de barındırma seçilir.
   - **VERBİS:** Küçük işletmeler çalışan sayısı ve bilanço eşiklerine göre muaf olabilir. Eşikler Kurul kararlarıyla değişiyor, mali müşavire teyit ettirilir.
3. **İYS (İleti Yönetim Sistemi).**
   - Randevu hatırlatması bilgilendirme mesajıdır.
   - "Sizi özledik, %10 indirim" ticari elektronik iletidir. İYS kaydı ve İYS'de onayı olan alıcı ister.
   - Türkiye'de SMS'in yasal çerçevesi bu. Bugünkü kod ABD'nin STOP kuralına göre yazıldı; İYS kontrolü eklenmeli.
4. **Online satış.**
   - Mesafeli satış sözleşmesi ve ön bilgilendirme formu.
   - Ödeme için iyzico ya da PayTR.
   - Gerekirse ETBİS kaydı.

## 6. Sitede ürün ya da hizmet satmak için gerekenler

Bugün site **başvuru modunda** (`ALLOW_SIGNUP=false`). İnsanlar başvuruyor, hesabı biz açıyoruz. Pilot için doğrusu bu. Açık satışa geçmek için:

| İş | Durum |
|---|---|
| Fiyat sayfası: paketler, ne var ne yok, iptal koşulu | Yok |
| Ödeme ve abonelik | ABD'de Stripe hazır, kapalı. TR'de yok (iyzico ya da PayTR) |
| Kendi kendine kayıt ve deneme süresi | Kodda var, kapalı |
| Fatura | ABD'de Stripe keser. TR'de e-arşiv entegrasyonu yok |
| Yasal metinler: Terms, Privacy, DPA, SMS Terms / mesafeli satış, KVKK | Kısmen |
| Destek kanalı: WhatsApp hattı ya da e-posta, yanıt süresi | Yok |
| Kurulum ve eğitim içeriği: kısa videolar, ilk gün kontrol listesi | Kurulum sihirbazı var, içerik yok |
| Bayi takibi: bayi kodu, hangi dükkân hangi bayiden geldi, komisyon raporu | **Yok**, bayi modeli seçilirse yazılmalı |

## 7. Türkiye: yerel bilgisayarcı esnafı üzerinden satış

**Neden mantıklı:**

- Esnaf yazılımı internetten bulup kendi kurmaz, tanıdığına sorar. Mahallenin bilgisayarcısı zaten yazar kasayı, yazıcıyı ve kamerayı kuran kişi.
- Ürünün yönü de "işletmenin kendi bilgisayarında çalışan yerel ajan". Bu ajanı birinin gidip kurması, bağlaması ve arıza olunca bakması gerekiyor. Bilgisayarcı tam bu boşluğu dolduruyor.
- Bu bir dağıtım ağı. Rakibin kopyalaması yıllar alır.

**Önerilen bayi modeli:**

| Kalem | Öneri (sahada doğrulanacak) |
|---|---|
| Kurulum ücreti | Bayi kendi alır: kurulum, veri aktarımı ve eğitim için tek seferlik ücret |
| Tekrarlayan komisyon | Aylık abonelikten %20–30, müşteri kaldıkça sürer. Bayiyi müşteriyi elde tutmaya teşvik eder |
| Röntgen satışı | Tek seferlik teşhis raporundan pay. Bayinin "ilk satış" ürünü |
| Bayi paketi | Demo hesabı, 1 sayfalık tanıtım broşürü, kurulum kontrol listesi, 30 dakikalık eğitim, bayi kodu |
| Destek ayrımı | 1. seviye (kurulum, yazıcı, bağlantı) bayi. 2. seviye (hata, veri) biz |

**Başlangıç:**

1. Bir şehirde 2–3 bilgisayarcıyla konuş. Esnafa en yakın olanlar, POS ve yazarkasa işi yapanlar.
2. Her biri 3–5 dükkân getirsin. 60 günlük pilot `docs/ajan-plani.md`'deki gibi yürür.
3. Ölçülecekler:
   - kurulum kaç saat sürüyor;
   - 60 gün sonra kaç dükkân kalıyor;
   - bayi bunu ikinci kez satmak istiyor mu.

**Kodda gereken:**

- Bayi hesabı (rol).
- Dükkâna bağlı bayi kodu.
- Bayinin kendi dükkânlarının listesi ve aylık komisyon raporu.

Mevcut rol ve satır güvenliği yapısı buna uygun; bayi, "birden çok dükkânı gören" bir rol olur. Pilot başlamadan önce yazılması yeterli.

## 8. İki yol: şirket ve ürün

İki yol birbirini bekliyor. Şirket yolu bitmeden ürün canlı satılamaz. Ürün yolu bitmeden şirket kurmak boşa masraf olur. İkisi paralel yürür:

| Hafta | Şirket yolu (sen) | Ürün yolu (kod) |
|---|---|---|
| 1–2 | Pazar kararı (aşağıda). Şirket başvurusu. Avukat ve mali müşavirle ilk görüşme, bu listeyle | Gözetim ve alarmlar. Arka plan işlerine kilit. Yedek kopyalama ve ilk geri yükleme provası |
| 3–4 | EIN / vergi no, banka hesabı. Yasal metinlerin taslakları (ben yazarım, avukat düzeltir) | Fiyat sayfası. Destek kanalı. TR seçilirse İYS kontrolü ve iyzico |
| 5–6 | Twilio A2P, Plaid production, Square production başvuruları. Bunların onayı 1–4 hafta sürebilir | Bayi rolü ve komisyon raporu (bayi modeli seçilirse) |
| 7–8 | Ücretli Render planı, alan adı ve e-posta doğrulaması | 5–10 dükkânla kapalı pilot |
| 9+ | Pilot sonuçlarına göre açık satış | Pilot geri bildirimleri |

## 9. Uzun vadede ayakta kalacak şey ne?

Dürüst cevap:

- **Uzun vadede ayakta kalmayacak olan:** Tek başına "randevu + kasa + hatırlatma" uygulaması. ABD'de Square, Vagaro, Booksy ve Fresha bunu ucuza ya da bedava veriyor. Türkiye'de de ücretsiz rakipler var. Bu bölümde rekabet fiyatla olur, küçük bir ekip fiyat savaşını kazanamaz.
- **Ayakta kalacak olan:**
  1. **Veri katmanı.** İşletme sistemini değiştirmek zorunda kalmıyor; Square'ini, bankasını ve defterini olduğu gibi bağlıyor. Biz üstüne yıllarca biriken hafızayı ve teşhisi (Röntgen) koyuyoruz. Bir işletmenin 3 yıllık temizlenmiş, ilişkilendirilmiş verisi zamanla büyüyen bir değer. İşletme bizi bıraksa bile o hafızayı kaybetmek istemez.
  2. **Yerel ajan + kurulum ağı.** Veri işletmenin bilgisayarında kalıyor, kurulumu tanıdığı bilgisayarcı yapıyor. Bu, büyük bulut rakiplerinin yapmadığı bir şey. Türkiye gibi güvenin yüz yüze kurulduğu pazarlarda bayi ağı başlı başına bir rekabet avantajı.
  3. **Aylık hizmet.** Abonelik "uygulama kirası" değil, "her ay gelen karne ve reçete" olarak satılıyor. Bu da fiyatı rakiplerin bedava uygulamasından ayırıyor.
- **Asıl risk:** Aynı anda iki pazarı yürütmek. ABD hukuki olarak daha ağır ve uzaktan yürüyor, Türkiye hızlı ve yüz yüze. Tek kişiyle ikisi birden yarım kalır.

**Öneri:**

- Ürün tek kalsın. Kod zaten üç dil ve iki para birimini taşıyor.
- Saha doğrulaması Türkiye'de bayi pilotuyla yapılsın. Ucuz, hızlı ve sen bizzat görüşebilirsin.
- ABD'nin uzun süren evrak işi (LLC, A2P, Plaid) aynı anda arka planda yürüsün.
- Pilot "dükkânlar 60 gün sonra kalıyor mu" sorusuna evet derse, ABD'ye kanıtla girilir.
