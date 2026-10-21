# İşletme Röntgeni ve Kalfa Ajanları: plan (taslak, Ekim 2026)

> Soru: Bir işletmenin geçmiş yıllarının gelir, gider ve bilanço verisini alıp işleyebilsek, sorunlarını bulup çözüm önerebilsek ve bunu onun mevcut sistemine bağlayabilsek? Sahada "bu zaten yapılıyor" denmeyecek, gerçekten fark yaratan bir şey nasıl olur?

## 1. Bugün piyasada ne var, ne yok

| Kim | Ne yapıyor | Ne yapmıyor |
|---|---|---|
| **Paraşüt** (TR) | Fişi kameradan okutup gider olarak kaydediyor; kullanım sorularına cevap veren bir asistan | Geçmiş verinin analizi, teşhis, öneri ve takip |
| **Kobaküs / KobAI** (TR) | Açık bankacılıkla nakit tahmini *vaat ediyor*; sayfada "yakında" yazıyor, lisans başvurusu sürüyor | Henüz canlı değil |
| **Digits** (ABD) | Yapay zekâyla defter tutma, mutabakat, anomali tespiti; aylık 35–250 $ | Danışmanlık ve öneri yok; İngilizce, ABD muhasebesi |
| **Puzzle** (ABD) | Nakit, harcama hızı, nakit ömrü ve marj göstergeleri; aylık 30–360 $ | Startup'lar için; Türk esnafının dili ve mevzuatı yok |
| Randevu ve ön muhasebe programları (TR) | Kayıt tutuyor | Yorum yapmıyor, öğretmiyor |

**Sonuç:** Kayıt tutan çok, *okuyan* yok. Fiş okutmak ve defter otomasyonu yapılıyor. **Geçmiş yıllara bakıp TL karşılığıyla "paran şuradan kaçıyor, şunu değiştir" diyen, sonra değişikliğin işe yarayıp yaramadığını ölçen** bir hizmet ne Türkiye'de ne ABD'de küçük esnaf için var.

## 2. Fark yaratacak şey: teşhis, reçete, takip

Ürün tek bir cümle: **"Son 3 yılını okuyalım, paranın nereden kaçtığını TL olarak gösterelim, düzeltelim ve 60 gün sonra işe yarayıp yaramadığını ölçelim."**

### Türkiye'ye özel, gerçekten yeni olan bulgular
1. **Enflasyondan arındırılmış büyüme.** "Ciron %40 artmış görünüyor ama TÜFE'ye göre gerçekte %12 küçülmüşsün." Esnafın çoğu nominal rakama bakıyor. Bunu kendi verisiyle gösteren bir araç yok.
2. **Fiyat erimesi.** Her hizmetin ya da ürünün son zam tarihi ve o günden bu yana enflasyonun ne kadar yediği: "Saç kesimine 9 aydır zam yapmadın; bu sürede fiyatın reel olarak %28 eridi, ayda yaklaşık 11.400 TL."
3. **Gider sürünmesi.** Sessizce büyüyen kalemler: abonelikler, malzeme birim fiyatı, komisyonlar (POS, yemek kartı, pazar yeri).
4. **Nakit takvimi.** Geçmiş 36 ayın düzeninden "her yıl Ocak ve Ağustos'ta kasa sıkışıyor, sebebi kira artışı ve sezon düşüşü". Önceden uyarı ve para ayırma planı.
5. **Kâr eden ve etmeyen.** Hangi hizmet, ürün, gün ya da çalışan para kazandırıyor, hangisi taşıyor.
6. **Müşteri kaybı.** Düzenli gelip artık gelmeyenlerin sayısı ve TL karşılığı. Randevu modülü varsa.
7. **Vergi ve stopaj hazırlığı.** Dönem sonu yükümlülükleri için aylık ne kadar ayırmalı. Mali müşavirle birlikte.

Her bulgu **kanıtlı** olur: hangi aylar, hangi kayıtlar, hangi hesap. Rakamları model uydurmaz; kod hesaplar. Bu, bugünkü asistanın kuralının aynısı.

## 3. Veriyi nereden alırız (mevcut sisteme entegrasyon)

