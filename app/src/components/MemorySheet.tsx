import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { Field, Icon, Segmented, Sheet } from './ui';

type Kind = 'shop' | 'money' | 'team' | 'client' | 'preference';
interface Note {
  id: string;
  user_id: string | null;
  kind: Kind;
  subject: string | null;
  text: string;
  source: 'said' | 'learned' | 'data' | 'owner';
  pinned: boolean;
  last_seen_at: string;
  expires_at: string | null;
}

const KINDS: Kind[] = ['shop', 'money', 'team', 'client', 'preference'];

/**
 * The assistant's long-term memory, in the open (core/agent/SOUL.md: "Gizli notum yoktur"):
 * every note it keeps, where it came from and how long it has left. Pin, correct, delete or add.
 */
export function MemorySheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { api, t, lang, fail, me } = useApp();
  const [notes, setNotes] = useState<Note[]>([]);
  const [markdown, setMarkdown] = useState('');
  const [view, setView] = useState<'list' | 'md'>('list');
  const [draft, setDraft] = useState<{ kind: Kind; text: string }>({ kind: 'shop', text: '' });
  const owner = me.user.role === 'owner';

  const load = () =>
    api
      .get(`/assistant/notes?lang=${lang}`)
      .then((r) => (setNotes(r.data), setMarkdown(r.markdown)))
      .catch(fail);
  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const act = (p: Promise<unknown>) => p.then(load).catch(fail);
  const daysLeft = (n: Note) => (n.expires_at ? Math.max(0, Math.round((Date.parse(n.expires_at) - Date.now()) / 86_400_000)) : null);
  const canEdit = (n: Note) => owner || n.user_id === me.user.id;

  return (
    <Sheet open={open} onClose={onClose} title={t('memoryTitle')}>
      <div className="stack">
        <p className="muted small">{t('memoryHint')}</p>
        <Segmented<'list' | 'md'> value={view} onChange={setView} options={[{ value: 'list', label: t('memoryNotes') }, { value: 'md', label: t('memoryFile') }]} />

        {view === 'md' ? (
          <pre className="memory-md">{markdown}</pre>
        ) : (
          <>
            {!notes.length && <p className="muted">{t('memoryEmpty')}</p>}
            {KINDS.map((k) => {
              const group = notes.filter((n) => n.kind === k);
              if (!group.length) return null;
              return (
                <section key={k} className="memory-group">
                  <h3>{t(`memoryKind_${k}` as any)}</h3>
                  {group.map((n) => (
                    <div key={n.id} className={`memory-note ${n.pinned ? 'pinned' : ''}`}>
                      <div className="grow">
                        <p>
                          {n.subject && <strong>{n.subject}: </strong>}
                          {n.text}
                        </p>
                        <p className="muted tiny">
                          {t(`memorySource_${n.source}` as any)} · {n.pinned ? t('memoryPinned') : t('memoryDaysLeft', { n: daysLeft(n) ?? 0 })}
                        </p>
                      </div>
                      {canEdit(n) && (
                        <>
                          <button
                            className={`icon-btn small ${n.pinned ? 'on' : ''}`}
                            aria-label={n.pinned ? t('memoryUnpin') : t('memoryPin')}
                            title={n.pinned ? t('memoryUnpin') : t('memoryPin')}
                            onClick={() => act(api.patch(`/assistant/notes/${n.id}`, { pinned: !n.pinned }))}
                          >
                            <Icon name="lock" size={16} />
                          </button>
                          <button className="icon-btn small" aria-label={t('delete')} title={t('delete')} onClick={() => act(api.del(`/assistant/notes/${n.id}`))}>
                            <Icon name="trash" size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </section>
              );
            })}

            <form
              className="memory-add stack tight"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.text.trim()) return;
                act(api.post('/assistant/notes', { kind: draft.kind, text: draft.text.trim() }).then(() => setDraft({ ...draft, text: '' })));
              }}
            >
              <Field label={t('memoryAdd')}>
                <input value={draft.text} maxLength={280} placeholder={t('memoryAddPlaceholder')} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
              </Field>
              <div className="row">
                <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })} aria-label={t('memoryKind')}>
                  {KINDS.filter((k) => k !== 'client').map((k) => (
                    <option key={k} value={k}>
                      {t(`memoryKind_${k}` as any)}
                    </option>
                  ))}
                </select>
                <button className="btn primary" disabled={!draft.text.trim()}>
                  <Icon name="plus" size={16} /> {t('memorySave')}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </Sheet>
  );
}
