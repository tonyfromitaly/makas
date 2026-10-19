// Settings › Connections: Square today. Connect sends the owner to Square; Square sends them back to the
// app with ?code&state, which this card finishes on its own. Then: sync now, open the X-ray, disconnect.
import { useEffect, useRef, useState } from 'react';
import { useApp, useLoad } from '../state';
import { dateLabel } from '../format';

export function Connections() {
  const { api, t, fail, toast, lang } = useApp();
  const { data, reload } = useLoad(() => api.get('/connections'), []);
  const [busy, setBusy] = useState(false);
  const finishing = useRef(false);
  const sq = data?.data?.find((c: any) => c.provider === 'square');

  // Back from Square: finish once, then clean the address bar.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const code = q.get('code');
    const state = q.get('state');
    if (!state || finishing.current) return;
    finishing.current = true;
    history.replaceState(null, '', location.pathname + location.hash);
    if (!code) return toast(t('squareDenied'));
    setBusy(true);
    api
      .post('/connections/square/finish', { code, state })
      .then((r: any) => toast(t('squareSynced').replace('{n}', String(r.sync.kayit))))
      .catch(fail)
      .finally(() => (setBusy(false), reload()));
  }, []);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      reload();
    }
  };
  const connect = () => run(async () => void (location.href = (await api.post<{ url: string }>('/connections/square/start')).url));
  const sync = () => run(async () => toast(t('squareSynced').replace('{n}', String((await api.post<any>('/connections/square/sync')).sync.kayit))));
  const disconnect = () => run(async () => void (await api.del('/connections/square?data=keep')));
  const xray = () =>
    run(async () => {
      const r = await api.get<{ html?: string; reason?: string }>('/rontgen?format=html');
      if (!r.html) return toast(t('xrayNoData'));
      const url = URL.createObjectURL(new Blob([r.html], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });

  if (!data) return null;
  const on = sq && sq.status !== 'disconnected';
  return (
    <section className="card stack">
      <h2 className="card-title">{t('connections')}</h2>
      <p className="muted small">{t('connectionsHint')}</p>
      <div className="row spread">
        <b>Square</b>
        <span className={`chip ${on && sq.status === 'connected' ? 'sub-active' : ''}`}>{on ? t(`conn_${sq.status}` as any) : t('conn_off')}</span>
      </div>
      {on && (
        <p className="muted small">
          {sq.last_sync_at ? `${t('lastSync')}: ${dateLabel(sq.last_sync_at.slice(0, 10), lang, { day: 'numeric', month: 'long' })} · ${sq.rows} ${t('rowsRead')}` : t('notSyncedYet')}
          {sq.last_error ? ` · ${sq.last_error}` : ''}
        </p>
      )}
      {!data.available.square ? (
        <p className="muted small">{t('squareUnavailable')}</p>
      ) : on && sq.status !== 'needs_reconnect' ? (
        <div className="row wrap">
          <button className="btn" disabled={busy} onClick={sync}>
            {t('syncNow')}
          </button>
          <button className="btn danger-ghost" disabled={busy} onClick={disconnect}>
            {t('disconnect')}
          </button>
        </div>
      ) : (
        <button className="btn primary" disabled={busy} onClick={connect}>
          {t('connectSquare')}
        </button>
      )}
      <button className="btn" disabled={busy} onClick={xray}>
        {t('openXray')}
      </button>
    </section>
  );
}
