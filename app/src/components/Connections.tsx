// Settings › Connections: Square today. Connect sends the owner to Square; Square sends them back to the
// app with ?code&state, which this card finishes on its own. Then: sync now, open the X-ray, disconnect.
import { useEffect, useRef, useState } from 'react';
import { useApp, useLoad } from '../state';
import { dateLabel } from '../format';

declare global {
  interface Window {
    Plaid?: { create(o: { token: string; onSuccess(publicToken: string): void; onExit?(err: unknown): void }): { open(): void } };
  }
}

/** Plaid Link must load from Plaid's CDN (their rule); it is fetched only when the owner connects a bank. */
function plaidScript() {
  return new Promise<void>((ok, fail) => {
    if (window.Plaid) return ok();
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = () => ok();
    s.onerror = () => fail(new Error('Plaid could not be loaded'));
    document.head.appendChild(s);
  });
}

export function Connections() {
  const { api, t, fail, toast, lang } = useApp();
  const { data, reload } = useLoad(() => api.get('/connections'), []);
  const [busy, setBusy] = useState(false);
  const finishing = useRef(false);
  const sq = data?.data?.find((c: any) => c.provider === 'square');
  const bank = data?.data?.find((c: any) => c.provider === 'plaid');
  const bankOn = bank && bank.status !== 'disconnected';

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
      .then((r: any) => toast(t('squareSynced', { n: String(r.sync.kayit) })))
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
  const sync = () => run(async () => toast(t('squareSynced', { n: String((await api.post<any>('/connections/square/sync')).sync.kayit) })));
  const disconnect = () => run(async () => void (await api.del('/connections/square?data=keep')));
  const bankDone = (r: any) => toast(t('bankSynced', { n: String(r.sync.kayit) }));
  const connectBank = () =>
    run(async () => {
      const { link_token } = await api.post<{ link_token: string }>('/connections/plaid/link-token');
      await plaidScript();
      await new Promise<void>((resolve) =>
        window.Plaid!.create({
          token: link_token,
          onSuccess: (public_token) => {
            api.post('/connections/plaid/finish', { public_token }).then(bankDone).catch(fail).finally(() => (resolve(), reload()));
          },
          onExit: () => resolve(),
        }).open(),
      );
    });
  const sandboxBank = () => run(async () => bankDone(await api.post('/connections/plaid/sandbox')));
  const syncBank = () => run(async () => bankDone(await api.post('/connections/plaid/sync')));
  const disconnectBank = () => run(async () => void (await api.del('/connections/plaid?data=keep')));
  const xray = () =>
    run(async () => {
      const r = await api.get<{ html?: string; reason?: string }>(`/rontgen?format=html&lang=${lang}`);
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
        <span className={`chip ${on && sq.status !== 'connected' ? 'attention' : ''}`}>{on ? t(`conn_${sq.status}` as any) : t('conn_off')}</span>
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
      <div className="row spread">
        <b>{t('bank')}</b>
        <span className={`chip ${bankOn && bank.status !== 'connected' ? 'attention' : ''}`}>{bankOn ? t(`conn_${bank.status}` as any) : t('conn_off')}</span>
      </div>
      {bankOn && (
        <p className="muted small">
          {bank.balance ? `${t('balance')}: ${bank.balance.para} ${Number(bank.balance.tutar).toLocaleString(undefined, { maximumFractionDigits: 2 })} · ` : ''}
          {bank.last_sync_at ? `${t('lastSync')}: ${dateLabel(bank.last_sync_at.slice(0, 10), lang, { day: 'numeric', month: 'long' })} · ${bank.rows} ${t('rowsRead')}` : t('notSyncedYet')}
          {bank.last_error ? ` · ${bank.last_error}` : ''}
        </p>
      )}
      {!data.available.plaid ? (
        <p className="muted small">{t('bankUnavailable')}</p>
      ) : bankOn && bank.status !== 'needs_reconnect' ? (
        <div className="row wrap">
          <button className="btn" disabled={busy} onClick={syncBank}>
            {t('syncNow')}
          </button>
          <button className="btn danger-ghost" disabled={busy} onClick={disconnectBank}>
            {t('disconnect')}
          </button>
        </div>
      ) : (
        <div className="row wrap">
          <button className="btn primary" disabled={busy} onClick={connectBank}>
            {t('connectBank')}
          </button>
          {data.available.plaidSandbox && (
            <button className="btn" disabled={busy} onClick={sandboxBank}>
              {t('sandboxBank')}
            </button>
          )}
        </div>
      )}
      <button className="btn" disabled={busy} onClick={xray}>
        {t('openXray')}
      </button>
    </section>
  );
}