İşletmeyi sistemini değiştirmeye zorlamıyoruz. **Monacount, mevcut sistemin üstüne oturan akıl katmanı.** İsteyen tamamen geçer, isteyen Logo ve Paraşüt'te kalır.

| Kaynak | Nasıl alınır | Tek seferlik / sürekli |
|---|---|---|
| Excel ve CSV (en yaygını) | Yükle; ajan sütunları tanır, eşler, belirsizleri sorar | ikisi de |
| Paraşüt, Logo İşbaşı, BizimHesap | Programın dışa aktarımı; ileride API varsa doğrudan bağlantı (programa göre teyit edilecek) | önce tek seferlik, sonra sürekli |
| e-Fatura ve e-Arşiv XML (UBL-TR) | Özel entegratörün API'si (NES, İZİBİZ, Doğan e-Dönüşüm gibi) ya da GİB portalından indirilen XML'ler | sürekli |
| e-Defter (XBRL-GL) | Mali müşavirden alınan dosyalar | tek seferlik, geçmiş yıllar |
| Banka hesap hareketleri | Ekstre (PDF, Excel); ileride lisanslı bir açık bankacılık sağlayıcısı üzerinden | ikisi de |
| POS ve yazar kasa gün sonu (Z raporu) | Fotoğraf veya PDF; ajan görsel okur | sürekli |
| Defter, adisyon, kâğıt fiş | Fotoğraf; ajan okur, emin olmadığını işaretler | tek seferlik |

Veri **bizim veritabanımızda** tek bir şemaya oturur: gelir, gider, kategori, karşı taraf, belge, tarih. Kaynağın kimliği korunur, aynı kayıt iki kez sayılmaz.

**Geri yazma ("onun sistemine entegre etmek"):** Önerilen değişiklikler önce Monacount'ta uygulanır: fiyat listesi, bütçe, hatırlatma, modül. Müşterinin ana programına geri yazma iki yolla olur: (1) o programın içe aktarabileceği dosya hazırlarız; (2) API olan programlarda onayla doğrudan yazarız. Mali müşavire her ay temiz bir paket gider.

## 4. Ajan ekibi

Her ajan **tek bir işte** uzman; birbirine iş devreder. Asistandaki SOUL.md ve AGENT.md yapısının aynısı, her ajan için ayrı.

| Ajan | Görevi | Çıktısı |
|---|---|---|
| **Toplayıcı** | Dosyaları okur (Excel, PDF, fotoğraf, XML), şemaya eşler, mükerrerleri ayıklar, eksikleri sorar | Veri kalite raporu ("36 ayın 31'i tam, 5 ayda kira eksik") |
| **Düzenleyici** | Kayıtları sınıflar; bankayı faturayla eşleştirir; olağan dışı kayıtları işaretler | Temiz defter |
| **Analist** | Bulguları kodla hesaplar; enflasyon, fiyat erimesi, gider sürünmesi, nakit takvimi, kârlılık | Kanıtlı bulgu listesi |
| **Danışman** | Bulguları önceliklendirilmiş eyleme çevirir; her birinin beklenen TL etkisini yazar | Reçete (en fazla 5 eylem) |
| **Kurucu** | Onaylanan eylemleri uygulamada kurar: modül, fiyat, bütçe, hatırlatma | Ayarlanmış Monacount |
| **Takipçi** | Her ay çalışır; eylemlerin etkisini başlangıçla karşılaştırır | Aylık karne |
| **Koç** | Uygulamayı ve parayı kişinin kendi rakamlarıyla öğretir | Haftalık ders, cevaplar |
| **Saha yardımcısı** | Ziyaret öncesi bizim saha ekibine özet ve soru listesi hazırlar | Ziyaret notu |

**İnsan kontrolü:** İlk dönemde her rapor müşteriye gitmeden önce bizden biri tarafından okunur ve imzalanır. Güveni bu kurar; ajanlar da bu düzeltmelerden öğrenir.

## 5. Hangi altyapı: Claude mu, Hermes mi?

