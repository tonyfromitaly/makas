import { useState } from 'react';
import { DateTime } from 'luxon';
import { useApp, useLoad } from '../state';
import { addDays, dateLabel, timeIn, todayIn } from '../format';
import { Empty, Icon, Sheet } from '../components/ui';
import { AppointmentForm } from './AppointmentForm';
import { AgentNotes, SetupBanner } from '../components/AgentNotes';
import { Register } from './Till';

export function Today() {
  const { api, me, t, lang, fmt, openAssistant, has } = useApp();
  const owner = me.user.role === 'owner';
  const randevu = has('randevu');
  const tz = me.shop.timezone;
  const [date, setDate] = useState(todayIn(tz));
  const [creating, setCreating] = useState<{} | null>(null);
  const [acting, setActing] = useState<any>(null);
  const [report, setReport] = useState(false);
  const { data, reload } = useLoad(() => api.get(`/appointments?date=${date}`), [date]);
  // The same weekday a week earlier: the fair day to measure today against.
  const { data: prev } = useLoad(() => (randevu ? api.get(`/appointments?date=${addDays(date, -7)}`) : Promise.resolve(null)), [date, randevu]);

  const isToday = date === todayIn(tz);
  const rel = isToday ? t('today') : date === addDays(todayIn(tz), 1) ? t('tomorrow') : date === addDays(todayIn(tz), -1) ? t('yesterday') : null;
  const s = data?.summary;
  const pct = s && s.expected_cents ? Math.round((s.done_cents / s.expected_cents) * 100) : 0;
  // The line printed in carbon blue: the next appointment still to come today.
  const nextId = isToday ? data?.data.find((a: any) => a.status === 'booked')?.id : null;
  const settled = !!s && s.done > 0 && s.booked === 0;

  return (
    <div className="screen today">
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

      {owner && !me.shop.set_up && <SetupBanner />}
      {owner && <AgentNotes compact />}
      {owner && randevu && isToday && data && <Floor appts={data.data} />}

      {/* The day as a till receipt: the takings on top, every appointment a line, a stamp once the day is settled. */}
      {randevu ? (
      <section className="receipt">
        <header className="receipt-head">
          <strong>{t('dayReceipt')}</strong>
          <span>
            {me.shop.name} · {DateTime.fromISO(date).setLocale(lang).toFormat('ccc dd.LL.yyyy')} · {data?.data.length ?? 0} {t('receiptAppts')}
          </span>
        </header>
        <hr className="rule" />
        <div className="till-line">
          <span className="eyebrow">{t('inTheTill')}</span>
          <strong className="numeral big">{fmt(s?.till_cents ?? s?.done_cents ?? 0)}</strong>
        </div>
        <Versus cur={s?.till_cents ?? s?.done_cents} prev={prev?.summary?.till_cents ?? prev?.summary?.done_cents} date={addDays(date, -7)} running={isToday} />
        <div className="meter" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="ledger-line">
          <span>{t('expected')}</span>
          <span className="leader" />
          <span className="numeral">{fmt(s?.expected_cents ?? 0)}</span>
        </div>
        <div className="ledger-line">
          <span>
            {s?.done ?? 0} {t('done').toLocaleLowerCase(lang)} · {s?.booked ?? 0} {t('booked').toLocaleLowerCase(lang)}
            {s?.missed ? ` · ${s.missed} ${t('missed').toLocaleLowerCase(lang)}` : ''}
          </span>
        </div>
        <hr className="rule" />
        <ol className="agenda">
          {data?.data.map((a: any) => (
            <li key={a.id} className={`appt status-${a.status} ${a.id === nextId ? 'now' : ''}`}>
              <button className="appt-btn" onClick={() => setActing(a)}>
                <time className="appt-time numeral">{timeIn(a.starts_at, tz)}</time>
                <span className="appt-main">
                  <span className="appt-client">
                    {a.client_name}
                    {a.client_missed > 0 && a.status === 'booked' && (
                      <span className={`chip risk ${a.client_missed > 1 ? 'high' : ''}`} title={t('risk')}>
                        <Icon name="flame" size={11} /> {a.client_missed}
                      </span>
                    )}
                    {(a.status === 'missed' || a.status === 'cancelled') && <span className="appt-tag">{t(a.status)}</span>}
                  </span>
                  <span className="appt-meta">
                    {a.service_name} · {owner ? a.barber_name : ''}
                    {a.station_name ? `${owner ? ' · ' : ''}${a.station_name}` : ''}
                    {a.source === 'online' && <span className="chip online-chip">{t('onlineTag')}</span>}
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
        <hr className="rule" />
        <div className="receipt-foot">
          {settled ? <span className="stamp inline">{t('dayClosedStamp')}</span> : <span>{t('receiptThanks')}</span>}
          {owner && (
            <button className="link-btn" onClick={() => setReport(true)}>
              {t('closeTill')} →
            </button>
          )}
        </div>
      </section>
      ) : (
        <DayTill date={date} />
      )}

      {owner && <TasksCard />}

      <div className="fab-row">
        <button className="fab ghost" onClick={() => openAssistant(true)} aria-label={t('speak')}>
          <Icon name="mic" size={20} />
        </button>
        {randevu && (
          <button className="fab" onClick={() => setCreating({})} aria-label={t('newAppointment')}>
            <Icon name="plus" size={20} /> {t('appointmentShort')}
          </button>
        )}
      </div>

      <Sheet open={!!creating} onClose={() => setCreating(null)} title={t('newAppointment')}>
        {creating && (
          <AppointmentForm
            date={date}
            onDone={(d) => {
              setCreating(null);
              if (d && d !== date) setDate(d);
              else reload();
            }}
          />
        )}
      </Sheet>

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
  // "Done" is the checkout: the visit's receipt, with products, a tip and how it was paid.
  const [checkout, setCheckout] = useState(false);
  if (checkout) return <Register appointment={appt} onDone={onDone} />;
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
        {appt.service_name} · {appt.barber_name}
        {appt.station_name ? ` · ${appt.station_name}` : ''} · {fmt(appt.price_cents_snapshot)}
      </p>
      {appt.client_missed > 0 && (
        <p className="notice warn">
          <Icon name="flame" size={16} /> {appt.client_missed > 1 ? t('risk') : t('riskSome')} ({appt.client_missed}×)
        </p>
      )}
      {appt.status === 'booked' ? (
        <div className="action-grid">
          <button className="btn ok" onClick={() => setCheckout(true)}>
            <Icon name="check" /> {t('doneCheckout')}
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


/** The barber's reminders and payments due today, overdue or in the next two days. */
function TasksCard() {
  const { api, me, t, lang, fmt, fail, bump } = useApp();
  const today = todayIn(me.shop.timezone);
  const { data, reload } = useLoad(() => api.get(`/tasks?status=open&until=${addDays(today, 2)}`), [today, bump]);
  if (!data?.data.length) return null;
  const done = async (id: string) => {
    try {
      await api.patch(`/tasks/${id}`, { status: 'done' });
      reload();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <section className="card tasks">
      <h3 className="mini-title">
        <Icon name="bell" size={16} /> {t('remindersToday')}
      </h3>
      <ul className="task-list">
        {data.data.map((x: any) => (
          <li key={x.id} className={x.due_date < today ? 'overdue' : ''}>
            <button className="tick" onClick={() => done(x.id)} aria-label={t('markDone')}>
              <Icon name="check" size={14} />
            </button>
            <span className="grow">
              {x.title}
              {x.amount_cents ? <strong className="numeral"> {fmt(x.amount_cents)}</strong> : null}
            </span>
            <span className="muted small">
              {x.due_date < today ? t('overdueLabel') : x.due_date === today ? (x.due_time ?? t('today')) : dateLabel(x.due_date, lang, { weekday: 'short', day: 'numeric' })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Without appointments the day is just the till: what came in and went out, from the books. */
function DayTill({ date }: { date: string }) {
  const { api, t, fmt, bump, me } = useApp();
  const { data } = useLoad(() => api.get(`/books/summary?period=day&date=${date}`), [date, bump]);
  const { data: prev } = useLoad(() => api.get(`/books/summary?period=day&date=${addDays(date, -7)}`), [date, bump]);
  return (
    <section className="receipt">
      <header className="receipt-head">
        <strong>{t('dayReceipt')}</strong>
      </header>
      <hr className="rule" />
      <div className="till-line">
        <span className="eyebrow">{t('inTheTill')}</span>
        <strong className="numeral big">{fmt(data?.income_cents ?? 0)}</strong>
      </div>
      <Versus cur={data?.income_cents} prev={prev?.income_cents} date={addDays(date, -7)} running={date === todayIn(me.shop.timezone)} />
      <div className="ledger-line">
        <span>{t('expense')}</span>
        <span className="numeral">{fmt(data?.expense_cents ?? 0)}</span>
      </div>
    </section>
  );
}

/**
 * Under the hero number: the same weekday last week. A day still running is not given a percentage
 * against a finished one; only the earlier day's total, so the owner can judge.
 */
function Versus({ cur, prev, date, running }: { cur?: number; prev?: number; date: string; running: boolean }) {
  const { t, fmt, lang } = useApp();
  if (prev === undefined || cur === undefined) return null;
  // "Geçen salı", "Last Tuesday": the weekday alone reads naturally.
  const wd = dateLabel(date, lang, { weekday: 'long' });
  const day = lang === 'en' ? wd : wd.toLocaleLowerCase(lang);
  const d = prev > 0 && !running ? cur / prev - 1 : null;
  return (
    <p className="versus small">
      {t('lastWeekSameDay', { day })}: <span className="numeral">{fmt(prev)}</span>
      {d !== null && Math.abs(d) >= 0.03 && <span className={d > 0 ? 'pos' : 'neg'}> · {d > 0 ? '+' : '−'}%{Math.round(Math.abs(d) * 100)}</span>}
    </p>
  );
}

/**
 * The floor right now: every chair and room, who is in it and until when, or who sits down next.
 * Only shown once the shop has stations.
 */
function Floor({ appts }: { appts: any[] }) {
  const { api, me, t, bump } = useApp();
  const tz = me.shop.timezone;
  const { data } = useLoad(() => api.get('/stations'), [bump]);
  const stations = data?.data ?? [];
  if (!stations.length) return null;
  const now = Date.now();
  const live = appts.filter((a) => a.status === 'booked' || a.status === 'done');
  return (
    <section className="floor" aria-label={t('stations')}>
      {stations.map((s: any) => {
        const here = live.filter((a) => a.station_id === s.id);
        const cur = here.find((a) => new Date(a.starts_at).getTime() <= now && new Date(a.ends_at).getTime() > now);
        const next = here.filter((a) => new Date(a.starts_at).getTime() > now).sort((x, y) => x.starts_at.localeCompare(y.starts_at))[0];
        return (
          <div key={s.id} className={`seat ${cur ? 'busy' : 'free'}`}>
            <span className="seat-name">{s.name}</span>
            {cur ? (
              <>
                <strong className="seat-who">{cur.client_name}</strong>
                <span className="seat-meta">
                  {cur.barber_name} · {t('untilTime')} <span className="numeral">{timeIn(cur.ends_at, tz)}</span>
                </span>
              </>
            ) : (
              <>
                <strong className="seat-who">{t('seatFree')}</strong>
                <span className="seat-meta">
                  {next ? (
                    <>
                      {t('nextAt')} <span className="numeral">{timeIn(next.starts_at, tz)}</span> · {next.barber_name}
                    </>
                  ) : (
                    t('seatFreeAllDay')
                  )}
                </span>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
