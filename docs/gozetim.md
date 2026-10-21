# Gözetim ve alarmlar

Sunucu bir şey bozulduğunda bunu loga yazmakla kalmaz, sana haber verir. Üç katman var.

## 1. Dışarıdan erişim kontrolü (sunucu tamamen düştüyse)

Sunucu kapandıysa kendi kendine haber veremez. Bunu dışarıdan bir servis yakalar.

- **Adres:** `https://monacount.com/api/health/ready`
  - Her şey yolundaysa `200` döner, bir sorun varsa `503`.
  - Cevapta yalnızca bozuk kontrolün adı görünür, ör. `{"ok":false,"failing":["connections"]}`. Ayrıntı yer almaz, dışarıya bilgi sızmaz.
- **Kurulum (5 dakika):**
  1. UptimeRobot ya da Better Stack'te ücretsiz hesap aç.
  2. Yeni bir HTTP monitörü ekle, adres yukarıdaki.
  3. Kontrol aralığını 5 dakika yap.
  4. Bildirim olarak e-postanı ya da telefonunu seç.
- Render'ın kendi sağlık kontrolü (`/api/health`) ayrıdır. O yalnızca "süreç ayakta mı" sorusuna bakar ve sunucuyu yeniden başlatmak için kullanılır.

## 2. Sunucunun kendi kontrolleri (15 dakikada bir)

Sunucu 15 dakikada bir şu kontrolleri yapar (`core/src/watch.ts`):

| Kontrol | Ne zaman bozuk sayılır |
|---|---|
| database | Veritabanına ulaşılamıyor |
| reminders | Bir gönderim kanalı açıkken 15 dakikadan fazla geciken hatırlatma var |
| reminder failures | Son 24 saatte 10 ya da daha fazla hatırlatma gönderilemedi |
| connections | Abonesi aktif bir dükkânın Square ya da banka bağlantısı 24 saattir eşitlenmedi ya da hata durumunda |
| job sync / job upkeep | Saatlik iş son çalışmasında hata verdi ya da 3 saattir başarılı olmadı |
| server errors | Son 15 dakikada 20 ya da daha fazla 5xx hatası |

Ayrıntılı sonuç operatör anahtarıyla görülebilir:

```bash
curl -H "Authorization: Bearer $ADMIN_API_KEY" https://monacount.com/api/admin/health
```

## 3. Alarm

Bir kontrol bozulduğunda sunucu mesaj gönderir:

- Sorun devam ediyorsa 6 saatte bir hatırlatır.
- Düzelince "düzeldi" mesajı atar.
- Sunucu çökerken de son bir mesaj göndermeye çalışır.

Render → fade → Environment'ta şunlardan birini ya da ikisini doldur:

- **`ALERT_EMAIL`:** kendi e-posta adresin. Resend üzerinden gider, yani `RESEND_API_KEY` ve doğrulanmış alan adı gerekir.
- **`ALERT_WEBHOOK_URL`:** bir Slack ya da Discord kanalının webhook adresi. Telefona bildirim için en hızlı yol bu.
  - Discord: Kanal → Ayarlar → Entegrasyonlar → Webhook.
  - Slack: Incoming Webhooks uygulaması.

İkisi de boşsa alarmlar yalnızca loga yazılır. Açılışta `alerts: log only` satırı bunu söyler.

## Saatlik işler tek kopyada çalışır

Eşitleme ve bakım, `job_runs` tablosundan bir kira (lease) alarak çalışır. Aynı anda iki sunucu kopyası açık olsa da her iş bir kez çalışır. Bu, Render'da yeni sürüm açılırken eskisiyle kısa süre çakıştığında da geçerli. Öteki kopya işi atlar ve loga `job skipped` yazar.

Kopya iş ortasında çökerse kira 55 dakika sonra düşer ve iş bir sonraki saatte devam eder. Hatırlatmalar zaten kendi kilitleriyle korunuyor (`reminder_queue.locked_until`).

## Henüz olmayan

- **Hata ayrıntısı takibi (Sentry vb.).** Şu an hata yığınları Render loglarında duruyor. Müşteri sayısı arttığında Sentry'nin ücretsiz planı eklenebilir. Bir ortam değişkeni ve birkaç satır kod.
- **Yedek geri yükleme provası.** Ücretli Postgres planına geçince ayda bir yapılmalı (`docs/operations.md`).
