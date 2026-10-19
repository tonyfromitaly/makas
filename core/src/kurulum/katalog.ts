// What the setup wizard knows: kinds of business, the systems they already use, the problems they name,
// and the modules we can switch on. Plain data, so a new business type or a new connector is one entry.
//
// Connector access (api / file / photo) is what we expect from each vendor's public material and still
// has to be confirmed vendor by vendor before we promise it to a customer (docs/kurulum-sihirbazi.md).

export type Dil = 'tr' | 'en';
export type Metin = Record<Dil, string>;

export type ModulId =
  | 'defter'
  | 'randevu'
  | 'hatirlatma'
  | 'musteri'
  | 'personel'
  | 'bahsis'
  | 'stok'
  | 'satis'
  | 'is-teklif'
  | 'uyelik'
  | 'rontgen'
  | 'kasa-kocu'
  | 'veresiye';

export const MODULLER: Record<ModulId, { ad: Metin; ne: Metin; her?: true }> = {
  defter: { her: true, ad: { tr: 'Defter', en: 'Books' }, ne: { tr: 'Gelir ve gider, sesle ya da yazarak', en: 'Income and expenses, by voice or typing' } },
  randevu: { ad: { tr: 'Randevu', en: 'Appointments' }, ne: { tr: 'Takvim, hizmetler, kim ne zaman', en: 'Calendar, services, who and when' } },
  hatirlatma: { ad: { tr: 'Müşteri hatırlatmaları', en: 'Client reminders' }, ne: { tr: 'WhatsApp ya da SMS, izin verenlere', en: 'WhatsApp or SMS, to clients who opted in' } },
  musteri: { ad: { tr: 'Müşteri defteri', en: 'Client book' }, ne: { tr: 'Kim ne sıklıkla geliyor, kim kayboldu', en: 'Who comes how often, who has gone quiet' } },
  personel: { ad: { tr: 'Ekip ve hakediş', en: 'Team and pay' }, ne: { tr: 'Maaş, komisyon ya da yer kirası; hafta sonu hesap', en: 'Wage, commission or space rent; settled weekly' } },
  bahsis: { ad: { tr: 'Bahşiş', en: 'Tips' }, ne: { tr: 'Kişi başına, kart ve nakit ayrı', en: 'Per person, card and cash apart' } },
  stok: { ad: { tr: 'Stok', en: 'Stock' }, ne: { tr: 'Biten, bayatlayan, fazla alınan', en: 'Running out, going stale, over-ordered' } },
  satis: { ad: { tr: 'Satışlar', en: 'Sales' }, ne: { tr: 'Kasa ve POS satışları, ürün ürün', en: 'Till and POS sales, item by item' } },
  'is-teklif': { ad: { tr: 'İşler ve teklifler', en: 'Jobs and quotes' }, ne: { tr: 'Teklif, iş, fatura, tahsilat', en: 'Quote, job, invoice, payment' } },
  uyelik: { ad: { tr: 'Üyelikler', en: 'Memberships' }, ne: { tr: 'Paketler, yenilemeler, bırakanlar', en: 'Packages, renewals, cancellations' } },
  rontgen: { her: true, ad: { tr: 'Röntgen', en: 'X-ray' }, ne: { tr: 'Geçmiş yılların verisinden bulgular', en: 'Findings from past years of data' } },
  'kasa-kocu': { her: true, ad: { tr: 'Kasa Koçu', en: 'Cash Coach' }, ne: { tr: 'Haftalık nakit, vergi payı, temel finans', en: 'Weekly cash, tax set-aside, money basics' } },
  veresiye: { ad: { tr: 'Veresiye', en: 'Store credit' }, ne: { tr: 'Açık hesap (isteyen açar)', en: 'Running tabs (off unless asked)' } },
};

export type SablonId = 'kuafor' | 'guzellik' | 'kafe' | 'butik' | 'ev-hizmet' | 'studyo';

export interface Sablon {
  id: SablonId;
  ad: Metin;
  ornek: Metin;
  moduller: ModulId[];
  sistemler: string[]; // the ones to suggest first
  dertler: string[]; // preselected
  musteri: Metin; // what they call the people they serve
  is: Metin; // what they call one piece of work
  tema: string;
  /** "Who I am", one paragraph, {ad} = business name. */
  kim: Metin;
}

