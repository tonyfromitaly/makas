# ABD yasal metinleri: taslaklar

Bu klasördeki dört metin, avukatla konuşmayı hızlandırmak için yazılmış **taslaklardır**. Hukuki görüş değildir ve bu haliyle yayınlanmamalıdır. Hepsi sistemin bugün gerçekten yaptığına göre yazıldı: saklama süreleri, onay kaydı, STOP, dışa aktarma, silme ve alt işleyiciler. Avukatın düzelteceği yer hukuki dil ve risk dağılımı olmalı, olgular değil.

| Dosya | Ne işe yarar | Nerede kullanılır |
|---|---|---|
| `terms-of-service.md` | İşletmeyle aramızdaki sözleşme: abonelik, sorumluluk sınırı, kullanım kuralları, mesaj sorumluluğu | Kayıt ve ödeme ekranında "kabul ediyorum" |
| `privacy-policy.md` | Kimin verisini neden topluyoruz, kimle paylaşıyoruz, ne kadar saklıyoruz, haklar | Site altbilgisi. **Plaid ve Square başvuruları bu adresi ister** |
| `data-processing-addendum.md` | İşletme veri sorumlusu, biz işleyiciyiz: taahhütler ve güvenlik önlemleri | Terms'in parçası. Büyük müşteriler ayrıca ister |
| `sms-terms.md` | Hatırlatma SMS programının koşulları, STOP/HELP, örnek mesajlar | Online randevu sayfası. **Twilio A2P 10DLC kampanya kaydı bu adresi ister** |

## Köşeli parantezler

Şirket kurulunca doldurulacaklar:

- `[COMPANY LEGAL NAME]`, `[STATE]`, `[ADDRESS]`;
- `[SUPPORT EMAIL]`, `[PRIVACY EMAIL]`;
- `[EFFECTIVE DATE]`;
- `[REGION]`: Render bölgesi;
- `[BACKUP RETENTION]`: ücretli Postgres planının yedek süresi;

## Avukata sorulacaklar

1. **TCPA ve hatırlatma ayrımı.**
   - Randevu hatırlatması "işlemsel" mesaj sayılıyor ve onay kutusu yeterli mi?
   - Gönderen işletme mi, biz mi? Sorumluluk nasıl paylaşılıyor?
   - Florida ve Oklahoma gibi "mini-TCPA" eyaletlerinde saat kısıtı var mı?
2. **Terms 4. bölümdeki tazminat (indemnity).** Küçük işletmeye fazla ağır mı? Satışı zorlaştırır mı?
3. **Uyuşmazlık.** Mahkeme mi, tahkim mi? Hangi eyalet?
4. **Sorumluluk sınırı.** "Son 12 ayda ödenen ücret" yeterli mi? Banka verisi tuttuğumuz için ayrı bir veri ihlali sınırı gerekir mi?
5. **Eyalet gizlilik yasaları.** Küçük bir şirket olarak çoğu eyaletin eşiğinin altında kalırız. Yine de işleyici olarak DPA şart. Metin yeterli mi?
6. **Yurt dışı.** Kurucu Türkiye'de. Veriye Türkiye'den erişim "uluslararası aktarım" sayılır mı, gizlilik politikasında nasıl yazılmalı?
7. **Sigorta.** Siber sorumluluk ve E&O poliçesi hangi limitte olmalı?

## Kodda ve hesaplarda yapılanlar, yapılacaklar

- ✓ **Onay kutusu artık boş başlıyor.**
  - Online randevu sayfasındaki "hatırlatma gönder" kutusu önceden işaretli geliyordu. ABD taşıyıcıları (10DLC kampanya incelemesi) ve TCPA önceden işaretli kutuyu onay saymıyor.
  - Kutu artık boş başlıyor.
  - Metni taşıyıcıların istediği satırları içeriyor: mesaj sayısı, "Msg & data rates may apply", STOP, HELP.
- ☐ **Twilio'da Messaging Service ve Advanced Opt-Out.**
  - `TWILIO_FROM`'a numara yerine Messaging Service kimliği (`MG…`) yazılmalı. Kod bunu destekliyor.
  - HELP ve START cevapları `sms-terms.md`'deki metinlerle Twilio konsolunda ayarlanmalı. HELP cevabı bizim kodumuzda yok, Twilio veriyor.
- ✓ **Yapay zekâ sağlayıcısı Claude oldu.**
  - Asistan canlıda Anthropic Claude ile çalışıyor (`ANTHROPIC_API_KEY`).
  - DeepSeek (Çin merkezli) yalnızca yerel çalışma ve deneme için seçenek olarak duruyor.
  - Canlı sunucu, `AI_PROVIDER=openai` açıkça yazılmadıkça DeepSeek anahtarını kullanmaz.
  - Defter notu ayrıştırma servisi (`PARSE_SERVICE_URL`) ayrı bir yol ve arkasında DeepSeek var. Canlıda boş kalmalı; boşken yerel ayrıştırıcı çalışır. `render.yaml`'da tanımlı değil.
  - Gizlilik politikasında alt işleyici olarak Anthropic yazıyor. Avukat, Anthropic'in ticari şartlarını ve veri işleme ekini (DPA) bizim DPA'mızla birlikte gözden geçirmeli.
- ☐ **Metinleri siteye koymak.** Avukat onayından sonra `site/` altında `/terms`, `/privacy`, `/dpa`, `/sms-terms` sayfaları yapılır ve kayıt, ödeme ve randevu sayfalarından bağlanır.
- ☐ **Sağlayıcı hesaplarında iki adımlı doğrulama.** DPA'da taahhüt ediliyor: Render, Netlify, Twilio, Square, Plaid, Stripe, Resend ve GitHub hesaplarının hepsinde açık olmalı.
