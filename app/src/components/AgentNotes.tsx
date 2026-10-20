// Today › the agent's notes: what the records say this week (Röntgen findings, the cash forecast),
// computed by the server from the shop's data; nothing here is written by a model. Owner only.
import { useState } from 'react';
import { useApp, useLoad } from '../state';

const SEV: Record<string, string> = { yuksek: 'sev-high', orta: 'sev-mid', bilgi: 'sev-info' };

export function AgentNotes() {
  const { api, t, fail, bump } = useApp();
  const { data, reload } = useLoad(() => api.get<{ data: any[]; agent_name: string | null }>('/signals'), [bump]);
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;
  const notes = data.data.slice(0, 4);
  const dismiss = async (id: string) => {
    try {
      await api.post(`/signals/${id}/dismiss`);
      reload();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <section className="card agent-notes stack">
      <div className="row spread">
        <h2 className="card-title">{data.agent_name ?? t('agentNotes')}</h2>
        {data.agent_name && <span className="eyebrow">{t('agentNotes')}</span>}
      </div>
      {!notes.length && <p className="muted small">{t('agentNotesEmpty')}</p>}
      {notes.map((n) => (
        <article key={n.id} className={`agent-note ${SEV[n.severity] ?? ''}`}>
          <button className="agent-note-head" onClick={() => setOpen(open === n.id ? null : n.id)} aria-expanded={open === n.id}>
            <b>{n.title}</b>
          </button>
          <p className="small">{n.body}</p>
          {open === n.id && (
            <div className="stack tight">
              {n.advice && <p className="small agent-advice">{n.advice}</p>}
              {!!n.evidence?.length && (
                <ul className="mini-list small">
                  {n.evidence.map((e: any) => (
                    <li key={e.etiket}>
                      <span className="grow">{e.etiket}</span>
                      <span className="numeral">{e.deger}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="row">
            <button className="link-btn" onClick={() => setOpen(open === n.id ? null : n.id)}>
              {t('details')}
            </button>
            <button className="link-btn" onClick={() => dismiss(n.id)}>
              {t('dismiss')}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

/** Shown to an owner whose shop has not been through the setup wizard. */
export function SetupBanner() {
  const { t, openSetup } = useApp();
  return (
    <section className="card stack setup-banner">
      <p style={{ margin: 0 }}>{t('setupBanner')}</p>
      <button className="btn primary" onClick={openSetup}>
        {t('setupStart')}
      </button>
    </section>
  );
}
