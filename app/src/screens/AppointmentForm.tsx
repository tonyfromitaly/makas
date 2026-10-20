import { useEffect, useMemo, useState } from 'react';
import type { VoiceDraft } from '@makas/core';
import { useApp, useLoad } from '../state';
import { Field, Icon } from '../components/ui';
import { SlotCheck } from '../components/SlotCheck';
import { fold } from '@makas/core';

export function AppointmentForm({ date, draft, onDone }: { date: string; draft?: VoiceDraft; onDone(date?: string): void }) {
  const { api, t, fmt, fail } = useApp();
  const lists = useLoad(
    () => Promise.all([api.get('/services?page_size=200'), api.get('/barbers?page_size=200'), api.get('/clients?page_size=200')]),
    [],
  );
  const [services, barbers, clients] = lists.data ?? [null, null, null];

  const [clientId, setClientId] = useState<string | null>(draft?.client_id ?? null);
  const [query, setQuery] = useState(draft?.client_id ? '' : draft?.client_name ?? '');
  const [newPhone, setNewPhone] = useState('');
  const [consent, setConsent] = useState(true);
  const [serviceId, setServiceId] = useState<string | null>(draft?.service_id ?? null);
  const [barberId, setBarberId] = useState<string | null>(draft?.barber_id ?? null);
  const [day, setDay] = useState(draft?.date ?? date);
  const [time, setTime] = useState(draft?.time ?? nextSlot());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (services && !serviceId && services.data[0]) setServiceId(services.data[0].id);
    if (barbers && !barberId && barbers.data[0]) setBarberId(barbers.data[0].id);
  }, [services, barbers]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    if (!clients) return [];
    const q = fold(query);
    return clients.data.filter((c: any) => !q || fold(c.name).includes(q)).slice(0, 6);
  }, [clients, query]);
  const picked = clients?.data.find((c: any) => c.id === clientId);
  const creatingClient = !picked && query.trim().length > 0 && !matches.some((m: any) => fold(m.name) === fold(query));

  const submit = async () => {
    setBusy(true);
    try {
      let cid = clientId;
      if (!cid) {
        const c = await api.post('/clients', { name: query.trim(), phone_e164: newPhone, consent });
        cid = c.id;
      }
      await api.post('/appointments', {
        client_id: cid,
        service_id: serviceId,
        barber_id: barberId,
        starts_local: `${day}T${time}`,
        source: draft ? 'voice' : 'manual',
      });
      onDone(day);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (!services) return <div className="skeleton" />;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {draft && (
        <p className="notice">
          <Icon name="mic" size={16} /> “{draft.transcript}” · {t('voiceDraft')}
        </p>
      )}

      <Field label={t('client')}>
        {picked ? (
          <div className="picked">
            <span>{picked.name}</span>
            <span className="muted">{picked.phone_masked}</span>
            <button type="button" className="icon-btn" onClick={() => (setClientId(null), setQuery(''))} aria-label="change">
              <Icon name="x" size={16} />
            </button>
          </div>
        ) : (
          <>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('pickClient')} autoFocus={!draft} />
            {!!matches.length && (
              <div className="chips wrap">
                {matches.map((c: any) => (
                  <button type="button" key={c.id} className="chip-btn" onClick={() => setClientId(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Field>

      {creatingClient && (
        <div className="subcard stack">
          <span className="eyebrow">{t('newClient')}</span>
          <Field label={t('phone')}>
            <input inputMode="tel" required value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+90 532 111 22 33" />
          </Field>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              {t('consentLabel')}
              <small>{t('consentHint')}</small>
            </span>
          </label>
        </div>
      )}

      <Field label={t('service')}>
        <div className="chips wrap">
          {services.data.map((s: any) => (
            <button type="button" key={s.id} className={`chip-btn ${serviceId === s.id ? 'on' : ''}`} onClick={() => setServiceId(s.id)}>
              {s.name} <span className="muted">{fmt(s.price_cents)}</span>
            </button>
          ))}
        </div>
      </Field>

      {barbers && barbers.data.length > 1 && (
        <Field label={t('barber')}>
          <div className="chips wrap">
            {barbers.data.map((b: any) => (
              <button type="button" key={b.id} className={`chip-btn ${barberId === b.id ? 'on' : ''}`} onClick={() => setBarberId(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
        </Field>
      )}

      <div className="row two">
        <Field label={t('date')}>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        </Field>
        <Field label={t('time')}>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required step={300} />
        </Field>
      </div>
      <SlotCheck date={day} time={time} serviceId={serviceId} barberId={barbers && barbers.data.length > 1 ? barberId : null} onPick={(tm, b) => (setTime(tm), setBarberId(b))} />

      <button className="btn primary block" disabled={busy || !serviceId || (!clientId && !query.trim())}>
        <Icon name="check" /> {draft ? t('confirm') : t('save')}
      </button>
    </form>
  );
}

function nextSlot() {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
