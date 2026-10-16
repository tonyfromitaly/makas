import { useEffect, useState } from 'react';
import type { Client } from '../api';
import type { T } from '../i18n';
import { Icon } from '../components/ui';

const KEY = 'fade.adminKey';

/**
 * Our side of "Bize yaz" (#operator): every shop's thread, newest and unanswered first, and a reply box.
 * Uses the admin key, never a shop login. In the live demo the key is provided automatically.
 */
export function Operator({ api, t, demoKey, onClose }: { api: Client; t: T; demoKey?: string; onClose(): void }) {
  const [key, setKey] = useState(() => demoKey ?? sessionStorage.getItem(KEY) ?? '');
  const [draftKey, setDraftKey] = useState('');
  const [threads, setThreads] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<any | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const loadThreads = async () => {
    const r = await api.raw('GET', '/admin/support', key);
    if (r.status === 401) return setError('401'), setKey('');
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
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            sessionStorage.setItem(KEY, draftKey);
            setError('');
            setKey(draftKey);
          }}
        >
          <input type="password" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder={t('adminKey')} autoFocus />
          {error && <p className="notice warn small">ADMIN_API_KEY ✕</p>}
          <button className="btn primary">{t('openOperator')}</button>
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
        <button className="icon-btn" onClick={onClose} aria-label="close"><Icon name="x" /></button>
      </header>

      {!open && (
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
