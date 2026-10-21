// The setup wizard's answers in, one business's whole setup out: the agent's SOUL.md and AGENT.md,
// which modules are on and why, which systems to connect and how, the look, and the install checklist.
// Written by code from the catalog, deterministic: the same answers always give the same agent.
import { CALISMA, DERTLER, GIZLILIK, MODULLER, SABLONLAR, SISTEMLER, TEMEL_GOREVLER, sistemAdi, type CalismaSekli, type Dil, type Gizlilik, type Gorev, type ModulId, type SablonId, type Yontem } from './katalog';

export interface Cevaplar {
  isletme: string;
  sahip: string;
  sablon: SablonId;
  dil: Dil;
  sistemler: string[];
  dertler: string[];
  /** Empty: works alone. */
  ekip: CalismaSekli[];
  kisi: number;
  ton: 'samimi' | 'resmi';
  gizlilik: Gizlilik;
  tema?: { skin: string; accent: string | null };
}

export interface Kurulum {
  ajanAdi: string;
  soulMd: string;
  agentMd: string;
  moduller: { id: ModulId; ad: string; acik: boolean; neden: string }[];
  baglantilar: { id: string; ad: string; yontem: Yontem; veri: string; adimlar: string[]; kosul?: string }[];
  gorevler: { id: string; ad: string; siklik: string; nasil: string }[];
  tema: { skin: string; accent: string | null };
  adimlar: { baslik: string; detay: string }[];
  uyarilar: string[];
}

const SIKLIK: Record<Gorev['siklik'], Record<Dil, string>> = {
  gunluk: { tr: 'Her gün', en: 'Daily' },
  haftalik: { tr: 'Her hafta', en: 'Weekly' },
  aylik: { tr: 'Her ay', en: 'Monthly' },
  olunca: { tr: 'Gerektiğinde', en: 'As needed' },
};

const YONTEM_ADIM: Record<Yontem, Record<Dil, (ad: string) => string[]>> = {
  api: {
    tr: (ad) => [`${ad} hesabınla giriş yap.`, 'Yalnızca okuma izni ver. Biz hiçbir şeyi değiştirmeyiz.', 'Geçmiş veriler indirilir; sonra her saat yenileri gelir.'],
    en: (ad) => [`Sign in with your ${ad} account.`, 'Grant read-only access. We never change anything there.', 'Past data is pulled in, then new data every hour.'],
  },
  dosya: {
    tr: (ad) => [`${ad} içinde Raporlar ya da Dışa aktar bölümünü aç.`, 'Mümkün olan en eski tarihten bugüne CSV ya da Excel indir.', 'Dosyayı buraya bırak. Ayda bir yenisini bırakman yeterli; hatırlatırım.'],
    en: (ad) => [`In ${ad}, open Reports or Export.`, 'Download CSV or Excel from the earliest date you can to today.', 'Drop the file here. A fresh one once a month is enough; I’ll remind you.'],
  },
  foto: {
    tr: () => ['Defter sayfalarını, fişleri ya da faturaları telefonla çek.', 'Okunanlar taslak olarak gelir; sen onaylamadan deftere geçmez.'],
    en: () => ['Photograph ledger pages, receipts or invoices with your phone.', 'What is read comes in as a draft; nothing is booked until you approve it.'],
  },
};

