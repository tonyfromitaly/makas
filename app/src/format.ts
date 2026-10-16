import { LOCALES, type Lang } from './i18n';

export function money(cents: number, currency: string, lang: Lang) {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(LOCALES[lang], {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

export const toCents = (s: string) => {
  const n = Number(s.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

export function timeIn(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));
}

export function dateLabel(isoDate: string, lang: Lang, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat(LOCALES[lang], { ...opts, timeZone: 'UTC' }).format(new Date(isoDate + 'T12:00:00Z'));
}

export function shortDate(iso: string, lang: Lang, tz: string) {
  return new Intl.DateTimeFormat(LOCALES[lang], { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}

/** YYYY-MM-DD for "now" in a timezone. */
export function todayIn(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

export function addDays(isoDate: string, n: number) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toLocaleUpperCase())
    .join('');
