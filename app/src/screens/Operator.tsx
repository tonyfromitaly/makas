import { useEffect, useState } from 'react';
import type { Client } from '../api';
import type { T } from '../i18n';
import { Icon } from '../components/ui';

const KEY = 'monacount.ops';

/**
 * Our side of "Bize yaz": every shop's thread, newest and unanswered first, a reply box, website demo
 * requests, applications, invites and the activity log. Opened only from the private operator link.
 * Signing in takes the admin key and, in production, a code from an authenticator app; the result is a
 * 30-minute session kept for this tab only. In the live demo the key is provided automatically.
 */
export function Operator({ api, t, demoKey, onClose }: { api: Client; t: T; demoKey?: string; onClose(): void }) {
  const [key, setKey] = useState(() => demoKey ?? sessionStorage.getItem(KEY) ?? '');
  const [draftKey, setDraftKey] = useState('');
  const [code, setCode] = useState('');
  const signOut = () => (sessionStorage.removeItem(KEY), setKey(''), setDraftKey(''), setCode(''));
  const signIn = async () => {
    const r = await api.raw('POST', '/admin/session', '', { key: draftKey, ...(code ? { code } : {}) });
    if (r.status !== 200) return setError(r.body?.error?.message ?? String(r.status));
    sessionStorage.setItem(KEY, r.body.token);
    setError('');
    setDraftKey('');
    setCode('');
    setKey(r.body.token);
  };
  const [threads, setThreads] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<any | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  // Applications come from the website and live on the real server only (not in the browser demo).
  const [view, setView] = useState<'support' | 'demos' | 'apps' | 'invite' | 'log'>('support');
  const [demos, setDemos] = useState<any[] | null>(null);
  const [log, setLog] = useState<any[] | null>(null);
  const loadDemos = async () => setDemos((await api.raw('GET', '/admin/demo-requests', key)).body?.data ?? []);
  const loadLog = async () => setLog((await api.raw('GET', '/admin/log', key)).body?.data ?? []);
  const [inv, setInv] = useState({ shop_name: '', owner_name: '', email: '', business_type: 'barber', country: 'TR', language: 'tr', status: 'trial', days: 14 });
  const sendInvite = async () => {
    const r = await api.raw('POST', '/admin/invites', key, { ...inv, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', days: Number(inv.days) });
    if (r.status === 200) {
      setNote(r.body.emailed ? t('emailSent') : t('emailFailed'));
      setInv({ ...inv, shop_name: '', owner_name: '', email: '' });
    } else setNote(r.body?.error?.message ?? 'Error');
  };
  const [apps, setApps] = useState<any[] | null>(null);
  const [note, setNote] = useState('');
  const loadApps = async () => {
    const r = await api.raw('GET', '/admin/signups', key);
    setApps(r.status === 200 ? r.body.data : []);
  };
  const decide = async (id: string, action: 'trial' | 'active' | 'reject') => {
    const r =
      action === 'reject'
        ? await api.raw('POST', `/admin/signups/${id}/reject`, key, {})
        : await api.raw('POST', `/admin/signups/${id}/approve`, key, action === 'trial' ? { status: 'trial', days: 14 } : { status: 'active', days: 30 });
    if (action !== 'reject') setNote(r.body?.emailed ? t('emailSent') : t('emailFailed'));
    loadApps();
  };

  const loadThreads = async () => {
    const r = await api.raw('GET', '/admin/support', key);
    // The session ended (30 minutes) or the key changed: back to sign-in.
    if (r.status === 401) return setError('401'), signOut();
    setThreads(r.body?.data ?? []);
  };
  const loadThread = async (id: string) => {
    const r = await api.raw('GET', `/admin/support/${id}`, key);
    setThread(r.body);
  };

  useEffect(() => {
    if (!key) return;
    loadThreads();
    const id = setInterval(() => (open ? loadThread(open) : loadThreads()), 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);

  const reply = async () => {
    if (!open || !text.trim()) return;
    await api.raw('POST', `/admin/support/${open}`, key, { message: text.trim() });
    setText('');
    loadThread(open);
  };

  if (!key)
    return (
      <div className="operator">
        <header className="op-head">
          <h1>{t('operatorPanel')}</h1>
          <button className="icon-btn" onClick={onClose} aria-label="close"><Icon name="x" /></button>
        </header>
        <form className="card stack" onSubmit={(e) => (e.preventDefault(), signIn())}>
          <input type="password" autoComplete="off" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder={t('adminKey')} autoFocus />
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder={t('authCode')} />
          {error && <p className="notice warn small">{error === '401' ? t('sessionEnded') : error}</p>}
          <button className="btn primary" disabled={!draftKey}>{t('openOperator')}</button>
          <p className="muted small">{t('opsNotice')}</p>
        </form>
      </div>
    );

  return (
    <div className="operator">
      <header className="op-head">
        {open ? (
          <button className="link-btn" onClick={() => (setOpen(null), setThread(null), loadThreads())}><Icon name="chevL" /> {t('back')}</button>
        ) : (
          <h1>{t('operatorPanel')}</h1>
        )}
        <div className="row">
          {!demoKey && <button className="btn small" onClick={signOut}>{t('logout')}</button>}
          <button className="icon-btn" onClick={onClose} aria-label="close"><Icon name="x" /></button>
        </div>
      </header>

      {!open && !demoKey && (
        <div className="segmented wrap">
          <button className={view === 'support' ? 'on' : ''} onClick={() => setView('support')}>{t('feedback')}</button>
          <button className={view === 'demos' ? 'on' : ''} onClick={() => (setView('demos'), loadDemos())}>{t('demoRequests')}</button>
          <button className={view === 'apps' ? 'on' : ''} onClick={() => (setView('apps'), loadApps())}>{t('applications')}</button>
          <button className={view === 'invite' ? 'on' : ''} onClick={() => setView('invite')}>{t('newInvite')}</button>
          <button className={view === 'log' ? 'on' : ''} onClick={() => (setView('log'), loadLog())}>{t('activityLog')}</button>
        </div>
      )}

      {!open && view === 'demos' && (
        <ul className="list">
          {demos?.map((d) => (
            <li key={d.id} className="app-row">
              <div>
                <span className="row-title">{d.business} · {d.name} <span className="chip">{d.site === 'monamilelab' ? 'TR' : 'US'}{d.team_size ? ` · ${d.team_size}` : ''}</span></span>
                <span className="row-meta">
                  <a href={`mailto:${d.email}`}>{d.email}</a>{d.phone ? ` · ${d.phone}` : ''}{d.city ? ` · ${d.city}` : ''} · {d.business_type} · {new Date(d.created_at).toLocaleString()}
                </span>
                {d.message && <p className="small">{d.message}</p>}
              </div>
            </li>
          ))}
          {demos && !demos.length && <li className="muted small" style={{ padding: 16 }}>{t('noDemoRequests')}</li>}
        </ul>
      )}

      {!open && view === 'log' && (
        <ul className="list">
          {log?.map((e, i) => (
            <li key={i} className="list-row small">
              <span className={e.ok ? '' : 'neg'}>{e.ok ? '✓' : '✕'}</span>
              <span className="grow numeral">{e.action}{e.target ? ` · ${e.target.slice(0, 8)}` : ''}</span>
              <span className="muted">{e.ip ?? ''} · {new Date(e.at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="notice small">{note}</p>}

      {!open && view === 'invite' && (
        <form className="card stack" onSubmit={(e) => (e.preventDefault(), sendInvite())}>
          <p className="muted small">{t('inviteHint')}</p>
          <input required placeholder={t('shopName')} value={inv.shop_name} onChange={(e) => setInv({ ...inv, shop_name: e.target.value })} />
          <input required placeholder={t('ownerName')} value={inv.owner_name} onChange={(e) => setInv({ ...inv, owner_name: e.target.value })} />
          <input required type="email" placeholder={t('email')} value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
          <select aria-label={t('businessType')} value={inv.business_type} onChange={(e) => setInv({ ...inv, business_type: e.target.value })}>
            {['barber', 'salon', 'beauty', 'other'].map((b) => <option key={b} value={b}>{t(`bt_${b}` as any)}</option>)}
          </select>
          <div className="row">
            <select aria-label={t('language')} value={inv.language} onChange={(e) => setInv({ ...inv, language: e.target.value })}>
              <option value="tr">Türkçe</option><option value="en">English</option><option value="es">Español</option>
            </select>
            <input className="narrow" maxLength={2} aria-label={t('country')} value={inv.country} onChange={(e) => setInv({ ...inv, country: e.target.value.toUpperCase() })} />
          </div>
          <div className="row">
            <select aria-label={t('subscription')} value={inv.status} onChange={(e) => setInv({ ...inv, status: e.target.value })}>
              <option value="trial">{t('sub_trial')}</option><option value="active">{t('sub_active')}</option>
            </select>
            <input className="narrow" type="number" min={1} max={366} aria-label="days" value={inv.days} onChange={(e) => setInv({ ...inv, days: Number(e.target.value) })} />
          </div>
          <button className="btn primary">{t('sendInvite')}</button>
        </form>
      )}

      {!open && view === 'apps' && (
        <ul className="list">
          {apps?.map((a) => (
            <li key={a.id} className="app-row">
              <div>
                <span className="row-title">{a.shop_name}</span>
                <span className="row-meta">{a.owner_name} · {a.email} · {a.country} · {new Date(a.created_at).toLocaleString()}</span>
              </div>
              <div className="row wrap">
                <button className="btn small ok" onClick={() => decide(a.id, 'trial')}>{t('approveTrial')}</button>
                <button className="btn small" onClick={() => decide(a.id, 'active')}>{t('approveActive')}</button>
                <button className="btn small danger-ghost" onClick={() => decide(a.id, 'reject')}>{t('reject')}</button>
              </div>
            </li>
          ))}
          {apps && !apps.length && <li className="muted small" style={{ padding: 16 }}>{t('noApplications')}</li>}
        </ul>
      )}

      {!open && view === 'support' && (
        <ul className="list">
          {threads?.map((th) => (
            <li key={th.shop_id}>
              <button className="list-row" onClick={() => (setOpen(th.shop_id), loadThread(th.shop_id))}>
                <span className="avatar">{th.shop_name.slice(0, 2).toUpperCase()}</span>
                <span className="grow">
                  <span className="row-title">{th.shop_name} {th.waiting > 0 && <span className="chip risk high">{th.waiting} {t('waiting')}</span>}</span>
                  <span className="row-meta">{th.last_author === 'operator' ? '↩ ' : ''}{th.last_message}</span>
                </span>
              </button>
            </li>
          ))}
          {threads && !threads.length && <li className="muted small" style={{ padding: 16 }}>{t('noThreads')}</li>}
        </ul>
      )}

      {open && thread && (
        <div className="stack">
          <h2 className="card-title">{thread.shop.name}</h2>
          <div className="support-thread tall">
            {thread.data.map((m: any) => (
              <div key={m.id} className={`sup ${m.author === 'operator' ? 'shop' : 'operator'}`}>
                <span className="sup-who">{m.author === 'operator' ? t('team') : m.user_name ?? thread.shop.name} · {new Date(m.created_at).toLocaleString()}</span>
                <p>{m.message}</p>
              </div>
            ))}
          </div>
          <form className="row" onSubmit={(e) => (e.preventDefault(), reply())}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('reply')} autoFocus />
            <button className="btn primary" disabled={!text.trim()}><Icon name="chevR" /></button>
          </form>
        </div>
      )}
    </div>
  );
}
