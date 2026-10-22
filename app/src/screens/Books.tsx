import { useState } from 'react';
import { useApp, useLoad } from '../state';
import { takeNavHint } from '../nav';
import { Empty, Icon, Segmented, useSpeech } from '../components/ui';
import { DraftList } from '../components/Drafts';
import { addDays, dateLabel, todayIn , pct as percent } from '../format';

type Period = 'day' | 'week' | 'month';

export function Books() {
  const { api, t, fmt, me, lang, fail, toast } = useApp();
  const tz = me.shop.timezone;
  const [period, setPeriod] = useState<Period>('day');
  const [focus, setFocus] = useState<'income' | 'expense' | null>(() => (takeNavHint() as 'income' | 'expense' | undefined) ?? null);
  const [date, setDate] = useState(todayIn(tz));
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<any[] | null>(null);
  const [engine, setEngine] = useState<string>('');
  const summary = useLoad(() => api.get(`/books/summary?period=${period}&date=${date}`), [period, date]);
  const entries = useLoad(
    () => (summary.data ? api.get(`/books?from=${summary.data.from}&to=${summary.data.to}&page_size=200`) : Promise.resolve(null)),
    [summary.data?.from, summary.data?.to],
  );

  const parse = async (sentence: string) => {
    if (!sentence.trim()) return;
    try {
      const r = await api.post('/books/parse', { text: sentence, lang });
      setDrafts(r.drafts.map((d: any) => ({ ...d, type: 'book' })));
      setEngine(r.engine);
      setText('');
    } catch (e) {
      fail(e);
    }
  };
  const speech = useSpeech(lang, (s) => {
    setText(s);
    parse(s);
  });
  const remove = async (id: string) => {
    try {
      await api.del(`/books/${id}`);
      summary.reload();
    } catch (e) {
      fail(e);
    }
  };

  const s = summary.data;
  const step = (n: number) => setDate(period === 'day' ? addDays(date, n) : period === 'week' ? addDays(date, 7 * n) : shiftMonth(date, n));
  const maxCat = s ? Math.max(1, ...s.by_category.map((c: any) => c.total_cents)) : 1;
  const insight = s ? insightLine(s, t) : '';

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t('books')}</h1>
      </div>

      <form
        className="note-box"
        onSubmit={(e) => {
          e.preventDefault();
          parse(text);
        }}
      >
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('notePlaceholder')} />
        <div className="row spread">
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
          <button className="btn primary small" disabled={!text.trim()}>
            <Icon name="sparkle" size={16} /> {t('parse')}
          </button>
        </div>
      </form>

      {drafts && (
        <div className="card draft stack" key={drafts.map((d) => d.raw_text).join()}>
          <div className="row spread">
            <strong>{t('draftTitle')}</strong>
            <span className="chip">{t(`engine_${engine}` as any)}</span>
          </div>
          <p className="muted small">“{drafts[0]?.raw_text}”</p>
          <DraftList drafts={drafts} />
          <p className="muted small">{t('draftHint')}</p>
        </div>
      )}

      <Segmented<Period>
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'day', label: t('day') },
          { value: 'week', label: t('week') },
          { value: 'month', label: t('month') },
        ]}
      />
      <div className="date-nav slim">
        <button className="icon-btn" onClick={() => step(-1)} aria-label="previous">
          <Icon name="chevL" />
        </button>
        <span className="date-title">
          {s && (period === 'day' ? dateLabel(s.from, lang) : period === 'month' ? dateLabel(s.from, lang, { month: 'long', year: 'numeric' }) : `${dateLabel(s.from, lang, { day: 'numeric', month: 'short' })} – ${dateLabel(s.to, lang, { day: 'numeric', month: 'short' })}`)}
        </span>
        <button className="icon-btn" onClick={() => step(1)} aria-label="next">
          <Icon name="chevR" />
        </button>
      </div>

      {s && (
        <>
          {/* Each card: the number, against a fair earlier period; a tap shows only that side below. */}
          <section className="kpis">
            <button className={`kpi ${focus === 'income' ? 'on' : ''}`} onClick={() => setFocus(focus === 'income' ? null : 'income')} aria-pressed={focus === 'income'}>
              <span className="eyebrow">{t('income')}</span>
              <strong className="numeral pos">{fmt(s.income_cents)}</strong>
              <Delta pct={s.compare?.income_pct} basis={s.compare?.basis} period={period} />
            </button>
            <button className={`kpi ${focus === 'expense' ? 'on' : ''}`} onClick={() => setFocus(focus === 'expense' ? null : 'expense')} aria-pressed={focus === 'expense'}>
              <span className="eyebrow">{t('expense')}</span>
              <strong className="numeral neg">{fmt(s.expense_cents)}</strong>
              <Delta pct={s.compare?.expense_pct} basis={s.compare?.basis} period={period} lowerIsBetter />
            </button>
            <button className="kpi net" onClick={() => setFocus(null)}>
              <span className="eyebrow">{t('net')}</span>
              <strong className="numeral">{fmt(s.net_cents)}</strong>
              <Delta pct={s.compare?.net_pct} basis={s.compare?.basis} period={period} />
            </button>
          </section>
          {insight && (
            <p className="insight">
              <Icon name="sparkle" size={16} /> {insight}
            </p>
          )}
          {period !== 'day' && s.series.length > 0 && <Series series={s.series} from={s.from} to={s.to} />}
          {!!s.by_category.length && (
            <ul className="bars">
              {s.by_category.filter((c: any) => !focus || c.kind === focus).map((c: any) => (
                <li key={c.kind + c.category}>
                  {/* "Other" exists on both sides; say which. */}
                  <span className="bar-label">{c.category === 'other' ? t(c.kind === 'income' ? 'otherIncome' : 'otherExpense') : t(`cat_${c.category}` as any)}</span>
                  <span className="bar-track">
                    <span className={`bar ${c.kind}`} style={{ width: `${(c.total_cents / maxCat) * 100}%` }} />
                  </span>
                  <span className={`numeral ${c.kind === 'income' ? 'pos' : 'neg'}`}>{fmt(c.total_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h3 className="mini-title">{t('entries')}</h3>
      {entries.data?.data.length ? (
        <ul className="mini-list entries">
          {entries.data.data.filter((e: any) => !focus || e.kind === focus).map((e: any) => (
            <li key={e.id}>
              <span className={`kind-dot ${e.kind}`} />
              <span className="grow">
                <span>{e.note || t(`cat_${e.category}` as any)}</span>
                <span className="muted small">
                  {' '}
                  · {t(`cat_${e.category}` as any)}
                  {e.source === 'appointment' && ` · ${t('fromAppointment')}`}
                  {period !== 'day' && ` · ${dateLabel(e.entry_date, lang, { day: 'numeric', month: 'short' })}`}
                </span>
              </span>
              <span className={`numeral ${e.kind === 'income' ? 'pos' : 'neg'}`}>
                {e.kind === 'income' ? '+' : '−'}
                {fmt(e.amount_cents)}
              </span>
              {e.source !== 'appointment' && (
                <button className="icon-btn small" onClick={() => remove(e.id)} aria-label={t('delete')}>
                  <Icon name="trash" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        entries.data && <Empty icon="book" text={t('noEntries')} />
      )}
    </div>
  );
}

function Series({ series, from, to }: { series: { date: string; income: number; expense: number }[]; from: string; to: string }) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const by = new Map(series.map((s) => [s.date, s]));
  const max = Math.max(1, ...series.map((s) => Math.max(s.income, s.expense)));
  return (
    <div className="series" aria-hidden>
      {days.map((d) => {
        const s = by.get(d);
        return (
          <div key={d} className="series-col" title={d}>
            <span className="s-bar income" style={{ height: `${((s?.income ?? 0) / max) * 100}%` }} />
            <span className="s-bar expense" style={{ height: `${((s?.expense ?? 0) / max) * 100}%` }} />
          </div>
        );
      })}
    </div>
  );
}

function insightLine(s: any, t: any) {
  const parts: string[] = [];
  const pct = s.insight.net_change_pct;
  if (pct !== null && pct !== 0) parts.push(t(pct > 0 ? 'insightUp' : 'insightDown', { pct: Math.abs(pct) }));
  if (s.insight.top_expense_category && s.insight.top_expense_share_pct)
    parts.push(t('insightTopExpense', { pct: s.insight.top_expense_share_pct, cat: t(`cat_${s.insight.top_expense_category}`).toLocaleLowerCase() }));
  return parts.join(' ');
}

function shiftMonth(date: string, n: number) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** "+12% vs the same days last month": colour only on the change, and only where it tells good from bad. */
function Delta({ pct, basis, period, lowerIsBetter = false }: { pct?: number | null; basis?: string; period: string; lowerIsBetter?: boolean }) {
  const { t, lang } = useApp();
  if (pct === null || pct === undefined) return null;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  const label = t(basis === 'same_days' ? `vs_same_${period}` as any : `vs_prev_${period}` as any);
  return (
    <span className="delta small">
      {Math.abs(pct) < 3 ? t('aboutSame') : <span className={good ? 'pos' : 'neg'}>{pct > 0 ? '+' : '−'}{percent(Math.abs(pct), lang)}</span>} <span className="muted">{label}</span>
    </span>
  );
}
