# Fade AI asistanının eğitimi

Asistan, berberin gün içinde söylediği ya da yazdığı her şeyi doğru yere işleyen ve dükkânın rakamlarını soran berbere cevap veren yardımcıdır. Bu doküman ona ne öğrettiğimizi, hangi kurallara bağlı olduğunu ve nasıl ölçtüğümüzü anlatır.

## Eğitim nasıl yapılıyor?

Model ince ayar (fine-tune) ile değiştirilmiyor; bunun yerine **her çağrıda aynı eğitim paketiyle yönlendiriliyor**. Bu yöntem daha ucuz, anında güncellenebilir ve her değişiklik ölçülebilir:

| Parça | Dosya | İçerik |
|---|---|---|
| Dükkân bilgisi | `core/src/assistant/training.ts` → `SHOP_KNOWLEDGE` | Bir berber dükkânının işleyişi: hizmetler ve süreleri, yoğun saatler, gelmeyen müşteri (no-show) kaybı, düzenli müşteri döngüsü (3–5 hafta), veresiye kültürü, gelir ve gider kalemleri, kira ve fatura takvimi, sağlıklı işletme işaretleri, mesaj izni ve STOP kuralı |
| Anlama talimatı | `UNDERSTAND_SYSTEM` | Cümleyi yapılandırılmış bir plana çeviren kurallar: çok tutarlı not bölme, "ödedim" ile "ödedi" farkı, hatırlatma ve ödeme ayrımı, Türkçe tutar biçimleri (1.800 / 12,50 / 2 bin), göreli tarihler ("ayın 25'i", "yarın"), berberde "saat 3" = 15:00 |
| Örnek konuşmalar | `FEW_SHOT` | Türkçe, İngilizce ve İspanyolca 18 çözülmüş örnek; model her çağrıda bunları önceki konuşma olarak görür |
| Sohbet talimatı | `CHAT_SYSTEM` | Açık soruları ("müşterim neden azaldı?") deneyimli bir dükkân yöneticisi gibi, kısa ve uygulanabilir cevaplama kuralları |
| Ölçüm seti | `api/test/assistant-eval.json` | 40 gerçekçi cümle ve beklenen sonuç |

## Değişmez kurallar

1. **Hesabı yapay zekâ yapmaz.** Model hiçbir toplamı üretmez. "Geçen ay ne kadar kazandık?" sorusunda model yalnızca `{metric: income, period: last_month}` niyetini çıkarır; rakamı veritabanı SQL ile hesaplar.
2. **Onaysız kayıt yok.** Randevu, müşteri, defter, veresiye ve hatırlatma önce taslak kart olarak gelir; berber onaylayınca normal uçlardan (doğrulama, denetim kaydı, kiracı yalıtımı) yazılır.
3. **Sohbet cevapları yalnızca dükkânın gerçek verisine dayanır.** Model sorulara cevap verirken yalnızca SQL ile hesaplanmış bir özet görür (bu ay ve geçen ay gelir/gider, son 60 günde gelmeme oranı, ortalama fiş, en çok yapılan hizmetler, günlere göre gelir, uzun süredir gelmeyen müşteri sayısı, alacaklar, bu ayki ödemeler). Bu özette olmayan bir rakamı uydurmaz.
4. **Mesaj izni olmayan müşteriye mesaj önerilmez**, asistan kendi başına mesaj göndermez.
5. **Belirsiz cümlede tahmine dayalı kayıt üretilmez;** asistan ne söylenebileceğine dair örnek verir.

## Asistan neleri anlıyor?

