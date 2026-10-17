import { DateTime } from 'luxon';
import { fold, parseAmountCents } from '../parse/text';
import { bestMatch, findDate, findTime, type Named } from '../parse/voice';
import { METRICS, PERIODS, type Plan, type PlanItem } from './plan';

// The assistant's conversation memory. Each (shop, user) pair has one running conversation:
// every turn is stored, and the model is given a bounded view of it, so a conversation of any
// length costs the same per turn:
//   focus   – what "it", "him", "make it 4" refer to: the last client, question and drafts (structured)
//   recent  – the last RECENT turns word for word
//   earlier – one short line per older turn, the newest EARLIER_MAX kept
// After SESSION_GAP_HOURS without a message the focus is dropped, so "saat 4 olsun" the next
// morning never edits yesterday's draft. Nothing here is ever written to the shop's records;
// drafts still go to the barber for confirmation.

export const RECENT = 8;
export const EARLIER_MAX = 24;
export const SESSION_GAP_HOURS = 6;

type Metric = (typeof METRICS)[number];
type Period = (typeof PERIODS)[number];

export interface Focus {
  client?: string;
  metric?: Metric;
  period?: Period;
  appointment?: Extract<PlanItem, { type: 'appointment' }>;
  reminder?: Extract<PlanItem, { type: 'reminder' }>;
  /** The note just written with "aklında tut", so "bunu unut" can take it back. */
  note?: { id: string; text: string };
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export interface Memory {
  focus: Focus;
  earlier: string[];
  recent: Turn[];
}

export const emptyMemory = (): Memory => ({ focus: {}, earlier: [], recent: [] });

const words = (xs: string[]) => new RegExp(`(^|\\s)(${xs.join('|')})(?=\\s|$|')`);

// Words that point back at the last client. "o" only counts at the start ("o 20 dolar ödedi", not "o zaman");
// "her" is Turkish for "every" and Spanish "el" is an article, so other languages' pronouns apply only in that language.
const PRONOUN = {
  tr: new Set(['onu', 'ona', 'onun', 'ondan', 'onunla', 'kendisi', 'kendisine', 'kendisinin']),
  en: new Set(['him', 'her', 'his', 'he', 'she', 'them', 'their', 'they']),
  es: new Set(['él', 'ella', 'le']),
};
const NOT_PRONOUN_AFTER_O = new Set(['zaman', 'kadar', 'gun', 'saat', 'hafta', 'ay', 'yuzden', 'da', 'de', 'an', 'is']);
const ASKS = words(['ne', 'kac', 'nedir', 'var mi', 'how', 'what', 'which', 'when', 'cuanto', 'cuantos', 'que', 'cuando']);

const FORGET = words(['unut', 'bunu unut', 'onu unut', 'unut bunu', 'notu sil', 'sil onu', 'forget that', 'forget it', 'delete that', 'olvidalo', 'olvida eso', 'borralo', 'borra eso']);
const CANCEL = words(['vazgec', 'vazgectim', 'bosver', 'iptal', 'iptal et', 'gerek yok', 'sil onu', 'never mind', 'nevermind', 'cancel', 'forget it', 'scratch that', 'olvidalo', 'cancela', 'cancelar', 'dejalo']);
const AMEND = words(['olsun', 'yap', 'al', 'cek', 'kaydir', 'degistir', 'degil', 'yerine', 'aslinda', 'ver', 'make it', 'change', 'instead', 'actually', 'move', 'switch', 'rather', 'mejor', 'cambia', 'cambialo', 'pasalo', 'en vez']);
export const FOLLOW = words(['peki', 'ya', 'bir de', 'and', 'what about', 'how about', 'y', 'y el', 'y la', 'y que tal']);
const DATE_WORD = /\b(bugun|yarin|obur gun|ertesi gun|today|tomorrow|day after|hoy|manana|pasado manana|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes|sabado|domingo)/;
const TIME_WORD = /(saat|\bat\b|a las|\d{1,2}[:.]\d{2}|\d{1,2}'?(te|ta|de|da|e|a|ye|ya)\b|\b\d{1,2}\b|bucuk|o ?clock)/;

// Same prefix matching as local.ts periodOf, so "bu ayki" and "geçen ayın" count.
const prefix = (xs: string[]) => new RegExp(`(^|\\s)(${xs.join('|')})`);
const PERIOD_RULES: [Period, RegExp][] = [
  ['last_month', prefix(['gecen ay', 'onceki ay', 'last month', 'previous month', 'mes pasado', 'el mes anterior'])],
  ['this_month', prefix(['bu ay', 'this month', 'este mes'])],
  ['last_week', prefix(['gecen hafta', 'last week', 'semana pasada'])],
  ['this_week', prefix(['bu hafta', 'this week', 'esta semana'])],
  ['this_year', prefix(['bu yil', 'bu sene', 'this year', 'este ano'])],
  ['yesterday', prefix(['dun', 'yesterday', 'ayer'])],
  ['tomorrow', prefix(['yarin', 'tomorrow', 'manana'])],
  ['today', prefix(['bugun', 'today', 'hoy'])],
];
export const periodWord = (f: string) => PERIOD_RULES.find(([, r]) => r.test(f))?.[0] ?? null;

/** Puts the remembered client into the sentence in place of the pronoun, so the normal rules can read it. */
export function resolvePronoun(text: string, focus: Focus, lang: 'tr' | 'en' | 'es', clients: Named[]) {
  if (!focus.client) return text;
  const parts = text.trim().split(/\s+/);
  const folded = parts.map((w) => fold(w).replace(/'.*$/, ''));
  // A sentence that already names someone else is about them.
  if (bestMatch(folded, clients.filter((c) => c.name !== focus.client))) return text;
  const idx = parts.findIndex((w, i) => {
    const f = folded[i];
    if (PRONOUN.tr.has(f)) return true;
    if (f === 'o' && i === 0 && !NOT_PRONOUN_AFTER_O.has(folded[1] ?? '')) return parts.length > 1;
    if (lang === 'en') return PRONOUN.en.has(f);
    if (lang === 'es') return PRONOUN.es.has(w.toLocaleLowerCase('es').replace(/[,.?!¿¡]/g, ''));
    return false;
  });
  if (idx < 0) return text;
  const suffix = parts[idx].match(/['’].*$/)?.[0] ?? '';
  parts[idx] = focus.client + suffix;
  return parts.join(' ');
}

/**
 * Corrections that only make sense with the conversation: "saat 4 olsun", "Emre'ye ver", "boşver".
 * Returns null when the sentence stands on its own. Question follow-ups ("peki geçen ay?") are read
 * in local.ts, next to the metric rules.
 */
export function followUp(text: string, focus: Focus, ctx: { now: DateTime; services: Named[]; barbers: Named[]; clients: Named[] }): Plan | null {
  const f = fold(text).replace(/[?!.,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const n = f.split(' ').length;

  if (focus.note && n <= 5 && FORGET.test(f)) return { items: [{ type: 'forget' }] };
  if (CANCEL.test(f) && n <= 5 && (focus.appointment || focus.reminder)) return { items: [{ type: 'cancel' }] };

  // Changing the appointment we just drafted.
  const a = focus.appointment;
  if (a && n <= 9 && !parseAmountCents(f.replace(TIME_WORD, ' ').replace(/\b\d{1,2}\b/g, ' '))) {
    const toks = f.split(' ').map((w) => w.replace(/'.*$/, ''));
    const service = bestMatch(toks, ctx.services);
    const barber = bestMatch(toks, ctx.barbers);
    const otherClient = bestMatch(toks, ctx.clients.filter((c) => c.name !== a.client_name));
    const time = TIME_WORD.test(f) ? findTime(f) : null;
    const date = DATE_WORD.test(f) ? findDate(f, ctx.now).toISODate()! : null;
    const changes = !!(time || date || service || barber);
    const asks = /\?\s*$/.test(text.trim()) || ASKS.test(f);
    const cue = AMEND.test(f) || (n <= 3 && !asks);
    if (changes && cue && !asks && !otherClient && !/randevu|appointment|cita|book /.test(f)) {
      return {
        items: [
          {
            ...a,
            time: time ? `${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}` : a.time,
            date: date ?? a.date,
            service: service?.item.name ?? a.service ?? null,
            barber: barber?.item.name ?? a.barber ?? null,
          },
        ],
      };
    }
  }

  return null;
}

/** What the next turn may refer to, after this one. Names are the resolved ones the barber saw. */
export function nextFocus(prev: Focus, items: PlanItem[]): Focus {
  const f: Focus = { ...prev };
  for (const it of items) {
    if (it.type === 'appointment') {
      f.appointment = it;
      if (it.client_name) f.client = it.client_name;
    } else if (it.type === 'client') f.client = it.name;
    else if (it.type === 'ledger') f.client = it.client_name;
    else if (it.type === 'reminder') f.reminder = it;
    else if (it.type === 'query') {
      f.metric = it.metric;
      f.period = it.period;
      if (it.client_name) f.client = it.client_name;
    } else if (it.type === 'cancel') {
      delete f.appointment;
      delete f.reminder;
    } else if (it.type === 'forget') delete f.note;
    else if (it.type === 'remember' && it.subject && it.kind === 'client') f.client = it.subject;
  }
  return f;
}

/** One line for the "earlier" list when a turn leaves the recent window. */
export function earlierLine(user: string, items: PlanItem[] | null, reply: string) {
  const what = (items ?? [])
    .map((i) => {
      switch (i.type) {
        case 'appointment':
          return `appointment draft ${i.client_name ?? '?'} ${i.date} ${i.time ?? ''} ${i.service ?? ''}`.trim();
        case 'client':
          return `new client ${i.name}`;
        case 'ledger':
          return `tab ${i.kind} ${i.client_name} ${i.amount_cents / 100}`;
        case 'book':
          return `${i.kind} ${i.amount_cents / 100} ${i.category}`;
        case 'reminder':
          return `reminder "${i.title}" ${i.due_date}`;
        case 'query':
          return `asked ${i.metric} ${i.period}${i.client_name ? ` ${i.client_name}` : ''}`;
        case 'remember':
          return `noted "${i.text}"`;
        default:
          return i.type;
      }
    })
    .join('; ');
  return `"${user.slice(0, 100)}" → ${what || 'reply'}${reply ? ` | ${reply.slice(0, 80)}` : ''}`;
}

const GAP_MS = SESSION_GAP_HOURS * 3600_000;

/**
 * The model's view of the conversation from stored turns (newest first): only the current session,
 * the last RECENT turns in full and older ones as their summary line. Bounded whatever the length.
 */
export function sessionView(rows: { role: 'user' | 'assistant'; text: string; summary: string | null; created_at: Date }[], now: Date) {
  const session: typeof rows = [];
  let prev = now;
  for (const r of rows) {
    if (prev.getTime() - new Date(r.created_at).getTime() > GAP_MS) break;
    session.push(r);
    prev = new Date(r.created_at);
  }
  session.reverse();
  return {
    recent: session.slice(-RECENT).map((r) => ({ role: r.role, text: r.text.slice(0, 400) })),
    earlier: session
      .slice(0, Math.max(0, session.length - RECENT))
      .filter((r) => r.role === 'user' && r.summary)
      .map((r) => r.summary!)
      .slice(-EARLIER_MAX),
    active: session.length > 0,
  };
}
