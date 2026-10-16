import { useState } from 'react';
import type { Client } from '../api';
import { Field, Icon } from '../components/ui';
import { errorText } from '../state';
import type { Lang, T } from '../i18n';

const guessTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const guessCountry = (lang: Lang) => (lang === 'tr' ? 'TR' : lang === 'es' ? 'MX' : 'US');
const guessCurrency = (lang: Lang) => (lang === 'tr' ? 'TRY' : lang === 'es' ? 'MXN' : 'USD');

export function Auth({ api, t, lang, setLang, onIn }: { api: Client; t: T; lang: Lang; setLang(l: Lang): void; onIn(): void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ email: '', password: '', shop_name: '', owner_name: '', country: guessCountry(lang), currency: guessCurrency(lang), timezone: guessTz() });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const r =
        mode === 'login'
          ? await api.post('/auth/login', { email: f.email, password: f.password })
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
    <div className="auth">
      <div className="auth-brand">
        <span className="logo">
          <Icon name="scissors" size={28} />
        </span>
        <h1>Makas</h1>
        <p className="eyebrow">{t('appTagline')}</p>
        <p className="hero-line">{t('heroLine')}</p>
      </div>
      <form
        className="card stack auth-card"
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
        <Field label={t('email')}>
          <input type="email" autoComplete="email" value={f.email} onChange={set('email')} required />
        </Field>
        <Field label={t('password')}>
          <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : 1} value={f.password} onChange={set('password')} required />
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
          {mode === 'login' ? t('login') : t('register')}
        </button>
        <button type="button" className="link-btn center" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? t('noAccount') : t('haveAccount')}
        </button>
      </form>
      <div className="lang-switch">
        {(['tr', 'en', 'es'] as Lang[]).map((l) => (
          <button key={l} className={l === lang ? 'on' : ''} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