| Tür | Örnek |
|---|---|
| Randevu | "Yarın saat 3'te Ahmet sakal", "Pazartesi 11:30 Mehmet saç kesimi", "Bugün beş buçukta Can'a çocuk tıraşı" |
| Müşteri kaydı | "Yeni müşteri Ali Kaya numarası 0532 444 55 66". Numara dükkânın ülkesine göre +90… biçimine çevrilir, aynı numara kayıtlıysa uyarılır |
| Defter (çok tutar) | "Bugün 100 dolar saç kesiminden kazandım, 300 dolar kira ödedim, 20 dolar bahşiş" → 3 kayıt. "Hem 100 dolar gelir hem de 300 dolar gider" → 2 kayıt. "2 tane wax sattım 30 dolar" → $30 ürün satışı (adet sayısı tutar sayılmaz) |
| Veresiye | "Mehmet 40 dolar veresiye", "Ahmet borcunu ödedi 40 dolar" |
| Hatırlatma ve ödeme | "Ayın 25'inde 1800 dolar kira ödemesini hatırlat", "Yarın saat 10'da makasçıyı aramamı hatırlat" |
| Rakam soruları | "Geçen ay ne kadar kazandık?", "Bu ayki toplam masraf ne?", "Bu ay ne kadar ödemem var?", "Kim borçlu?", "Mehmet'in ne kadar borcu var?", "Yarın kaç randevum var?", "Geçen ay en çok hangi hizmet yapıldı?" |
| Açık sorular | "Müşterilerim azaldı gibi, ne yapmalıyım?", "Hangi gün en yoğun?", "Nasıl daha çok kazanırım?" |

Her şey Türkçe, İngilizce ve İspanyolca çalışır.

## Konuşma hafızası

Asistan artık konuşmayı hatırlıyor. Her kullanıcının tek bir sohbeti var; her mesaj veritabanına (`assistant_turns`) kaydedilir, uygulama yenilense de sohbet geri gelir. Kod: `core/src/assistant/memory.ts`.

Modele her turda konuşmanın tamamı değil, **sınırlı bir görünümü** gider; böylece 10. mesajla 300. mesajın maliyeti aynıdır:

| Parça | Ne | Sınır |
| --- | --- | --- |
| `focus` | Konuşulan şey: son müşteri, son sorunun metriği ve dönemi, az önce hazırlanan randevu/hatırlatma taslağı | tek nesne |
| `recent` | Son mesajlar, kelimesi kelimesine | 8 mesaj |
| `earlier` | Daha eski her mesaj için tek satırlık özet (`"Mehmet 40 dolar veresiye yaz" → tab charge Mehmet Kaya 40`) | 24 satır |

Bununla çözülenler:
- **Zamirler:** "onun borcu ne kadar", "ona yarın 10'da yaz", "how much does he owe me?", "¿cuánto me debe él?"
- **Düzeltmeler:** "saat 4 olsun", "Emre'ye ver", "saç sakal olsun", "pazartesi yap", "make it 3 instead", "mejor a las 6"
- **Devam soruları:** "peki geçen ay?" (metrik aynı kalır), "giderler?" (dönem aynı kalır), "and this week?"
- **Vazgeçme:** "boşver", "never mind" → taslak bırakılır, hiçbir şey kaydedilmez

Kurallar:
- **6 saat** mesaj gelmezse bağlam sıfırlanır: ertesi sabah "saat 5 olsun" dünkü taslağı değiştirmez. Uygulamada bu ara tarih çizgisiyle gösterilir.
- Hafıza hiçbir zaman kayıt yazmaz; her taslak yine berberin onayından geçer.
- Zamir yalnızca cümlede başka bir müşteri adı yoksa çözülür; "Ali Kaya" gibi listede olmayan bir isim, soyadı tuttu diye "Mehmet Kaya"ya çevrilmez.
- Kullanıcı sohbeti **Asistan → çöp kutusu** ile siler; konuşmalar 90 günden eski olunca `npm run retention -w api` ile otomatik silinir. Konuşmalar dükkân verisi dışa aktarımına dahildir.
- Asistana kullanıcı başına dakikada en fazla 30 mesaj gönderilebilir (model maliyetine karşı koruma).

