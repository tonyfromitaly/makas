import { useEffect, useRef, useState } from 'react';
import { createClient, httpTransport, type Client } from '../api';
import { detectLang, makeT, type Lang } from '../i18n';
import { Icon } from '../components/ui';

// The shop's public booking page, embedded on its website. A conversation with the shop's booking agent:
// what, who ("we are five … or anyone"), when, a name and a phone. Every option is a real free time.

interface Option {
  label: string;
  set: Record<string, string | boolean>;
  hint?: string;
}
interface Turn {
  from: 'agent' | 'client';
  text: string;
}

/** The page's address: /book/<slug> on the website, or ?book=<slug> wherever the app runs. */
export function bookSlug(): string | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get('book') ?? location.pathname.match(/\/book\/([a-z0-9-]{3,40})\/?$/i)?.[1] ?? null;
}

export function BookPage({ slug, api: given, onClose }: { slug: string; api?: Client; onClose?(): void }) {
  const [api] = useState<Client>(() => given ?? createClient(httpTransport(import.meta.env.VITE_API_URL ?? '/api'), () => {}));
  const [lang, setLang] = useState<Lang>(() => {
    const q = new URLSearchParams(location.search).get('lang');
    return q === 'tr' || q === 'en' || q === 'es' ? q : detectLang();
  });
  const t = makeT(lang);
  const [shop, setShop] = useState<any>(null);
  const [error, setError] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [input, setInput] = useState<'text' | 'phone' | null>(null);
  const [step, setStep] = useState<string>('service');
  const [state, setState] = useState<Record<string, unknown>>({});
  const [booked, setBooked] = useState<any>(null);
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const hp = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const turn = async (body: { set?: Record<string, unknown>; text?: string }, said?: string, l: Lang = lang, st: Record<string, unknown> = state) => {
    setBusy(true);
    if (said) setTurns((ts) => [...ts, { from: 'client', text: said }]);
    try {
      const r = await api.post(`/public/book/${slug}/agent`, { lang: l, state: st, ...body, website: hp.current?.value || undefined });
      setState(r.state);
      setOptions(r.options);
      setInput(r.input);
      setStep(r.step);
      if (r.booked) setBooked(r.booked);
      if (r.say) setTurns((ts) => [...ts, { from: 'agent', text: r.say }]);
    } catch (e: any) {
      setError(e?.code === 'BOOKING_OFF' ? t('bookOff') : e?.code === 'RATE_LIMITED' ? t('bookSlowDown') : t('error_generic'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    api
      .get(`/public/book/${slug}`)
      .then((s) => {
        setShop(s);
        document.title = s.shop.name;
        // The shop's own language when the visitor's is not one we speak.
        if (!new URLSearchParams(location.search).get('lang') && !['tr', 'en', 'es'].includes(navigator.language.slice(0, 2))) setLang(s.shop.language);
        return turn({});
      })
      .catch((e) => setError(e?.code === 'BOOKING_OFF' ? t('bookOff') : t('error_generic')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  // Braces matter: scrollIntoView returns a promise in newer browsers, and an effect must not return one.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns, options]);

  const choose = (o: Option) => turn({ set: step === 'phone' ? { ...o.set, consent } : o.set }, o.hint && step === 'time' ? `${o.label} · ${o.hint}` : o.label);
  const send = () => {
    const v = text.trim();
    if (!v || busy) return;
    setText('');
    turn({ text: v, ...(step === 'phone' ? { set: { consent } } : {}) }, v);
  };
  const restart = () => {
    setTurns([]);
    setBooked(null);
    setState({});
    turn({}, undefined, lang, {});
  };
  const switchLang = (l: Lang) => {
    setLang(l);
    setTurns([]);
    setState({});
    setBooked(null);
    turn({}, undefined, l, {});
  };

  return (
    <div className="book">
      <header className="book-head">
        <div>
          <span className="eyebrow">{t('bookTitle')}</span>
          <h1>{shop?.shop.name ?? ' '}</h1>
          {shop?.shop.note && <p className="muted small">{shop.shop.note}</p>}
        </div>
        <div className="book-tools">
          <select value={lang} onChange={(e) => switchLang(e.target.value as Lang)} aria-label={t('language')}>
            <option value="tr">TR</option>
            <option value="en">EN</option>
            <option value="es">ES</option>
          </select>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label={t('close')}>
              <Icon name="x" />
            </button>
          )}
        </div>
      </header>

      <main className="book-chat" aria-live="polite">
        {error && <p className="notice warn">{error}</p>}
        {turns.map((m, i) => (
          <div key={i} className={`book-msg ${m.from}`}>
            {m.from === 'agent' && (
              <span className="book-avatar" aria-hidden>
                <Icon name="sparkle" size={14} />
              </span>
            )}
            <p>{m.text}</p>
          </div>
        ))}
        {booked && (
          <section className="receipt book-done">
            <span className="stamp">{t('bookedStamp')}</span>
            <strong>{booked.service_name}</strong>
            <span className="numeral">
              {new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${booked.date}T12:00:00Z`))} · {booked.time}
            </span>
            <span>
              {booked.staff_name}
              {booked.station_name ? ` · ${booked.station_name}` : ''}
            </span>
            <div className="row">
              <button className="btn" onClick={() => downloadIcs(booked, shop?.shop)}>
                <Icon name="calendar" /> {t('addToCalendar')}
              </button>
              <button className="btn" onClick={restart}>
                {t('bookAnother')}
              </button>
            </div>
          </section>
        )}
        {!booked && !!options.length && (
          <div className={`book-options ${step}`}>
            {options.map((o, i) => (
              <button key={i} className={`book-chip ${o.set.confirm === true ? 'primary' : ''}`} disabled={busy} onClick={() => choose(o)}>
                <span>{o.label}</span>
                {o.hint && <small>{o.hint}</small>}
              </button>
            ))}
          </div>
        )}
        <div ref={end} />
      </main>

      {!booked && !error && (
        <footer className="book-input">
          {step === 'phone' && (
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t('bookConsent')}</span>
            </label>
          )}
          <div className="row">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              inputMode={input === 'phone' ? 'tel' : 'text'}
              autoComplete={input === 'phone' ? 'tel' : step === 'name' ? 'name' : 'off'}
              placeholder={input === 'phone' ? t('bookPhonePh') : input === 'text' ? t('bookNamePh') : t('bookTypePh')}
              aria-label={t('bookTypePh')}
            />
            <button className="btn primary" onClick={send} disabled={!text.trim() || busy} aria-label={t('send')}>
              <Icon name="chevR" />
            </button>
          </div>
          {/* Honeypot: hidden from people, filled by bots. */}
          <input ref={hp} className="hp" tabIndex={-1} autoComplete="off" aria-hidden name="website" />
          <p className="book-fine muted small">{t('bookFine')}</p>
        </footer>
      )}
    </div>
  );
}

/** A calendar file for the booking, so it lands in the client's own calendar. */
function downloadIcs(b: any, shop: any) {
  const start = b.date.replace(/-/g, '') + 'T' + b.time.replace(':', '') + '00';
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Usta//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${b.appointment_id}@usta`,
    `DTSTART;TZID=${shop?.timezone ?? 'UTC'}:${start}`,
    `SUMMARY:${b.service_name} · ${shop?.name ?? ''}`,
    `DESCRIPTION:${b.staff_name}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'randevu.ics';
  a.click();
  URL.revokeObjectURL(url);
}