export const SABLONLAR: Sablon[] = [
  {
    id: 'kuafor',
    ad: { tr: 'Kuaför, berber', en: 'Hair salon, barber' },
    ornek: { tr: 'Saç, sakal, boya', en: 'Cuts, beards, colour' },
    moduller: ['randevu', 'hatirlatma', 'musteri', 'personel', 'bahsis'],
    sistemler: ['booksy', 'square', 'fresha', 'squire', 'vagaro', 'banka', 'tablo'],
    dertler: ['kayip-musteri', 'bos-saat', 'fiyat'],
    musteri: { tr: 'müşteri', en: 'client' },
    is: { tr: 'randevu', en: 'appointment' },
    tema: 'adisyon',
    kim: {
      tr: '{ad} için çalışan asistanım. Koltukta kim oturdu, kim üç haftada bir gelirdi de bu ay gelmedi, hangi fiyata en son ne zaman dokunuldu: hepsini aklımda tutarım.',
      en: 'I work for {ad}. Who sat in the chair, who used to come every three weeks and hasn’t this month, when a price was last touched: I keep all of it in mind.',
    },
  },
  {
    id: 'guzellik',
    ad: { tr: 'Güzellik ve bakım stüdyosu', en: 'Beauty and wellness studio' },
    ornek: { tr: 'Tırnak, cilt, masaj, kaş-kirpik', en: 'Nails, skin, massage, brows' },
    moduller: ['randevu', 'hatirlatma', 'musteri', 'personel', 'bahsis', 'uyelik'],
    sistemler: ['fresha', 'vagaro', 'mindbody', 'square', 'acuity', 'banka', 'tablo'],
    dertler: ['kayip-musteri', 'bos-saat', 'personel'],
    musteri: { tr: 'danışan', en: 'client' },
    is: { tr: 'seans', en: 'session' },
    tema: 'pudra',
    kim: {
      tr: '{ad} için çalışan asistanım. Kimin hangi bakımı hangi aralıkla yaptırdığını, paketi kimin bitirmek üzere olduğunu, hangi saatlerin boş geçtiğini takip ederim.',
      en: 'I work for {ad}. I follow who has which treatment how often, whose package is about to run out and which hours keep going empty.',
    },
  },
  {
    id: 'kafe',
    ad: { tr: 'Kafe, restoran', en: 'Café, restaurant' },
    ornek: { tr: 'Kahve, mutfak, paket servis', en: 'Coffee, kitchen, takeaway' },
    moduller: ['satis', 'stok', 'personel', 'bahsis'],
    sistemler: ['square', 'toast', 'clover', 'banka', 'tablo', 'defter-foto'],
    dertler: ['stok', 'gider', 'nakit'],
    musteri: { tr: 'misafir', en: 'guest' },
    is: { tr: 'sipariş', en: 'order' },
    tema: 'cini',
    kim: {
      tr: '{ad} için çalışan asistanım. Hangi ürün kazandırıyor, hangisi rafta bekliyor, tedarikçi fiyatları ne kadar arttı, haftanın hangi günü kasa doluyor: rakamları kayıtlardan okur, sana kısa söylerim.',
      en: 'I work for {ad}. Which items earn, which sit on the shelf, how far supplier prices have moved, which day the till fills up: I read the numbers from the records and tell you briefly.',
    },
  },
  {
    id: 'butik',
    ad: { tr: 'Butik, perakende', en: 'Boutique, retail' },
    ornek: { tr: 'Giyim, hediyelik, kırtasiye', en: 'Clothing, gifts, stationery' },
    moduller: ['satis', 'stok', 'musteri'],
    sistemler: ['shopify', 'square', 'clover', 'banka', 'tablo'],
    dertler: ['stok', 'fiyat', 'nakit'],
    musteri: { tr: 'müşteri', en: 'customer' },
    is: { tr: 'satış', en: 'sale' },
    tema: 'pudra',
    kim: {
      tr: '{ad} için çalışan asistanım. Hangi ürün dönüyor, hangisi sermayeyi rafta bağlıyor, sezon ne zaman başlıyor ve bitiyor: geçmiş satışlardan çıkarırım.',
      en: 'I work for {ad}. Which products turn over, which tie money up on the shelf, when the season starts and ends: I work it out from past sales.',
    },
  },
  {
    id: 'ev-hizmet',
    ad: { tr: 'Ev hizmetleri, tamir, tesisat', en: 'Home services, repairs, trades' },
    ornek: { tr: 'Tesisatçı, elektrikçi, temizlik, bahçe', en: 'Plumber, electrician, cleaning, landscaping' },
    moduller: ['is-teklif', 'randevu', 'musteri', 'personel'],
    sistemler: ['jobber', 'housecall-pro', 'quickbooks', 'banka', 'tablo', 'defter-foto'],
    dertler: ['tahsilat', 'gider', 'vergi'],
    musteri: { tr: 'müşteri', en: 'customer' },
    is: { tr: 'iş', en: 'job' },
    tema: 'defter',
    kim: {
      tr: '{ad} için çalışan asistanım. Hangi teklif cevap bekliyor, hangi iş bitti de parası gelmedi, malzeme fiyatları işin kârını ne kadar yedi: sen sahadayken ben takip ederim.',
      en: 'I work for {ad}. Which quote is waiting for an answer, which job is done but unpaid, how much material prices ate into a job’s margin: I keep track while you are on site.',
    },
  },
  {
    id: 'studyo',
    ad: { tr: 'Spor, yoga, dans stüdyosu', en: 'Fitness, yoga, dance studio' },
    ornek: { tr: 'Grup dersleri, özel ders, üyelik', en: 'Classes, private sessions, memberships' },
    moduller: ['randevu', 'uyelik', 'musteri', 'personel', 'hatirlatma'],
    sistemler: ['mindbody', 'square', 'acuity', 'calendly', 'banka', 'tablo'],
    dertler: ['kayip-musteri', 'personel', 'nakit'],
    musteri: { tr: 'üye', en: 'member' },
    is: { tr: 'ders', en: 'class' },
    tema: 'karbon',
    kim: {
      tr: '{ad} için çalışan asistanım. Kim derslere gelmeyi seyrekleştirdi, hangi üyelik yenilenmek üzere, hangi ders dolu hangisi boş: üyeleri kaybetmeden önce sana haber veririm.',
      en: 'I work for {ad}. Who is coming to class less often, which memberships are up for renewal, which classes fill and which don’t: I tell you before members slip away.',
    },
  },
];