const T = {
  tr: {
    soulTitle: (a: string) => `# SOUL.md — ${a}`,
    soulNote: '> Bu dosya ajanın karakteridir. Kurulum sihirbazı cevaplarına göre yazdı; istediğin zaman düzenleyebilirsin.',
    who: '## Kim olduğum',
    whoTail: 'Adım Mona. Patron değilim, muhasebeci de değilim. İşin yanında duran, her şeyi hatırlayan, az konuşan bir yardımcıyım.',
    how: '## Nasıl konuşurum',
    howSamimi: (s: string) => [`${s} ile kısa ve sıcak konuşurum: "Yazdım, bir bak", "Bu hafta kira daha ödenmedi."`, 'Bir cevapta tek bir iş yaparım. Sorulmadan uzun tavsiye vermem.'],
    howResmi: (s: string) => [`${s} ile kısa, açık ve saygılı konuşurum. Gereksiz ayrıntı vermem.`, 'Bir cevapta tek bir iş yaparım. Sorulmadan uzun tavsiye vermem.'],
    howLang: 'Karşımdakinin dilinde cevap veririm.',
    never: '## Asla yapmadıklarım',
    never1: '**Rakam uydurmam.** Her toplamı ve her tahmini kayıtlar ve hesap motoru üretir. Ben sadece söylerim.',
    never2: '**Onaysız kayıt yazmam.** Okuduğum, duyduğum, bağlı sistemlerden gelen her yeni kayıt önce taslaktır.',
    never3: (m: string) => `**Kimseye kendiliğimden mesaj atmam.** Yalnızca izin veren ${m}lere, kurallı hatırlatmalar gider.`,
    never3Yok: '**Kimseye mesaj atmam.** Müşteri hatırlatmaları kapalı; açılırsa yalnızca izin verenlere gider.',
    never4: '**Hassas bilgi tutmam.** Sağlık, din, siyaset, aile meseleleri, kart ve şifre: söylense bile not almam.',
    neverTeam: '**Herkes kendi hesabını görür.** Ekipten kimse başkasının kazancını görmez; işletmenin tamamını yalnızca sahibi görür.',
    neverYerel: '**Veri bu bilgisayardan çıkmaz.** Yapay zekâ modeli de burada çalışır.',
    neverOzet: '**Kayıtlar bu bilgisayarda kalır.** Buluttaki modele yalnızca isim ve telefon içermeyen özet gönderirim.',
    memory: '## Hafızam',
    memory1: 'İşe yarayan bilgileri kısa notlar olarak tutarım. Notlarım 90 gün yaşar, sabitlenen hiç silinmez.',
    memory2: (s: string) => `Not ile kayıt çelişirse kayda inanırım. ${s} hafızamdaki her şeyi görebilir, düzeltebilir, silebilir.`,
    care: '## Neye önem veririm',
    careLine: (list: string) => `Küçük işletmenin sessiz kayıpları: ${list}. Benim işim bunları fark edip doğru anda, tek cümleyle söylemek.`,
    agentTitle: (a: string) => `# AGENT.md — ${a} nasıl çalışır`,
    agentNote: '> SOUL.md ajanın kim olduğunu, bu dosya ne yaptığını anlatır. Kurulum sihirbazı yazdı.',
    tasks: '## Görevlerim',
    taskHead: '| Görev | Ne zaman | Nasıl bilirim |',
    sources: '## Bağlı sistemler',
    srcHead: '| Sistem | Nasıl bağlı | Ne okurum |',
    srcNone: 'Henüz bağlı sistem yok. Kayıtlar uygulamadan, sesle ya da defter fotoğrafıyla girilir.',
    mods: '## Açık modüller',
    roles: '## Roller',
    roleAlone: (s: string) => `- **${s}:** Her şeyi görür ve onaylar.`,
    roleOwner: (s: string) => `- **${s} (sahip):** Tüm işletmeyi, herkesin hesabını ve tüm notları görür.`,
    roleTeam: (k: string) => `- **${k}:** Kendi işini, kendi kazancını ve kendi notlarını görür.`,
    where: '## Veri nerede',
    whereYerel: 'Veritabanı, bağlantılar ve yapay zekâ modeli bu bilgisayarda çalışır.',
    whereOzet: 'Veritabanı ve bağlantılar bu bilgisayarda çalışır. Buluttaki modele yalnızca isimsiz özet gider.',
    outMsg: 'Bunun dışında dışarıya yalnızca izin veren müşterilere hatırlatma mesajları çıkar.',
    outNone: 'Bunun dışında dışarıya hiçbir şey çıkmaz.',
    whereTail: 'Bilgisayar kapalıyken hesap yapılmaz; açılınca kaldığı yerden devam eder. Yedek her gece alınır.',
    yontem: { api: 'Doğrudan bağlantı', dosya: 'Dışa aktarılan dosya', foto: 'Fotoğraf' } as Record<Yontem, string>,
    stepInstall: 'Uygulamayı kur',
    stepInstallD: 'Bilgisayarına indir ve aç. Veritabanı ve ajan bilgisayarında kurulur; hesap açmak için kart istenmez.',
    stepConnect: (ad: string) => `${ad} bağla`,
    stepHistory: 'Geçmişi içeri al',
    stepHistoryD: 'Bağlı sistemlerden ve elindeki dosyalardan geçmiş yıllar alınır, tek deftere çevrilir. Okunamayan satırlar listelenir, tahmin yürütülmez.',
    stepXray: 'İlk Röntgen',
    stepXrayD: 'Motor tüm geçmişi tarar. İlk bulgular ve "bu veriyle yapılamayanlar" listesi önüne gelir.',
    stepAgent: 'Ajanla tanış',
    stepAgentD: (a: string) => `${a} kendini tanıtır, görevlerini söyler. SOUL.md ve AGENT.md dosyalarını beğenmediğin yerden değiştirebilirsin.`,
    stepPhone: 'Telefonu eşleştir',
    stepPhoneD: 'Telefondan sormak ve hatırlatma almak için bilgisayarı telefonuna bağla. Arada yalnızca mesaj geçer, veri saklanmaz.',
    warnFile: (ad: string) => `${ad} için doğrudan bağlantı beklemiyoruz; ayda bir dışa aktarma dosyası gerekecek.`,
    warnNoBooking: 'Randevu modülü açık ama bağlı bir randevu sistemi yok: randevular bu uygulamadan tutulacak.',
    warnNoBank: 'Banka bağlı değil: kasa ve nakit tahminleri yalnızca girilen kayıtlara dayanır.',
    warnYerel: 'Yerel model için bilgisayarda en az 16 GB bellek önerilir.',
    because: { her: 'Her kurulumda var', sablon: 'İşletme türün için', dert: (d: string) => `"${d}" için`, ekip: 'Ekibin var', kapali: 'Kapalı; istersen açarsın' },
    agentName: (i: string) => `Mona · ${i}`,
  },
  en: {
    soulTitle: (a: string) => `# SOUL.md — ${a}`,
    soulNote: '> This file is the agent’s character. The setup wizard wrote it from your answers; edit it any time.',
    who: '## Who I am',
    whoTail: 'My name is Mona. I’m not the boss and not the accountant. I’m the helper who stands next to the work, remembers everything and says little.',
    how: '## How I talk',
    howSamimi: (s: string) => [`I talk with ${s} briefly and warmly: "Done, have a look", "Rent isn’t paid yet this week."`, 'One job per answer. No long advice unless asked.'],
    howResmi: (s: string) => [`I talk with ${s} briefly, clearly and politely. No needless detail.`, 'One job per answer. No long advice unless asked.'],
    howLang: 'I answer in the language I’m spoken to in.',
    never: '## What I never do',
    never1: '**I never make up numbers.** Every total and forecast comes from the records and the calculation engine. I only say them.',
    never2: '**I never book anything without approval.** Everything I read, hear or receive from connected systems starts as a draft.',
    never3: (m: string) => `**I never message anyone on my own.** Only ${m}s who opted in get rule-based reminders.`,
    never3Yok: '**I message nobody.** Client reminders are off; if switched on, only opted-in clients get them.',
    never4: '**I keep nothing sensitive.** Health, religion, politics, family matters, cards and passwords: never noted, even if said.',
    neverTeam: '**Everyone sees their own numbers.** Nobody on the team sees anyone else’s earnings; only the owner sees the whole business.',
    neverYerel: '**Data never leaves this computer.** The AI model runs here too.',
    neverOzet: '**Records stay on this computer.** The cloud model only gets summaries without names or phone numbers.',
    memory: '## My memory',
    memory1: 'I keep useful facts as short notes. Notes live 90 days; pinned ones never expire.',
    memory2: (s: string) => `If a note and a record disagree, I trust the record. ${s} can see, fix or delete anything I remember.`,
    care: '## What I care about',
    careLine: (list: string) => `The quiet losses of a small business: ${list}. My job is to notice them and say so at the right moment, in one sentence.`,
    agentTitle: (a: string) => `# AGENT.md — how ${a} works`,
    agentNote: '> SOUL.md says who the agent is; this file says what it does. Written by the setup wizard.',
    tasks: '## My tasks',
    taskHead: '| Task | When | How I know |',
    sources: '## Connected systems',
    srcHead: '| System | Connected by | What I read |',
    srcNone: 'No systems connected yet. Records come in through the app, by voice or as ledger photos.',
    mods: '## Modules on',
    roles: '## Roles',
    roleAlone: (s: string) => `- **${s}:** Sees and approves everything.`,
    roleOwner: (s: string) => `- **${s} (owner):** Sees the whole business, everyone’s numbers and all notes.`,
    roleTeam: (k: string) => `- **${k}:** Sees their own work, their own earnings and their own notes.`,
    where: '## Where the data is',
    whereYerel: 'The database, the connectors and the AI model run on this computer.',
    whereOzet: 'The database and the connectors run on this computer. The cloud model only receives nameless summaries.',
    outMsg: 'Apart from that, only reminder messages to opted-in clients go out.',
    outNone: 'Apart from that, nothing goes out.',
    whereTail: 'While the computer is off nothing is calculated; it catches up when it is back on. A backup is taken every night.',
    yontem: { api: 'Direct connection', dosya: 'Exported file', foto: 'Photo' } as Record<Yontem, string>,
    stepInstall: 'Install the app',
    stepInstallD: 'Download it and open it. The database and the agent are set up on your computer; no card needed to start.',
    stepConnect: (ad: string) => `Connect ${ad}`,
    stepHistory: 'Bring in the history',
    stepHistoryD: 'Past years come in from connected systems and your files, turned into one ledger. Unreadable lines are listed, never guessed.',
    stepXray: 'First X-ray',
    stepXrayD: 'The engine scans the whole history. The first findings and a list of what this data cannot tell appear.',
    stepAgent: 'Meet your agent',
    stepAgentD: (a: string) => `${a} introduces itself and its tasks. Change anything you don’t like in SOUL.md and AGENT.md.`,
    stepPhone: 'Pair your phone',
    stepPhoneD: 'Link the computer to your phone to ask questions and get reminders. Only messages pass through; nothing is stored in between.',
    warnFile: (ad: string) => `We don’t expect a direct connection for ${ad}; a monthly export file will be needed.`,
    warnNoBooking: 'Appointments are on but no booking system is connected: appointments will be kept in this app.',
    warnNoBank: 'No bank connected: cash forecasts rest only on the records entered.',
    warnYerel: 'For the local model, at least 16 GB of memory is recommended.',
    because: { her: 'In every setup', sablon: 'For your kind of business', dert: (d: string) => `For "${d}"`, ekip: 'You have a team', kapali: 'Off; switch it on if you like' },
    agentName: (i: string) => `Mona · ${i}`,
  },
};

