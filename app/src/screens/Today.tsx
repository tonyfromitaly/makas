import { useState } from 'react';
import { DateTime } from 'luxon';
import { useApp, useLoad } from '../state';
import { addDays, dateLabel, timeIn, todayIn } from '../format';
import { Empty, Icon, Sheet } from '../components/ui';
import { AppointmentForm } from './AppointmentForm';
import { AgentNotes, SetupBanner } from '../components/AgentNotes';

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
      {owner && <AgentNotes />}

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
          <strong className="numeral big">{fmt(s?.done_cents ?? 0)}</strong>
        </div>
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
        <hr className="rule" />
        <div className="receipt-foot">
          {settled ? <span className="stamp inline">{t('dayClosedStamp')}</span> : <span>{t('receiptThanks')}</span>}
          <button className="link-btn" onClick={() => setReport(true)}>
            {t('closeTill')} →
          </button>
        </div>
      </section>
      ) : (
        <DayTill date={date} />
      )}

      <TasksCard />

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
  const { api, t, fmt, bump } = useApp();
  const { data } = useLoad(() => api.get(`/books/summary?period=day&date=${date}`), [date, bump]);
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
      <div className="ledger-line">
        <span>{t('expense')}</span>
        <span className="numeral">{fmt(data?.expense_cents ?? 0)}</span>
      </div>
    </section>
  );
}
