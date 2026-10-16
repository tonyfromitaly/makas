import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { Icon, useSpeech } from '../components/ui';
import { DraftList, type Draft } from '../components/Drafts';

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  drafts?: Draft[];
  engine?: string;
}

// Kept outside the component so the conversation survives switching tabs.
let history: Msg[] = [];
let seq = 0;

export function Assistant({ autoMic, onMicUsed }: { autoMic?: boolean; onMicUsed?(): void }) {
  const { api, t, lang, fail } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>(history);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lists, setLists] = useState<{ services: any[]; barbers: any[] }>();
  const end = useRef<HTMLDivElement>(null);

  const push = (m: Omit<Msg, 'id'>) =>
    setMsgs((x) => {
      const next = [...x, { ...m, id: ++seq }];
      history = next;
      return next;
    });

  useEffect(() => {
    Promise.all([api.get('/services?page_size=200'), api.get('/barbers?page_size=200')])
      .then(([s, b]) => setLists({ services: s.data, barbers: b.data }))
      .catch(fail);
    if (!history.length)
      api
        .get(`/assistant/brief?lang=${lang}`)
        .then((r) => push({ role: 'assistant', text: r.reply }))
        .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Block body: scrollIntoView may return a promise, which must not become the effect's cleanup.
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
      <div className="screen-head">
        <h1>{t('assistant')}</h1>
      </div>
      <p className="muted small">{t('assistantHint')}</p>

      <div className="chat">
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === 'assistant' && (
              <span className="msg-avatar">
                <Icon name="sparkle" size={16} />
              </span>
            )}
            <div className="msg-body">
              <p className="bubble">{m.text}</p>
              {!!m.drafts?.length && <DraftList drafts={m.drafts} lists={lists} />}
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
