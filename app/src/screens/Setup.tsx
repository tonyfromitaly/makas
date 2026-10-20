// The setup wizard: a few questions, then the owner's whole setup written out (agent, modules,
// connections, look, install steps). Runs entirely in the browser; nothing is sent anywhere.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CALISMA, DERTLER, GIZLILIK, SABLONLAR, SISTEMLER, kurulumUret, type CalismaSekli, type Cevaplar, type Gizlilik, type KurulumDil, type SablonId } from '@makas/core';
import { SKINS, ACCENTS, applyLook, type Skin } from '../theme';

const W = {
  tr: {
    title: 'Kurulum',
    steps: ['İşletme', 'Sistemler', 'Dertler', 'Ekip', 'Gizlilik ve görünüm', 'Kurulumun'],
    business: 'İşletmenin adı',
    owner: 'Senin adın',
    kind: 'Ne iş yapıyorsun?',
    systemsQ: 'Şu an hangi sistemleri kullanıyorsun?',
    systemsHint: 'Hepsini işaretle. Bağlanamadığımız sistemin verisini dışa aktarılan dosyayla alırız.',
    suggested: 'Senin gibi işletmelerin kullandıkları',
    others: 'Diğerleri',
    method: { api: 'Doğrudan bağlantı', dosya: 'Dosya ile', foto: 'Fotoğraf ile' },
    painsQ: 'Seni en çok ne yoruyor?',
    painsHint: 'En fazla dört tane seç. Ajanın görevleri buna göre yazılır.',
    teamQ: 'Kaç kişisiniz?',
    alone: 'Yalnız çalışıyorum',
    payQ: 'Ekibin nasıl çalışıyor? (birden fazla seçebilirsin)',
    toneQ: 'Ajan seninle nasıl konuşsun?',
    tone: { samimi: 'Samimi, kısa', resmi: 'Resmî, kısa' },
    privacyQ: 'Verin nerede dursun?',
    lookQ: 'Görünüm',
    colour: 'Rengin',
    own: 'Temanın rengi',
    next: 'Devam',
    back: 'Geri',
    make: 'Kurulumu hazırla',
    again: 'Baştan başla',
    tabs: { adim: 'Kurulum adımları', soul: 'Ajanın kimliği', agent: 'Görevleri', mod: 'Modüller', bag: 'Bağlantılar' },
    on: 'Açık',
    off: 'Kapalı',
    download: 'İndir',
    notes: 'Dikkat',
    localNote: 'Bu sayfa hiçbir şeyi bir yere göndermez; kurulum bu bilgisayarda hazırlanır.',
    apply: 'Kurulumu uygula',
    applyHint: 'Modüller, görünüm ve ajan dükkânına kaydedilir. İstediğin zaman Ayarlar’dan yeniden kurabilirsin.',
    close: 'Vazgeç',
    verify: 'Bağlantı türleri ve şartlar Ekim 2026 araştırmasına dayanır; firmalar şartlarını değiştirebilir.',
  },
  en: {
    title: 'Setup',
    steps: ['Business', 'Systems', 'Problems', 'Team', 'Privacy and look', 'Your setup'],
    business: 'Business name',
    owner: 'Your name',
    kind: 'What kind of business?',
    systemsQ: 'Which systems do you use today?',
    systemsHint: 'Tick them all. Where we can’t connect directly, an exported file does the job.',
    suggested: 'Used by businesses like yours',
    others: 'Others',
    method: { api: 'Direct connection', dosya: 'By file', foto: 'By photo' },
    painsQ: 'What wears you out the most?',
    painsHint: 'Pick up to four. Your agent’s tasks are written from these.',
    teamQ: 'How many of you are there?',
    alone: 'I work alone',
    payQ: 'How does your team work? (pick any)',
    toneQ: 'How should the agent talk to you?',
    tone: { samimi: 'Friendly, brief', resmi: 'Formal, brief' },
    privacyQ: 'Where should your data live?',
    lookQ: 'Look',
    colour: 'Your colour',
    own: 'The look’s own colour',
    next: 'Next',
    back: 'Back',
    make: 'Prepare my setup',
    again: 'Start over',
    tabs: { adim: 'Install steps', soul: 'Agent identity', agent: 'Tasks', mod: 'Modules', bag: 'Connections' },
    on: 'On',
    off: 'Off',
    download: 'Download',
    notes: 'Heads-up',
    localNote: 'This page sends nothing anywhere; the setup is prepared on this computer.',
    apply: 'Apply this setup',
    applyHint: 'Modules, look and the agent are saved to your business. You can run setup again from Settings any time.',
    close: 'Cancel',
    verify: 'Connection types and conditions follow our October 2026 research; vendors may change their terms.',
  },
} as const;

