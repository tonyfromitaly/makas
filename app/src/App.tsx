import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient, httpTransport, type Client } from './api';
import { Ctx, DEFAULT_MODULES, errorText, type Me } from './state';
import { Setup } from './screens/Setup';
import { applyLook, loadLook, saveLook, type Skin } from './theme';
import { setNavHint } from './nav';
import { detectLang, makeT, type Lang } from './i18n';
import { money } from './format';
import { Icon } from './components/ui';
import { Auth } from './screens/Auth';
import { Today } from './screens/Today';
import { Clients } from './screens/Clients';
import { Books } from './screens/Books';
import { Settings } from './screens/Settings';
import { Locked } from './screens/Locked';
import { Suspended } from './screens/Suspended';
import { Assistant, forgetConversation } from './screens/Assistant';
import { DemoPanel } from './components/DemoPanel';
import { Welcome } from './components/Welcome';
import { Operator } from './screens/Operator';
import { Till } from './screens/Till';

export const DEMO = import.meta.env.MODE === 'demo' || import.meta.env.VITE_DEMO === 'true';
type Tab = 'today' | 'till' | 'clients' | 'assistant' | 'books' | 'settings';

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
      const { startDemo, demoLogin, sampleKind } = await import('./demo');
      const client = createClient(await startDemo(), signedOut);
      // Sample shops and the empty demo keep separate sessions.
      if (sampleKind() || !(await client.resume())) await client.signIn(await client.post('/auth/login', demoLogin()));
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
  // Back from a connection sign-in (Square adds ?code&state): open Settings, where it is finished.
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).has('state') ? 'settings' : 'today'));
  const [autoMic, setAutoMic] = useState(false);
  const [welcome, setWelcome] = useState(() => {
    if (!DEMO || new URLSearchParams(location.search).has('ornek')) return false;
    try {
      return !localStorage.getItem('makas.welcomed');
    } catch {
      return true;
    }
  });
  const closeWelcome = () => {
    setWelcome(false);
    try {
      localStorage.setItem('makas.welcomed', '1');
    } catch {
      /* ignore */
    }
  };
  const [toastMsg, setToast] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [bump, setBump] = useState(0);
  const [operator, setOperator] = useState(() => typeof location !== 'undefined' && location.hash === '#operator');
  const [unread, setUnread] = useState(0);
  const [demoAdminKey, setDemoAdminKey] = useState<string>();
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

  useEffect(() => {
    const onHash = () => setOperator(location.hash === '#operator');
    window.addEventListener('hashchange', onHash);
    if (DEMO) import('./demo').then((d) => setDemoAdminKey(d.DEMO_KEYS.admin));
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Replies from the Monacount team show as a badge on Settings, checked every 20 seconds.
  useEffect(() => {
    if (phase !== 'in' || !api) return;
    const check = () => api.get<{ unread: number }>('/support/unread').then((r) => setUnread(r.unread)).catch(() => {});
    check();
    const id = setInterval(check, 20000);
    return () => clearInterval(id);
  }, [phase, api, bump, operator]);

  const loadMe = useCallback(async (client: Client) => {
    const m = await client.get<Me>('/shops/me');
    // The shop's look from the setup wizard, unless this phone already chose its own.
    const look = m.shop.look;
    if (look && loadLook().skin === 'auto' && !loadLook().accent) {
      const l = { skin: look.skin as Skin, accent: look.accent };
      saveLook(l);
      applyLook(l);
    }
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

  if (operator && api)
    return <Operator api={api} t={t} demoKey={demoAdminKey} onClose={() => ((location.hash = ''), setOperator(false))} />;

  // The welcome shows at once; Postgres keeps starting in the background behind it.
  if (welcome) return <Welcome t={t} onStart={closeWelcome} />;

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
      if ((e as any)?.code === 'SUBSCRIPTION_INACTIVE' || (e as any)?.code === 'SHOP_DELETED') loadMe(api);
      else toast(errorText(t, e));
    },
    signOut: async () => {
      await api.signOut();
      forgetConversation();
      setMe(null);
      setPhase('out');
    },
    demo: DEMO,
    bump,
    refreshAll: () => setBump((b) => b + 1),
    showWelcome: () => setWelcome(true),
    markSupportRead: () => setUnread(0),
    openAssistant: (mic = false) => {
      setAutoMic(mic);
      setTab('assistant');
    },
    has: (m: string) => (me.shop.modules ?? DEFAULT_MODULES).includes(m),
    openSetup: () => setSetupOpen(true),
    go: (k: Tab, hint?: string) => {
      setNavHint(hint);
      setTab(k);
    },
  };

  if (setupOpen)
    return (
      <Ctx.Provider value={state}>
        <Setup
          initial={{ isletme: me.shop.name, sahip: me.user.name, dil: lang === 'tr' ? 'tr' : 'en' }}
          onClose={() => setSetupOpen(false)}
          onApply={async (c) => {
            const r = await api.post<{ look: { skin: string; accent: string | null }; agent_name: string }>('/shops/me/setup', c);
            const l = { skin: r.look.skin as Skin, accent: r.look.accent };
            saveLook(l);
            applyLook(l);
            await loadMe(api);
            setSetupOpen(false);
            setTab('today');
            toast(t('setupApplied', { name: r.agent_name }));
          }}
        />
      </Ctx.Provider>
    );

  return (
    <Ctx.Provider value={state}>
      <div className="app">
        <header className="topbar">
          <span className="pole-strip" aria-hidden />
          <span className="brand">
            <Icon name="scissors" size={18} /> {me.shop.name}
          </span>
          {/* ?shot hides the demo controls for website screenshots. */}
          {DEMO && !new URLSearchParams(location.search).has('shot') && <DemoPanel />}
        </header>
        <main>
          {me.shop.deleted_at ? (
            <Suspended />
          ) : me.locked ? (
            <Locked />
          ) : (
            <>
              {tab === 'today' && <Today key={bump} />}
              {tab === 'till' && <Till />}
              {tab === 'clients' && <Clients />}
              {tab === 'assistant' && <Assistant autoMic={autoMic} onMicUsed={() => setAutoMic(false)} />}
              {tab === 'books' && <Books />}
              {tab === 'settings' && <Settings />}
            </>
          )}
        </main>
        {!me.locked && !me.shop.deleted_at && (
          <nav className={`tabbar ${me.user.role === 'owner' ? 'six' : ''}`}>
            {(
              [
                ['today', 'calendar'],
                ['till', 'till'],
                ['assistant', 'sparkle'],
                ['clients', 'users'],
                ['books', 'book'],
                ['settings', 'gear'],
              ] as [Tab, string][]
            )
              // No client book and no appointments: the Clients tab has nothing to show.
              .filter(([k]) => k !== 'clients' || state.has('musteri') || state.has('randevu'))
              // A team member's app: their day, their till, their clients. The books are the owner's.
              .filter(([k]) => k !== 'books' || me.user.role === 'owner')
              .map(([k, icon]) => (
              <button key={k} className={`${tab === k ? 'on' : ''} ${k === 'assistant' ? 'center' : ''}`} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
                <Icon name={icon} size={22} />
                {k === 'settings' && unread > 0 && <span className="tab-badge">{unread}</span>}
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
