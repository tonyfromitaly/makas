# Monacount

**Berber dükkânı sahibinin telefonunda tek ekran: randevu defteri, gün kazancı, müşteri veresiye defteri ve otomatik WhatsApp/SMS hatırlatmaları.**

Para birimi dolar (dükkân başına değiştirilebilir). Abonelik ürünü olarak tasarlandı: her dükkân kendi verisini görür, işletme (biz) abonelikleri yönetir, mesajları ayrı bir altyapı gönderir. Arayüz Türkçe, İngilizce ve İspanyolca.

> **Web sitesi:** https://monacount.com · **Canlı demo:** https://monacount.com/demo/ (örnek verili: `/demo/?ornek=berber`, `/demo/?ornek=kuafor`)
> Demoda hiçbir kurulum yok: **gerçek sunucu kodu ve gerçek Postgres (PGlite, WebAssembly) tarayıcının içinde çalışır.** Sağ üstteki **Canlı demo** düğmesi mesaj altyapısını (Tony tarafı) ve işletme panelini oynamanı sağlar.

**Tanıtım filmi (19 sn):** [app/public/media/fade-film.mp4](app/public/media/fade-film.mp4). Demoyu ilk açışta da oynar.

---

## AI asistanı bağlamak

Canlıda asistan Claude (Anthropic) ile çalışır. DeepSeek yerel çalışma ve deneme için seçenek olarak duruyor.

