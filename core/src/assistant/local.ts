import { DateTime } from 'luxon';
import { fold, hasAny, parseAmountCents } from '../parse/text';
import { parseNotesLocal } from '../parse/note';
import { bestMatch, findDate, findTime, parseVoiceAppointment, type Named } from '../parse/voice';
import { extractPhone } from './phone';
import type { Plan, PlanItem } from './plan';

export interface AssistantContext {
  now: DateTime; // in the shop's timezone
  lang: 'tr' | 'en' | 'es';
  services: Named[];
  barbers: Named[];
  clients: Named[];
}

const re = (words: string[]) => new RegExp(`(^|\\s)(${words.join('|')})`);
const QUESTION = re(['ne kadar', 'kac', 'hangi', 'kim', 'nedir', 'ne zaman', 'var mi', 'how much', 'how many', 'what', 'which', 'who', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'que', 'quien', 'cual']);
// Weak cues only count when the sentence carries no amount ("toplam 500 kazandım" is a note, not a question).
const QUESTION_WEAK = re(['toplam', 'goster', 'listele', 'ozet', 'total', 'show', 'list', 'summary', 'muestra', 'resumen']);
const REMIND = ['hatirlat', 'unutma', 'not al', 'remind', 'dont forget', 'don t forget', 'recuerda', 'recordar', 'recordatorio', 'no olvid'];
const CLIENT_NEW = ['musteri ekle', 'musteri kaydet', 'yeni musteri', 'musteri kayd', 'musteriyi kaydet', 'kaydet', 'new client', 'add client', 'new customer', 'add customer', 'register', 'save client', 'nuevo cliente', 'agrega', 'registra', 'anade', 'guarda'];
const APPT = ['randevu', 'appointment', 'book ', 'booking', 'cita', 'reserva', 'agenda'];
const LEDGER_CHARGE = ['borc yaz', 'borca yaz', 'veresiye', 'borclandir', 'hesabina yaz', 'on his tab', 'on her tab', 'on the tab', 'owes', 'put on', 'fiado', 'fiar', 'apunta', 'debe'];
const LEDGER_PAY = /(^|\s)(odedi|borcunu odedi|borcunu kapatti|kapatti|paid me|paid back|paid his|paid her|settled|pago|abono|saldo su)(\s|$)/;
const TIME_HINT = /(saat|\bat\b|a las|\d{1,2}[:.]\d{2})/;

const METRIC_RULES: [string, RegExp][] = [
  ['payables', re(['odemem', 'odeyecegim', 'odenecek', 'odemeler', 'odemem gereken', 'borcum', 'faturalar', 'have to pay', 'need to pay', 'i owe', 'bills', 'payments due', 'due', 'debo', 'tengo que pagar', 'pagos', 'por pagar'])],
  ['receivables', re(['alacak', 'veresiye', 'borclu', 'bana borc', 'owe me', 'owed', 'outstanding', 'receivable', 'me deben', 'fiado', 'por cobrar'])],
  ['reminders', re(['hatirlatma', 'yapilacak', 'isler', 'reminder', 'to do', 'todo', 'tasks', 'recordatorio', 'pendiente'])],
  ['top_service', re(['en cok', 'en populer', 'hangi hizmet', 'most popular', 'best selling', 'top service', 'mas vendido', 'mas popular'])],
  ['appointments', re(['randevu', 'musteri gel', 'kac musteri', 'appointment', 'booking', 'customers', 'clients', 'cita', 'clientes'])],
  ['net', /(^|\s)(net|kar|kari|kazanc kaldi|elimde kalan|profit|ganancia|beneficio)(\s|$)/],
  ['expense', re(['masraf', 'gider', 'harca', 'odedik', 'expense', 'spent', 'spend', 'cost', 'gasto', 'gastamos', 'gastado'])],
  ['income', re(['kazan', 'gelir', 'ciro', 'kasa', 'hasilat', 'income', 'earn', 'made', 'revenue', 'sales', 'take', 'ingreso', 'ganamos', 'ganado', 'ganancia', 'vendimos', 'facturamos'])],
];

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
export function understandLocal(text: string, ctx: AssistantContext): Plan {
  const f = fold(text);
  const today = ctx.now.toISODate()!;
  const items: PlanItem[] = [];

  // 1. Questions about the shop's numbers.
  const isQuestion = /\?\s*$/.test(text.trim()) || QUESTION.test(f) || (QUESTION_WEAK.test(f) && !parseAmountCents(f));
  if (isQuestion && !hasAny(f, REMIND)) {
    const client = bestMatch(f.split(' '), ctx.clients);
    if (client && re(['borc', 'owe', 'debe', 'balance', 'bakiye', 'veresiye']).test(f))
      return { items: [{ type: 'query', metric: 'client_balance', period: 'this_month', client_name: client.item.name }] };
    const hit = METRIC_RULES.find(([, r]) => r.test(f));
    if (hit) return { items: [{ type: 'query', metric: hit[0] as any, period: periodOf(f, hit[0]) as any }] };
  }

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

  // 6. Money notes, one entry per amount.
  if (amount) {
    const drafts = parseNotesLocal(text, today, ctx.lang);
    if (drafts.length) return { items: drafts.map((d) => ({ type: 'book' as const, ...d })) };
  }

  // 7. A question we could not map, or nothing we understood.
  return { items: [{ type: 'unknown' }] };
}
