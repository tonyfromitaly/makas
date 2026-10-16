import { DateTime } from 'luxon';
import { fold } from './text';

export interface Named {
  id: string;
  name: string;
}

export interface VoiceDraft {
  date: string;
  time: string | null;
  service_id: string | null;
  barber_id: string | null;
  client_id: string | null;
  client_name: string | null;
  transcript: string;
}

const NUMBER_WORDS: Record<string, number> = {
  // tr
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, 'on bir': 11, 'on iki': 12,
  // en
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  // es
  una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

const WEEKDAYS: [string, number][] = [
  ['pazartesi', 1], ['sali', 2], ['carsamba', 3], ['persembe', 4], ['cumartesi', 6], ['cuma', 5], ['pazar', 7],
  ['monday', 1], ['tuesday', 2], ['wednesday', 3], ['thursday', 4], ['friday', 5], ['saturday', 6], ['sunday', 7],
  ['lunes', 1], ['martes', 2], ['miercoles', 3], ['jueves', 4], ['viernes', 5], ['sabado', 6], ['domingo', 7],
];

const STOP = new Set(
  (
    'saat randevu randevusu icin ile ve bugun yarin obur gun sabah aksam ogle ogleden sonra bucuk yaz ekle kaydet olsun lutfen ' +
    'at for with and the a an today tomorrow morning evening afternoon pm am half past appointment book booking please o clock ' +
    'para con y el la las los de del hoy manana pasado tarde noche media cita reserva por favor'
  ).split(' '),
);

/** Turkish case suffixes after a name or number: Ahmet'e, 3'te, besde. */
const stripSuffix = (w: string) => w.replace(/'.*$/, '');

function findTime(f: string): { h: number; m: number; span: string } | null {
  let h: number | null = null;
  let m = 0;
  let span = '';
  const clock = f.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (clock) {
    h = Number(clock[1]);
    m = Number(clock[2]);
    span = clock[0];
  } else {
    const num = f.match(/\b(\d{1,2})(?:'?(?:te|ta|de|da))?\b/);
    if (num) {
      h = Number(num[1]);
      span = num[0];
    } else {
      const keys = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length);
      for (const k of keys) {
        const re = new RegExp(`(^|\\s)(saat |at |a las )?${k}(te|ta|de|da|e|a)?(\\s|$)`);
        const hit = f.match(re);
        // Bare "bir"/"una" are articles; only trust them next to a time word.
        if (hit && (k.length > 3 || hit[2] || /bucuk|media|half|pm|am/.test(f))) {
          h = NUMBER_WORDS[k];
          span = hit[0].trim();
          break;
        }
      }
    }
    if (h !== null && /\b(bucuk|y media|and a half|thirty|treinta)/.test(f)) m = 30;
    if (h !== null && /\b(ceyrek|quarter|cuarto)\b/.test(f)) m = 15;
  }
  if (h === null || h > 23 || m > 59) return null;
  const pm = /\b(aksam|ogleden sonra|pm|evening|afternoon|tarde|noche)\b/.test(f);
  const am = /\b(sabah|am|morning|de la manana)\b/.test(f);
  if (pm && h < 12) h += 12;
  // Shops are rarely open 1–7 am: "saat 3" means 15:00.
  else if (!am && h >= 1 && h <= 7) h += 12;
  return { h, m, span };
}

function findDate(f: string, now: DateTime): DateTime {
  if (/\b(obur gun|ertesi gun|day after tomorrow|pasado manana)\b/.test(f)) return now.plus({ days: 2 });
  if (/\b(yarin|tomorrow)\b/.test(f) || (/\bmanana\b/.test(f) && !/de la manana/.test(f))) return now.plus({ days: 1 });
  for (const [w, wd] of WEEKDAYS) {
    if (new RegExp(`(^|\\s)${w}(\\s|$|'|ye|ya|e|a|ni|nu)`).test(f)) {
      const diff = (wd - now.weekday + 7) % 7;
      return now.plus({ days: diff });
    }
  }
  return now;
}

function bestMatch(words: string[], items: Named[]): { item: Named; used: string[] } | null {
  let best: { item: Named; used: string[]; score: number } | null = null;
  for (const item of items) {
    const tokens = fold(item.name).split(' ').filter((t) => t.length >= 3);
    const used: string[] = [];
    for (const t of tokens) {
      const stem = t.slice(0, Math.max(4, t.length - 2));
      const hit = words.find((w) => w.startsWith(stem) || t.startsWith(w.slice(0, Math.max(4, w.length - 2))));
      if (hit && hit.length >= 3) used.push(hit);
    }
    const score = used.length / Math.max(tokens.length, 1);
    if (used.length && (!best || score > best.score)) best = { item, used, score };
  }
  return best;
}

/**
 * Turns a spoken sentence ("yarın saat 3'te Ahmet sakal") into an appointment draft.
 * The draft always goes to a confirmation screen; nothing is saved from here.
 */
export function parseVoiceAppointment(
  transcript: string,
  now: DateTime,
  lists: { services: Named[]; barbers: Named[]; clients: Named[] },
): VoiceDraft {
  const f = fold(transcript);
  const time = findTime(f);
  const date = findDate(f, now);
  let words = f
    .replace(time?.span ?? '\u0000', ' ')
    .split(' ')
    .map(stripSuffix)
    .filter((w) => w && !STOP.has(w) && !/^\d/.test(w) && !WEEKDAYS.some(([d]) => w.startsWith(d)));

  const take = (used: string[]) => {
    words = words.filter((w) => !used.includes(w));
  };
  const service = bestMatch(words, lists.services);
  if (service) take(service.used);
  const barber = bestMatch(words, lists.barbers);
  if (barber && barber.used.length) take(barber.used);
  const client = bestMatch(words, lists.clients);
  if (client) take(client.used);

  const leftover = words.filter((w) => w.length >= 2 && !(w in NUMBER_WORDS)).slice(0, 2);
  const titled = leftover.map((w) => w.charAt(0).toLocaleUpperCase('tr') + w.slice(1)).join(' ');

  return {
    date: date.toISODate()!,
    time: time ? `${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}` : null,
    service_id: service?.item.id ?? null,
    barber_id: barber?.item.id ?? null,
    client_id: client?.item.id ?? null,
    client_name: client?.item.name ?? (titled || null),
    transcript,
  };
}
