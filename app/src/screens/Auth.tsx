import { useEffect, useState } from 'react';
import type { Client } from '../api';
import { Field } from '../components/ui';
import { Hero } from '../components/Welcome';
import { errorText } from '../state';
import type { Lang, T } from '../i18n';
import { DEMO_LOGIN } from '@makas/core';

const guessTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const guessCountry = (lang: Lang) => (lang === 'tr' ? 'TR' : lang === 'es' ? 'MX' : 'US');

type Mode = 'login' | 'key' | 'register';
interface Meta {
  signup: 'open' | 'subscribe';
  billing: boolean;
  site_url: string | null;
}

/** "#key=FADE-…" from the welcome e-mail opens straight into the access-key form. */
function keyFromHash() {
  const m = location.hash.match(/^#key=(.+)$/);
  return m ? decodeURIComponent(m[1]) : '';
}

export function Auth({ api, t, lang, setLang, onIn }: { api: Client; t: T; lang: Lang; setLang(l: Lang): void; onIn(): void }) {
  const initialKey = keyFromHash();
  const [mode, setMode] = useState<Mode>(initialKey ? 'key' : 'login');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [f, setF] = useState({ email: '', password: '', key: initialKey, shop_name: '', owner_name: '', country: guessCountry(lang), currency: 'USD', timezone: guessTz() });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api.get<Meta>('/meta').then(setMeta).catch(() => setMeta({ signup: 'open', billing: false, site_url: null }));
    // The key is in the form now; keep it out of the address bar and history.
    if (initialKey) history.replaceState(null, '', location.pathname + location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribeOnly = meta?.signup === 'subscribe';
  const siteUrl = `${meta?.site_url ?? ''}/?lang=${lang}#abone-ol`;

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const r =
        mode === 'login'
          ? await api.post('/auth/login', { email: f.email, password: f.password })
          : mode === 'key'
            ? await api.post('/auth/key', { key: f.key, password: f.password })
            : await api.post('/auth/register', { ...f, language: lang });
      await api.signIn(r);
      onIn();
    } catch (e) {
      setErr(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Hero t={t}>
      <form
        className="hero-card stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {mode === 'register' && (
          <>
            <Field label={t('shopName')}>
              <input value={f.shop_name} onChange={set('shop_name')} required />
            </Field>
            <Field label={t('ownerName')}>
              <input value={f.owner_name} onChange={set('owner_name')} required />
            </Field>
          </>
        )}
        {mode === 'key' ? (
          <>
            <p className="muted small">{t('keyHint')}</p>
            <Field label={t('accessKey')}>
              <input value={f.key} onChange={set('key')} required placeholder="FADE-XXXX-XXXX-XXXX" autoCapitalize="characters" spellCheck={false} className="key-input" />
            </Field>
          </>
        ) : (
          <Field label={t('email')}>
            <input type="email" autoComplete="email" value={f.email} onChange={set('email')} required />
          </Field>
        )}
        <Field label={mode === 'login' ? t('password') : t('newPassword')}>
          <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 8} value={f.password} onChange={set('password')} required />
        </Field>
        {mode === 'register' && (
          <div className="row three">
            <Field label={t('country')}>
              <input value={f.country} maxLength={2} onChange={set('country')} required />
            </Field>
            <Field label={t('currency')}>
              <input value={f.currency} maxLength={3} onChange={set('currency')} required />
            </Field>
            <Field label={t('timezone')}>
              <input value={f.timezone} onChange={set('timezone')} required />
            </Field>
          </div>
        )}
        {err && <p className="notice warn">{err}</p>}
        <button className="btn primary block" disabled={busy}>
          {mode === 'login' ? t('login') : mode === 'key' ? t('setPasswordEnter') : t('register')}
        </button>
        {import.meta.env.DEV && mode === 'login' && (
          <button type="button" className="btn block" onClick={() => setF({ ...f, email: DEMO_LOGIN.email, password: DEMO_LOGIN.password })}>
            Demo · {DEMO_LOGIN.email}
          </button>
        )}
        <div className="auth-links">
          {mode !== 'key' && (
            <button type="button" className="link-btn" onClick={() => (setErr(''), setMode('key'))}>
              {t('haveKey')}
            </button>
          )}
          {mode !== 'login' && (
            <button type="button" className="link-btn" onClick={() => (setErr(''), setMode('login'))}>
              {t('haveAccount')}
            </button>
          )}
          {/* Production sells shops on the website; open self-signup only where the server allows it. */}
          {mode === 'login' && meta && (subscribeOnly ? (
            <a className="link-btn" href={siteUrl}>{t('subscribeOnSite')}</a>
          ) : (
            <button type="button" className="link-btn" onClick={() => (setErr(''), setMode('register'))}>
              {t('noAccount')}
            </button>
          ))}
        </div>
      </form>
      <div className="lang-switch">
        {(['tr', 'en', 'es'] as Lang[]).map((l) => (
          <button key={l} className={l === lang ? 'on' : ''} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </Hero>
  );
}
