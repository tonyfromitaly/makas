import { useState } from 'react';
import { CATEGORIES } from '@makas/core';
import { useApp, useLoad } from '../state';
import { Empty, Field, Icon, Segmented, useSpeech } from '../components/ui';
import { addDays, dateLabel, todayIn, toCents } from '../format';

type Period = 'day' | 'week' | 'month';

export function Books() {
  const { api, t, fmt, me, lang, fail, toast } = useApp();
  const tz = me.shop.timezone;
  const [period, setPeriod] = useState<Period>('day');
  const [date, setDate] = useState(todayIn(tz));
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<any>(null);
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
      setDraft({ ...r.draft, amount: String(r.draft.amount_cents / 100) });
      setEngine(r.engine);
    } catch (e) {
      fail(e);
    }
  };
  const speech = useSpeech(lang, (s) => {
    setText(s);
    parse(s);
  });
  const save = async () => {
    try {
      await api.post('/books', {
        kind: draft.kind,
        category: draft.category,
        amount_cents: toCents(draft.amount),
        entry_date: draft.entry_date,
        note: draft.note,
        raw_text: draft.raw_text,
        source: 'ai_note',
      });
      setDraft(null);
      setText('');
      toast(t('saved'));
      summary.reload();
    } catch (e) {
      fail(e);
    }
  };
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

      {draft && (
        <div className="card draft stack">
          <div className="row spread">
            <strong>{t('draftTitle')}</strong>
            <span className="chip">{t(`engine_${engine}` as any)}</span>
          </div>
          <p className="muted small">“{draft.raw_text}”</p>
          <Segmented
            value={draft.kind}
            onChange={(k) => setDraft({ ...draft, kind: k })}
            options={[
              { value: 'income', label: t('income') },
              { value: 'expense', label: t('expense') },
            ]}
          />
          <div className="row two">
            <Field label={t('amount')}>
              <input inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </Field>
            <Field label={t('date')}>
              <input type="date" value={draft.entry_date} onChange={(e) => setDraft({ ...draft, entry_date: e.target.value })} />
            </Field>
          </div>
          <Field label={t('category')}>
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`cat_${c}` as any)}
                </option>
              ))}
            </select>
          </Field>
          <p className="muted small">{t('draftHint')}</p>
          <div className="row">
            <button className="btn" onClick={() => setDraft(null)}>
              {t('cancel')}
            </button>
            <button className="btn primary grow" onClick={save} disabled={!toCents(draft.amount)}>
              <Icon name="check" /> {t('confirm')} · {fmt(toCents(draft.amount))}
            </button>
          </div>
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
          <section className="kpis">
            <div className="kpi">
              <span className="eyebrow">{t('income')}</span>
              <strong className="numeral pos">{fmt(s.income_cents)}</strong>
            </div>
            <div className="kpi">
              <span className="eyebrow">{t('expense')}</span>
              <strong className="numeral neg">{fmt(s.expense_cents)}</strong>
            </div>
            <div className="kpi net">
              <span className="eyebrow">{t('net')}</span>
              <strong className="numeral">{fmt(s.net_cents)}</strong>
            </div>
          </section>
          {insight && (
            <p className="insight">
              <Icon name="sparkle" size={16} /> {insight}
            </p>
          )}
          {period !== 'day' && s.series.length > 0 && <Series series={s.series} from={s.from} to={s.to} />}
          {!!s.by_category.length && (
            <ul className="bars">
              {s.by_category.map((c: any) => (
                <li key={c.kind + c.category}>
                  <span className="bar-label">{t(`cat_${c.category}` as any)}</span>
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
          {entries.data.data.map((e: any) => (
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
