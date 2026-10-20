import { DateTime } from 'luxon';
import { fold, hasAny, parseAmountCents } from '../parse/text';
import { parseNotesLocal } from '../parse/note';
import { bestMatch, findDate, findTime, parseVoiceAppointment, type Named } from '../parse/voice';
import { extractPhone } from './phone';
import type { Plan, PlanItem } from './plan';
import { FOLLOW, followUp, periodWord, resolvePronoun, type Focus } from './memory';

export interface AssistantContext {
  now: DateTime; // in the shop's timezone
  lang: 'tr' | 'en' | 'es';
  services: Named[];
  barbers: Named[];
  clients: Named[];
  /** What the conversation is about (see memory.ts). Without it every sentence stands alone. */
  focus?: Focus;
}

const re = (words: string[]) => new RegExp(`(^|\\s)(${words.join('|')})`);
const QUESTION = re(['ne kadar', 'kac', 'hangi', 'kim', 'nedir', 'ne zaman', 'var mi', 'ne var', 'ne durumda', 'ne tuttu', 'ne oldu', 'miyiz', 'muyuz', 'how much', 'how many', 'what', 'which', 'who', 'are we', 'did we', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'que', 'quien', 'cual', 'como']);
// Weak cues only count when the sentence carries no amount ("toplam 500 kazandım" is a note, not a question).
// Open questions and requests for advice go to the data-grounded chat.
const ADVICE = re(['ne yapmali', 'ne yapsam', 'nasil', 'neden', 'niye', 'oneri', 'tavsiye', 'fikir', 'yorumla', 'durum ne', 'nasil gidiyor', 'why', 'how can', 'how do i', 'what should', 'advice', 'suggest', 'tips', 'por que', 'como puedo', 'que hago', 'consejo', 'recomienda']);
const QUESTION_WEAK = re(['toplam', 'goster', 'listele', 'ozet', 'getir', 'cikar', 'dokum', 'rapor', 'tablo', 'total', 'show', 'list', 'summary', 'give me', 'pull up', 'muestra', 'resumen', 'dame']);
// The whole picture of a period: the books' account, a summary, a comparison, "how did it go".
const SUMMARY = re(['hesab', 'hesap', 'dokum', 'ozet', 'rapor', 'bilanco', 'kar zarar', 'gelir gider', 'nasil gecti', 'nasildi', 'nasiliz', 'nasil gidiyor', 'isler nasil', 'karsilastir', 'gore nasil', 'how did', 'how are we doing', 'how we did', 'how was', 'numbers', 'summary', 'recap', 'rundown', 'p&l', 'p l ', 'pnl', 'profit and loss', 'report', 'compared to', 'como nos fue', 'como vamos', 'como estuvo', 'resumen', 'informe']);
// Advice proper ("nasıl daha çok kazanırım") as opposed to "how did we do" about the shop's own numbers.
const ADVICE_REAL = re(['nasil daha', 'nasil artir', 'ne yapmali', 'ne yapsam', 'neden', 'niye', 'oneri', 'tavsiye', 'fikir', 'why', 'how can', 'how do i', 'what should', 'advice', 'suggest', 'tips', 'por que', 'como puedo', 'que hago', 'consejo', 'recomienda']);
// "Keep this in mind" is a note for the assistant's memory, not a dated reminder ("unutma ki" ≠ "unutma").
const REMEMBER = re(['aklinda tut', 'aklinda olsun', 'aklina yaz', 'kafana yaz', 'bilmen gereken', 'bilesin', 'not et ki', 'unutma ki', 'sunu bil', 'sunu aklinda', 'remember that', 'keep in mind', 'note that', 'for the record', 'ten en cuenta', 'recuerda que', 'apunta que', 'que sepas']);
const REMEMBER_STRIP = /(şunu\s+|sunu\s+)?(aklında tut|aklinda tut|aklında olsun|aklinda olsun|aklına yaz|aklina yaz|kafana yaz|bilmen gereken|bilesin|not et ki|unutma ki|şunu bil|sunu bil|remember that|keep in mind( that)?|note that|for the record|ten en cuenta( que)?|recuerda que|apunta que|que sepas)[:,]?\s*/gi;
const MONEY_TOPIC = re(['kira', 'fatura', 'odeme', 'tedarik', 'fiyat', 'zam', 'komisyon', 'pos', 'rent', 'bill', 'price', 'supplier', 'payment', 'alquiler', 'factura', 'precio', 'proveedor']);
const PREFERENCE_TOPIC = re(['bana', 'cevap', 'kisa tut', 'uzun', 'soyleme', 'sabah ozet', 'me ', 'answer', 'reply', 'tell me', 'dont tell', 'respuesta', 'dime', 'no me']);
const REMIND = ['hatirlat', 'unutma', 'not al', 'remind', 'dont forget', 'don t forget', 'recuerda', 'recordar', 'recordatorio', 'no olvid'];
const CLIENT_NEW = ['musteri ekle', 'musteri kaydet', 'yeni musteri', 'musteri kayd', 'musteriyi kaydet', 'kaydet', 'new client', 'add client', 'new customer', 'add customer', 'register', 'save client', 'nuevo cliente', 'agrega', 'registra', 'anade', 'guarda'];
const APPT = ['randevu', 'appointment', 'book ', 'booking', 'cita', 'reserva', 'agenda'];
const LEDGER_CHARGE = ['borc yaz', 'borca yaz', 'veresiye', 'borclandir', 'hesabina yaz', 'on his tab', 'on her tab', 'on the tab', 'owes', 'put on', 'fiado', 'fiar', 'apunta', 'debe'];
const LEDGER_PAY = /(^|\s)(odedi|borcunu odedi|borcunu kapatti|kapatti|paid me|paid back|paid his|paid her|settled|pago|abono|saldo su)(\s|$)/;
// Words that make a number a time of day ("saat 3", "3'te", "beş buçukta", "at 11", "a las 4").
const TIME_HINT = /(saat|\bat\b|a las|\d{1,2}[:.]\d{2}|bucuk|ceyrek|half past|o ?clock|y media|\d{1,2}'?(te|ta|de|da)\b|\b(bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)(de|da|te|ta)\b)/;

const MONEY_WORD = /(\$|€|₺|dolar|dollar|bucks|usd|lira|\btl\b|euro|peso|bin\b|kazan|gelir|gider|odedim|aldim|harcad|bahsis|kira|fatura|made|paid|spent|bought|tip|rent|gane|pague|gaste|propina|alquiler)/;
/** The team: who sold what, commissions, settling up. */
const TEAM = re(['ekip', 'ekibim', 'personel', 'calisan', 'eleman', 'kim en cok', 'en cok kim', 'hakedis', 'prim', 'komisyon', 'team', 'staff', 'employees', 'who sold', 'commission', 'payroll', 'equipo', 'empleados', 'comision', 'quien vendio', 'nomina']);
const SOLD = /(^|\s)(satti|sattin|satmis|satis|satisi|cirosu|yapti|kazandirdi|kazandi|getirdi|sell|sells|sold|made|make|brought in|vende|vendio|hizo|gano)(\s|$|\?)/;
const METRIC_RULES: [string, RegExp][] = [
  ['cash', re(['kasada ne', 'kasada kac', 'kasada ne kadar', 'kasa ne durumda', 'kasa durumu', 'bakiye', 'bankada', 'hesapta ne', 'hesapta kac', 'hesapta ne kadar', 'balance', 'in the bank', 'cash on hand', 'whats in the till', 'what s in the till', 'in the till', 'saldo', 'en el banco', 'en caja'])],
  ['payables', re(['odemem', 'odeyecegim', 'odenecek', 'odemeler', 'odemem gereken', 'borcum', 'faturalar', 'have to pay', 'need to pay', 'i owe', 'bills', 'payments due', 'due', 'debo', 'tengo que pagar', 'pagos', 'por pagar'])],
  ['receivables', re(['alacak', 'veresiye', 'borclu', 'bana borc', 'owe me', 'owed', 'outstanding', 'receivable', 'me deben', 'fiado', 'por cobrar'])],
  ['reminders', re(['hatirlatma', 'yapilacak', 'isler', 'reminder', 'to do', 'todo', 'tasks', 'recordatorio', 'pendiente'])],
  ['top_service', re(['en cok', 'en populer', 'hangi hizmet', 'en iyi satan', 'most popular', 'best selling', 'best seller', 'top service', 'what sold', 'mas vendido', 'mas popular'])],
  ['appointments', re(['randevu', 'musteri gel', 'kac musteri', 'kimler var', 'kim var', 'kim geliyor', 'appointment', 'booking', 'customers', 'clients', 'who is coming', 'whos coming', 'who s coming', 'cita', 'clientes', 'quien viene'])],
  ['net', /(^|\s)(net|kar|kari|kar ettik|kardayiz|zarar|zarardayiz|zarar ettik|kazanc kaldi|elimde kalan|elimde ne kaldi|cebimizde|cepte ne|profit|profitable|in the red|in the black|left over|ganancia|beneficio|perdida|nos quedo)(\s|$|\?)/],
  ['expense', re(['masraf', 'gider', 'harca', 'odedik', 'cikti', 'expense', 'spent', 'spend', 'cost', 'gasto', 'gastamos', 'gastado'])],
  ['income', re(['kazan', 'gelir', 'ciro', 'kasa', 'hasilat', 'girdi', 'para yaptik', 'satis', 'income', 'earn', 'made', 'make', 'bring in', 'brought in', 'revenue', 'sales', 'take', 'till', 'ingreso', 'ganamos', 'ganado', 'ganancia', 'vendimos', 'facturamos', 'caja'])],
];

/** "ekim ayının hesabı", "eylül ne kadar kazandırdı", "how was september": a month named outright. */
function namedMonth(f: string): number | null {
  for (const [name, n] of Object.entries(MONTHS)) {
    // "25 ekim" is a date, not the month as a whole.
    if (new RegExp(`(^|\\s)${name}`).test(f) && !new RegExp(`\\d+\\S* ${name}`).test(f)) return n;
  }
  return null;
}

function periodOf(f: string, metric: string) {
  if (re(['gecen ay', 'onceki ay', 'last month', 'previous month', 'mes pasado', 'el mes anterior']).test(f)) return 'last_month';
  if (re(['bu ay', 'this month', 'este mes']).test(f)) return 'this_month';
  if (re(['gecen hafta', 'last week', 'semana pasada']).test(f)) return 'last_week';
  if (re(['bu hafta', 'this week', 'esta semana']).test(f)) return 'this_week';
  if (re(['bu yil', 'bu sene', 'this year', 'este ano']).test(f)) return 'this_year';
  if (re(['dun', 'yesterday', 'ayer']).test(f)) return 'yesterday';
  if (re(['yarin', 'tomorrow', 'manana']).test(f)) return 'tomorrow';
  if (re(['bugun', 'today', 'hoy']).test(f)) return 'today';
  return metric === 'appointments' || metric === 'reminders' ? 'today' : 'this_month';
}

const MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/** Due date for a reminder, plus the matched words so they are not read as an amount. */
export function parseDue(f: string, now: DateTime): { date: DateTime; span: string } {
  const month = Object.keys(MONTHS).join('|');
  const dm =
    f.match(new RegExp(`(\\d{1,2})\\S* (${month})`)) ?? f.match(new RegExp(`(${month}) (\\d{1,2})`)) ?? f.match(new RegExp(`(\\d{1,2}) de (${month})`));
  if (dm) {
    const [a, b] = [dm[1], dm[2]];
    const day = Number(/\d/.test(a) ? a : b);
    const m = MONTHS[/\d/.test(a) ? b : a];
    let d = now.set({ month: m, day });
    if (d < now.startOf('day')) d = d.plus({ years: 1 });
    return { date: d, span: dm[0] };
  }
  const dom = f.match(/ayin (\d{1,2})\S*/) ?? f.match(/(?:on the )?(\d{1,2})(?:st|nd|rd|th)\b/) ?? f.match(/\bel (?:dia )?(\d{1,2})\b/);
  if (dom) {
    const day = Number(dom[1]);
    let d = now.set({ day: Math.min(day, now.daysInMonth!) });
    if (d < now.startOf('day')) d = now.plus({ months: 1 }).set({ day: Math.min(day, now.plus({ months: 1 }).daysInMonth!) });
    return { date: d, span: dom[0] };
  }
  if (re(['haftaya', 'gelecek hafta', 'next week', 'la proxima semana', 'semana que viene']).test(f)) return { date: now.plus({ weeks: 1 }), span: '' };
  return { date: findDate(f, now), span: '' };
}

const FILLER = new Set(
  ('musteri musterisi yeni ekle kaydet kaydi kayit numarasi numara telefonu telefon tel no adi ismi isimli adinda olan ' +
    'new client customer add save register named name number phone is his her the a an with called ' +
    'nuevo cliente agrega registra anade guarda llamado nombre numero telefono es su el la un con de y ve and').split(' '),
);

const titleCase = (w: string) => w.charAt(0).toLocaleUpperCase('tr') + w.slice(1);

const TITLE_DROP = new Set(
  ('bana lutfen please por favor bugun yarin obur gun haftaya today tomorrow tonight hoy manana saat at a las alle on the el dia ' +
    'dolar dolari dolarlik dollar dollars usd lira tl peso pesos euro de ve ayin gunu gun').split(' '),
);

/** Turkish object case reads oddly in a title: "faturasını" → "faturası", "ödemeyi" → "ödeme", "aramamı" → "arama". */
const nominative = (w: string) =>
  w
    .replace(/s([ıiuü])n[ıiuü]$/, 's$1')
    .replace(/([aeıioöuü])y[ıiuü]$/, '$1')
    .replace(/(m[ae])m[ıi]$/, '$1');

/** Turns "ayın 25'inde 1800 dolar kira ödemesini hatırlat" into "Kira ödemesi": no trigger words, dates, amounts or currency. */
function reminderTitle(text: string) {
  const months = Object.keys(MONTHS);
  const kept = text
    .replace(/(hatırlat\S*|hatirlat\S*|unutma\S*|not al\S*|remind me( to)?|don'?t forget( to)?|recu[eé]rdame( que)?|recordar|no olvides?)/gi, ' ')
    .split(/\s+/)
    .filter((w) => {
      const f = fold(w).replace(/[,.:;!?]+$/, '');
      const base = f.replace(/'.*$/, '');
      if (!f || TITLE_DROP.has(base) || /^\$?\d/.test(f) || /\d(st|nd|rd|th)$/.test(f)) return false;
      if (months.includes(base) || ['pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'].includes(base)) return false;
      return true;
    })
    .map((w) => w.replace(/[,.:;!?]+$/, ''))
    .map(nominative);
  const t = kept.join(' ').trim() || text.trim();
  return titleCase(t).slice(0, 200);
}

/**
 * Rule-based understanding for tr/en/es. It runs offline (and in the browser demo); with an API key
 * configured the LLM produces the same Plan instead. Neither ever computes a total.
 */
export function understandLocal(said: string, base: AssistantContext): Plan {
  let ctx = base;
  let text = said;
  const focus = base.focus;
  if (focus) {
    // A client drafted a moment ago may not be saved yet; still let "ona" find them.
    if (focus.client && !base.clients.some((c) => c.name === focus.client))
      ctx = { ...base, clients: [...base.clients, { id: '', name: focus.client }] };
    const fu = followUp(said, focus, ctx);
    if (fu) return fu;
    text = resolvePronoun(said, focus, ctx.lang, ctx.clients);
  }
  const f = fold(text);
  const today = ctx.now.toISODate()!;
  const items: PlanItem[] = [];

  // 0. A short follow-up to the last question keeps what it does not change:
  //    "peki geçen ay?" keeps the metric, "giderler?" keeps the period.
  if (focus?.metric && !hasAny(f, REMIND) && !parseAmountCents(f)) {
    const n = f.split(' ').length;
    const short = n <= 6 && (FOLLOW.test(f) || /\?\s*$/.test(text.trim()) || n <= 3);
    const hit = METRIC_RULES.find(([, r]) => r.test(f))?.[0] as any;
    const period = periodWord(f);
    if (short && !!hit !== !!period && !ADVICE.test(f)) {
      return { items: [{ type: 'query', metric: hit ?? focus.metric, period: period ?? focus.period ?? 'this_month', client_name: null }] };
    }
  }

  // 0b. A note for the assistant's long-term memory.
  if (REMEMBER.test(f)) {
    const note = text.replace(REMEMBER_STRIP, ' ').replace(/\s+/g, ' ').trim().replace(/^(ki|that|que)\s+/i, '').replace(/[\s,;:]+$/, '');
    const toks = fold(note).split(' ').map((w) => w.replace(/'.*$/, ''));
    const client = bestMatch(toks, ctx.clients);
    const barber = bestMatch(toks, ctx.barbers);
    const nf = fold(note);
    const kind = client ? 'client' : barber ? 'team' : MONEY_TOPIC.test(nf) ? 'money' : PREFERENCE_TOPIC.test(nf) ? 'preference' : 'shop';
    if (note.length >= 3)
      return { items: [{ type: 'remember', kind, subject: client?.item.name ?? barber?.item.name ?? null, text: (note.charAt(0).toLocaleUpperCase('tr') + note.slice(1)).slice(0, 200) }] };
  }

  // 1. Questions about the shop's numbers. A metric (or "the account", "how did it go") with a period
  //    and no amount is a question even without a question word: "bu ayın cirosu", "geçen ayın hesabını
  //    getir", "ekim ayının hesabı".
  const amountSaid = !!parseAmountCents(f);
  const month = namedMonth(f);
  const periodSaid = !!periodWord(f) || month !== null || re(['bugun', 'dun', 'today', 'yesterday', 'hoy', 'ayer', 'aylik', 'monthly', 'mensual', 'haftalik', 'weekly', 'semanal']).test(f);
  const metricHit = METRIC_RULES.find(([, r]) => r.test(f));
  const summarySaid = SUMMARY.test(f) && !ADVICE_REAL.test(f);
  const isQuestion =
    /\?\s*$/.test(text.trim()) || QUESTION.test(f) || (QUESTION_WEAK.test(f) && !amountSaid) || (summarySaid && !amountSaid) || (!!metricHit && periodSaid && !amountSaid);
  if (isQuestion && !hasAny(f, REMIND)) {
    const client = bestMatch(f.split(' '), ctx.clients);
    if (client && re(['borc', 'owe', 'debe', 'balance', 'bakiye', 'veresiye']).test(f))
      return { items: [{ type: 'query', metric: 'client_balance', period: 'this_month', client_name: client.item.name }] };
    // "Ahmet bu ay ne kadar sattı", "ekip bu hafta ne yaptı", "kim en çok sattı": the team's sales.
    const member = bestMatch(f.split(' ').map((w) => w.replace(/'.*$/, '')), ctx.barbers);
    if (!ADVICE_REAL.test(f) && (TEAM.test(f) || (member && (SOLD.test(f) || metricHit?.[0] === 'income'))))
      return { items: [{ type: 'query', metric: 'team', period: periodOf(f, 'team') as any, month, staff_name: member?.item.name ?? null }] };
    // "geçen aya göre nasılız", "compared to last month": this month, measured against the last.
    const versus = re(['gore', 'karsilastir', 'compared', 'versus', 'comparado', 'frente a']).test(f);
    if (summarySaid)
      return { items: [{ type: 'query', metric: 'summary', period: (versus ? 'this_month' : periodOf(f, 'summary')) as any, month: versus ? null : month }] };
    if (metricHit && !ADVICE_REAL.test(f)) return { items: [{ type: 'query', metric: metricHit[0] as any, period: periodOf(f, metricHit[0]) as any, month }] };
    // "bu hafta nasıl geçti", "¿cómo nos fue?": how did the shop do, with a period → the summary.
    if (!ADVICE_REAL.test(f) && periodSaid && !amountSaid && re(['nasil', 'durum', 'how', 'como']).test(f))
      return { items: [{ type: 'query', metric: 'summary', period: periodOf(f, 'summary') as any, month }] };
    return { items: [{ type: 'chat', question: text.trim().slice(0, 600) }] };
  }
  if (ADVICE.test(f)) return { items: [{ type: 'chat', question: text.trim().slice(0, 600) }] };

  // 2. A reminder for the barber (optionally a payment with an amount).
  if (hasAny(f, REMIND)) {
    const due = parseDue(f, ctx.now);
    let rest = due.span ? f.replace(due.span, ' ') : f;
    const time = TIME_HINT.test(rest) ? findTime(rest) : null;
    if (time) rest = rest.replace(time.span, ' ');
    const amount = parseAmountCents(rest);
    const payment = !!amount || re(['odeme', 'ode', 'kira', 'fatura', 'pay', 'rent', 'bill', 'pago', 'pagar', 'alquiler', 'factura']).test(f);
    items.push({
      type: 'reminder',
      kind: payment ? 'payment' : 'reminder',
      title: reminderTitle(text),
      due_date: due.date.toISODate()!,
      due_time: time ? `${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}` : null,
      amount_cents: amount ?? null,
    });
    return { items };
  }

  const phone = extractPhone(text);
  const hasTime = TIME_HINT.test(f) && !!findTime(f);
  const wantsAppt = hasAny(f, APPT) || (hasTime && (bestMatch(f.split(' '), ctx.services) || bestMatch(f.split(' '), ctx.clients)));

  // 3. Registering a client by voice: "yeni müşteri Ali Kaya 0532 111 22 33".
  if (!wantsAppt && (hasAny(f, CLIENT_NEW) || (phone && !parseAmountCents(phone.rest)))) {
    const words = (phone ? phone.rest : text)
      .split(/\s+/)
      .map((w) => w.replace(/['’].*$/, '').replace(/[,.:;]+$/, ''))
      .filter((w) => w && !FILLER.has(fold(w)) && !/\d/.test(w));
    const name = words.slice(0, 3).map(titleCase).join(' ');
    const language = re(['ingilizce', 'english', 'ingles']).test(f) ? 'en' : re(['ispanyolca', 'spanish', 'espanol']).test(f) ? 'es' : re(['turkce', 'turkish', 'turco']).test(f) ? 'tr' : null;
    if (name) return { items: [{ type: 'client', name, phone: phone?.raw ?? null, language }] };
  }

  // 4. Booking.
  if (wantsAppt) {
    const d = parseVoiceAppointment(phone ? phone.rest : text, ctx.now, ctx);
    return {
      items: [
        {
          type: 'appointment',
          client_name: d.client_name,
          phone: phone?.raw ?? null,
          service: ctx.services.find((s) => s.id === d.service_id)?.name ?? null,
          barber: ctx.barbers.find((b) => b.id === d.barber_id)?.name ?? null,
          date: d.date,
          time: d.time,
        },
      ],
    };
  }

  // 5. A client's tab: "Mehmet 40 dolar veresiye", "Mehmet borcunu ödedi 40".
  const amount = parseAmountCents(f);
  const client = bestMatch(f.split(' ').map((w) => w.replace(/'.*$/, '')), ctx.clients);
  if (amount && client && (hasAny(f, LEDGER_CHARGE) || LEDGER_PAY.test(f))) {
    return {
      items: [
        {
          type: 'ledger',
          client_name: client.item.name,
          kind: LEDGER_PAY.test(f) && !hasAny(f, LEDGER_CHARGE.filter((w) => w !== 'debe')) ? 'payment' : 'charge',
          amount_cents: amount,
          note: text.trim().slice(0, 200),
        },
      ],
    };
  }

  // 6. Money notes, one entry per amount. "saat 5 olsun" holds a time, not five dollars.
  const onlyATime = hasTime && !MONEY_WORD.test(f) && (f.match(/\d+/g) ?? []).length === 1;
  if (amount && !onlyATime) {
    const drafts = parseNotesLocal(text, today, ctx.lang);
    if (drafts.length) return { items: drafts.map((d) => ({ type: 'book' as const, ...d })) };
  }

  // 7. A question we could not map, or nothing we understood.
  return { items: [{ type: 'unknown' }] };
}
