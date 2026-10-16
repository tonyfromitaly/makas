import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient, httpTransport, type Client } from './api';
import { Ctx, errorText, type Me } from './state';
import { detectLang, makeT, type Lang } from './i18n';
import { money } from './format';
import { Icon } from './components/ui';
import { Auth } from './screens/Auth';
import { Today } from './screens/Today';
import { Clients } from './screens/Clients';
import { Books } from './screens/Books';
import { Settings } from './screens/Settings';
import { Locked } from './screens/Locked';
import { DemoPanel } from './components/DemoPanel';

export const DEMO = import.meta.env.MODE === 'demo' || import.meta.env.VITE_DEMO === 'true';
type Tab = 'today' | 'clients' | 'books' | 'settings';

const LANG_KEY = 'makas.lang';
const savedLang = (): Lang | null => {
  try {
    return (localStorage.getItem(LANG_KEY) as Lang) || null;
  } catch {
    return null;
  }
};

// Created once per page (StrictMode runs effects twice; the demo must open one database).
let booting: Promise<{ client: Client; signedIn: boolean }> | null = null;
const signedOutHandlers: (() => void)[] = [];
function boot(onSignedOut: () => void) {
  signedOutHandlers.splice(0, signedOutHandlers.length, onSignedOut);
  booting ??= (async () => {
    const signedOut = () => signedOutHandlers.forEach((f) => f());
    if (DEMO) {
      const { startDemo, DEMO_LOGIN } = await import('./demo');
      const client = createClient(await startDemo(), signedOut);
      if (!(await client.resume())) await client.signIn(await client.post('/auth/login', DEMO_LOGIN));
      return { client, signedIn: true };
    }
    const client = createClient(httpTransport(import.meta.env.VITE_API_URL ?? '/api'), signedOut);
    return { client, signedIn: await client.resume() };
  })();
  return booting;
}

export function App() {
  const [api, setApi] = useState<Client | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [phase, setPhase] = useState<'boot' | 'out' | 'in'>('boot');
  const [lang, setLangState] = useState<Lang>(savedLang() ?? detectLang());
  const [tab, setTab] = useState<Tab>('today');
  const [toastMsg, setToast] = useState('');
  const [bump, setBump] = useState(0);
  const t = useMemo(() => makeT(lang), [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  };
  const toast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2600);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const loadMe = useCallback(async (client: Client) => {
    const m = await client.get<Me>('/shops/me');
    setMe(m);
    if (!savedLang()) setLangState(m.shop.language);
    setPhase('in');
  }, []);

  useEffect(() => {
    const signedOut = () => (setMe(null), setPhase('out'));
    boot(signedOut).then(async ({ client, signedIn }) => {
      setApi(client);
      if (!signedIn) return setPhase('out');
      await loadMe(client).catch(() => setPhase('out'));
    });
  }, [loadMe]);

  if (phase === 'boot' || !api)
    return (
      <div className="boot">
        <span className="logo spin">
          <Icon name="scissors" size={30} />
        </span>
        {DEMO && <p>{t('loadingDemo')}</p>}
      </div>
    );

  if (phase === 'out' || !me) return <Auth api={api} t={t} lang={lang} setLang={setLang} onIn={() => loadMe(api)} />;

  const state = {
    api,
    me,
    lang,
    setLang,
    t,
    fmt: (c: number) => money(c, me.shop.currency, lang),
    reloadMe: () => loadMe(api),
    toast,
    fail: (e: unknown) => {
      if ((e as any)?.code === 'SUBSCRIPTION_INACTIVE') loadMe(api);
      else toast(errorText(t, e));
    },
    signOut: async () => {
      await api.signOut();
      setMe(null);
      setPhase('out');
    },
    demo: DEMO,
    bump,
    refreshAll: () => setBump((b) => b + 1),
  };

  return (
    <Ctx.Provider value={state}>
      <div className="app">
        <header className="topbar">
          <span className="brand">
            <Icon name="scissors" size={18} /> {me.shop.name}
          </span>
          {DEMO && <DemoPanel />}
        </header>
        <main>
          {me.locked ? (
            <Locked />
          ) : (
            <>
              {tab === 'today' && <Today key={bump} />}
              {tab === 'clients' && <Clients />}
              {tab === 'books' && <Books />}
              {tab === 'settings' && <Settings />}
            </>
          )}
        </main>
        {!me.locked && (
          <nav className="tabbar">
            {(
              [
                ['today', 'calendar'],
                ['clients', 'users'],
                ['books', 'book'],
                ['settings', 'gear'],
              ] as [Tab, string][]
            ).map(([k, icon]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
                <Icon name={icon} size={22} />
                <span>{t(k)}</span>
              </button>
            ))}
          </nav>
        )}
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      </div>
    </Ctx.Provider>
  );
}
