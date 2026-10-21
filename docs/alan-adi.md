# monacount.com: alan adı, site ve e-posta

> Site 21 Ekim 2026'da Cloudflare Pages'e taşındı (`docs/cloudflare-pages.md`). Aşağıdaki 1. ve 2. bölümler artık geçersiz: Netlify'daki geçici kurulumu anlatıyorlar ve yalnızca kayıt olarak duruyorlar. `monacount.com` ve `www` kayıtlarını artık Pages yönetiyor.

| Ne | Nerede |
|---|---|
| Alan adı | Cloudflare'da kayıtlı. DNS de Cloudflare'da |
| Site, demo, uygulama, randevu sayfaları | Cloudflare Pages, proje `monacount` (`docs/cloudflare-pages.md`) |
| API | Render. `/api/*` isteklerini Pages Function (önceden Netlify) oraya iletir |
| Giden e-posta | Resend, `send.monacount.com` alt alanı üzerinden |
| Gelen e-posta (`support@`) | Cloudflare Email Routing, Gmail'e yönlendirir |

## 1. Netlify

1. `usta-fade` sitesini aç → **Domain management** → **Add a domain**.
2. `monacount.com` yaz → **Verify** → **Add domain**. Netlify DNS önerisini kabul etme; DNS Cloudflare'da kalacak.
3. `www.monacount.com`'u da ekle.
4. `monacount.com` için **Set as primary domain** de.

## 2. Cloudflare DNS

**DNS → Records:**

1. Kök (`@`) ve `www` için park sayfasına giden eski kayıtları sil.
2. Şu iki kaydı ekle:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `@` | `usta-fade.netlify.app` | **DNS only** (gri bulut) |
| CNAME | `www` | `usta-fade.netlify.app` | **DNS only** (gri bulut) |

- **Proxy kapalı olmalı.** Açık olursa Netlify SSL sertifikası (Let's Encrypt) alamaz.
- **SSL/TLS → Full (strict).**
- Sertifika genelde 5–30 dakikada hazır olur: Netlify'da domain satırında "HTTPS: certificate provisioned" görünür.

## 3. Resend

1. **Domains → Add Domain** → `monacount.com`, bölge **US East (N. Virginia)**.
2. Gösterilen kayıtları Cloudflare'a aynen ekle. Örnek değerler aşağıda; **geçerli olan, Resend ekranındaki değerler**:

| Type | Name | İçerik |
|---|---|---|
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | `p=…` (uzun DKIM anahtarı, tek parça) |
| TXT | `_dmarc` | `v=DMARC1; p=none;` |

3. Resend'de **Verify** de.

## 4. support@monacount.com

1. Cloudflare → **Email → Email Routing → Get started**.
2. `support` adresinin hedefi kendi Gmail adresin olsun; gelen doğrulama e-postasını onayla.
3. Cloudflare kök alana kendi MX kayıtlarını ekler. Bunlar Resend'in `send` alt alanındaki kayıtlarla çakışmaz.

## 5. Bittikten sonra (kod ve paneller)

- **Render → fade → Environment:**
  - `PUBLIC_URL=https://monacount.com`. `render.yaml` güncel; elle girilmişse panelde de değiştir.
  - `MAIL_FROM=Monacount <hello@monacount.com>`.
  - `ALERT_EMAIL` istenirse `support@monacount.com`.
- **Square:** Redirect URL `https://monacount.com/app/`.
- **Plaid:** izinli alan adı ve redirect URI `https://monacount.com/app/`.
- **Twilio:** gelen mesaj webhook'u `https://monacount.com/api/webhooks/twilio`. İmza bu adresle hesaplanıyor, bu yüzden `PUBLIC_URL` ile aynı olmalı.
- **Site:** `site/brand.json`'daki iletişim adresi `support@monacount.com` yapılır.
