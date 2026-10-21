# Gerçek Postgres doğrulaması

Şimdiye kadar bütün testler PGlite'ta, yani Postgres'in gömülü sürümünde koştu. Canlıda veritabanı Render'daki gerçek Postgres olacak. Bu doğrulama, aynı kodun orada da çalıştığını gösterir:

- migration'lar uygulanıyor mu;
- her dükkânın verisi satır güvenliğiyle (RLS) ayrı tutuluyor mu;
- `btree_gist` eklentisi ve çakışma kuralları yerinde mi;
- uygulamanın bütün akışı (test alanındaki 55 adım) bu veritabanında baştan sona çalışıyor mu.

Canlı veritabanına dokunulmaz. Ayrı ve atılabilir bir **deneme veritabanı** açılır.

## Senin yapacakların (5 dakika)

1. **Render'da deneme veritabanı aç.**
   - <https://dashboard.render.com> → sağ üstte **New** → **Postgres**.
   - **Name:** `fade-staging-db`.
   - **Region:** Frankfurt (`render.yaml` ile aynı bölge).
   - **PostgreSQL Version:** 16.
   - **Plan:** Free (deneme için yeter; işin bitince silebilirsin).
   - **Create Database** de. Hazır olması bir iki dakika sürer; durum "Available" olunca devam et.
2. **Dış bağlantı adresini kopyala.** Veritabanının sayfasında **Connect** → **External** sekmesindeki **External Database URL**'i kopyala. `postgresql://…@…frankfurt-postgres.render.com/…` gibi görünür.
3. **Bilgisayarının adresini izinli listeye ekle.** Aynı sayfada **Networking** / **Access Control** bölümü var. Varsayılan ayar her yerden bağlantıya izin veriyorsa bir şey yapma. Sadece belirli adreslere açıksa **Add current IP** de.
4. **Adresi `.env`'ye yaz** (bana yapıştırma). Proje kökündeki `.env` dosyasına şu satırı ekle, kaydet:

   ```
   STAGING_DATABASE_URL=postgresql://...kopyaladığın adres...
   ```

5. Bana "hazır" de.

## Benim yapacaklarım

1. **Postgres denetimi** (`npm run pg:check -w api`). Deneme veritabanına bağlanır, migration'ları uygular ve şunları kontrol eder:
   - Uygulamanın sorgularına satır güvenliği uygulanıyor mu? Render, `CREATEROLE` yetkisi olmayan sıradan bir sahip kullanıcı verir; kod bu durumda `FORCE ROW LEVEL SECURITY`'ye dayanır.
   - 22 dükkân tablosunun hepsinde RLS zorunlu mu?
   - `btree_gist` eklentisi ve iki çakışma kuralı (kişi; koltuk/oda) yerinde mi?
   - İki geçici dükkânla deneme: biri ötekinin müşterisini ve koltuğunu görebiliyor mu, ötekine yazabiliyor mu, ötekinin satırını değiştirebiliyor mu?
   - Dükkân seçilmeden sorgu atılınca hiçbir satır görünmüyor mu?
   - Geçici dükkânlar iş bitince silinir.
2. **Test alanı, bu kez gerçek Postgres'le.** Aynı üretim modu API (`staging-api-pg`) deneme veritabanıyla açılır. Netlify'ı taklit eden yerel sunucunun arkasında uçtan uca test betiği (`scripts/staging-e2e.mjs`) koşar: 55 adım, Square ve Plaid sandbox dahil.
3. Sonuçlar `docs/canli-oncesi-test-raporu.md`'ye işlenir.

## Sorun çıkarsa

- **`self-signed certificate` ya da `certificate` hatası.** `.env`'ye `PGSSLMODE=no-verify` satırını ekle. Bağlantı yine şifreli olur, yalnızca sertifika doğrulanmaz. Bu sadece deneme bağlantısı içindir.
- **`ECONNREFUSED` ya da `timeout`.** 3. adımdaki izin listesinde bilgisayarının adresi yok demektir.
- **`btree_gist` eksik.** Render'da bu eklenti normalde kurulabilir. Kurulamazsa API çakışmaları yine kendisi kontrol eder; denetim bunu ayrı bir uyarı olarak yazar.

## Bitince

- Deneme veritabanını Render'dan silebilirsin. Render'da veritabanını aç → **Settings** → **Delete Database**.
- `.env`'deki `STAGING_DATABASE_URL` satırını da sil.
- Canlı veritabanı `render.yaml` ile ayrıca kurulur; o zaman bu denetim aynı betikle tekrar koşturulabilir.