export type Yontem = 'api' | 'dosya' | 'foto';

export interface Sistem {
  id: string;
  ad: string | Metin;
  tur: Metin;
  yontem: Yontem;
  /** What we read from it. */
  veri: Metin;
}

export const SISTEMLER: Sistem[] = [
  { id: 'square', ad: 'Square', tur: { tr: 'Ödeme ve randevu', en: 'Payments and booking' }, yontem: 'api', veri: { tr: 'Satışlar, randevular, müşteriler, ödemeler', en: 'Sales, appointments, customers, payouts' } },
  { id: 'booksy', ad: 'Booksy', tur: { tr: 'Randevu', en: 'Booking' }, yontem: 'dosya', veri: { tr: 'Randevular ve müşteri listesi', en: 'Appointments and client list' } },
  { id: 'fresha', ad: 'Fresha', tur: { tr: 'Randevu', en: 'Booking' }, yontem: 'dosya', veri: { tr: 'Randevular, satışlar, müşteriler', en: 'Appointments, sales, clients' } },
  { id: 'vagaro', ad: 'Vagaro', tur: { tr: 'Randevu', en: 'Booking' }, yontem: 'dosya', veri: { tr: 'Randevular, satışlar, müşteriler', en: 'Appointments, sales, customers' } },
  { id: 'squire', ad: 'Squire', tur: { tr: 'Randevu (berber)', en: 'Booking (barbers)' }, yontem: 'dosya', veri: { tr: 'Randevular ve ödemeler', en: 'Appointments and payments' } },
  { id: 'acuity', ad: 'Acuity Scheduling', tur: { tr: 'Randevu', en: 'Booking' }, yontem: 'api', veri: { tr: 'Randevular ve müşteriler', en: 'Appointments and clients' } },
  { id: 'calendly', ad: 'Calendly', tur: { tr: 'Randevu', en: 'Booking' }, yontem: 'api', veri: { tr: 'Randevular', en: 'Bookings' } },
  { id: 'mindbody', ad: 'Mindbody', tur: { tr: 'Stüdyo yönetimi', en: 'Studio management' }, yontem: 'api', veri: { tr: 'Dersler, üyelikler, satışlar', en: 'Classes, memberships, sales' } },
  { id: 'toast', ad: 'Toast', tur: { tr: 'Restoran POS', en: 'Restaurant POS' }, yontem: 'dosya', veri: { tr: 'Satışlar ürün ürün, saat saat', en: 'Sales by item and by hour' } },
  { id: 'clover', ad: 'Clover', tur: { tr: 'POS', en: 'POS' }, yontem: 'api', veri: { tr: 'Satışlar ve stok', en: 'Sales and inventory' } },
  { id: 'shopify', ad: 'Shopify', tur: { tr: 'Online ve mağaza satışı', en: 'Online and in-store sales' }, yontem: 'api', veri: { tr: 'Siparişler, ürünler, stok, müşteriler', en: 'Orders, products, inventory, customers' } },
  { id: 'jobber', ad: 'Jobber', tur: { tr: 'Saha işleri', en: 'Field service' }, yontem: 'api', veri: { tr: 'Teklifler, işler, faturalar', en: 'Quotes, jobs, invoices' } },
  { id: 'housecall-pro', ad: 'Housecall Pro', tur: { tr: 'Saha işleri', en: 'Field service' }, yontem: 'dosya', veri: { tr: 'İşler ve faturalar', en: 'Jobs and invoices' } },
  { id: 'quickbooks', ad: 'QuickBooks', tur: { tr: 'Muhasebe', en: 'Accounting' }, yontem: 'api', veri: { tr: 'Gelir, gider, faturalar', en: 'Income, expenses, invoices' } },
  { id: 'banka', ad: { tr: 'Banka hesabı', en: 'Bank account' }, tur: { tr: 'Banka', en: 'Bank' }, yontem: 'api', veri: { tr: 'Hesap hareketleri (yalnızca okuma)', en: 'Transactions (read only)' } },
  { id: 'tablo', ad: 'Excel / Google Sheets', tur: { tr: 'Tablo', en: 'Spreadsheet' }, yontem: 'dosya', veri: { tr: 'Ne tutuyorsan: defter, liste, stok', en: 'Whatever you keep: books, lists, stock' } },
  { id: 'defter-foto', ad: { tr: 'Kâğıt defter', en: 'Paper ledger' }, tur: { tr: 'Kâğıt', en: 'Paper' }, yontem: 'foto', veri: { tr: 'Defter sayfaları, fişler, faturalar', en: 'Ledger pages, receipts, invoices' } },
];

