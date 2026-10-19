# Kurulum sihirbazı

İşletme sahibi birkaç soruya cevap verir. Sistem o işletmeye özel ajanı ve kurulumu yazar. Bu, yerel
çalışan "iş yönetimi ajanı" fikrinin ilk parçası. Uygulama işletmenin kendi bilgisayarında çalışacak,
veri orada kalacak, biz yalnızca aracı olacağız.

- **Ekran:** uygulamada `#kurulum` adresi (`app/src/screens/Setup.tsx`). Tarayıcıda çalışır, hiçbir şey
  göndermez.
- **Katalog:** `core/src/kurulum/katalog.ts`
  - 6 işletme şablonu
  - 17 sistem
  - 10 dert
  - 13 modül
  - çalışma şekilleri ve gizlilik seçenekleri

  Yeni bir işletme türü ya da sistem eklemek tek bir kayıt eklemek demek.
- **Üretici:** `core/src/kurulum/uret.ts` → `kurulumUret(cevaplar)`. Şunları yazar:
  - SOUL.md (ajanın kimliği)
  - AGENT.md (görevler, bağlı sistemler, roller, verinin nerede durduğu)
  - modüllerin açık/kapalı durumu ve gerekçesi
  - bağlantı adımları
  - kurulum adımları
  - uyarılar

  Kodla yazılır ve deterministiktir: aynı cevaplar her zaman aynı ajanı verir, yapay zekâ jetonu
  harcanmaz.
- **Testler:** `api/test/kurulum.test.ts`
- **Ekran görüntüleri:** `node scripts/setup-shots.mjs http://localhost:5180 tasarim/kurulum` (önce demo
  sunucusunu aç).

## Henüz olmayanlar

- **Bağlantılar gerçek değil.** "Doğrudan bağlantı" ve "dosya ile" etiketleri firmaların açıkladıklarına
  göre bizim beklentimiz. Her firma tek tek doğrulanacak (API var mı, ücretli mi, onay gerekiyor mu).
  İlk sırada Square, Booksy/Fresha dışa aktarma dosyası ve Plaid var.
- **Masaüstü paketi yok.** Gerekenler:
  - veritabanını, ajanı ve bağlantıları tek bir programda kurmak
  - yerel model seçeneği
  - telefon eşleştirmesi için yalnızca mesaj ileten aracı servis
- **Ajan dosyaları henüz çalışan asistana bağlanmadı.** Üretilen SOUL.md ve AGENT.md şu an indirilebilir.
  Sıradaki adım: asistanın, kendi işletmesinin dosyasını kullanması.