type Tab = keyof (typeof W)['tr']['tabs'];

/**
 * Standalone (#kurulum) it only shows what would be set up. Inside the app (onApply) the last step
 * applies it to the shop: modules, look, and the agent's SOUL and tasks.
 */
export function Setup({ initial, onApply, onClose }: { initial?: Partial<Cevaplar>; onApply?(c: Cevaplar): Promise<void>; onClose?(): void } = {}) {
  const [dil, setDil] = useState<KurulumDil>(() => initial?.dil ?? (navigator.language?.startsWith('tr') ? 'tr' : 'en'));
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const w = W[dil];
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<Tab>('adim');
  const [c, setC] = useState<Cevaplar>({
    isletme: initial?.isletme ?? '',
    sahip: initial?.sahip ?? '',
    sablon: 'kuafor',
    dil,
    sistemler: [],
    dertler: SABLONLAR[0].dertler,
    ekip: [],
    kisi: 1,
    ton: 'samimi',
    gizlilik: 'yerel',
    tema: { skin: SABLONLAR[0].tema, accent: null },
  });
  const set = (p: Partial<Cevaplar>) => setC((x) => ({ ...x, ...p }));
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step, tab]);
  const sablon = SABLONLAR.find((s) => s.id === c.sablon)!;
  const kurulum = useMemo(() => (step === 5 ? kurulumUret({ ...c, dil }) : null), [step, c, dil]);

  const pickSablon = (id: SablonId) => {
    const s = SABLONLAR.find((x) => x.id === id)!;
    set({ sablon: id, dertler: s.dertler, tema: { skin: s.tema, accent: c.tema?.accent ?? null } });
    applyLook({ skin: s.tema as Skin, accent: c.tema?.accent ?? null });
  };
  const pickLook = (skin: string, accent: string | null) => {
    set({ tema: { skin, accent } });
    applyLook({ skin: skin as Skin, accent });
  };
  const toggle = <T,>(list: T[], x: T, max = 99) => (list.includes(x) ? list.filter((y) => y !== x) : list.length < max ? [...list, x] : list);
  const canNext = step !== 0 || c.isletme.trim().length > 0;

  return (
    <div className="app setup">
      <header className="topbar">
        <span className="brand">Usta · {w.title}</span>
        {onClose && (
          <button className="link-btn" onClick={onClose}>
            {w.close}
          </button>
        )}
        <div className="segmented small">
          {(['tr', 'en'] as const).map((l) => (
            <button key={l} className={dil === l ? 'on' : ''} onClick={() => (setDil(l), set({ dil: l }))}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      <div className="screen">
        <ol className="setup-steps" aria-label={w.title}>
          {w.steps.map((s, i) => (
            <li key={s} className={i === step ? 'now' : i < step ? 'done' : ''}>
              <span className="numeral">{i + 1}</span> {s}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="card stack">
            <label className="field">
              <span className="eyebrow">{w.business}</span>
              <input value={c.isletme} onChange={(e) => set({ isletme: e.target.value })} placeholder={dil === 'tr' ? 'Lale Kafe' : 'Corner Café'} autoFocus />
            </label>
            <label className="field">
              <span className="eyebrow">{w.owner}</span>
              <input value={c.sahip} onChange={(e) => set({ sahip: e.target.value })} />
            </label>
            <span className="eyebrow">{w.kind}</span>
            <div className="setup-grid">
              {SABLONLAR.map((s) => (
                <button key={s.id} className="setup-choice" aria-pressed={c.sablon === s.id} onClick={() => pickSablon(s.id)}>
                  <b>{s.ad[dil]}</b>
                  <span className="muted small">{s.ornek[dil]}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="card stack">
            <h2 className="card-title">{w.systemsQ}</h2>
            <p className="muted small">{w.systemsHint}</p>
            {[
              [w.suggested, SISTEMLER.filter((s) => sablon.sistemler.includes(s.id))],
              [w.others, SISTEMLER.filter((s) => !sablon.sistemler.includes(s.id))],
            ].map(([title, list]) => (
              <Fragment key={title as string}>
                <span className="eyebrow">{title as string}</span>
                <div className="setup-list">
                  {(list as typeof SISTEMLER).map((s) => (
                    <label key={s.id} className="setup-check">
                      <input type="checkbox" checked={c.sistemler.includes(s.id)} onChange={() => set({ sistemler: toggle(c.sistemler, s.id) })} />
                      <span className="grow">
                        <b>{typeof s.ad === 'string' ? s.ad : s.ad[dil]}</b>
                        <span className="muted small"> · {s.tur[dil]}</span>
                      </span>
                      <span className={`chip method-${s.yontem}`}>{w.method[s.yontem]}</span>
                    </label>
                  ))}
                </div>
              </Fragment>
            ))}
          </section>
        )}

        {step === 2 && (
          <section className="card stack">
            <h2 className="card-title">{w.painsQ}</h2>
            <p className="muted small">{w.painsHint}</p>
            <div className="setup-list">
              {DERTLER.map((d) => (
                <label key={d.id} className="setup-check">
                  <input type="checkbox" checked={c.dertler.includes(d.id)} onChange={() => set({ dertler: toggle(c.dertler, d.id, 4) })} />
                  <span className="grow">{d.ad[dil]}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="card stack">
            <h2 className="card-title">{w.teamQ}</h2>
            <div className="row">
              <input className="narrow" type="number" min={1} max={200} value={c.kisi} onChange={(e) => set({ kisi: Math.max(1, Number(e.target.value) || 1) })} aria-label={w.teamQ} />
              <span className="muted">{c.kisi === 1 ? w.alone : ''}</span>
            </div>
            {c.kisi > 1 && (
              <>
                <span className="eyebrow">{w.payQ}</span>
                <div className="setup-list">
                  {(Object.keys(CALISMA) as CalismaSekli[]).map((k) => (
                    <label key={k} className="setup-check">
                      <input type="checkbox" checked={c.ekip.includes(k)} onChange={() => set({ ekip: toggle(c.ekip, k) })} />
                      <span className="grow">{CALISMA[k][dil]}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <span className="eyebrow">{w.toneQ}</span>
            <div className="segmented">
              {(['samimi', 'resmi'] as const).map((x) => (
                <button key={x} className={c.ton === x ? 'on' : ''} onClick={() => set({ ton: x })}>
                  {w.tone[x]}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="card stack">
            <h2 className="card-title">{w.privacyQ}</h2>
            <div className="setup-list">
              {(Object.keys(GIZLILIK) as Gizlilik[]).map((g) => (
                <label key={g} className="setup-check">
                  <input type="radio" name="gizlilik" checked={c.gizlilik === g} onChange={() => set({ gizlilik: g })} />
                  <span className="grow">
                    <b>{GIZLILIK[g].ad[dil]}</b>
                    <span className="muted small" style={{ display: 'block' }}>
                      {GIZLILIK[g].ne[dil]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <span className="eyebrow">{w.lookQ}</span>
            <div className="skins">
              {SKINS.filter((s) => s.id !== 'auto').map((s) => (
                <button key={s.id} className="skin" aria-pressed={c.tema?.skin === s.id} onClick={() => pickLook(s.id, c.tema?.accent ?? null)}>
                  <span className="skin-art" style={{ background: s.swatch[3] }} aria-hidden>
                    <i style={{ left: 8, right: 8, top: 8, bottom: 0, background: s.swatch[0] }} />
                    <i style={{ left: 16, top: 16, width: 34, height: 6, background: s.swatch[1] }} />
                    <i style={{ left: 16, top: 30, width: 24, height: 10, background: s.swatch[2] }} />
                  </span>
                  <span className="skin-name">{s.id}</span>
                </button>
              ))}
            </div>
            <span className="eyebrow">{w.colour}</span>
            <div className="accents">
              <button className="accent own" aria-pressed={!c.tema?.accent} onClick={() => pickLook(c.tema!.skin, null)} aria-label={w.own} />
              {ACCENTS.map((a) => (
                <button key={a.id} className="accent" style={{ background: a.light }} aria-pressed={c.tema?.accent === a.id} onClick={() => pickLook(c.tema!.skin, a.id)} aria-label={a.id} />
              ))}
            </div>
          </section>
        )}

        {step === 5 && kurulum && (
          <>
            <section className="card stack">
              <span className="eyebrow">{SABLONLAR.find((s) => s.id === c.sablon)!.ad[dil]}</span>
              <h2 className="card-title">{kurulum.ajanAdi}</h2>
              <p className="muted small">{onApply ? w.applyHint : w.localNote}</p>
              {onApply && (
                <button
                  className="btn primary"
                  disabled={applying}
                  onClick={async () => {
                    setApplying(true);
                    setApplyError('');
                    try {
                      await onApply({ ...c, dil });
                    } catch (e: any) {
                      setApplyError(e?.message ?? String(e));
                    } finally {
                      setApplying(false);
                    }
                  }}
                >
                  {w.apply}
                </button>
              )}
              {applyError && <p className="small neg">{applyError}</p>}
              {kurulum.uyarilar.length > 0 && (
                <div className="subcard stack">
                  <span className="eyebrow">{w.notes}</span>
                  {kurulum.uyarilar.map((u) => (
                    <p key={u} className="small" style={{ margin: 0 }}>
                      {u}
                    </p>
                  ))}
                </div>
              )}
            </section>
            <div className="segmented setup-tabs">
              {(Object.keys(w.tabs) as Tab[]).map((k) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {w.tabs[k]}
                </button>
              ))}
            </div>
            <section className="card stack">
              {tab === 'adim' && (
                <ol className="setup-install">
                  {kurulum.adimlar.map((a) => (
                    <li key={a.baslik}>
                      <b>{a.baslik}</b>
                      <span className="muted small">{a.detay}</span>
                    </li>
                  ))}
                </ol>
              )}
              {tab === 'soul' && <Md text={kurulum.soulMd} file="SOUL.md" label={w.download} />}
              {tab === 'agent' && <Md text={kurulum.agentMd} file="AGENT.md" label={w.download} />}
              {tab === 'mod' && (
                <ul className="mini-list">
                  {kurulum.moduller.map((m) => (
                    <li key={m.id} className={m.acik ? '' : 'inactive'}>
                      <span className="grow">
                        <b>{m.ad}</b> <span className="muted small">· {m.neden}</span>
                      </span>
                      <span className={`chip ${m.acik ? 'sub-active' : ''}`}>{m.acik ? w.on : w.off}</span>
                    </li>
                  ))}
                </ul>
              )}
              {tab === 'bag' && (
                <div className="stack">
                  {kurulum.baglantilar.map((b) => (
                    <div key={b.id} className="subcard stack">
                      <div className="row spread">
                        <b>{b.ad}</b>
                        <span className={`chip method-${b.yontem}`}>{w.method[b.yontem]}</span>
                      </div>
                      <span className="muted small">{b.veri}</span>
                      {b.kosul && <p className="small setup-kosul">{b.kosul}</p>}
                      <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                        {b.adimlar.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                  <p className="muted small">{w.verify}</p>
                </div>
              )}
            </section>
          </>
        )}

        <div className="row spread setup-nav">
          {step > 0 ? (
            <button className="btn" onClick={() => setStep(step === 5 ? 0 : step - 1)}>
              {step === 5 ? w.again : w.back}
            </button>
          ) : (
            <span />
          )}
          {step < 5 && (
            <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
              {step === 4 ? w.make : w.next}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Just enough Markdown for the agent files: headings, lists, tables, quotes, bold. */
function Md({ text, file, label }: { text: string; file: string; label: string }) {
  const save = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    a.click();
    URL.revokeObjectURL(url);
  };
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('# ')) out.push(<h3 key={i} className="md-h1">{l.slice(2)}</h3>);
    else if (l.startsWith('## ')) out.push(<span key={i} className="eyebrow md-h2">{l.slice(3)}</span>);
    else if (l.startsWith('> ')) out.push(<p key={i} className="muted small">{l.slice(2)}</p>);
    else if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!/^\|\s*-/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map((x) => x.trim()));
        i++;
      }
      i--;
      out.push(
        <table key={i} className="md-table">
          <thead>
            <tr>{rows[0].map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(1).map((r, j) => (
              <tr key={j}>{r.map((x, k) => <td key={k}>{inline(x)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
    } else if (/^(- |\d+\. )/.test(l)) out.push(<p key={i} className="md-li">{inline(l.replace(/^- /, '• '))}</p>);
    else if (l.trim()) out.push(<p key={i} className="md-p">{inline(l)}</p>);
  }
  return (
    <div className="md stack">
      <div className="row spread">
        <span className="numeral small">{file}</span>
        <button className="btn small" onClick={save}>
          {label}
        </button>
      </div>
      {out}
    </div>
  );
}
