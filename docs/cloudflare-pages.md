# Cloudflare Pages: site, demo, uygulama ve randevu sayfaları

Netlify'ın yaptığı işi artık Cloudflare Pages yapıyor. Böylece alan adı, DNS, site ve e-posta yönlendirmesi tek panelde toplanıyor. API ve veritabanı yine Render'da.

| Parça | Nerede |
|---|---|
| Derleme | `npm run build:pages` → `web-dist/` (`scripts/build-netlify.mjs`, `WEB_HOST=cloudflare`) |
| `/api/*` | `functions/api/[[path]].js`. İsteği `API_ORIGIN`'deki sunucuya (Render) aynen iletir: ziyaretçi adresi `X-Forwarded-For`'da, HTTPS bilgisi `X-Forwarded-Proto`'da gider |
| Güvenlik başlıkları | `web-dist/_headers`. Kaynağı hâlâ `netlify.toml`'daki `[[headers]]` blokları |
| Tek sayfa yedekleri | `functions/{app,demo,book}/[[path]].js` (`functions-lib/spa.js`): önce dosya sunulur; dosya yoksa ve tarayıcı bir sayfa istiyorsa uygulamanın `index.html`'i verilir. `_redirects` kullanılmıyor, çünkü Pages yönlendirme kurallarını dosyalardan önce uygular ve `/app/assets/*.js`'i de sayfaya çevirirdi. `_routes.json` asset klasörlerini fonksiyonların dışında tutar |
| Bilinmeyen adres | `404.html`. Bu dosya olmasa Pages her adrese ana sayfayı başlıksız sunar |
| Demo formu | `POST /api/public/demo-requests`. Kayıt `demo_requests` tablosuna yazılır, operatöre `ALERT_EMAIL` ya da `ALERT_WEBHOOK_URL` ile haber gider, kayıtlar 12 ay sonra silinir. Operatör listesi: `GET /api/admin/demo-requests` |

Yerelde denemek için:

```bash
npm run build:pages
```

```bash
npx wrangler@4 pages dev web-dist --binding API_ORIGIN=http://127.0.0.1:3100
```

## Durum (21 Ekim 2026)

- Pages projesi `monacount`, `tonyfromitaly/makas` deposunun `main` dalına bağlı. Her push otomatik derlenip yayınlanır. Önizleme adresi: `monacount.pages.dev`.
- `monacount.com` ve `www.monacount.com` Pages'e bağlı. Sertifikayı Cloudflare veriyor (Google Trust Services).
- `www` adresi, bir yönlendirme kuralıyla (Rules → Redirect Rules) `monacount.com`'a 301 ile gider; sorgu parametreleri korunur.
- Netlify'dan alan adı kaldırıldı. Depo zaten bağlı değildi. Netlify Forms'ta kayıtlı talep yoktu.
- `API_ORIGIN` henüz boş, çünkü API Render'da canlı değil. Bu sürece kadar:
  - `/api` 503 `API_OFFLINE` döner;
  - uygulamaya giriş ve sitedeki demo formu çalışmaz; form hata mesajı gösterir, sayfadaki e-posta bağlantısı çalışır.
  - Render açılınca: Pages → Settings → Variables and Secrets → `API_ORIGIN` = Render adresi → yeniden yayınla (Deployments → Retry).

## Kurulum (bir kez, yapıldı)

1. **Projeyi oluştur.** Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
   - GitHub'a izin ver ve `tonyfromitaly/makas` deposunu seç.
   - GitHub yetkisini sen onaylarsın.
2. **Build settings:**
   - Framework preset: **None**.
   - Build command: `npm run build:pages`.
   - Build output directory: `web-dist`.
   - Root directory: boş bırak.
3. **Environment variables (Production):**
   - `NODE_VERSION` = `22`.
   - `API_ORIGIN` = Render'daki API adresi, ör. `https://monacount-api.onrender.com`. Boşsa `/api` 503 "API_OFFLINE" döner.
4. **Save and Deploy.** Bitince `<proje>.pages.dev` adresinde site açılır; orada dene.
5. **Alan adını çevir:**
   - Cloudflare → DNS → Records'ta Netlify'a giden iki CNAME'i sil (`monacount.com` ve `www` → `usta-fade.netlify.app`).
   - Pages projesi → **Custom domains** → **Set up a custom domain** → `monacount.com`. Ardından `www.monacount.com`.
   - Cloudflare kayıtları ve sertifikayı kendisi kurar; birkaç dakika sürer.
6. **Netlify'ı kapat:**
   - Domain'i kaldır: Domain management → Options → Remove.
   - Depo bağlantısını kes (Build & deploy → Unlink), yoksa her push iki yerde yayınlanır.
   - Netlify Forms'ta eski demo talepleri varsa önce dışa aktar.

## Değişmeyenler

- Render'daki `PUBLIC_URL=https://monacount.com` aynı kalır.
- Square, Plaid ve Twilio adresleri aynı kalır: Square/Plaid için `https://monacount.com/app/`, Twilio için `/api/webhooks/twilio`.
- Resend ve Email Routing kayıtları DNS'te ayrı satırlardır; taşımadan etkilenmez.
