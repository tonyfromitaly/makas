import { useState } from 'react';
import { useApp, useLoad } from '../state';
import { takeNavHint } from '../nav';
import { Empty, Field, Icon, Segmented, Sheet } from '../components/ui';
import { initials, shortDate, toCents } from '../format';

type Filter = 'all' | 'debt' | 'lapsed' | 'risk';

export function Clients() {
  const { api, t, fmt, me, lang, has } = useApp();
  const [filter, setFilter] = useState<Filter>(() => (takeNavHint() as Filter | undefined) ?? 'all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, reload } = useLoad(
    () => api.get(`/clients?filter=${filter}&page_size=200${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    [filter, q],
  );
  const credit = has('veresiye');
  const ledger = useLoad(() => (credit ? api.get('/ledger?page_size=1') : Promise.resolve(null)), [credit]);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t('clients')}</h1>
        <button className="btn small" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> {t('newClient')}
        </button>
      </div>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} />
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('all') },
          // Store credit is a module the owner switches on; off, there is no "owes" anywhere.
          ...(credit ? [{ value: 'debt' as Filter, label: t('debt') }] : []),
          { value: 'lapsed', label: t('lapsed') },
          { value: 'risk', label: t('risky') },
        ]}
      />
      {filter === 'debt' && ledger.data && (
        <p className="notice">
          {t('outstanding')}: <strong className="numeral">{fmt(ledger.data.outstanding_cents)}</strong>
        </p>
      )}
      <ul className="list">
        {data?.data.map((c: any) => (
          <li key={c.id}>
            <button className="list-row" onClick={() => setOpen(c.id)}>
              <span className="avatar">{initials(c.name)}</span>
              <span className="grow">
                <span className="row-title">
                  {c.name}
                  {c.risk !== 'none' && (
                    <span className={`chip risk ${c.risk === 'high' ? 'high' : ''}`}>
                      <Icon name="flame" size={12} /> {c.missed}
                    </span>
                  )}
                  {c.consent_status === 'revoked' && <span className="chip muted-chip" title={t('consent')}>✕ <Icon name="bell" size={12} /></span>}
                </span>
                <span className="row-meta">
                  {c.visits} {t('visits')} · {t('lastVisit')}: {c.last_visit ? shortDate(c.last_visit, lang, me.shop.timezone) : t('never')}
                </span>
              </span>
              {credit && c.balance_cents > 0 && <span className="chip debt numeral">{fmt(c.balance_cents)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {data && !data.data.length && <Empty icon="users" text={t('noClients')} />}

      <Sheet open={!!open} onClose={() => (setOpen(null), reload(), ledger.reload())} title={t('client')}>
        {open && <ClientDetail id={open} />}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title={t('newClient')}>
        {adding && <NewClient onDone={() => (setAdding(false), reload())} />}
      </Sheet>
    </div>
  );
}

function NewClient({ onDone }: { onDone(): void }) {
  const { api, t, fail, me } = useApp();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState(me.shop.language);
  const [consent, setConsent] = useState(true);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.post('/clients', { name, phone_e164: phone, consent, language });
          onDone();
        } catch (err) {
          fail(err);
        }
      }}
    >
      <Field label={t('client')}>
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label={t('phone')}>
        <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+90 532 111 22 33" />
      </Field>
      <Field label={t('language')}>
        <select value={language} onChange={(e) => setLanguage(e.target.value as any)}>
          <option value="tr">Türkçe</option>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          {t('consentLabel')}
          <small>{t('consentHint')}</small>
        </span>
      </label>
      <button className="btn primary block">{t('save')}</button>
    </form>
  );
}

function ClientDetail({ id }: { id: string }) {
  const { api, t, fmt, me, lang, fail, toast, has } = useApp();
  const credit = has('veresiye');
  const { data: c, reload } = useLoad(() => api.get(`/clients/${id}`), [id]);
  const ledger = useLoad(() => (credit ? api.get(`/ledger?client_id=${id}&page_size=50`) : Promise.resolve(null)), [id, credit]);
  const [phone, setPhone] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  if (!c) return <div className="skeleton" />;

  const reveal = async () => {
    const r = await api.get(`/clients/${id}/phone`);
    setPhone(r.phone_e164);
    return r.phone_e164 as string;
  };
  const whatsapp = async (text?: string) => {
    const p = (phone ?? (await reveal())).replace('+', '');
    window.open(`https://wa.me/${p}${text ? `?text=${encodeURIComponent(text)}` : ''}`, '_blank', 'noopener');
  };
  const book = async (kind: 'charge' | 'payment') => {
    const cents = toCents(amount);
    if (!cents) return;
    try {
      await api.post('/ledger', { client_id: id, kind, amount_cents: cents, note: note || undefined });
      setAmount('');
      setNote('');
      ledger.reload();
      reload();
    } catch (e) {
      fail(e);
    }
  };
  const toggleConsent = async () => {
    try {
      await api.patch(`/clients/${id}`, { consent: c.consent_status !== 'granted' });
      reload();
      toast(t('saved'));
    } catch (e) {
      fail(e);
    }
  };
  const lapsed = c.last_visit && !c.next_at && Date.now() - new Date(c.last_visit).getTime() > 30 * 864e5;

  return (
    <div className="stack">
      <div className="client-head">
        <span className="avatar lg">{initials(c.name)}</span>
        <div>
          <h3>{c.name}</h3>
          <p className="muted">
            {phone ?? c.phone_masked}{' '}
            {!phone && (
              <button className="link-btn" onClick={reveal}>
                {t('showNumber')}
              </button>
            )}
          </p>
          <p className="muted small">{t('numberAudited')}</p>
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={() => whatsapp()}>
          <Icon name="chat" /> {t('whatsapp')}
        </button>
        {lapsed && c.consent_status === 'granted' && (
          <button className="btn primary" onClick={() => whatsapp(t('winBackMsg', { name: c.name.split(' ')[0], shop: me.shop.name }))}>
            <Icon name="sparkle" /> {t('winBack')}
          </button>
        )}
      </div>

      <div className="stat-row">
        <div>
          <span className="eyebrow">{t('visits')}</span>
          <strong className="numeral">{c.visits}</strong>
        </div>
        <div>
          <span className="eyebrow">{t('missed')}</span>
          <strong className="numeral">{c.missed}</strong>
        </div>
        <div>
          <span className="eyebrow">{t('lastVisit')}</span>
          <strong>{c.last_visit ? shortDate(c.last_visit, lang, me.shop.timezone) : '—'}</strong>
        </div>
      </div>

      {credit && (
      <div className="subcard stack">
        <div className="row spread">
          <span className="eyebrow">{t('balance')}</span>
          <strong className={`numeral big ${c.balance_cents > 0 ? 'neg' : ''}`}>{c.balance_cents > 0 ? fmt(c.balance_cents) : t('settled')}</strong>
        </div>
        <div className="row">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t('amount')} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`${t('notes')} (${t('optional')})`} />
        </div>
        <div className="row">
          <button className="btn" onClick={() => book('charge')}>
            {t('charge')}
          </button>
          <button className="btn ok" onClick={() => book('payment')}>
            {t('payment')}
          </button>
        </div>
        {!!ledger.data?.data.length && (
          <ul className="mini-list">
            {ledger.data.data.map((l: any) => (
              <li key={l.id}>
                <span>{shortDate(l.created_at, lang, me.shop.timezone)}</span>
                <span className="grow muted">{l.note ?? (l.kind === 'charge' ? t('charge') : t('payment'))}</span>
                <span className={`numeral ${l.kind === 'charge' ? 'neg' : 'pos'}`}>
                  {l.kind === 'charge' ? '+' : '−'}
                  {fmt(l.amount_cents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      <div className="row spread">
        <span>
          {t('consent')}: <strong>{c.consent_status === 'granted' ? t('granted') : t('revoked')}</strong>
        </span>
        <button className="link-btn" onClick={toggleConsent}>
          {c.consent_status === 'granted' ? t('revokeConsent') : t('grantConsent')}
        </button>
      </div>

      {!!c.history?.length && (
        <div>
          <h3 className="mini-title">{t('history')}</h3>
          <ul className="mini-list">
            {c.history.map((h: any) => (
              <li key={h.id}>
                <span>{shortDate(h.starts_at, lang, me.shop.timezone)}</span>
                <span className="grow">{h.service_name}</span>
                <span className={`chip status-${h.status}`}>{t(h.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
