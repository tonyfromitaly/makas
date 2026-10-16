import { useState } from 'react';
import { DateTime } from 'luxon';
import { parseVoiceAppointment, type VoiceDraft } from '@makas/core';
import { useApp, useLoad } from '../state';
import { addDays, dateLabel, timeIn, todayIn } from '../format';
import { Empty, Icon, Sheet, useSpeech } from '../components/ui';
import { AppointmentForm } from './AppointmentForm';

export function Today() {
  const { api, me, t, lang, fmt } = useApp();
  const tz = me.shop.timezone;
  const [date, setDate] = useState(todayIn(tz));
  const [creating, setCreating] = useState<{ draft?: VoiceDraft } | null>(null);
  const [acting, setActing] = useState<any>(null);
  const [report, setReport] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const { data, reload } = useLoad(() => api.get(`/appointments?date=${date}`), [date]);

  const isToday = date === todayIn(tz);
  const rel = isToday ? t('today') : date === addDays(todayIn(tz), 1) ? t('tomorrow') : date === addDays(todayIn(tz), -1) ? t('yesterday') : null;
  const s = data?.summary;
  const pct = s && s.expected_cents ? Math.round((s.done_cents / s.expected_cents) * 100) : 0;

  return (
    <div className="screen">
      <div className="date-nav">
        <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="previous day">
          <Icon name="chevL" />
        </button>
        <button className="date-title" onClick={() => setDate(todayIn(tz))}>
          {rel && <span className="eyebrow">{rel}</span>}
          <span>{dateLabel(date, lang)}</span>
        </button>
        <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="next day">
          <Icon name="chevR" />
        </button>
      </div>

      <section className="till card">
        <div className="till-main">
          <span className="eyebrow">{t('inTheTill')}</span>
          <strong className="numeral big">{fmt(s?.done_cents ?? 0)}</strong>
        </div>
        <div className="till-side">
          <span className="eyebrow">{t('expected')}</span>
          <span className="numeral">{fmt(s?.expected_cents ?? 0)}</span>
        </div>
        <div className="meter" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="till-foot">
          <span>
            {s?.done ?? 0} {t('done').toLocaleLowerCase()} · {s?.booked ?? 0} {t('booked').toLocaleLowerCase()}
            {s?.missed ? ` · ${s.missed} ${t('missed').toLocaleLowerCase()}` : ''}
          </span>
          <button className="link-btn" onClick={() => setReport(true)}>
            <Icon name="check" size={16} /> {t('closeTill')}
          </button>
        </div>
      </section>

      <ol className="agenda">
        {data?.data.map((a: any) => (
          <li key={a.id} className={`appt status-${a.status}`}>
            <button className="appt-btn" onClick={() => setActing(a)}>
              <time className="appt-time numeral">{timeIn(a.starts_at, tz)}</time>
              <span className="appt-main">
                <span className="appt-client">
                  {a.client_name}
                  {a.client_missed > 0 && a.status === 'booked' && (
                    <span className={`chip risk ${a.client_missed > 1 ? 'high' : ''}`} title={t('risk')}>
                      <Icon name="flame" size={12} /> {a.client_missed}
                    </span>
                  )}
                </span>
                <span className="appt-meta">
                  {a.service_name} · {a.barber_name}
                </span>
              </span>
              <span className="appt-end">
                <span className="numeral">{fmt(a.price_cents_snapshot)}</span>
                <ReminderDots reminders={a.reminders} />
              </span>
            </button>
          </li>
        ))}
      </ol>
      {data && !data.data.length && (
        <Empty icon="calendar" text={t('noAppointments')}>
          <button className="btn" onClick={() => setCreating({})}>
            {t('addFirst')}
          </button>
        </Empty>
      )}

      <div className="fab-row">
        <button className="fab ghost" onClick={() => setVoiceOpen(true)} aria-label={t('speak')}>
          <Icon name="mic" size={22} />
        </button>
        <button className="fab" onClick={() => setCreating({})} aria-label={t('newAppointment')}>
          <Icon name="plus" size={24} />
        </button>
      </div>

      <Sheet open={!!creating} onClose={() => setCreating(null)} title={t('newAppointment')}>
        {creating && (
          <AppointmentForm
            date={date}
            draft={creating.draft}
            onDone={(d) => {
              setCreating(null);
              if (d && d !== date) setDate(d);
              else reload();
            }}
          />
        )}
      </Sheet>

      <VoiceSheet
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onDraft={(draft) => {
          setVoiceOpen(false);
          setCreating({ draft });
        }}
      />

      <Sheet open={!!acting} onClose={() => setActing(null)} title={acting ? `${timeIn(acting.starts_at, tz)} · ${acting.client_name}` : ''}>
        {acting && <ActionPanel appt={acting} onDone={() => (setActing(null), reload())} />}
      </Sheet>

      <Sheet open={report} onClose={() => setReport(false)} title={t('dayReport')}>
        {report && <DayReport date={date} appts={data} />}
      </Sheet>
    </div>
  );
}

function ReminderDots({ reminders }: { reminders: any[] }) {
  const { t } = useApp();
  if (!reminders?.length) return null;
  return (
    <span className="dots" aria-label={t('reminders')}>
      {reminders.map((r) => (
        <span key={r.id} className={`dot ${r.status}`} title={`${r.template_key === 'reminder_day_before' ? t('remDayBefore') : t('remDayOf')}: ${t(`rem_${r.status}` as any)}`} />
      ))}
    </span>
  );
}