export interface Gorev {
  id: string;
  ad: Metin;
  siklik: 'gunluk' | 'haftalik' | 'aylik' | 'olunca';
  /** How the agent knows: always computed from records, never guessed. */
  nasil: Metin;
  gerek?: ModulId[];
}

export const sistemAdi = (s: Sistem, d: Dil) => (typeof s.ad === 'string' ? s.ad : s.ad[d]);

export interface Dert {
  id: string;
  ad: Metin;
  gorevler: Gorev[];
  moduller: ModulId[];
  /** One line for "what I care about". */
  ozen: Metin;
}

export const DERTLER: Dert[] = [
  {
    id: 'kayip-musteri',
    ad: { tr: 'Müşteriler gelmeyi bırakıyor, fark etmiyorum', en: 'Regulars stop coming and I don’t notice' },
    moduller: ['musteri'],
    ozen: { tr: 'sessizce kaybolan müşteriler', en: 'regulars who quietly drift away' },
    gorevler: [
      {
        id: 'kayip-takibi',
        ad: { tr: 'Kayıp müşteri takibi', en: 'Lapsing client watch' },
        siklik: 'haftalik',
        nasil: { tr: 'Her düzenli müşterinin geliş aralığını hesaplar; aralık 1,5 katını geçince listeye alır.', en: 'Computes each regular’s usual gap; flags them once it is 1.5× overdue.' },
      },
    ],
  },
  {
    id: 'bos-saat',
    ad: { tr: 'Gelmeyen randevular, boş saatler', en: 'No-shows and empty hours' },
    moduller: ['randevu', 'hatirlatma'],
    ozen: { tr: 'boş geçen saatler', en: 'hours that go empty' },
    gorevler: [
      { id: 'hatirlat', ad: { tr: 'Randevu hatırlatması', en: 'Appointment reminders' }, siklik: 'olunca', nasil: { tr: 'Bir gün önce ve birkaç saat önce, izin veren müşteriye.', en: 'A day before and a few hours before, to clients who opted in.' }, gerek: ['hatirlatma'] },
      { id: 'bos-saat-raporu', ad: { tr: 'Boş saat haritası', en: 'Empty-hour map' }, siklik: 'haftalik', nasil: { tr: 'Son 8 haftanın doluluğunu gün ve saate göre çıkarır; en boş üç dilimi söyler.', en: 'Maps the last 8 weeks by day and hour; names the three emptiest slots.' }, gerek: ['randevu'] },
    ],
  },
  {
    id: 'fiyat',
    ad: { tr: 'Fiyatı ne zaman artıracağımı bilmiyorum', en: 'I don’t know when to raise prices' },
    moduller: [],
    ozen: { tr: 'enflasyonun gerisinde kalan fiyatlar', en: 'prices falling behind inflation' },
    gorevler: [
      { id: 'fiyat-erimesi', ad: { tr: 'Fiyat erimesi', en: 'Price erosion' }, siklik: 'aylik', nasil: { tr: 'Her hizmetin/ürünün son zammından bu yana resmî enflasyonu hesaplar; geride kalanları söyler.', en: 'Compares each item’s last price change with official inflation since; names the ones behind.' } },
    ],
  },
  {
    id: 'nakit',
    ad: { tr: 'Ay sonunu getirmekte zorlanıyorum', en: 'Cash runs short before month end' },
    moduller: [],
    ozen: { tr: 'haber vermeden gelen nakit sıkışıklığı', en: 'cash crunches that arrive unannounced' },
    gorevler: [
      { id: 'nakit-takvimi', ad: { tr: 'Nakit takvimi', en: 'Cash calendar' }, siklik: 'haftalik', nasil: { tr: 'Sabit ödemeleri ve geçmiş haftaların gelirini üst üste koyar; önümüzdeki 3 haftada kasanın düşeceği günü söyler.', en: 'Lays fixed payments over past weekly income; names the day in the next 3 weeks the balance dips.' } },
    ],
  },
  {
    id: 'gider',
    ad: { tr: 'Para nereye gidiyor bilmiyorum', en: 'I don’t know where the money goes' },
    moduller: [],
    ozen: { tr: 'fark edilmeden büyüyen giderler', en: 'costs that grow unnoticed' },
    gorevler: [
      { id: 'gider-tarama', ad: { tr: 'Gider taraması', en: 'Expense sweep' }, siklik: 'aylik', nasil: { tr: 'Enflasyondan hızlı artan kalemleri, unutulan abonelikleri ve olası çift ödemeleri bulur.', en: 'Finds lines growing faster than inflation, forgotten subscriptions and possible double payments.' } },
    ],
  },
  {
    id: 'vergi',
    ad: { tr: 'Vergi zamanı sürpriz oluyor', en: 'Tax time is always a surprise' },
    moduller: [],
    ozen: { tr: 'vergi gününde boş kalan kasa', en: 'an empty account on tax day' },
    gorevler: [
      { id: 'vergi-payi', ad: { tr: 'Vergi payı', en: 'Tax set-aside' }, siklik: 'haftalik', nasil: { tr: 'Haftanın kârından kenara ayrılacak payı söyler; oranı muhasebecin belirler.', en: 'Says how much of the week’s profit to set aside; your accountant sets the rate.' } },
    ],
  },
  {
    id: 'personel',
    ad: { tr: 'Ekibin hesabı karışıyor', en: 'Team pay gets messy' },
    moduller: ['personel'],
    ozen: { tr: 'hafta sonunda karışan hesaplar', en: 'muddled settlements at the end of the week' },
    gorevler: [
      { id: 'hakedis', ad: { tr: 'Haftalık hakediş', en: 'Weekly settlement' }, siklik: 'haftalik', nasil: { tr: 'Her kişinin işini, komisyonunu, yer kirasını ve bahşişini toplar; kim kime ne borçlu çıkarır.', en: 'Adds up each person’s work, commission, space rent and tips; shows who owes whom.' }, gerek: ['personel'] },
    ],
  },
  {
    id: 'stok',
    ad: { tr: 'Stok bitiyor ya da bozuluyor', en: 'Stock runs out or goes to waste' },
    moduller: ['stok', 'satis'],
    ozen: { tr: 'rafta bekleyen ya da biten mal', en: 'stock that sits or runs out' },
    gorevler: [
      { id: 'stok-uyari', ad: { tr: 'Stok uyarısı', en: 'Stock alerts' }, siklik: 'gunluk', nasil: { tr: 'Satış hızından bitiş gününü hesaplar; siparişi ne zaman vermen gerektiğini söyler.', en: 'Works out the run-out day from sales speed; says when to reorder.' }, gerek: ['stok'] },
      { id: 'olu-stok', ad: { tr: 'Ölü stok', en: 'Dead stock' }, siklik: 'aylik', nasil: { tr: '60 gündür satmayan ürünleri ve bağladıkları parayı listeler.', en: 'Lists items unsold for 60 days and the money they hold.' }, gerek: ['stok'] },
    ],
  },
  {
    id: 'tahsilat',
    ad: { tr: 'Teklifler ve tahsilatlar takipte kayboluyor', en: 'Quotes and payments slip through' },
    moduller: ['is-teklif'],
    ozen: { tr: 'bitmiş ama parası gelmemiş işler', en: 'finished jobs that were never paid' },
    gorevler: [
      { id: 'acik-is', ad: { tr: 'Açık teklif ve fatura takibi', en: 'Open quotes and invoices' }, siklik: 'gunluk', nasil: { tr: '3 gündür cevapsız teklifleri ve vadesi geçen faturaları söyler.', en: 'Names quotes unanswered for 3 days and overdue invoices.' }, gerek: ['is-teklif'] },
    ],
  },
  {
    id: 'kayit',
    ad: { tr: 'Kayıt tutmaya vaktim yok', en: 'No time to keep records' },
    moduller: [],
    ozen: { tr: 'akılda tutulup kaybolan kayıtlar', en: 'records kept in your head and lost' },
    gorevler: [
      { id: 'gun-sonu', ad: { tr: 'Gün sonu kapanışı', en: 'End-of-day close' }, siklik: 'gunluk', nasil: { tr: 'Bağlı sistemlerden günü toplar; eksik görünen kalemi tek soruyla sorar.', en: 'Totals the day from connected systems; asks one question about anything missing.' } },
    ],
  },
];

