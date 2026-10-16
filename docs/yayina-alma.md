# Fade'i yayına almak: Render + Stripe + Resend

Sonuç: `https://<senin-adın>.onrender.com` adresinde web sitesi, `/app/` altında kilitli uygulama. Biri siteden abone olur, kartla öder, uygulama linki ve erişim anahtarı e-postasına düşer.

```
web sitesi (/)  →  "Abone ol" formu  →  Stripe ödeme sayfası
                                            │ ödeme tamam
                                            ▼
               Stripe webhook  →  /api/billing/webhook  →  dükkân + sahip hesabı + erişim anahtarı
                                                                     │
                                                                     ▼
                                     Resend  →  "Fade hazır" e-postası (link + FADE-XXXX-XXXX-XXXX)
                                                                     │
                                                                     ▼
                                     /app/#key=…  →  şifre belirle  →  dükkân açık
```

## 1. Stripe (ödeme)

1. https://dashboard.stripe.com adresinde hesap aç. Önce **Test modu**nda çalış (sağ üstteki anahtar).
2. **Ürün kataloğu → Ürün ekle**: ad `Fade Pro`, fiyat örneğin `29 USD`, **Yinelenen / Aylık**. Kaydettikten sonra fiyatın kimliğini kopyala (`price_...`). Bu `STRIPE_PRICE_ID` olacak.
3. **Geliştiriciler → API anahtarları**: gizli anahtarı kopyala (`sk_test_...`). Bu `STRIPE_SECRET_KEY` olacak.
4. **Ayarlar → Faturalandırma → Müşteri portalı**: portalı etkinleştir (kart değişikliği, fatura geçmişi, iptal). Uygulamadaki "Aboneliği yönet" düğmesi bu portala gider.
5. Webhook'u 3. adımdan sonra, Render adresin belli olunca kuracağız.

## 2. Resend (hoş geldin e-postası)

1. https://resend.com adresinde hesap aç ve **API Keys → Create** ile bir anahtar al (`re_...`). Bu `RESEND_API_KEY` olacak.
2. **Domains → Add domain** ile kendi alan adını ekle ve DNS kayıtlarını gir. Alan adı doğrulanmadan Resend yalnızca senin hesap e-postana gönderim yapar; müşterilere göndermek için doğrulanmış alan adı şart.
3. `MAIL_FROM` değerini `Fade <merhaba@alanadin.com>` gibi ayarla.

## 3. Render (sunucu ve veritabanı)

1. https://render.com adresinde GitHub hesabınla giriş yap.
2. **New → Blueprint**'e tıkla, `tonyfromitaly/makas` reposunu seç. Render, repodaki `render.yaml` dosyasını okuyup web servisini ve Postgres veritabanını kendisi kurar. `JWT_SECRET`, `SERVICE_API_KEY` ve `ADMIN_API_KEY` otomatik üretilir.
3. Senden istenen değerleri gir: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `RESEND_API_KEY`, `MAIL_FROM`, `AI_API_KEY` (DeepSeek). `STRIPE_WEBHOOK_SECRET`'ı şimdilik boş bırak.
4. İlk yayın bitince adresin belli olur: `https://fade-xxxx.onrender.com`. Sitenin `/` adresinde, uygulamanın `/app/` adresinde açıldığını kontrol et.

## 4. Stripe webhook

1. Stripe → **Geliştiriciler → Webhook'lar → Uç nokta ekle**.
2. URL: `https://fade-xxxx.onrender.com/api/billing/webhook`
3. Olaylar: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Kaydet ve **İmzalama sırrı**nı kopyala (`whsec_...`). Render'da `STRIPE_WEBHOOK_SECRET` olarak gir; servis yeniden başlar.

## 5. Dene

1. Siteyi aç, formu doldur, Stripe test kartıyla öde: `4242 4242 4242 4242`, ileri bir tarih, herhangi bir CVC.
2. E-postana "Fade hazır" gelir (alan adı doğrulanmadıysa yalnızca Resend hesabının e-postasına). Linke dokun, şifreni belirle, içeridesin.
3. Stripe'ta aboneliği iptal et ya da ödemeyi başarısız yap: uygulama kilit ekranına düşer. Ödeme düzelince kilit kendiliğinden açılır.
4. Gerçek ödemeye geçmek için Stripe'ı **Canlı mod**a al; canlı moddaki fiyat kimliği, gizli anahtar ve webhook sırrıyla Render'daki değerleri değiştir.

## İşletme işleri

- **E-postası kaybolan müşteri:** `POST /api/admin/shops/<shop_id>/access-key` ile yeni anahtar üret (`ADMIN_API_KEY` ile; Render → Environment'tan görebilirsin) ve müşteriye ilet. Anahtar tek kullanımlık ve 14 gün geçerli.
- **Destek:** `https://fade-xxxx.onrender.com/app/#operator` adresinde `ADMIN_API_KEY` ile İşletme paneli.
- **Ücretsiz plan notları:** Render'ın ücretsiz web servisi 15 dakika boşta kalınca uyur; ilk istek 30-60 saniye sürebilir. Ücretsiz Postgres sınırlı süre ücretsizdir. Gerçek müşteriler gelmeden önce iki hizmeti de ücretli plana geçir.
- **Canlı demo** GitHub Pages'te ayrı ve açık kalır; gerçek veriye dokunmaz.