function ActionPanel({ appt, onDone }: { appt: any; onDone(): void }) {
  const { api, t, fail, me, fmt } = useApp();
  const tz = me.shop.timezone;
  const [time, setTime] = useState(timeIn(appt.starts_at, tz));
  const local = DateTime.fromISO(appt.starts_at, { zone: tz });
  const set = async (body: any) => {
    try {
      await api.patch(`/appointments/${appt.id}`, body);
      onDone();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div className="stack">
      <p className="muted">
        {appt.service_name} · {appt.barber_name} · {fmt(appt.price_cents_snapshot)}
      </p>
      {appt.client_missed > 0 && (
        <p className="notice warn">
          <Icon name="flame" size={16} /> {appt.client_missed > 1 ? t('risk') : t('riskSome')} ({appt.client_missed}×)
        </p>
      )}
      {appt.status === 'booked' ? (
        <div className="action-grid">
          <button className="btn ok" onClick={() => set({ status: 'done' })}>
            <Icon name="check" /> {t('done')}
          </button>
          <button className="btn" onClick={() => set({ status: 'missed' })}>
            {t('missed')}
          </button>
          <button className="btn danger-ghost" onClick={() => set({ status: 'cancelled' })}>
            {t('cancelled')}
          </button>
        </div>
      ) : (
        <button className="btn" onClick={() => set({ status: 'booked' })}>
          <Icon name="undo" /> {t('restore')} ({t(appt.status)})
        </button>
      )}
      {appt.status === 'booked' && (
        <div className="row">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t('time')} />
          <button className="btn" onClick={() => set({ starts_local: `${local.toISODate()}T${time}` })}>
            <Icon name="clock" /> {t('reschedule')}
          </button>
        </div>
      )}
      {!!appt.reminders?.length && (
        <div>
          <h3 className="mini-title">{t('reminders')}</h3>
          <ul className="reminder-list">
            {appt.reminders.map((r: any) => (
              <li key={r.id}>
                <span className={`dot ${r.status}`} />
                <span>{r.template_key === 'reminder_day_before' ? t('remDayBefore') : t('remDayOf')}</span>
                <span className="muted">{DateTime.fromISO(r.scheduled_at, { zone: tz }).toFormat('dd.MM HH:mm')}</span>
                <span className="muted">{t(`rem_${r.status}` as any)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {appt.consent_status === 'revoked' && <p className="muted small">{t('consent')}: {t('revoked')}</p>}
    </div>
  );
}

function VoiceSheet({ open, onClose, onDraft }: { open: boolean; onClose(): void; onDraft(d: VoiceDraft): void }) {
  const { api, me, t, lang, fail } = useApp();
  const [text, setText] = useState('');
  const run = async (sentence: string) => {
    if (!sentence.trim()) return;
    try {
      const [services, barbers, clients] = await Promise.all([
        api.get('/services?page_size=200'),
        api.get('/barbers?page_size=200'),
        api.get('/clients?page_size=200'),
      ]);
      const now = DateTime.now().setZone(me.shop.timezone);
      onDraft(parseVoiceAppointment(sentence, now, { services: services.data, barbers: barbers.data, clients: clients.data }));
      setText('');
    } catch (e) {
      fail(e);
    }
  };
  const speech = useSpeech(lang, (s) => {
    setText(s);
    run(s);
  });
  return (
    <Sheet open={open} onClose={onClose} title={t('newAppointment')}>
      <div className="stack voice">
        <button
          className={`mic-orb ${speech.listening ? 'live' : ''}`}
          disabled={!speech.supported}
          onClick={() => (speech.listening ? speech.stop() : speech.start())}
          aria-label={t('speak')}
        >
          <Icon name="mic" size={34} />
        </button>
        <p className="muted center">{speech.listening ? t('listening') : speech.supported ? t('speak') : t('voiceUnsupported')}</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            run(text);
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('typeInstead')} />
          <button className="btn primary" type="submit">
            <Icon name="chevR" />
          </button>
        </form>
      </div>
    </Sheet>
  );
}

function DayReport({ date, appts }: { date: string; appts: any }) {
  const { api, me, t, lang, fmt, fail } = useApp();
  const { data } = useLoad(() => api.get(`/books/summary?period=day&date=${date}`), [date]);
  if (!data) return <div className="skeleton" />;
  const s = appts?.summary;
  const lines = [
    `✂️ ${me.shop.name} · ${dateLabel(date, lang)}`,
    `${t('income')}: ${fmt(data.income_cents)}`,
    `${t('expense')}: ${fmt(data.expense_cents)}`,
    `${t('net')}: ${fmt(data.net_cents)}`,
    s ? `${s.done} ${t('done').toLocaleLowerCase()} · ${s.missed} ${t('missed').toLocaleLowerCase()}` : '',
  ].filter(Boolean);
  const text = lines.join('\n');
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ text });
      else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') fail(e);
    }
  };
  return (
    <div className="stack">
      <div className="report-card">
        <span className="eyebrow">{me.shop.name}</span>
        <h3>{dateLabel(date, lang)}</h3>
        <dl className="report-grid">
          <dt>{t('income')}</dt>
          <dd className="numeral pos">{fmt(data.income_cents)}</dd>
          <dt>{t('expense')}</dt>
          <dd className="numeral neg">{fmt(data.expense_cents)}</dd>
          <dt>{t('net')}</dt>
          <dd className="numeral big">{fmt(data.net_cents)}</dd>
        </dl>
        {s && (
          <p className="muted small">
            {s.done} {t('done').toLocaleLowerCase()} · {s.booked} {t('booked').toLocaleLowerCase()} · {s.missed} {t('missed').toLocaleLowerCase()}
          </p>
        )}
      </div>
      <button className="btn primary" onClick={share}>
        <Icon name="share" /> {t('share')}
      </button>
    </div>
  );
}