/** Every setup gets these, whatever the answers. */
export const TEMEL_GOREVLER: Gorev[] = [
  { id: 'sabah-ozeti', ad: { tr: 'Sabah özeti', en: 'Morning brief' }, siklik: 'gunluk', nasil: { tr: 'Bugünün işleri, dünün kasası, tek bir dikkat noktası.', en: 'Today’s work, yesterday’s takings, one thing to watch.' } },
  { id: 'aylik-karne', ad: { tr: 'Aylık karne (Röntgen)', en: 'Monthly report card (X-ray)' }, siklik: 'aylik', nasil: { tr: 'Röntgen motoru tüm veriyi yeniden tarar; yeni bulguları ve geçen ayın düzelenlerini söyler.', en: 'The X-ray engine rescans everything; reports new findings and what improved.' } },
  { id: 'hafiza', ad: { tr: 'Hafıza güncellemesi', en: 'Memory upkeep' }, siklik: 'gunluk', nasil: { tr: 'Gece, konuşmalardan kalıcı notları çıkarır; 90 günü geçen notları siler.', en: 'At night, keeps lasting notes from conversations; drops notes older than 90 days.' } },
];

export type CalismaSekli = 'maas' | 'komisyon' | 'kira';
export const CALISMA: Record<CalismaSekli, Metin> = {
  maas: { tr: 'Maaşlı çalışan', en: 'Employee on wage' },
  komisyon: { tr: 'Komisyonla çalışan', en: 'Commission' },
  kira: { tr: 'Yer kiralayan bağımsız çalışan', en: 'Independent, rents a space' },
};

export type Gizlilik = 'yerel' | 'ozet';
export const GIZLILIK: Record<Gizlilik, { ad: Metin; ne: Metin }> = {
  yerel: {
    ad: { tr: 'Her şey bu bilgisayarda', en: 'Everything on this computer' },
    ne: { tr: 'Yapay zekâ modeli de bilgisayarında çalışır. Hiçbir veri dışarı çıkmaz. Cevaplar biraz daha sade olur.', en: 'The AI model runs on your computer too. No data leaves it. Answers are a little plainer.' },
  },
  ozet: {
    ad: { tr: 'Veri burada, yalnızca isimsiz özet buluta', en: 'Data here, only nameless summaries to the cloud' },
    ne: { tr: 'Kayıtlar bilgisayarında kalır. Daha iyi cevap için buluttaki modele isim ve telefon içermeyen özet gider.', en: 'Records stay on your computer. For better answers, a summary without names or phone numbers goes to a cloud model.' },
  },
};
