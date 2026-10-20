import { useEffect, useState } from 'react';
import { takeNavHint } from '../nav';
import { useApp, useLoad } from '../state';
import { Field, Icon } from '../components/ui';
import { dateLabel, toCents } from '../format';
import { SupportChat } from '../components/SupportChat';
import { ManagePlan } from '../components/ManagePlan';
import { Connections } from '../components/Connections';
import { OnlineBooking, Products, Stations, TeamSettings } from '../components/TeamSettings';
import type { Lang } from '../i18n';
import { ACCENTS, SKINS, applyLook, isDark, loadLook, saveLook, type Look as LookT } from '../theme';

export function Settings() {
  const { api, t, me, reloadMe, fail, toast, lang, setLang, signOut, has, openSetup } = useApp();
  const [shop, setShop] = useState({ ...me.shop });
  const isOwner = me.user.role === 'owner';
  // Opened from an agent note: start at the section it is about.
  useEffect(() => {
    const h = takeNavHint();
    if (h) setTimeout(() => document.getElementById(`sec-${h}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300);
  }, []);

  const saveShop = async () => {
    try {
      await api.patch('/shops/me', {
        name: shop.name,
        timezone: shop.timezone,
        language: shop.language,
        currency: shop.currency,
        reminder_day_before_hour: Number(shop.reminder_day_before_hour),
        reminder_hours_before: Number(shop.reminder_hours_before),
      });
      await reloadMe();
      toast(t('saved'));
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t('settings')}</h1>
      </div>

      <section className="card stack">
        <div className="row spread">
          <span className="eyebrow">{t('subscription')}</span>
          <span className={`chip sub-${me.subscription?.status}`}>{t(`sub_${me.subscription?.status}` as any)}</span>
        </div>
        {me.subscription?.current_period_end && (
          <p className="muted small">
            {t('until')}: {dateLabel(me.subscription.current_period_end.slice(0, 10), lang, { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
        <ManagePlan />
        <Field label={t('language')}>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </Field>
      </section>

      {isOwner && (
        <section className="card stack">
          <h2 className="card-title">{me.shop.agent_name ?? t('setupStart')}</h2>
          <p className="muted small">{me.shop.set_up ? t('setupAgainHint') : t('setupBanner')}</p>
          <button className="btn" onClick={openSetup}>
            {me.shop.set_up ? t('setupAgain') : t('setupStart')}
          </button>
        </section>
      )}

      <Look />

      {isOwner && (
        <section className="card stack">
          <h2 className="card-title">{t('shop')}</h2>
          <Field label={t('shopName')}>
            <input value={shop.name} onChange={(e) => setShop({ ...shop, name: e.target.value })} />
          </Field>
          <div className="row two">
            <Field label={t('timezone')}>
              <input value={shop.timezone} onChange={(e) => setShop({ ...shop, timezone: e.target.value })} />
            </Field>
            <Field label={t('currency')}>
              <input value={shop.currency} maxLength={3} onChange={(e) => setShop({ ...shop, currency: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          <Field label={`${t('language')} (${t('reminders').toLocaleLowerCase()})`}>
            <select value={shop.language} onChange={(e) => setShop({ ...shop, language: e.target.value as Lang })}>
              <option value="tr">Türkçe</option>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </Field>
          {has('hatirlatma') && (
            <>
          <span className="eyebrow" id="sec-reminders">{t('reminderRules')}</span>
          <div className="row two">
            <Field label={t('dayBeforeAt')}>
              <input type="number" min={0} max={23} value={shop.reminder_day_before_hour} onChange={(e) => setShop({ ...shop, reminder_day_before_hour: Number(e.target.value) })} />
            </Field>
            <Field label={t('hoursBefore')}>
              <input type="number" min={1} max={24} value={shop.reminder_hours_before} onChange={(e) => setShop({ ...shop, reminder_hours_before: Number(e.target.value) })} />
            </Field>
          </div>
            </>
          )}
          <button className="btn primary" onClick={saveShop}>
            {t('save')}
          </button>
        </section>
      )}

      {isOwner && <Connections />}
      {isOwner && <TeamSettings />}
      {isOwner && (has('randevu') || has('personel')) && <Stations />}
      {isOwner && (has('randevu') || has('satis')) && (
        <div id="sec-services">
          <Catalog kind="services" />
        </div>
      )}
      {isOwner && <Products />}
      {isOwner && has('randevu') && <OnlineBooking />}
      <SupportChat />

      <section className="card stack">
        {isOwner && <ExportButton />}
        <button className="btn" onClick={signOut}>
          {t('logout')}
        </button>
        {isOwner && <DeleteShop />}
      </section>
      <p className="muted small center">Fade v0.2 · {me.user.email}</p>
    </div>
  );
}

function Look() {
  const { t } = useApp();
  const [look, setLook] = useState<LookT>(loadLook);
  const pick = (next: LookT) => {
    setLook(next);
    saveLook(next);
    applyLook(next);
  };
  const dark = isDark(look);
  return (
    <section className="card stack">
      <h2 className="card-title">{t('look')}</h2>
      <p className="muted small">{t('lookHint')}</p>
      <div className="skins">
        {SKINS.map((s) => {
          const [paper, ink, accent, counter] = s.swatch;
          return (
            <button key={s.id} className="skin" aria-pressed={look.skin === s.id} onClick={() => pick({ ...look, skin: s.id })} title={t(`skinDesc_${s.id}` as any)}>
              <span className="skin-art" style={{ background: counter }} aria-hidden>
                <i style={{ left: 8, right: 8, top: 8, bottom: 0, background: paper, borderRadius: s.id === 'pudra' || s.id === 'cini' ? 8 : 1 }} />
                <i style={{ left: 16, top: 16, width: 34, height: 6, background: ink }} />
                <i style={{ left: 16, top: 28, width: 52, height: 4, background: ink, opacity: 0.35 }} />
                <i style={{ left: 16, top: 40, width: 24, height: 10, background: accent, borderRadius: 2 }} />
                {s.id === 'auto' && <i style={{ right: 8, top: 8, bottom: 0, width: '45%', background: '#1b2029' }} />}
              </span>
              <span className="skin-name">{t(`skin_${s.id}` as any)}</span>
            </button>
          );
        })}
      </div>
      <p className="muted small">{t(`skinDesc_${look.skin}` as any)}</p>
      <span className="eyebrow">{t('accentColor')}</span>
      <div className="accents">
        <button className="accent own" aria-pressed={!look.accent} onClick={() => pick({ ...look, accent: null })} aria-label={t('accentOwn')} title={t('accentOwn')} />
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            className="accent"
            style={{ background: dark ? a.dark : a.light }}
            aria-pressed={look.accent === a.id}
            onClick={() => pick({ ...look, accent: a.id })}
            aria-label={t(`accent_${a.id}` as any)}
            title={t(`accent_${a.id}` as any)}
          />
        ))}
      </div>
    </section>
  );
}

function Catalog({ kind }: { kind: 'services' | 'barbers' }) {
  const { api, t, fmt, fail } = useApp();
  const { data, reload } = useLoad(() => api.get(`/${kind}?include_inactive=true&page_size=200`), [kind]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [min, setMin] = useState('30');
  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.post(`/${kind}`, kind === 'services' ? { name, price_cents: toCents(price), duration_min: Number(min) } : { name });
      setName('');
      setPrice('');
      reload();
    } catch (e) {
      fail(e);
    }
  };
  const toggle = async (row: any) => {
    try {
      if (kind === 'services' && row.active) await api.del(`/services/${row.id}`);
      else await api.patch(`/${kind}/${row.id}`, { active: !row.active });
      reload();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <section className="card stack">
      <h2 className="card-title">{t(kind)}</h2>
      <ul className="mini-list">
        {data?.data.map((r: any) => (
          <li key={r.id} className={r.active ? '' : 'inactive'}>
            <span className="grow">{r.name}</span>
            {kind === 'services' && (
              <span className="muted">
                {r.duration_min} {t('minutes')} · <span className="numeral">{fmt(r.price_cents)}</span>
              </span>
            )}
            {kind === 'services' && (
              <select
                className="narrow mini-select"
                value={r.station_kind ?? ''}
                aria-label={t('needsStation')}
                title={t('needsStation')}
                onChange={async (e) => {
                  try {
                    await api.patch(`/services/${r.id}`, { station_kind: e.target.value || null });
                    reload();
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                <option value="">{t('noStation')}</option>
                {['chair', 'room', 'bed', 'table', 'other'].map((k) => (
                  <option key={k} value={k}>
                    {t(`kind_${k}` as any)}
                  </option>
                ))}
              </select>
            )}
            <button className="link-btn" onClick={() => toggle(r)}>
              {r.active ? t('inactive') : t('activate')}
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'services' ? t('service') : t('barber')} />
        {kind === 'services' && (
          <>
            <input className="narrow" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={t('price')} />
            <input className="narrow" type="number" value={min} onChange={(e) => setMin(e.target.value)} aria-label={t('duration')} />
          </>
        )}
        <button className="btn" onClick={add} aria-label={t('add')}>
          <Icon name="plus" />
        </button>
      </div>
    </section>
  );
}

export function Feedback() {
  const { api, t, fail, toast } = useApp();
  const [msg, setMsg] = useState('');
  return (
    <section className="card stack">
      <h2 className="card-title">{t('feedback')}</h2>
      <textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('feedbackPlaceholder')} />
      <button
        className="btn"
        disabled={!msg.trim()}
        onClick={async () => {
          try {
            await api.post('/feedback', { message: msg });
            setMsg('');
            toast(t('feedbackThanks'));
          } catch (e) {
            fail(e);
          }
        }}
      >
        {t('send')}
      </button>
    </section>
  );
}

export function ExportButton() {
  const { api, t, fail } = useApp();
  return (
    <button
      className="btn"
      onClick={async () => {
        try {
          const data = await api.get('/shops/me/export');
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = `makas-export-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) {
          fail(e);
        }
      }}
    >
      <Icon name="download" /> {t('exportData')}
    </button>
  );
}

function DeleteShop() {
  const { api, t, fail, reloadMe } = useApp();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  if (!open)
    return (
      <button className="btn danger-ghost" onClick={() => setOpen(true)}>
        <Icon name="trash" /> {t('deleteShop')}
      </button>
    );
  return (
    <div className="subcard stack danger-zone">
      <p>{t('deleteConfirm')}</p>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('password')} />
      <div className="row">
        <button className="btn" onClick={() => setOpen(false)}>
          {t('cancel')}
        </button>
        <button
          className="btn danger"
          disabled={!pw}
          onClick={async () => {
            try {
              await api.del('/shops/me', { password: pw });
              // The shop is suspended, not gone: the app now shows the restore screen.
              await reloadMe();
            } catch (e) {
              fail(e);
            }
          }}
        >
          {t('delete')}
        </button>
      </div>
    </div>
  );
}
