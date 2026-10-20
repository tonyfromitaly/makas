# Banka bağlantısı (Plaid)

İşletmenin banka hesabındaki hareketler yalnızca okunur. Square satış tarafını biliyor; banka da gider
tarafını ve gerçek kasayı tamamlıyor. Röntgen ancak ikisi birlikte olunca başabaşı, nakit takvimini,
gider bulgularını ve kasa ömrünü hesaplayabiliyor.

- **Kod:**
  - `core/src/baglanti/plaid.ts`: Plaid'den okuma, hareketleri deftere çevirme, bakiye.
  - `core/src/baglanti/plaid-esitle.ts`: eşitleme, şifreli anahtar, defter satırları.
- **Testler:** `api/test/plaid.test.ts`. Sahte bir Plaid'e karşı çalışır; sayfalama ve değişiklikler
  gerçek API'deki gibi.

## Hareketler nereye gidiyor

| Bankada | Bizde |
| --- | --- |
| Kira | Gider · kira |
| Elektrik/gaz, su | Gider · elektrik, su |
| Telefon, internet, kablo | Gider · abonelik |
| Mağaza alışverişleri, malzeme | Gider · malzeme |
| Kredi ödemeleri | Gider · faiz ve finansman |
| Vergi ödemesi | Gider · vergi |
| Muhasebe hizmeti | Gider · muhasebe |
| Banka ücretleri, diğerleri | Gider · diğer |
| Bankamatikten nakit çekme | Sahibin çektiği (işletme gideri değil) |
| Kendi hesapların arası aktarım | Alınmaz |
| Para girişi | Gelir. **Ancak** satış sistemi (Square) ya da uygulamanın kendi defteri zaten gelir tutuyorsa alınmaz; yoksa aynı para iki kez sayılırdı (satış + bankaya yatan ödeme) |
| Bekleyen (pending) hareket | Kesinleşince alınır |

- **Kategoriler:** Plaid'in "personal finance category" sınıflandırmasından çevriliyor; eşleme
  `plaid.ts` içindeki `DETAY` tablosunda.
- **Defter:** Uygulamanın defterinde her gün için kategori başına tek satır görünür ("Banka · 1 kira").
- **Kasa:** Vadesiz ve tasarruf hesaplarının bugünkü bakiyesi. Röntgen bu bakiyeyi kayıtların başına
  geri hesaplayıp ileri doğru çalıştırır; son ayın kasası bugünkü bakiyeye eşit çıkar.
- **Eşitleme:** Plaid'in imleci (cursor) ile yalnızca değişenler gelir: yeni, düzeltilen ve silinen
  hareketler. Sunucu bağlı dükkânları her saat eşitler. İlk bağlantıda en fazla 2 yıllık geçmiş
  istenir.

## Güvenlik

- Erişim anahtarı AES-GCM ile şifreli saklanır (`CONNECTION_SECRET`). Uygulamaya hiçbir zaman gönderilmez.
- Banka giriş penceresi (Plaid Link) Plaid'in kendi sitesinden açılır. Banka şifresi bize hiç gelmez.
- Bağlantıyı kesmek Plaid'deki bağlantıyı da kaldırır (`/item/remove`). İstenirse okunan veriler de
  silinir.
- Uygulamanın güvenlik ayarlarına (CSP) yalnızca Plaid'in alan adları eklendi.

## Kurulum (sandbox ile deneme)

1. **dashboard.plaid.com** adresinde ücretsiz hesap aç.
2. **Developers → Keys** bölümünden **client_id** ve **Sandbox secret** değerlerini al.
3. `.env` dosyasına sen yaz (bana yapıştırma):
   ```
   PLAID_CLIENT_ID=...
   PLAID_SECRET=...
   PLAID_ENV=sandbox
   ```
4. Uygulamada **Ayarlar › Bağlantılar**'a git. İki yol var:
   - **Deneme bankası (sandbox):** Plaid'in test bankasını pencere açmadan bağlar. Test kullanıcısı
     `user_transactions_dynamic`, gerçekçi hareketler üretiyor.
   - **Bankanı bağla:** Plaid'in giriş penceresini açar. Sandbox'ta "First Platypus Bank" seçilir,
     kullanıcı `user_good`, şifre `pass_good`.

## Canlıya geçerken

- Plaid'in canlı ortamı için panelden başvuru gerekiyor. Deneme planında 10 bağlantıya kadar ücretsiz;
  sonra kullandıkça öde ve hareketler bağlantı başına aylık ücret (docs/baglanti-arastirmasi.md).
- `PLAID_ENV=production` ile birlikte canlı secret kullanılır.
