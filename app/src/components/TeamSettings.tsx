import { useState } from 'react';
import { useApp, useLoad } from '../state';
import { Field, Icon, Segmented, Sheet } from './ui';
import { toCents } from '../format';
import { dealText } from '../screens/Till';
import { BookPage } from '../screens/Book';

// The owner's settings for the team and the floor: who works here and on what deal, the chairs and rooms,
// what is sold over the counter, and the online booking page with its hours.

const KINDS = ['chair', 'room', 'bed', 'table', 'other'] as const;
const DAYS = [1, 2, 3, 4, 5, 6, 7];

export function TeamSettings() {
  const { api, t, fmt } = useApp();
  const { data, reload } = useLoad(() => api.get('/barbers?include_inactive=true'), []);
  const [editing, setEditing] = useState<any>(null);
  return (
    <section className="card stack" id="sec-team">
      <h2 className="card-title">{t('teamTitle')}</h2>
      <p className="muted small">{t('teamHint')}</p>
      <ul className="mini-list team-list">
        {data?.data.map((p: any) => (
          <li key={p.id} className={p.active ? '' : 'inactive'}>
            <button className="team-row" onClick={() => setEditing(p)}>
              <span className="grow">
                <strong>{p.name}</strong>
                {p.title && <span className="muted"> · {p.title}</span>}
                <span className="row-meta">
                  {dealText(t, fmt, p)}
                  {p.station_name ? ` · ${p.station_name}` : ''}
                  {p.has_login ? ` · ${t('hasLogin')}` : ''}
                </span>
              </span>
              <Icon name="chevR" size={16} />
            </button>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={() => setEditing({ name: '', pay_model: 'commission', service_pct: 50, product_pct: 10, salary_cents: 0, rent_cents: 0, rent_period: 'week', work_days: DAYS, online: true, active: true })}>
        <Icon name="plus" /> {t('addTeamMember')}
      </button>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? editing.name : t('addTeamMember')}>
        {editing && <MemberForm member={editing} onDone={() => (setEditing(null), reload())} />}
      </Sheet>
    </section>
  );
}

function MemberForm({ member, onDone }: { member: any; onDone(): void }) {
  const { api, t, fail, toast, me } = useApp();
  // Fresh each time the form opens: chairs added a moment ago are offered too.
  const { data: st } = useLoad(() => api.get('/stations'), []);
  const stations: any[] = st?.data ?? [];
  const [m, setM] = useState({ ...member, salary: member.salary_cents ? String(member.salary_cents / 100) : '', rent: member.rent_cents ? String(member.rent_cents / 100) : '' });
  const [email, setEmail] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const set = (patch: any) => setM((x: any) => ({ ...x, ...patch }));
  const save = async () => {
    const body = {
      name: m.name.trim(),
      title: m.title?.trim() || null,
      pay_model: m.pay_model,
      service_pct: Number(m.service_pct) || 0,
      product_pct: Number(m.product_pct) || 0,
      salary_cents: toCents(m.salary || '0'),
      rent_cents: toCents(m.rent || '0'),
      rent_period: m.rent_period,
      station_id: m.station_id || null,
      work_days: m.work_days,
      online: m.online,
      ...(member.id ? { active: m.active } : {}),
    };
    try {
      if (member.id) await api.patch(`/barbers/${member.id}`, body);
      else await api.post('/barbers', body);
      toast(t('saved'));
      onDone();
    } catch (e) {
      fail(e);
    }
  };
  const createLogin = async () => {
    try {
      const r = await api.post(`/barbers/${member.id}/login`, { email });
      setKey(r.key);
    } catch (e) {
      fail(e);
    }
  };
  const loginText = key ? t('staffKeyMessage', { shop: me.shop.name, url: `${location.origin}${import.meta.env.BASE_URL}`, key }) : '';
  return (
    <div className="stack">
      <div className="row two">
        <Field label={t('name')}>
          <input value={m.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={t('staffTitle')}>
          <input value={m.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder={t('staffTitlePh')} />
        </Field>
      </div>
      <span className="eyebrow">{t('deal')}</span>
      <Segmented
        value={m.pay_model}
        onChange={(v) => set({ pay_model: v })}
        options={[
          { value: 'commission', label: t('payCommission') },
          { value: 'booth_rent', label: t('payRent') },
          { value: 'salary', label: t('paySalary') },
        ]}
      />
      <p className="muted small">{t(`payHint_${m.pay_model}` as any)}</p>
      {m.pay_model === 'booth_rent' ? (
        <div className="row two">
          <Field label={t('rentAmount')}>
            <input inputMode="decimal" value={m.rent} onChange={(e) => set({ rent: e.target.value })} />
          </Field>
          <Field label={t('rentPeriod')}>
            <select value={m.rent_period} onChange={(e) => set({ rent_period: e.target.value })}>
              <option value="week">{t('perWeek')}</option>
              <option value="month">{t('perMonth')}</option>
            </select>
          </Field>
        </div>
      ) : (
        <div className="row two">
          {m.pay_model === 'salary' && (
            <Field label={t('monthlySalary')}>
              <input inputMode="decimal" value={m.salary} onChange={(e) => set({ salary: e.target.value })} />
            </Field>
          )}
          <Field label={t('servicePct')}>
            <input type="number" min={0} max={100} value={m.service_pct} onChange={(e) => set({ service_pct: e.target.value })} />
          </Field>
          <Field label={t('productPct')}>
            <input type="number" min={0} max={100} value={m.product_pct} onChange={(e) => set({ product_pct: e.target.value })} />
          </Field>
        </div>
      )}
      {!!stations.length && (
        <Field label={t('homeStation')}>
          <select value={m.station_id ?? ''} onChange={(e) => set({ station_id: e.target.value || null })}>
            <option value="">{t('noHomeStation')}</option>
            {stations.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <span className="eyebrow">{t('workDays')}</span>
      <div className="chips days">
        {DAYS.map((d) => (
          <button
            key={d}
            className={`chip-btn ${m.work_days.includes(d) ? 'on' : ''}`}
            aria-pressed={m.work_days.includes(d)}
            onClick={() => set({ work_days: m.work_days.includes(d) ? m.work_days.filter((x: number) => x !== d) : [...m.work_days, d].sort() })}
          >
            {t(`wd${d}` as any)}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={m.online} onChange={(e) => set({ online: e.target.checked })} />
        <span>{t('showOnline')}</span>
      </label>
      {member.id && (
        <label className="check">
          <input type="checkbox" checked={m.active} onChange={(e) => set({ active: e.target.checked })} />
          <span>{t('stillWorksHere')}</span>
        </label>
      )}
      <button className="btn primary" onClick={save} disabled={!m.name.trim()}>
        {t('save')}
      </button>

      {member.id && (
        <div className="subcard stack">
          <span className="eyebrow">{t('ownLogin')}</span>
          {member.has_login ? (
            <>
              <p className="small">
                {t('loginIs')} <strong>{member.login_email}</strong>
              </p>
              {member.login_email !== me.user.email && (
                <button
                  className="btn danger-ghost"
                  onClick={async () => {
                    try {
                      await api.del(`/barbers/${member.id}/login`);
                      onDone();
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  {t('removeLogin')}
                </button>
              )}
            </>
          ) : key ? (
            <>
              <p className="small">{t('staffKeyReady')}</p>
              <code className="key-out">{key}</code>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    if (navigator.share) await navigator.share({ text: loginText });
                    else {
                      await navigator.clipboard.writeText(loginText);
                      toast(t('copied'));
                    }
                  } catch {
                    /* closed */
                  }
                }}
              >
                <Icon name="share" /> {t('sendToThem')}
              </button>
            </>
          ) : (
            <>
              <p className="muted small">{t('ownLoginHint')}</p>
              <div className="row">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email')} />
                <button className="btn" disabled={!/\S+@\S+\.\S+/.test(email)} onClick={createLogin}>
                  {t('createLogin')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Stations() {
  const { api, t, fail } = useApp();
  const { data, reload } = useLoad(() => api.get('/stations?include_inactive=true'), []);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('chair');
  return (
    <section className="card stack" id="sec-stations">
      <h2 className="card-title">{t('stations')}</h2>
      <p className="muted small">{t('stationsHint')}</p>
      <ul className="mini-list">
        {data?.data.map((s: any) => (
          <li key={s.id} className={s.active ? '' : 'inactive'}>
            <span className="kind-dot" data-kind={s.kind} aria-hidden />
            <span className="grow">
              {s.name} <span className="muted small">· {t(`kind_${s.kind}` as any)}</span>
              {s.staff?.length ? <span className="row-meta">{s.staff.join(', ')}</span> : null}
            </span>
            <button
              className="link-btn"
              onClick={async () => {
                try {
                  await api.patch(`/stations/${s.id}`, { active: !s.active });
                  reload();
                } catch (e) {
                  fail(e);
                }
              }}
            >
              {s.active ? t('inactive') : t('activate')}
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('stationNamePh')} />
        <select className="narrow" value={kind} onChange={(e) => setKind(e.target.value as any)} aria-label={t('stationKind')}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind_${k}` as any)}
            </option>
          ))}
        </select>
        <button
          className="btn"
          aria-label={t('add')}
          disabled={!name.trim()}
          onClick={async () => {
            try {
              await api.post('/stations', { name: name.trim(), kind });
              setName('');
              reload();
            } catch (e) {
              fail(e);
            }
          }}
        >
          <Icon name="plus" />
        </button>
      </div>
    </section>
  );
}

export function Products() {
  const { api, t, fmt, fail } = useApp();
  const { data, reload } = useLoad(() => api.get('/products?include_inactive=true'), []);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  return (
    <section className="card stack" id="sec-products">
      <h2 className="card-title">{t('products')}</h2>
      <p className="muted small">{t('productsHint')}</p>
      <ul className="mini-list">
        {data?.data.map((p: any) => (
          <li key={p.id} className={p.active ? '' : 'inactive'}>
            <span className="grow">{p.name}</span>
            <span className="muted">
              {p.stock !== null && `${t('inStock', { n: p.stock })} · `}
              <span className="numeral">{fmt(p.price_cents)}</span>
            </span>
            <button
              className="link-btn"
              onClick={async () => {
                try {
                  await api.patch(`/products/${p.id}`, { active: !p.active });
                  reload();
                } catch (e) {
                  fail(e);
                }
              }}
            >
              {p.active ? t('inactive') : t('activate')}
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('productNamePh')} />
        <input className="narrow" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={t('price')} />
        <input className="narrow" type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} placeholder={t('stock')} />
        <button
          className="btn"
          aria-label={t('add')}
          disabled={!name.trim()}
          onClick={async () => {
            try {
              await api.post('/products', { name: name.trim(), price_cents: toCents(price), stock: stock.trim() ? Number(stock) : null });
              setName('');
              setPrice('');
              setStock('');
              reload();
            } catch (e) {
              fail(e);
            }
          }}
        >
          <Icon name="plus" />
        </button>
      </div>
    </section>
  );
}

/** The address people book at: /book/<slug> on the website, ?book=<slug> elsewhere (dev, demo). */
export function bookingUrl(slug: string) {
  const base = import.meta.env.BASE_URL;
  if (base === '/app/' || base === '/book/') return `${location.origin}/book/${slug}`;
  return `${location.origin}${base}?book=${slug}`;
}

export function OnlineBooking() {
  const { api, t, fail, toast, reloadMe } = useApp();
  const { data, reload, setData } = useLoad(() => api.get('/shops/me/booking'), []);
  const [preview, setPreview] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  if (!data) return <section className="card skeleton" />;
  const current = slug ?? data.slug;
  const url = bookingUrl(data.slug);
  const embed = `<script src="${location.origin}${import.meta.env.BASE_URL === '/app/' ? '/book/' : import.meta.env.BASE_URL}embed.js" data-shop="${data.slug}" async></script>`;
  const patch = async (body: any) => {
    try {
      const r = await api.patch('/shops/me/booking', body);
      setData({ ...data, ...r });
      setSlug(null);
      await reloadMe();
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast(t('copied'));
    } catch {
      /* clipboard blocked */
    }
  };
  const hours = data.hours as Record<string, [string, string] | null>;
  return (
    <section className="card stack" id="sec-booking">
      <div className="row spread">
        <h2 className="card-title">{t('onlineBooking')}</h2>
        <label className="switch">
          <input type="checkbox" checked={data.booking_enabled} onChange={(e) => patch({ booking_enabled: e.target.checked })} />
          <span>{data.booking_enabled ? t('on') : t('off')}</span>
        </label>
      </div>
      <p className="muted small">{t('onlineBookingHint')}</p>
      <Field label={t('bookingAddress')} hint={url}>
        <div className="row">
          <input value={current} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
          {slug !== null && slug !== data.slug && (
            <button className="btn" onClick={() => patch({ slug: current })}>
              {t('save')}
            </button>
          )}
        </div>
      </Field>
      {data.booking_enabled && (
        <>
          <div className="row">
            <button className="btn" onClick={() => setPreview(true)}>
              <Icon name="sparkle" /> {t('seeAsClient')}
            </button>
            <button className="btn" onClick={() => copy(url)}>
              <Icon name="share" /> {t('copyLink')}
            </button>
          </div>
          <Field label={t('embedCode')} hint={t('embedHint')}>
            <div className="row">
              <code className="key-out grow">{embed}</code>
              <button className="btn" onClick={() => copy(embed)} aria-label={t('copy')}>
                {t('copy')}
              </button>
            </div>
          </Field>
        </>
      )}
      <span className="eyebrow">{t('openingHours')}</span>
      <ul className="mini-list hours">
        {DAYS.map((d) => {
          const h = hours[String(d)];
          const setDay = (v: [string, string] | null) => patch({ hours: { ...hours, [String(d)]: v } });
          return (
            <li key={d}>
              <span className="day">{t(`wd${d}` as any)}</span>
              {h ? (
                <>
                  <input type="time" value={h[0]} onChange={(e) => e.target.value < h[1] && setDay([e.target.value, h[1]])} aria-label={t('opens')} />
                  <span>–</span>
                  <input type="time" value={h[1]} onChange={(e) => e.target.value > h[0] && setDay([h[0], e.target.value])} aria-label={t('closes')} />
                  <button className="link-btn" onClick={() => setDay(null)}>
                    {t('closed')}
                  </button>
                </>
              ) : (
                <button className="link-btn grow" onClick={() => setDay(['09:00', '19:00'])}>
                  {t('closedOpenIt')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <Field label={t('bookingNote')}>
        <input defaultValue={data.booking_note ?? ''} maxLength={300} placeholder={t('bookingNotePh')} onBlur={(e) => e.target.value !== (data.booking_note ?? '') && patch({ booking_note: e.target.value || null })} />
      </Field>
      {preview && (
        <div className="book-overlay" role="dialog" aria-modal="true">
          <BookPage slug={data.slug} api={api} onClose={() => (setPreview(false), reload())} />
        </div>
      )}
    </section>
  );
}
