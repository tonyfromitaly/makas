# Makas ✂️

**Berber dükkânı sahibinin telefonunda tek ekran: randevu defteri, gün kazancı, müşteri veresiye defteri ve otomatik WhatsApp/SMS hatırlatmaları.**

Abonelik ürünü olarak tasarlandı: her dükkân kendi verisini görür, işletme (biz) abonelikleri yönetir, mesajları ayrı bir altyapı gönderir. Arayüz Türkçe, İngilizce ve İspanyolca.

> **Canlı demo:** https://tonyfromitaly.github.io/makas/
> Demoda hiçbir kurulum yok: **gerçek sunucu kodu ve gerçek Postgres (PGlite, WebAssembly) tarayıcının içinde çalışır.** Sağ üstteki **Canlı demo** düğmesi mesaj altyapısını (Tony tarafı) ve işletme panelini oynamanı sağlar.

---

## Ne yapıyor?

| Ekran | İçerik |
|---|---|
| **Bugün** | Gün listesi, *Kasada / Beklenen* sayacı, tek dokunuşla tamamlandı/gelmedi/iptal, saat değiştirme, hatırlatma durum noktaları, **sesle randevu**, **Kasayı kapat** gün raporu (WhatsApp'tan paylaşılır) |
| **Müşteriler** | Arama; *Borçlu / Uzun süredir gelmeyen / Riskli* filtreleri; veresiye defteri (borç yaz, ödeme al); **gelmeme riski** rozeti; **geri çağır** mesajı; numara maskeli, açmak denetim kaydına düşer |
| **Defter** | Serbest not veya ses ("kira 18.000 ödedim") → **onay taslağı** → kayıt. Gün/hafta/ay gelir-gider-net, kategori kırılımı, günlük grafik, tek cümlelik yorum. **Bütün rakamlar SQL'den gelir; yapay zekâ hiçbir toplamı üretmez.** |
| **Ayarlar** | Dükkân, hizmetler, berberler, hatırlatma kuralı, dil, geri bildirim, verimi indir (JSON), dükkânı sil |
| **Kilit ekranı** | Abonelik pasifse uygulama kilitlenir; geri bildirim ve veri dışa aktarma açık kalır |

## Hızlı başlangıç

### 1) Sıfır kurulum (yalnızca Node 20+)
```bash
npm install
npm run dev
```
API gömülü Postgres (PGlite, `./api/.data`) ile `http://localhost:3000`'de, uygulama `http://localhost:5173`'te açılır. Demo dükkân otomatik oluşur, giriş bilgisi `core/src/seed.ts` içindeki `DEMO_LOGIN`'dedir.

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
npm test          # 43 test: kiracı yalıtımı, kabul ölçütleri, auth, ayrıştırıcılar, repo hijyeni
npm run typecheck
```

## Mimari (kısa)

```
core/   İş kuralları: rotalar, SQL, migration, hatırlatma motoru, ayrıştırıcılar (ortam bağımsız TypeScript)
api/    Fastify adaptörü: helmet, CORS, rate limit, HTTPS zorunluluğu, argon2id, pg havuzu
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
9. **Yenilikler:** gelmeme riski, uzun süredir gelmeyen müşteriyi geri çağırma, kasayı kapat raporu, PWA, tarayıcıda çalışan canlı demo, mesaj altyapısı simülatörü, TR/EN/ES.

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
| Repoda sır yok, `.env.example` değerleri boş | `api/test/repo-hygiene.test.ts` |

## Bu turda yok (şemada yeri hazır)
Çevrimiçi ödeme (Stripe alanları hazır), müşteriye açık rezervasyon sayfası, personel arayüzü (`barbers.user_id`, `users.role=barber` hazır), uygulama mağazası paketi.

---
Lisans: MIT
