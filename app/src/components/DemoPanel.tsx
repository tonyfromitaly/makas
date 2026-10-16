import { useState } from 'react';
import { useApp } from '../state';
import { DEMO_KEYS, resetDemo } from '../demo';
import { Icon, Sheet } from './ui';

/** Lets a reviewer play the other two layers: Tony's message worker and our operator desk. */
export function DemoPanel() {
  const { api, t, me, reloadMe, refreshAll, fail } = useApp();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState<any[] | null>(null);
  const [feedback, setFeedback] = useState<any[] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 6));

  const pull = async () => {
    const until = new Date(Date.now() + 48 * 3600_000).toISOString();
    const r = await api.raw('GET', `/reminders/due?until=${encodeURIComponent(until)}`, DEMO_KEYS.service);
    setDue(r.body?.data ?? []);
    note(`GET /reminders/due → ${r.status} (${r.body?.data?.length ?? 0})`);
  };
  const result = async (id: string, status: 'sent' | 'failed') => {
    const r = await api.raw('POST', `/reminders/${id}/result`, DEMO_KEYS.service, status === 'sent' ? { status, provider_ref: `wamid.demo.${id.slice(0, 6)}` } : { status, error: 'demo failure' });
    note(`POST /reminders/:id/result ${status} → ${r.status}`);
    setDue((d) => d?.filter((x) => x.id !== id) ?? null);
    refreshAll();
  };
  const stop = async (id: string) => {
    const r = await api.raw('POST', '/reminders/optout', DEMO_KEYS.service, { reminder_id: id });
    note(`POST /reminders/optout → ${r.status}`);
    setDue((d) => d?.filter((x) => x.id !== id) ?? null);
    refreshAll();
  };
  const toggleSub = async () => {
    const active = !me.locked;
    const r = await api.raw('PATCH', `/admin/shops/${me.shop.id}/subscription`, DEMO_KEYS.admin, { status: active ? 'past_due' : 'trial' });
    note(`PATCH /admin/shops/:id/subscription → ${r.status}`);
    try {
      await reloadMe();
    } catch (e) {
      fail(e);
    }
    setOpen(false);
  };
  const readFeedback = async () => {
    const r = await api.raw('GET', '/admin/feedback', DEMO_KEYS.admin);
    setFeedback(r.body?.data ?? []);
  };

  return (
    <>
      <button className="demo-pill" onClick={() => setOpen(true)}>
        <Icon name="beaker" size={16} /> {t('demoBadge')}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('demoTitle')}>
        <div className="stack">
          <p className="muted small">{t('demoIntro')}</p>

          <section className="subcard stack">
            <h3 className="mini-title">
              <Icon name="chat" size={16} /> {t('tonySim')}
            </h3>
            <p className="muted small">{t('tonyIntro')}</p>
            <button className="btn" onClick={pull}>
              {t('pullDue')}
            </button>
            {due && !due.length && <p className="muted small">{t('queueEmpty')}</p>}
            {due?.map((m) => (
              <div key={m.id} className="wa-bubble">
                <div className="wa-meta">
                  {m.channel} · {m.to} · {m.template_key}
                </div>
                <pre>{m.message}</pre>
                <div className="row">
                  <button className="btn small ok" onClick={() => result(m.id, 'sent')}>
                    {t('markSent')}
                  </button>
                  <button className="btn small" onClick={() => result(m.id, 'failed')}>
                    {t('markFailed')}
                  </button>
                  <button className="btn small danger-ghost" onClick={() => stop(m.id)}>
                    {t('replyStop')}
                  </button>
                </div>
              </div>
            ))}
            {!!log.length && <pre className="log">{log.join('\n')}</pre>}
          </section>

          <section className="subcard stack">
            <h3 className="mini-title">
              <Icon name="gear" size={16} /> {t('operator')}
            </h3>
            <button className="btn" onClick={toggleSub}>
              <Icon name="lock" size={16} /> {me.locked ? t('unlockShop') : t('lockShop')}
            </button>
            <button className="btn" onClick={readFeedback}>
              {t('readFeedback')}
            </button>
            {feedback?.map((f) => (
              <p key={f.id} className="small">
                <strong>{f.shop_name}:</strong> {f.message}
              </p>
            ))}
          </section>
          <button className="btn danger-ghost" onClick={resetDemo}>
            {t('resetDemo')}
          </button>
        </div>
      </Sheet>
    </>
  );
}
