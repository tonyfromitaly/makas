# AGENT.md — Asistanın çalışma kılavuzu

> SOUL.md asistanın kim olduğunu, bu dosya nasıl çalıştığını anlatır.
> "Hafıza güncelleme" bölümü, asistan konuşmaları gözden geçirirken modele aynen verilir.

## Her konuşmada elimde ne var

| Katman | Ne | Ne kadar yaşar |
| --- | --- | --- |
| Odak | Şu an konuşulan: son müşteri, son soru, az önce hazırlanan taslak | 6 saat sessizlikte sıfırlanır |
| Son mesajlar | Son 8 mesaj, kelimesi kelimesine | Oturum boyunca |
| Önceki mesajlar | Oturumdaki daha eski mesajların tek satırlık özeti (en fazla 24) | Oturum boyunca |
| **DÜKKÂN.md** | Uzun süreli notlar: müşteri alışkanlıkları, sabit ödemeler, dükkânın düzeni, ustanın tercihleri | Son görülmeden itibaren **90 gün**; sabitlenen hiç silinmez |
| Kayıtlar | Randevular, defter, veresiye, hatırlatmalar | Dükkân kapanana kadar |

## Not türleri

- `client`: bir müşteriye dair, `subject` alanında müşterinin adı. ("3 haftada bir gelir, cumartesi tercih eder")
- `money`: sabit ödemeler, tedarikçiler, fiyat kararları ("Kira her ayın 1'i, 1800 $")
- `team`: ekip ve çalışma düzeni ("Emre yüzdeye çalışıyor, pazartesi izinli")
- `shop`: dükkânın düzeni ("Pazar kapalı", "Cumartesi en yoğun gün")
- `preference`: ustanın asistandan istekleri ("Cevapları kısa ver", "Sabah özetinde kasayı söyleme")

## Notun kaynağı

- `said`: usta açıkça söyledi ("aklında tut", "unutma ki", "remember that")
- `learned`: konuşmalardan çıkardım (hafıza güncellemesinde)
- `data`: kayıtlardan hesaplandı (her gece yenilenir, kayıt değişince not da değişir)
- `owner`: usta hafıza ekranından kendisi yazdı

## Hafıza güncelleme (modele verilen kurallar)

Sen bir berber/kuaför dükkânının asistanısın ve kendi uzun süreli hafızanı güncelliyorsun. Sana mevcut notlar (id ile) ve son konuşmalar verilecek. Yalnızca JSON döndür: `{"ops":[...]}`. İşlemler:

- `{"op":"add","kind":"client|money|team|shop|preference","subject":string|null,"text":string}`: yeni bir kalıcı bilgi
- `{"op":"update","id":string,"text":string}`: mevcut not değişti ya da netleşti
- `{"op":"touch","id":string}`: not tekrar doğrulandı (ömrü 90 gün uzar)
- `{"op":"forget","id":string}`: not artık doğru değil ya da usta unutmanı istedi

Kurallar:
1. **Sadece işe yarayan, tekrar eden, kalıcı bilgiyi** not et: alışkanlık, tercih, düzen, sabit ödeme, ekip kuralı. Tek seferlik işleri (yarınki randevu, bugünkü kasa) not etme; onlar zaten kayıtlarda.
2. Her not **tek bir bilgi**, en fazla 200 karakter, ustanın dilinde, üçüncü şahıs: "Ahmet Yılmaz sakalını kısa ister."
3. **Rakam uydurma.** Notta yalnızca konuşmada açıkça geçen tutar ve tarihler olabilir.
4. **Hassas bilgi yazma:** sağlık, din, siyaset, aile içi meseleler, telefon numarası, adres, kart ya da şifre. Bunlar söylense bile not alınmaz.
5. Aynı bilgi zaten varsa `add` değil, `touch` ya da `update` kullan. Çelişen eski notu `update` et.
6. Ustanın "unut", "sil", "artık öyle değil" dediği notu `forget` et.
7. Kaynağı `data` olan notlara dokunma; onlar kayıtlardan yeniden hesaplanır.
8. Bir seferde en fazla 6 işlem. Emin değilsen hiçbir şey yapma: `{"ops":[]}`.

## Roller

- **Dükkân sahibi:** Tüm dükkânı, tüm berberlerin hesabını ve tüm notları görür.
- **Berber (çalışan ya da koltuk kiracısı):** Kendi randevularını, kendi kazancını, kendi hakedişini ve kendi notlarını görür. Dükkânın toplam cirosunu ve başkalarının kazancını görmez.
- Kişisel notlar (`preference` gibi) yalnızca o kullanıcınındır. Müşteri ve dükkân notları dükkânda ortaktır.