| | **Claude Managed Agents** (Anthropic) | **Claude Agent SDK** (kendi sunucumuz) | **Hermes Agent** (Nous Research, açık kaynak, MIT) |
|---|---|---|---|
| Ne | Ajan döngüsünü ve araçların çalıştığı kum havuzunu Anthropic yönetir; zamanlanmış çalışma ve sonucu puanlayan bir değerlendirici var | Döngü ve araçlar bizde | Kendi sunucumuzda; kalıcı hafıza (MEMORY.md), kendi yazdığı beceri dosyaları, model seçimi serbest |
| Artı | En hızlı başlangıç; aylık takip için zamanlama hazır; dosya ve kod çalıştırma hazır | Veri ve maliyet kontrolü bizde | Veri Türkiye'de kalabilir; açık kaynak |
| Eksi | Veri yurt dışında işlenir; KVKK açık rızası ve aktarım kuralları gerekir | Daha çok mühendislik | Kalite ve sürdürme yükü bizde; becerilerin alanlar arası aktarılmadığı bildiriliyor |

**Öneri:** Pilotu **Claude ile** yapalım: Managed Agents, aylık Takipçi için zamanlanmış çalışma ve rapor kalitesi için değerlendirici. Kişisel veriyi (isim, telefon, TCKN, IBAN) modele göndermeden önce maskeleyelim; ham veri bizim veritabanımızda kalsın. Kurumsal müşteri "veri Türkiye'den çıkmasın" derse Hermes veya kendi sunucumuzda Agent SDK seçeneğini açık tutalım. Mimari bunu baştan desteklesin: ajanlar bizim kendi araç arayüzümüzden konuşsun, model değişebilsin.

## 6. Uygulama eğitimi (onboarding)

Eğitim, kurulumun parçası olmalı; ayrı bir "kullanım kılavuzu" kimse okumaz.

1. **Saha kurulumu (30–45 dk, yerinde):** Saha ekibi kontrol listesiyle gider. İşletme şablonu seçilir, hizmet ve fiyatlar girilir, çalışanlar eklenir, geçmiş veri toplanır (Excel, ekstre, fotoğraf).
2. **İlk hafta görevleri (uygulamada):** Asistanın sesle yönlendirdiği 5 görev: ilk randevu, ilk gider, ilk soru ("bu hafta ne kazandım?"), ilk hatırlatma, gün sonu. Her biri 1 dakika. Tamamlanınca rozet ve bir Kasa Koçu dersi gelir.
3. **Röntgen raporu teslimi (48 saat içinde, yüz yüze ya da görüntülü):** Bulgular, reçete ve onay. Bu toplantı aynı zamanda ikinci eğitim.
4. **Sürekli destek:** WhatsApp destek hattı, haftalık 1 dakikalık ders, aylık karne.

**Ölçü:** Kurulumdan sonraki 14 günde en az 10 gün kayıt girilmişse işletme "aktif" sayılır. Aktif olmayana Saha yardımcısı uyarı çıkarır.

## 7. Fiyat (bulut ve ajan hizmeti olarak)

Bu artık "uygulama aboneliği" değil, **hizmet**. Fiyat da buna göre:

| Paket | Ne var | Fiyat (TL, KDV hariç, hipotez) |
|---|---|---|
| **İşletme Röntgeni** (tek seferlik) | 3 yıla kadar veri toplama, temizleme, teşhis raporu, reçete, kurulum ve eğitim | 7.500–15.000 (veri hacmi ve kaynak sayısına göre) |
| **Kalfa** | Uygulama, asistan, hatırlatmalar, Kasa Koçu | 499 / ay |
| **Kalfa + Ajan** | Kalfa'ya ek olarak sürekli veri bağlantısı, aylık karne, çeyrek dönem yeniden teşhis, mali müşavir paketi | 1.490–2.490 / ay |
| **Kurumsal** | Çok şube, roller, özel modül ve alanlar, mevcut sistemle API entegrasyonu, öncelikli destek | 4.990+ / ay; entegrasyon proje bazında |

- **Maliyet kuralı:** Model kullanım maliyeti, ilgili paket gelirinin %15'ini geçmemeli. Pilotta işletme başına gerçek token tüketimini ölçüp fiyatı buna göre kesinleştiririz.
- **Devlet desteği fırsatı:** 2026–2030 Yapay Zekâ Eylem Planı'nda KOBİ'lere yapay zekâ kuponu ve hazır çözüm paketi programı öngörülüyor (ilk 12 ayda 1.000 kupon hedefi). Röntgen bu kapsama girebilirse esnafa "devlet destekli" sunulabilir. Şartları resmî duyurudan takip etmek gerekiyor.

