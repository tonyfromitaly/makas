import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { Icon } from './ui';

interface Msg {
  id: string;
  author: 'shop' | 'operator';
  message: string;
  created_at: string;
}

const POLL_MS = 5000;

/** "Bize yaz": the shop's live thread with the Monacount team. Polls while open, so replies land within seconds. */
export function SupportChat() {
  const { api, t, lang, fail, markSupportRead } = useApp();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = async () => {
    try {
      const r = await api.get<{ data: Msg[] }>('/support');
      setMsgs(r.data);
      // Opening the thread reads our replies; clear the badge on the Settings tab.
      markSupportRead();
    } catch (e) {
      fail(e);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Keep the newest message in view inside the card (not the page).
    if (msgs && msgs.length !== lastCount.current && box.current) box.current.scrollTop = box.current.scrollHeight;
    lastCount.current = msgs?.length ?? 0;
  }, [msgs]);

  const send = async () => {
    const m = text.trim();
    if (!m) return;
    setBusy(true);
    try {
      await api.post('/support', { message: m });
      setText('');
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const time = (iso: string) => new Date(iso).toLocaleString(lang === 'tr' ? 'tr-TR' : lang === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const waitingReply = !!msgs?.length && msgs[msgs.length - 1].author === 'shop';

  return (
    <section className="card stack support">
      <div className="row spread">
        <h2 className="card-title">{t('feedback')}</h2>
        <span className="live-dot">
          <span /> {t('live')}
        </span>
      </div>
      <div className="support-thread" ref={box}>
        {msgs && !msgs.length && <p className="muted small">{t('supportEmpty')}</p>}
        {msgs?.map((m) => (
          <div key={m.id} className={`sup ${m.author}`}>
            <span className="sup-who">{m.author === 'operator' ? t('team') : t('you')} · {time(m.created_at)}</span>
            <p>{m.message}</p>
          </div>
        ))}
        {waitingReply && <p className="muted small center">{t('supportEta')}</p>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('feedbackPlaceholder')} />
        <button className="btn primary" disabled={!text.trim() || busy} aria-label={t('send')}>
          <Icon name="chevR" />
        </button>
      </form>
    </section>
  );
}