## Uzun süreli hafıza (3 ay)

Asistanın karakteri ve hafıza kuralları iki dosyada; ikisini de sen düzenleyebilirsin:
- [`core/agent/SOUL.md`](../core/agent/SOUL.md): asistan kimdir, nasıl konuşur, asla ne yapmaz.
- [`core/agent/AGENT.md`](../core/agent/AGENT.md): elindeki bağlam katmanları, not türleri, hafızayı nasıl güncelleyeceği, roller.
Düzenledikten sonra `npm run agent:sync` çalıştır (unutursan test hatırlatır).

Dükkânın hafızası **DÜKKÂN.md**: kısa notlar, dört kaynaktan gelir:

| Kaynak | Nasıl | Örnek |
| --- | --- | --- |
| Usta söyler | "aklında tut", "unutma ki", "remember that" | "Ahmet sakalını kısa ister" |
| Konuşmalardan öğrenir | Sohbet 20 dk sessiz kalınca DeepSeek konuşmayı gözden geçirir, not ekler/günceller/siler | "Burak her seferinde ense de ister" |
| Kayıtlardan çıkarır | Her saat yeniden hesaplanır | "Kira genelde ayın 3'ünde; son ödeme $1.800", "En yoğun gün salı" |
| Usta yazar | Asistan → Hafıza ekranı | "Pazar günleri kapalıyız" |

- Her not son doğrulandığı günden itibaren **90 gün** yaşar; tekrar duyulursa tazelenir, sabitlenen hiç silinmez.
- Hassas bilgi (sağlık, din, siyaset, telefon, adres, kart) **hiç tutulmaz**; söylense de, model önerse de reddedilir.
- Her mesajla en alakalı 24 not modele gider (adı geçen müşterinin notları önce).
- Asistan → **Hafıza**: her not, kaynağı ve kalan günü; sabitle, sil, elle ekle, DÜKKÂN.md olarak gör.
- Randevuda hizmet söylenmezse müşterinin **her zamanki** hizmeti seçilir.
- Bakım işi API içinde saatte bir çalışır (`runMemoryUpkeep`); elle: `POST /admin/memory/run`.

## İki motor

- **DeepSeek** (`.env` içinde `AI_API_KEY` varsa): eğitim paketiyle çalışır, serbest konuşmayı ve konuşma dilinden metne çeviri hatalarını daha iyi tolere eder, açık sorulara doğal cevap verir.
- **Yerleşik kural motoru** (anahtar yoksa ya da model hata verirse, canlı demoda her zaman): aynı planı Türkçe, İngilizce ve İspanyolca kurallarla üretir, açık sorulara veriden kural tabanlı tavsiye çıkarır. Model cevap vermezse otomatik olarak buna düşülür, berber hiçbir şey fark etmez.

## Ölçüm

```bash
npm test          # yerel motor 40/40 cümleyi geçmek zorunda (CI'da da koşar)
npm run ai:check  # .env'deki anahtarı tek bir anlama ve tek bir sohbet çağrısıyla dener
npm run ai:eval   # 40 cümleyi hem yerel motora hem DeepSeek'e sorar, isabet oranını ve her hatayı yazar
npm run ai:stress # çok turlu diyaloglar + hiç temizlenmeyen 120 turluk uzun konuşma (STRESS_TURNS ile değişir)
```

Çok turlu diyaloglar `api/test/assistant-dialogues.json` dosyasında. Her turda beklenen anlama (`expect`) ya da kesinlikle üretilmemesi gereken şey (`not`) yazılır. `npm test` bu diyalogları ve 300 turluk bir konuşmayı yerel motorla koşar.

Yeni bir cümle türü öğretmek için: önce `assistant-eval.json`'a örneği ve beklenen sonucu ekle, gerekiyorsa `FEW_SHOT`'a çözülmüş bir örnek koy, sonra `npm run ai:eval` ile ölç.
