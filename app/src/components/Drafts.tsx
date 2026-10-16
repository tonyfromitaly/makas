import { useEffect, useState } from 'react';
import { CATEGORIES } from '@makas/core';
import { useApp } from '../state';
import { Field, Icon, Segmented } from './ui';
import { toCents } from '../format';

export type Draft = Record<string, any> & { type: 'appointment' | 'client' | 'book' | 'reminder' | 'ledger' };
type Status = 'open' | 'saved' | 'dismissed' | 'busy';

/** One proposed write. Nothing reaches the database until the barber taps confirm. */
export function DraftCard({ draft, lists, onSaved, confirmSignal = 0 }: { draft: Draft; lists?: { services: any[]; barbers: any[] }; onSaved?(): void; confirmSignal?: number }) {
  const { api, t, fmt, fail, refreshAll } = useApp();
  const [d, setD] = useState<Draft>({ ...draft, amount: draft.amount_cents ? String(draft.amount_cents / 100) : '', consent: true });
  const [status, setStatus] = useState<Status>('open');
  const set = (patch: Record<string, unknown>) => setD((x) => ({ ...x, ...patch }));

  const save = async () => {
    setStatus('busy');
    try {
      if (d.type === 'book') {
        await api.post('/books', { kind: d.kind, category: d.category, amount_cents: toCents(d.amount), entry_date: d.entry_date, note: d.note || undefined, raw_text: d.raw_text, source: 'ai_note' });
      } else if (d.type === 'reminder') {
        await api.post('/tasks', { kind: d.kind, title: d.title, due_date: d.due_date, due_time: d.due_time || null, amount_cents: d.amount ? toCents(d.amount) : null, source: 'assistant', raw_text: d.raw_text });
      } else if (d.type === 'ledger') {
        await api.post('/ledger', { client_id: d.client_id, kind: d.kind, amount_cents: toCents(d.amount), note: d.note || undefined });
      } else if (d.type === 'client') {
        await api.post('/clients', { name: d.name, phone_e164: d.phone_e164 || d.phone_raw, consent: d.consent, language: d.language });
      } else if (d.type === 'appointment') {
        let clientId = d.client_id;
        if (!clientId) clientId = (await api.post('/clients', { name: d.client_name, phone_e164: d.phone_e164, consent: d.consent })).id;
        await api.post('/appointments', { client_id: clientId, service_id: d.service_id, barber_id: d.barber_id || undefined, starts_local: `${d.date}T${d.time}`, source: 'voice' });
      }
      setStatus('saved');
      refreshAll();
      onSaved?.();
    } catch (e) {
      setStatus('open');
      fail(e);
    }
  };

  const valid =
    d.type === 'book' ? toCents(d.amount) > 0
    : d.type === 'ledger' ? toCents(d.amount) > 0
    : d.type === 'reminder' ? !!d.title && !!d.due_date
    : d.type === 'client' ? !!d.name && !!(d.phone_e164 || d.phone_raw)
    : !!d.service_id && !!d.time && !!d.date && (!!d.client_id || (!!d.client_name && !!d.phone_e164));

  // "Confirm all" from the list: save this card if it is still open and complete.
  useEffect(() => {
    if (confirmSignal && status === 'open' && valid) save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmSignal]);

  if (status === 'saved' || status === 'dismissed')
    return (
      <div className={`draft-done ${status}`}>
        <Icon name={status === 'saved' ? 'check' : 'x'} size={16} /> {summary(d, t, fmt)} · {status === 'saved' ? t('savedCheck') : t('dismissed')}
      </div>
    );

  return (
    <div className={`draft-card type-${d.type}`}>
      <div className="draft-head">
        <span className="chip">{label(d, t)}</span>
        {d.type === 'book' && <strong className={`numeral ${d.kind === 'income' ? 'pos' : 'neg'}`}>{d.kind === 'income' ? '+' : '−'}{fmt(toCents(d.amount))}</strong>}
      </div>

      {d.type === 'book' && (
        <div className="stack tight">
          <Segmented value={d.kind} onChange={(k) => set({ kind: k })} options={[{ value: 'income', label: t('income') }, { value: 'expense', label: t('expense') }]} />
          <div className="row">
            <input inputMode="decimal" value={d.amount} onChange={(e) => set({ amount: e.target.value })} aria-label={t('amount')} />
            <select value={d.category} onChange={(e) => set({ category: e.target.value })} aria-label={t('category')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat_${c}` as any)}</option>)}
            </select>
            <input type="date" value={d.entry_date} onChange={(e) => set({ entry_date: e.target.value })} aria-label={t('date')} />
          </div>
        </div>
      )}

      {d.type === 'reminder' && (
        <div className="stack tight">
          <input value={d.title} onChange={(e) => set({ title: e.target.value })} aria-label={t('title')} />
          <div className="row">
            <input type="date" value={d.due_date} onChange={(e) => set({ due_date: e.target.value })} aria-label={t('dueDate')} />
            <input type="time" value={d.due_time ?? ''} onChange={(e) => set({ due_time: e.target.value })} aria-label={t('time')} />
            <input inputMode="decimal" placeholder={`${t('amount')} (${t('optional')})`} value={d.amount} onChange={(e) => set({ amount: e.target.value, kind: e.target.value ? 'payment' : d.kind })} />
          </div>
        </div>
      )}

      {d.type === 'ledger' && (
        <div className="stack tight">
          <strong>{d.client_name}</strong>
          <div className="row">
            <Segmented value={d.kind} onChange={(k) => set({ kind: k })} options={[{ value: 'charge', label: t('tabCharge') }, { value: 'payment', label: t('tabPayment') }]} />
            <input className="narrow" inputMode="decimal" value={d.amount} onChange={(e) => set({ amount: e.target.value })} aria-label={t('amount')} />
          </div>
        </div>
      )}

      {d.type === 'client' && (
        <div className="stack tight">
          <input value={d.name} onChange={(e) => set({ name: e.target.value })} aria-label={t('client')} />
          <input inputMode="tel" value={d.phone_e164 ?? d.phone_raw ?? ''} onChange={(e) => set({ phone_e164: e.target.value })} placeholder={t('phone')} aria-label={t('phone')} />
          {d.duplicate_of && <p className="notice warn small">{t('duplicateWarn', { name: d.duplicate_of })}</p>}
          <Consent value={d.consent} onChange={(v) => set({ consent: v })} />
        </div>
      )}

      {d.type === 'appointment' && (
        <div className="stack tight">
          <strong>{d.client_name ?? '—'}</strong>
          {!d.client_id && (
            <>
              <input inputMode="tel" value={d.phone_e164 ?? ''} onChange={(e) => set({ phone_e164: e.target.value })} placeholder={t('newClientPhone')} />
              <Consent value={d.consent} onChange={(v) => set({ consent: v })} />
            </>
          )}
          <div className="row">
            <select value={d.service_id ?? ''} onChange={(e) => set({ service_id: e.target.value })} aria-label={t('service')}>
              {lists?.services.map((s) => <option key={s.id} value={s.id}>{s.name} · {fmt(s.price_cents)}</option>)}
            </select>
            {lists && lists.barbers.length > 1 && (
              <select value={d.barber_id ?? ''} onChange={(e) => set({ barber_id: e.target.value })} aria-label={t('barber')}>
                {lists.barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>
          <div className="row">
            <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} aria-label={t('date')} />
            <input type="time" value={d.time ?? ''} onChange={(e) => set({ time: e.target.value })} aria-label={t('time')} />
          </div>
        </div>
      )}

      <div className="row">
        <button className="btn small" onClick={() => setStatus('dismissed')}>{t('cancel')}</button>
        <button className="btn small primary grow" disabled={!valid || status === 'busy'} onClick={save}>
          <Icon name="check" size={16} /> {t('confirm')}
        </button>
      </div>
    </div>
  );
}

function Consent({ value, onChange }: { value: boolean; onChange(v: boolean): void }) {
  const { t } = useApp();
  return (
    <label className="check small">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{t('consentLabel')}</span>
    </label>
  );
}

function label(d: Draft, t: any) {
  if (d.type === 'book') return `${t('books')} · ${t(`cat_${d.category}`)}`;
  if (d.type === 'reminder') return d.kind === 'payment' ? t('paymentKind') : t('reminderKind');
  if (d.type === 'ledger') return t('balance');
  if (d.type === 'client') return t('newClient');
  return t('newAppointment');
}

function summary(d: Draft, t: any, fmt: (c: number) => string) {
  if (d.type === 'book') return `${d.kind === 'income' ? '+' : '−'}${fmt(toCents(d.amount))} ${t(`cat_${d.category}`)}`;
  if (d.type === 'reminder') return `${d.title} · ${d.due_date}`;
  if (d.type === 'ledger') return `${d.client_name} ${fmt(toCents(d.amount))}`;
  if (d.type === 'client') return d.name;
  return `${d.client_name} · ${d.date} ${d.time ?? ''}`;
}

/** Several drafts at once (a note with many amounts): confirm them one by one or all together. */
export function DraftList({ drafts, lists }: { drafts: Draft[]; lists?: { services: any[]; barbers: any[] } }) {
  const { t } = useApp();
  const [confirmAll, setConfirmAll] = useState(0);
  return (
    <div className="stack tight">
      {drafts.map((d, i) => <DraftCard key={i} draft={d} lists={lists} confirmSignal={confirmAll} />)}
      {drafts.length > 1 && (
        <button className="btn small ok" onClick={() => setConfirmAll((x) => x + 1)}>
          <Icon name="check" size={16} /> {t('confirmAll')}
        </button>
      )}
    </div>
  );
}