const RANDEVU_SISTEMI = new Set(['square', 'booksy', 'fresha', 'vagaro', 'squire', 'acuity', 'calendly', 'mindbody', 'jobber', 'housecall-pro']);

export function kurulumUret(c: Cevaplar): Kurulum {
  const d = c.dil;
  const t = T[d];
  const sablon = SABLONLAR.find((s) => s.id === c.sablon) ?? SABLONLAR[0];
  const dertler = DERTLER.filter((x) => c.dertler.includes(x.id));
  const sistemler = SISTEMLER.filter((s) => c.sistemler.includes(s.id));
  const ajanAdi = t.agentName(c.isletme);
  const sahip = c.sahip.trim() || (d === 'tr' ? 'İşletme sahibi' : 'The owner');
  const ekipVar = c.ekip.length > 0 && c.kisi > 1;

  // Modules: always-on, then the business type, then what the problems need, then the team.
  const neden = new Map<ModulId, string>();
  for (const [id, m] of Object.entries(MODULLER) as [ModulId, (typeof MODULLER)[ModulId]][]) if (m.her) neden.set(id, t.because.her);
  for (const id of sablon.moduller) if (!neden.has(id)) neden.set(id, t.because.sablon);
  for (const x of dertler) for (const id of x.moduller) if (!neden.has(id)) neden.set(id, t.because.dert(x.ad[d]));
  if (ekipVar && !neden.has('personel')) neden.set('personel', t.because.ekip);
  if (!ekipVar && !dertler.some((x) => x.moduller.includes('personel'))) neden.delete('personel');
  if (!ekipVar) neden.delete('bahsis');
  const moduller = (Object.keys(MODULLER) as ModulId[]).map((id) => ({
    id,
    ad: MODULLER[id].ad[d],
    acik: neden.has(id),
    neden: neden.get(id) ?? t.because.kapali,
  }));
  const acik = new Set(moduller.filter((m) => m.acik).map((m) => m.id));

  // Tasks: the basics, then each problem's tasks whose modules are on.
  // A team always gets the weekly settlement, whether or not pay was named as a problem.
  const ekipGorevi = ekipVar ? DERTLER.find((x) => x.id === 'personel')!.gorevler : [];
  const gorevler = [...TEMEL_GOREVLER, ...dertler.flatMap((x) => x.gorevler), ...ekipGorevi]
    .filter((g, i, all) => all.findIndex((y) => y.id === g.id) === i)
    .filter((g) => !g.gerek || g.gerek.every((m) => acik.has(m)))
    .map((g) => ({ id: g.id, ad: g.ad[d], siklik: SIKLIK[g.siklik][d], nasil: g.nasil[d] }));

  const baglantilar = sistemler.map((s) => ({ id: s.id, ad: sistemAdi(s, d), yontem: s.yontem, veri: s.veri[d], adimlar: YONTEM_ADIM[s.yontem][d](sistemAdi(s, d)), kosul: s.kosul?.[d] }));

  const uyarilar: string[] = [];
  for (const s of sistemler) if (s.yontem === 'dosya' && s.id !== 'tablo') uyarilar.push(t.warnFile(sistemAdi(s, d)));
  if (acik.has('randevu') && !sistemler.some((s) => RANDEVU_SISTEMI.has(s.id))) uyarilar.push(t.warnNoBooking);
  if (!c.sistemler.includes('banka')) uyarilar.push(t.warnNoBank);
  if (c.gizlilik === 'yerel') uyarilar.push(t.warnYerel);

  // SOUL.md
  const musteri = sablon.musteri[d];
  const ozenler = (dertler.length ? dertler : DERTLER.filter((x) => sablon.dertler.includes(x.id))).map((x) => x.ozen[d]);
  const liste = d === 'tr' ? birlestir(ozenler, 've') : birlestir(ozenler, 'and');
  const never = [t.never1, t.never2, acik.has('hatirlatma') ? t.never3(musteri) : t.never3Yok, t.never4, ...(ekipVar ? [t.neverTeam] : []), c.gizlilik === 'yerel' ? t.neverYerel : t.neverOzet];
  const soulMd = [
    t.soulTitle(ajanAdi),
    '',
    t.soulNote,
    '',
    t.who,
    '',
    `${sablon.kim[d].replace('{ad}', c.isletme)} ${t.whoTail}`,
    '',
    t.how,
    '',
    ...(c.ton === 'samimi' ? t.howSamimi(sahip) : t.howResmi(sahip)).map((x) => `- ${x}`),
    `- ${t.howLang}`,
    '',
    t.never,
    '',
    ...never.map((x, i) => `${i + 1}. ${x}`),
    '',
    t.memory,
    '',
    `- ${t.memory1}`,
    `- ${t.memory2(sahip)}`,
    '',
    t.care,
    '',
    t.careLine(liste),
    '',
  ].join('\n');

  // AGENT.md
  const cell = (s: string) => s.replace(/\|/g, '/');
  const agentMd = [
    t.agentTitle(ajanAdi),
    '',
    t.agentNote,
    '',
    t.tasks,
    '',
    t.taskHead,
    '| --- | --- | --- |',
    ...gorevler.map((g) => `| ${cell(g.ad)} | ${g.siklik} | ${cell(g.nasil)} |`),
    '',
    t.sources,
    '',
    ...(baglantilar.length
      ? [t.srcHead, '| --- | --- | --- |', ...baglantilar.map((b) => `| ${b.ad} | ${t.yontem[b.yontem]} | ${cell(b.veri)} |`)]
      : [t.srcNone]),
    '',
    t.mods,
    '',
    ...moduller.filter((m) => m.acik).map((m) => `- **${m.ad}**: ${MODULLER[m.id].ne[d]}`),
    '',
    t.roles,
    '',
    ...(ekipVar ? [t.roleOwner(sahip), ...c.ekip.map((k) => t.roleTeam(CALISMA[k][d]))] : [t.roleAlone(sahip)]),
    '',
    t.where,
    '',
    `${c.gizlilik === 'yerel' ? t.whereYerel : t.whereOzet} ${acik.has('hatirlatma') ? t.outMsg : t.outNone}`,
    t.whereTail,
    '',
  ].join('\n');

  const adimlar = [
    { baslik: t.stepInstall, detay: t.stepInstallD },
    ...baglantilar.map((b) => ({ baslik: t.stepConnect(b.ad), detay: b.adimlar.join(' ') })),
    { baslik: t.stepHistory, detay: t.stepHistoryD },
    { baslik: t.stepXray, detay: t.stepXrayD },
    { baslik: t.stepAgent, detay: t.stepAgentD(ajanAdi) },
    { baslik: t.stepPhone, detay: t.stepPhoneD },
  ];

  return {
    ajanAdi,
    soulMd,
    agentMd,
    moduller,
    baglantilar,
    gorevler,
    tema: c.tema ?? { skin: sablon.tema, accent: null },
    adimlar,
    uyarilar,
  };
}

function birlestir(xs: string[], ve: string) {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${ve} ${xs[xs.length - 1]}`;
}

export { GIZLILIK };
