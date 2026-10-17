import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { LOCALES } from '../i18n';
import { Icon, useSpeech } from '../components/ui';
import { DraftList, type Draft } from '../components/Drafts';
import { MemorySheet } from '../components/MemorySheet';

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  drafts?: Draft[];
  engine?: string;
  at: number;
  /** Loaded from the server: its drafts were handled back then, so they are shown, not offered again. */
  past?: boolean;
}

// Kept outside the component so the conversation survives switching tabs; the server keeps it across reloads.
let history: Msg[] = [];
let loaded = false;
let seq = 0;
/** Signing out must not leave one person's conversation on screen for the next. */
export function forgetConversation() {
  history = [];
  loaded = false;
}
// After this long without a message the assistant starts a fresh context (core/src/assistant/memory.ts).
const SESSION_GAP_MS = 6 * 3600_000;

export function Assistant({ autoMic, onMicUsed }: { autoMic?: boolean; onMicUsed?(): void }) {
  const { api, t, lang, fail } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>(history);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lists, setLists] = useState<{ services: any[]; barbers: any[] }>();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const push = (m: Omit<Msg, 'id' | 'at'>) =>
    setMsgs((x) => {
      const next = [...x, { ...m, id: ++seq, at: Date.now() }];
      history = next;
      return next;
    });
  const replace = (next: Msg[]) => {
    history = next;
    setMsgs(next);
  };
  const brief = () =>
    api
      .get(`/assistant/brief?lang=${lang}`)
      .then((r) => push({ role: 'assistant', text: r.reply }))
      .catch(fail);

  useEffect(() => {
    Promise.all([api.get('/services?page_size=200'), api.get('/barbers?page_size=200')])
      .then(([s, b]) => setLists({ services: s.data, barbers: b.data }))
      .catch(fail);
    if (loaded) return;
    loaded = true;
    api
      .get('/assistant/history?limit=60')
      .then((r) => {
        const past: Msg[] = r.data.map((x: any) => ({ id: ++seq, role: x.role, text: x.text, drafts: x.drafts ?? undefined, engine: x.engine, at: Date.parse(x.created_at), past: true }));
        replace(past);
        // The day's opening line when the conversation is new or was left a while ago.
        const last = past[past.length - 1];
        if (!last || Date.now() - last.at > SESSION_GAP_MS) brief();
      })
      .catch(() => {
        if (!history.length) brief();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = async () => {
    if (!confirm(t('clearChatConfirm'))) return;
    try {
      await api.del('/assistant/history');
      replace([]);
      brief();
    } catch (e) {
      fail(e);
    }
  };
  const when = (ms: number) => new Date(ms).toLocaleString(LOCALES[lang], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    // Only follow the conversation once it has started, so the header stays in view on open.
    // Block body: scrollIntoView may return a promise, which must not become the effect's cleanup.
    if (msgs.length > 1 || busy) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  const send = async (sentence: string) => {
    const s = sentence.trim();
    if (!s || busy) return;
    setText('');
    push({ role: 'user', text: s });
    setBusy(true);
    try {
      const r = await api.post('/assistant', { text: s, lang });
      push({ role: 'assistant', text: r.reply, drafts: r.drafts, engine: r.engine });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const speech = useSpeech(lang, (s) => send(s));
  useEffect(() => {
    if (autoMic && speech.supported) speech.start();
    if (autoMic) onMicUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMic]);

  const suggestions = ['sug1', 'sug3', 'sug4', 'sug5', 'sug6', 'sug7', 'sug2', 'sug8'] as const;

  return (
    <div className="screen assistant">
      <MemorySheet open={memoryOpen} onClose={() => setMemoryOpen(false)} />
      <div className="assistant-hero">
        <span className={`orb ${busy || speech.listening ? 'busy' : ''}`} aria-hidden />
        <div className="grow">
          <h1>{t('assistant')}</h1>
          <p className="muted small">{t('assistantHint')}</p>
        </div>
        <button className="memory-btn" onClick={() => setMemoryOpen(true)} aria-label={t('memoryTitle')}>
          <Icon name="book" size={16} /> {t('memoryOpen')}
        </button>
        {msgs.some((m) => m.role === 'user') && (
          <button className="icon-btn" onClick={clear} aria-label={t('clearChat')} title={t('clearChat')}>
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>

      <div className="chat">
        {msgs.map((m, i) => (
          <div key={m.id} className="msg-wrap">
          {/* A break this long starts a fresh context: show it, so "saat 4 olsun" is not expected to reach back. */}
          {(i === 0 ? m.past : m.at - msgs[i - 1].at > SESSION_GAP_MS) && <p className="chat-break">{when(m.at)}</p>}
          <div className={`msg ${m.role}`}>
            {m.role === 'assistant' && (
              <span className="msg-avatar">
                <Icon name="sparkle" size={16} />
              </span>
            )}
            <div className="msg-body">
              <p className="bubble">{m.text}</p>
              {!!m.drafts?.length && (m.past ? <p className="muted small">{t('draftsEarlier', { n: m.drafts.length })}</p> : <DraftList drafts={m.drafts} lists={lists} />)}
            </div>
          </div>
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            <span className="msg-avatar">
              <Icon name="sparkle" size={16} />
            </span>
            <p className="bubble typing">{t('thinking')}</p>
          </div>
        )}
        <div ref={end} />
      </div>

      {msgs.length <= 1 && (
        <div className="chips wrap suggestions">
          {suggestions.map((k) => (
            <button key={k} className="chip-btn" onClick={() => send(t(k))}>
              {t(k)}
            </button>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <button
          type="button"
          className={`icon-btn mic ${speech.listening ? 'live' : ''}`}
          disabled={!speech.supported}
          onClick={() => (speech.listening ? speech.stop() : speech.start())}
          aria-label={t('speak')}
          title={speech.supported ? t('speak') : t('voiceUnsupported')}
        >
          <Icon name="mic" />
        </button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={speech.listening ? t('listening') : t('askPlaceholder')} />
        <button className="icon-btn send" disabled={!text.trim() || busy} aria-label={t('send')}>
          <Icon name="chevR" />
        </button>
      </form>
    </div>
  );
}
