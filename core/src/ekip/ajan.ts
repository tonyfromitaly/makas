import { DateTime } from 'luxon';
import { fold } from '../parse/text';
import { bestMatch, type Named } from '../parse/voice';

// The booking agent on the shop's website: one conversation that asks what the client wants, who they
// would like ("we are five: Ahmet, Elif, … or anyone"), which day and time, then a name and a phone.
// It is deterministic on purpose: every option it offers is a real free slot from the slot engine, and
// it never promises anything the shop's calendar cannot keep. Free text works too ("yarın 3'te Elif").

export type Lang = 'tr' | 'en' | 'es';

export interface AgentState {
  service_id?: string | null;
  /** A person's id, or 'any' for whoever is free first. */
  staff_id?: string | null;
  date?: string | null;
  time?: string | null;
  name?: string | null;
  phone?: string | null;
  consent?: boolean | null;
}

export type Field = 'service' | 'staff' | 'date' | 'time' | 'name' | 'phone' | 'confirm' | 'done';

export interface AgentOption {
  label: string;
  /** What choosing it sets: { service_id: … }, { staff_id: 'any' }, { confirm: true } … */
  set: Record<string, string | boolean>;
  hint?: string;
}

const WEEKDAYS: Record<Lang, string[]> = {
  tr: ['pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar'],
  en: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  es: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
};
const MONTHS = [
  ['ocak', 'january', 'jan', 'enero', 'ene'],
  ['subat', 'february', 'feb', 'febrero'],
  ['mart', 'march', 'mar', 'marzo'],
  ['nisan', 'april', 'apr', 'abril', 'abr'],
  ['mayis', 'may', 'mayo'],
  ['haziran', 'june', 'jun', 'junio'],
  ['temmuz', 'july', 'jul', 'julio'],
  ['agustos', 'august', 'aug', 'agosto', 'ago'],
  ['eylul', 'september', 'sep', 'sept', 'septiembre'],
  ['ekim', 'october', 'oct', 'octubre'],
  ['kasim', 'november', 'nov', 'noviembre'],
  ['aralik', 'december', 'dec', 'diciembre', 'dic'],
];
const ANYONE = /\b(fark etmez|farketmez|farkmaz|kim olursa|herhangi|kim bos|ilk bos|anyone|any one|anybody|no preference|doesn'?t matter|whoever|cualquiera|da igual|me da igual|quien sea)\b/;

/** A day named in the text: today, tomorrow, a weekday (the next one), or "24 ekim" / "24". */
export function parseDay(text: string, today: DateTime): string | null {
  const t = ` ${fold(text)} `;
  if (/\b(bugun|today|hoy)\b/.test(t)) return today.toISODate();
  if (/\b(obur gun|ertesi gun|day after tomorrow|pasado manana)\b/.test(t)) return today.plus({ days: 2 }).toISODate();
  if (/\b(yarin|tomorrow|manana)\b/.test(t)) return today.plus({ days: 1 }).toISODate();
  for (const names of Object.values(WEEKDAYS)) {
    const i = names.findIndex((n) => new RegExp(`\\b${n}`).test(t));
    if (i >= 0) {
      const add = (i + 1 - today.weekday + 7) % 7;
      return today.plus({ days: add }).toISODate();
    }
  }
  const dm = t.match(/\b(\d{1,2})\s*(?:\.|\/)?\s*([a-z]+)\b/);
  if (dm) {
    const month = MONTHS.findIndex((m) => m.some((x) => dm[2].startsWith(x)));
    const day = Number(dm[1]);
    if (month >= 0 && day >= 1 && day <= 31) {
      let d = today.set({ month: month + 1, day });
      if (d < today) d = d.plus({ years: 1 });
      return d.isValid ? d.toISODate() : null;
    }
  }
  const num = t.match(/\b(\d{1,2})\s*(?:'?(?:inde|sinde|unda|ünde|th|st|nd|rd))\b/);
  if (num) {
    const day = Number(num[1]);
    let d = today.set({ day });
    if (d.isValid && d < today) d = d.plus({ months: 1 });
    return d.isValid ? d.toISODate() : null;
  }
  return null;
}

/** A time named in the text: 14:30, 14.30, 3'te, saat 3, at 3pm, a las 3. Bare hours under 8 are afternoon. */
export function parseTime(text: string): string | null {
  const t = fold(text);
  let m = t.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  let h: number | null = null;
  let min = 0;
  if (m) (h = Number(m[1])), (min = Number(m[2]));
  else if ((m = t.match(/\b(1[0-2]|0?[1-9])\s*(am|pm)\b/))) h = (Number(m[1]) % 12) + (m[2] === 'pm' ? 12 : 0);
  else if ((m = t.match(/\b(?:saat|at|a las|las)\s*([01]?\d|2[0-3])\b/)) || (m = t.match(/\b([01]?\d|2[0-3])\s*'?\s*(?:te|ta|de|da|gibi)\b/))) h = Number(m[1]);
  if (h === null) return null;
  if (h >= 1 && h < 8 && !/\b(am|sabah)\b/.test(t)) h += 12;
  if (/\b(bucuk|half)\b/.test(t) && min === 0) min = 30;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function parsePhoneish(text: string): string | null {
  const m = text.match(/\+?[\d][\d\s().-]{6,}\d/);
  return m ? m[0] : null;
}

/** The one item the text names, if it names one ("Elif'e", "sakal"). */
export function pick<T extends Named>(text: string, items: T[]): T | null {
  const t = fold(text);
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  const exact = items.filter((i) => t.includes(fold(i.name)));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact.sort((a, b) => b.name.length - a.name.length)[0];
  const m = bestMatch(words, items);
  return (m?.item as T) ?? null;
}

export const anyone = (text: string) => ANYONE.test(` ${fold(text)} `);

const T: Record<Lang, Record<string, string>> = {
  tr: {
    hello: '{shop} randevu asistanıyım. Hangi hizmet için geliyorsunuz?',
    service: 'Hangi hizmet için geliyorsunuz?',
    staff: '{service} için kimi istersiniz? {n} kişiyiz.',
    staffOne: '{service} için {name} bakıyor.',
    anyone: 'Fark etmez, ilk boş olan',
    anyoneShort: 'ilk boş olan',
    day: 'Hangi gün uygun?',
    dayNone: 'Önümüzdeki iki haftada {who} için boş yer göremiyorum. Başka birini seçebilir ya da dükkânı arayabilirsiniz.',
    closed: '{day} kapalıyız.',
    full: '{day} doldu.',
    time: '{day} için boş saatler:',
    taken: '{time} dolu. En yakın boş saatler:',
    past: 'O saat geçti. En yakın boş saatler:',
    outside: '{time} çalışma saatlerimizin dışında ({from}–{to}). Boş saatler:',
    name: 'Randevuyu kimin adına alayım?',
    phone: 'Telefon numaranız? Hatırlatmayı buraya göndeririz.',
    phoneBad: 'Bu numarayı okuyamadım. Ülke koduyla yazar mısınız? (ör. {example})',
    confirm: 'Özetliyorum: {service}, {staff}, {day} saat {time}. Ücret {price}. Onaylıyor musunuz?',
    yes: 'Onayla',
    change: 'Saati değiştir',
    done: 'Tamamdır {name}, randevunuz alındı: {day} saat {time}, {staff}. Görüşmek üzere!',
    doneReminder: ' Bir gün önce hatırlatma göndereceğiz.',
    gone: 'Az önce biri o saati aldı. Şunlar boş:',
    tooMany: 'Bu numarayla zaten birkaç randevu var. Değiştirmek için dükkânı arayabilirsiniz.',
    notUnderstood: 'Tam anlayamadım.',
    minutes: 'dk',
    today: 'Bugün',
    tomorrow: 'Yarın',
    off: 'Bu dükkân şu an online randevu almıyor.',
  },
  en: {
    hello: 'I’m the booking assistant for {shop}. What would you like to come in for?',
    service: 'What would you like to come in for?',
    staff: 'Who would you like for {service}? There are {n} of us.',
    staffOne: '{name} takes care of {service}.',
    anyone: 'Anyone, first available',
    anyoneShort: 'first available',
    day: 'Which day suits you?',
    dayNone: 'I can’t see a free time for {who} in the next two weeks. You can pick someone else or call the shop.',
    closed: 'We’re closed {onday}.',
    full: 'We’re fully booked {onday}.',
    time: 'Free times {onday}:',
    taken: '{time} is taken. The nearest free times:',
    past: 'That time has passed. The nearest free times:',
    outside: '{time} is outside our hours ({from}–{to}). Free times:',
    name: 'What name should I book it under?',
    phone: 'Your phone number? We’ll send the reminder there.',
    phoneBad: 'I couldn’t read that number. Could you write it with the country code? (e.g. {example})',
    confirm: 'To sum up: {service} with {staff}, {day} at {time}. Price {price}. Shall I book it?',
    yes: 'Book it',
    change: 'Change the time',
    done: 'All set, {name}: {day} at {time} with {staff}. See you then!',
    doneReminder: ' We’ll send you a reminder the day before.',
    gone: 'Someone just took that time. These are free:',
    tooMany: 'This number already has a few bookings. Please call the shop to change them.',
    notUnderstood: 'I didn’t quite get that.',
    minutes: 'min',
    today: 'Today',
    tomorrow: 'Tomorrow',
    off: 'This shop isn’t taking online bookings right now.',
  },
  es: {
    hello: 'Soy el asistente de citas de {shop}. ¿Para qué servicio quiere venir?',
    service: '¿Para qué servicio quiere venir?',
    staff: '¿Con quién quiere {service}? Somos {n}.',
    staffOne: '{name} se encarga de {service}.',
    anyone: 'Me da igual, el primero libre',
    anyoneShort: 'el primero libre',
    day: '¿Qué día le viene bien?',
    dayNone: 'No veo horas libres para {who} en las próximas dos semanas. Puede elegir a otra persona o llamar.',
    closed: 'Está cerrado {onday}.',
    full: 'Está completo {onday}.',
    time: 'Horas libres {onday}:',
    taken: 'Las {time} está ocupado. Las horas libres más cercanas:',
    past: 'Esa hora ya pasó. Las horas libres más cercanas:',
    outside: 'Las {time} queda fuera del horario ({from}–{to}). Horas libres:',
    name: '¿A nombre de quién hago la cita?',
    phone: '¿Su teléfono? Le enviaremos el recordatorio ahí.',
    phoneBad: 'No pude leer ese número. ¿Puede escribirlo con el código de país? (p. ej. {example})',
    confirm: 'Resumen: {service} con {staff}, {day} a las {time}. Precio {price}. ¿La confirmo?',
    yes: 'Confirmar',
    change: 'Cambiar la hora',
    done: 'Listo, {name}: {day} a las {time} con {staff}. ¡Hasta pronto!',
    doneReminder: ' Le enviaremos un recordatorio el día antes.',
    gone: 'Alguien acaba de tomar esa hora. Estas están libres:',
    tooMany: 'Este número ya tiene varias citas. Llame a la tienda para cambiarlas.',
    notUnderstood: 'No lo entendí bien.',
    minutes: 'min',
    today: 'Hoy',
    tomorrow: 'Mañana',
    off: 'Esta tienda no acepta citas online ahora mismo.',
  },
};

export function say(lang: Lang, key: string, vars: Record<string, string | number> = {}) {
  return (T[lang][key] ?? T.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function dayLabel(lang: Lang, iso: string, today: DateTime) {
  const d = DateTime.fromISO(iso, { zone: today.zone });
  if (d.hasSame(today, 'day')) return say(lang, 'today');
  if (d.hasSame(today.plus({ days: 1 }), 'day')) return say(lang, 'tomorrow');
  return d.setLocale(lang).toFormat(lang === 'en' ? 'ccc d LLL' : 'ccc d LLL');
}

export const PHONE_EXAMPLE: Record<string, string> = { TR: '+90 555 123 45 67', US: '+1 415 555 0142', ES: '+34 612 345 678', GB: '+44 7700 900123' };

/** "today", "tomorrow", "on Thu 22 Oct" (English); "hoy", "mañana", "el jue 22 oct" (Spanish). Turkish uses the label. */
export function onDay(lang: Lang, iso: string, today: DateTime) {
  const label = dayLabel(lang, iso, today);
  if (label === say(lang, 'today') || label === say(lang, 'tomorrow')) return label.toLocaleLowerCase(lang);
  return lang === 'en' ? `on ${label}` : lang === 'es' ? `el ${label}` : label;
}