1. Kök klasördeki `.env` dosyasında `ANTHROPIC_API_KEY=` satırına anahtarı yaz (console.anthropic.com → API Keys; dosya git'e girmez).
   - Denemede DeepSeek kullanmak için `ANTHROPIC_API_KEY`'i boş bırakıp `AI_API_KEY`'e DeepSeek anahtarını yaz.
   - İkisi de doluyken DeepSeek'i seçmek için `AI_PROVIDER=openai` ekle.
   - Canlı sunucu (`NODE_ENV=production`), `AI_PROVIDER=openai` açıkça yazılmadıkça DeepSeek anahtarını kullanmaz.
2. `npm run ai:check`: anahtarı tek bir anlama ve tek bir sohbet çağrısıyla dener.
3. `npm run ai:eval`: 40 cümlelik eğitim/ölçüm setini hem yerel motora hem modele sorar, isabet oranını yazar.
4. `npm run dev` → http://localhost:5173 → "Demo · fatihyahyayildizz@gmail.com" düğmesi → Asistan sekmesi.

Asistanın neyi bildiği, hangi kurallara bağlı olduğu ve nasıl ölçüldüğü: [docs/asistan-egitimi.md](docs/asistan-egitimi.md). GitHub Pages'teki canlı demo statik bir sayfa olduğu için anahtar taşıyamaz; orada her zaman yerleşik kural motoru çalışır.

## Web sitesi (Mona Mile Lab · Monacount)

`site/` tek sayfalık tanıtım sitesi: buğulu ayna (silince uygulama görünür), "Kimin için" sekmeleri (berber, kuaför, güzellik, sırada ne var), kaydırınca değişen telefon anlatımı, nasıl başlarız, güvenlik, hakkında ve **Demo talep et** formu (Netlify Forms). Marka adı, ürün adı ve e-posta tek dosyada: `site/brand.json`.

- Netlify'da yayın: `node scripts/build-netlify.mjs` → `netlify-dist/` (site `/`, demo `/demo/`, uygulama `/app/`); güvenlik başlıkları `netlify.toml` ve `_headers` içinde.
- `/api/*` istekleri Render'daki API'ye yönlendirilir: Netlify'da `API_ORIGIN` ortam değişkenini Render adresine ayarla.
- Yerelde kontrol: `node scripts/serve-netlify.mjs` (aynı başlık ve yönlendirmelerle) ve `node scripts/csp-check.mjs http://localhost:8888 / /demo/`.
- Uygulama ekran görüntüleri örnek verili demodan otomatik çekilir: `node scripts/shots.mjs`.

## Abonelik ve kilit

Gerçek uygulama kilitlidir: içeri yalnızca hesabı ya da **erişim anahtarı** olan girer, herkese açık "dükkân aç" kapalıdır.

1. Kişi web sitesindeki (`/`) **Abone ol** formunu doldurur ve Stripe'ın güvenli sayfasında öder.
2. Stripe ödemeyi onaylayınca sistem dükkânı açar ve tek kullanımlık bir anahtar (`MONA-XXXX-XXXX-XXXX`) üretir.
3. Resend, kişinin dilinde, uygulama linki ve anahtar içeren bir hoş geldin e-postası gönderir.
4. Kişi linke dokunur, anahtar otomatik dolar, şifresini belirler ve içeri girer.
5. Ödeme durursa kilit ekranı açılır; "Aboneliği yenile" Stripe portalına götürür, ödeme düzelince kilit kendiliğinden kalkar.

**Ödeme açılmadan önce** site başvuru alır: başvuru İşletme panelinin **Başvurular** sekmesine düşer, sen onaylayınca dükkân açılır ve link e-postayla gider. Stripe anahtarları girildiğinde form kendiliğinden ödemeye geçer.

Yayına alma (Render + Stripe + Resend) adım adım: [docs/yayina-alma.md](docs/yayina-alma.md). Repodaki `render.yaml` sunucuyu ve veritabanını tek tıkla kurar.

## Canlı destek: "Bize yaz"

Berber Ayarlar'daki **Bize yaz** kartından yazar; mesajlar sohbet olarak akar ve kart birkaç saniyede bir yenilenir. Ekip (işletme) cevabı **İşletme paneli**nden verir: uygulama adresinin sonuna `#operator` ekleyip (`http://localhost:5173/#operator`) `ADMIN_API_KEY` ile girilir. Cevap bekleyen sohbetler üstte listelenir. Ekipten gelen okunmamış cevaplar Ayarlar sekmesinde rozet olarak görünür. Canlı demoda panel, sağ üstteki **Canlı demo** düğmesinden anahtarsız açılır.

## Ne yapıyor?

| Ekran | İçerik |
|---|---|
| **Asistan** ✨ | Mikrofonla ya da yazıyla tek giriş noktası. Cümleyi anlar ve doğru yere hazırlar: **randevu**, **müşteri kaydı** ("yeni müşteri Ali Kaya 0532 444 55 66"), **defter** (bir cümlede birden çok tutar: "100 dolar kazandım, 300 dolar kira ödedim, 20 dolar bahşiş" → 3 ayrı kayıt), **veresiye**, **hatırlatma/ödeme** ("ayın 25'inde kira ödemesini hatırlat"). Sorulara cevap verir: "geçen ay ne kadar kazandık?", "bu ayki toplam masraf ne?", "bu ay ne kadar ödemem var?", "kim borçlu?", "yarın kaç randevum var?". Her kayıt tek dokunuşla onaylanır; **rakamları her zaman SQL hesaplar.** Açılışta gün özeti verir. |
| **Bugün** | Günü gelen hatırlatmalar ve ödemeler (geciken kırmızı), gün listesi, *Kasada / Beklenen* sayacı, tek dokunuşla tamamlandı/gelmedi/iptal, saat değiştirme, hatırlatma durum noktaları, **sesle randevu**, **Kasayı kapat** gün raporu (WhatsApp'tan paylaşılır) |
| **Müşteriler** | Arama; *Borçlu / Uzun süredir gelmeyen / Riskli* filtreleri; veresiye defteri (borç yaz, ödeme al); **gelmeme riski** rozeti; **geri çağır** mesajı; numara maskeli, açmak denetim kaydına düşer |
| **Defter** | Serbest not veya ses ("kira 18.000 ödedim") → **onay taslağı** → kayıt. Gün/hafta/ay gelir-gider-net, kategori kırılımı, günlük grafik, tek cümlelik yorum. **Bütün rakamlar SQL'den gelir; yapay zekâ hiçbir toplamı üretmez.** |
| **Ayarlar** | Dükkân, hizmetler, berberler, hatırlatma kuralı, dil, **canlı destek sohbeti (Bize yaz)**, verimi indir (JSON), dükkânı sil |
| **Kilit ekranı** | Abonelik pasifse uygulama kilitlenir; geri bildirim ve veri dışa aktarma açık kalır |

## Hızlı başlangıç

### 1) Sıfır kurulum (yalnızca Node 20+)
```bash
npm install
npm run dev
```
API gömülü Postgres (PGlite, `./api/.data`) ile `http://localhost:3000`'de, uygulama `http://localhost:5173`'te açılır. Demo dükkân (Berber Halil) boş olarak otomatik oluşur: yalnızca hizmet listesi ve iki berber hazırdır; müşteri, randevu ve defter kayıtlarını sen girersin. Giriş bilgisi `core/src/seed.ts` içindeki `DEMO_LOGIN`'dedir.

### 2) Üretim benzeri (Docker, tek komut)
```bash
cp .env.example .env    # sırları doldur: openssl rand -base64 48
docker compose up -d
```
Postgres 16 + API + web (nginx) + Caddy (otomatik HTTPS) + günlük yedek ayağa kalkar. `APP_DOMAIN` gerçek alan adınsa sertifika kendiliğinden alınır.

### 3) Canlı demoyu yerelde derle
```bash
npm run build:demo && npx vite preview --outDir app/dist
```

### Testler
```bash
npm test          # 112 test (abonelik akışı ve süper kullanıcısız veritabanı dahil): kiracı yalıtımı, kabul ölçütleri, asistan + 40 cümlelik eğitim seti, auth, ayrıştırıcılar, repo hijyeni
npm run typecheck
```

## Mimari (kısa)

```
core/   İş kuralları: rotalar, SQL, migration, hatırlatma motoru, ayrıştırıcılar (ortam bağımsız TypeScript)
api/    Fastify adaptörü: helmet, CORS, rate limit, HTTPS zorunluluğu, argon2id, pg havuzu, Stripe + Resend
site/   Web sitesi: tanıtım, fiyat, abonelik formu (üretimde / adresinde)
app/    React PWA (telefona kurulur, çevrimdışı açılır). Demo modunda core'u tarayıcıda PGlite ile çalıştırır
docs/   Mimari, API kontratı, güvenlik ve gizlilik, operasyon
```

Uygulama mesaj **göndermez**: randevu oluşunca `reminder_queue`'ya iki satır yazar. Mesaj altyapısı (Tony tarafı) servis anahtarıyla kuyruğu çeker, WhatsApp/SMS gönderir, sonucu geri yazar. Sağlayıcı değişse uygulama değişmez. Ayrıntı: [docs/architecture.md](docs/architecture.md), [docs/api.md](docs/api.md).

## Şemaya göre geliştirmeler

Temel şemadaki boşluklar kapatıldı, üstüne yenilikler eklendi:

1. **Çift sayım yok:** randevu *tamamlandı* olunca deftere tek bir `source=appointment` gelir satırı yazılır, geri alınınca silinir. Gün kazancı ve defter özeti tek kaynaktan gelir.
2. **`shops.currency`** eklendi; tutarlar her zaman kuruş (cents).
3. **Aynı koltuğa çift randevu imkânsız:** Postgres `EXCLUDE USING gist` kısıtı.
4. **Mesaj asla iki kez gitmez:** `due` çağrısı satırları 5 dakikalığına kiralar (`locked_until`, `FOR UPDATE SKIP LOCKED`).
5. **STOP cevabı için uç:** `POST /reminders/optout`. İzin anında kalkar, kuyruk durur.
6. **Geç alınan randevu:** vakti geçmiş hatırlatma `skipped / too_late` olarak yazılır. Zaman çizelgesi dürüst kalır, yaz saati geçişleri doğru hesaplanır.
7. **İşletme uçları:** `ADMIN_API_KEY` ile geri bildirim okuma, abonelik güncelleme, 90 günlük saklama işi.
8. **Çift katmanlı kiracı yalıtımı:** her sorgu `shop_id` ile filtrelenir, **ayrıca** Postgres row-level security kısıtlı bir rolle zorlanır. Bileşik yabancı anahtarlar başka dükkânın satırına bağ kurmayı veritabanı seviyesinde engeller.
9. **AI asistan:** Claude (`ANTHROPIC_API_KEY`) ile, yerelde isteğe bağlı olarak DeepSeek ya da OpenAI uyumlu herhangi bir modelle (`AI_API_KEY`) bağlanır; model yalnızca cümleyi yapılandırılmış bir plana çevirir (`core/src/assistant/plan.ts`). API planı doğrular, isimleri kayıtlara eşler, soruları SQL ile cevaplar; yazma işlemleri berber onayından geçer. Anahtar yoksa (ve canlı demoda) Türkçe/İngilizce/İspanyolca kural motoru (`core/src/assistant/local.ts`) aynı planı üretir.
10. **Yenilikler:** gelmeme riski, uzun süredir gelmeyen müşteriyi geri çağırma, kasayı kapat raporu, PWA, tarayıcıda çalışan canlı demo, mesaj altyapısı simülatörü, TR/EN/ES.

## Kabul ölçütleri → testler

| Ölçüt | Test |
|---|---|
| Kayıt → hizmet → müşteri → 3 randevu → gün listesi ve kazanç | `api/test/acceptance.test.ts` |
| Randevu başına 2 hatırlatma, servis anahtarıyla due, result güncellemesi | aynı dosya |
| *Tamamlandı* → kazanç artar; borç yazılır, ödemeyle kapanır | aynı dosya |
| "500 kazandım" + "kira 1800 ödedim" → onaylı kayıt; özet = satır toplamı | aynı dosya |
| Geri bildirim işletme tarafında okunur | aynı dosya |
| Abonelik pasif → kilit (402) | aynı dosya |
| A dükkânı B'nin müşterisini, randevusunu, defterini okuyamaz/yazamaz | `api/test/tenant-isolation.test.ts` |
| Asistan: çok tutarlı not, sesli müşteri kaydı, hatırlatma, "ne kadar ödemem var", SQL ile birebir cevaplar | `api/test/assistant.test.ts` |
| Repoda sır yok, `.env.example` değerleri boş | `api/test/repo-hygiene.test.ts` |

## Bu turda yok (şemada yeri hazır)
Çevrimiçi ödeme (Stripe alanları hazır), müşteriye açık rezervasyon sayfası, personel arayüzü (`barbers.user_id`, `users.role=barber` hazır), uygulama mağazası paketi.

## Görüntü ve araçlar
- Giriş ekranı ve film görüntüleri: [Pexels](https://www.pexels.com) (Pexels Lisansı) — 4178099, 7686515, 7697526, 7697135.
- Film [Remotion](https://www.remotion.dev) ile kodla üretildi; geçişler çapraz bir "makas kesiği", imza dokusu akan barber-pole bandı.

---
Lisans: MIT