## 8. Pilot (60 gün)

- **10 işletme, 3 sektör:** berber ve kuaför, kafe ve büfe, tamirci ve oto yıkama.
- **Başarı ölçüleri:**
  - Rapor 48 saatte teslim edilir.
  - Her raporda TL değeri olan en az 3 bulgu olur.
  - İşletme en az 1 eylemi uygular.
  - 60. günde o eylemin etkisi ölçülür.
  - "Bu raporu arkadaşına önerir misin?" sorusuna evet oranı.
  - Röntgen için para ödemeye hazırlık.
- **Hazırlık (bizim tarafta):**
  1. İçe aktarma şeması ve Excel/ekstre okuyucu.
  2. Enflasyon serisi (TÜİK TÜFE) ve fiyat erimesi analizi.
  3. Rapor şablonu (uygulamanın Adisyon diliyle, fiş gibi).
  4. Ajanların SOUL/AGENT dosyaları.
  5. KVKK açık rıza metni ve maskeleme.
  6. Saha kontrol listesi.

## 9. Açık sorular

1. Paraşüt, Logo İşbaşı ve BizimHesap'ın güncel API ve dışa aktarma imkânları (programa göre teyit edilecek).
2. Açık bankacılık için hangi lisanslı sağlayıcıyla çalışılabileceği.
3. Mali müşavirlerle iş birliği modeli: rakip değil kanal olabilirler; Röntgen'i müşterilerine onlar satabilir.
4. Pilot işletmelerden veri işleme için yazılı rıza.

## Kaynaklar
- [Paraşüt yapay zekâ özellikleri](https://www.parasut.com/yapay-zeka-ozellikleri)
- [Kobaküs / KobAI](https://kobakus.com/en/)
- [Best AI agents for bookkeeping 2026 (Rework)](https://resources.rework.com/tools/ai-agents/best-ai-agents-for-bookkeeping-2026)
- [Puzzle pricing](https://puzzle.io/pricing)
- [We took 50+ demos from AI vendors targeting the CFO function](https://tirabassi.com/we-took-50-demos-from-ai-vendors-targeting-the-cfo-function-heres-the-honest-truth/)
- [Türkiye Yapay Zekâ Eylem Planı 2026–2030 (ilkkod)](https://www.ilkkod.com/haberler/turkiye-yapay-zeka-eylem-plani-2026)
- [Yapay zekâ fabrikaları ve KOBİ kuponları (Ege Medyası)](https://www.egemedyasi.com/teknoloji/yapay-zeka-fabrikalari-kobi-ve-girisimcilere-seviye-atlatacak/108549)
- [Yapay Zekâ Eylem Planı hukuki değerlendirme (Lexology)](https://www.lexology.com/library/detail.aspx?g=2bc38c45-7a9b-487e-ad0a-a1181296c679)
- [KOSGEB yapay zekâ kredi programı (Müşavirler Kulübü)](https://musavirlerkulubu.com.tr/makale/kosgeb-yapay-zeka-kredi-programi-2026-kobiler-icin-detayli-rehber)
- [e-Fatura entegrasyon kılavuzu (TÜRMOB arşivi)](https://www.turmob.org.tr/arsiv/mbs/resmigazete/-e-FaturaUygulamasiEntegrasyonKilavuzu-v1.9.pdf)
- [NES e-Fatura API](https://nes.com.tr/e-fatura-entegrasyonu) · [İZİBİZ geliştirici](https://dev.izibiz.com.tr/) · [Doğan e-Dönüşüm geliştirici](https://doganedonusum.com/dev/index.html)
- [SAP Business One e-Fatura / e-Defter rehberi](https://blog.cloudspark.com.tr/sap-business-one-e-fatura-e-defter-entegrasyonu-rehberi/)
- [Hermes Agent (Nous Research) dokümanı](https://agentic-ai.readthedocs.io/en/latest/AgentPlatforms/hermes-agent/)
- [Hermes Agent incelemesi 2026 (fast.io)](https://fast.io/resources/hermes-agent-review-2026/)
