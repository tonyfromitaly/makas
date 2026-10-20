import { useMemo, useState } from 'react';
import { useApp, useLoad } from '../state';
import { addDays, dateLabel, timeIn, toCents, todayIn } from '../format';
import { Empty, Icon, Segmented, Sheet } from '../components/ui';

// The till. The owner rings up anyone's sale, sees each person's settlement slip and the day's receipts.
// A team member rings up their own sales and sees what they sold, their tips and their share.

type Period = 'day' | 'week' | 'month';
type Method = 'cash' | 'card' | 'other';

export interface Line {
  key: string;
  kind: 'service' | 'product' | 'other';
  ref_id: string | null;
  name: string;
  unit_cents: number;
  qty: number;
}

export function Till() {
  const { me, t } = useApp();
  const owner = me.user.role === 'owner';
  const [view, setView] = useState<'pos' | 'team' | 'sales' | 'mine'>(owner ? 'pos' : 'mine');
  return (
    <div className="screen till">
      <div className="screen-head">
        <h1>{t('till')}</h1>
      </div>
      <Segmented
        value={view}
        onChange={(v) => setView(v as typeof view)}
        options={
          owner
            ? [
                { value: 'pos', label: t('tillRingUp') },
                { value: 'team', label: t('tillTeam') },
                { value: 'sales', label: t('tillReceipts') },
              ]
            : [
                { value: 'mine', label: t('tillMine') },
                { value: 'pos', label: t('tillRingUp') },
                { value: 'sales', label: t('tillMyReceipts') },
              ]
        }
      />
      {view === 'pos' && <Register />}
      {view === 'team' && <TeamSlips />}
      {view === 'sales' && <Receipts />}
      {view === 'mine' && <MySlip onRingUp={() => setView('pos')} />}
    </div>
  );
}

/**
 * Ringing up a sale. Tap services and products, they print onto the receipt; a tip, how it was paid,
 * and "take payment" stamps it. With an appointment it is that visit's checkout.
 */
export function Register({ appointment, onDone }: { appointment?: any; onDone?(): void }) {
  const { api, me, t, fmt, fail, toast, refreshAll } = useApp();
  const owner = me.user.role === 'owner';
  const { data: services } = useLoad(() => api.get('/services?page_size=200'), []);
  const { data: products } = useLoad(() => api.get('/products'), []);
  const { data: team } = useLoad(() => (owner ? api.get('/barbers') : Promise.resolve({ data: [] })), [owner]);
  const [staff, setStaff] = useState<string | null>(appointment?.barber_id ?? me.staff?.id ?? null);
  const [lines, setLines] = useState<Line[]>(() =>
    appointment
      ? [{ key: 'visit', kind: 'service', ref_id: appointment.service_id, name: appointment.service_name, unit_cents: appointment.price_cents_snapshot, qty: 1 }]
      : [],
  );
  const [tip, setTip] = useState(0);
  const [tipText, setTipText] = useState('');
  const [method, setMethod] = useState<Method>('card');
  const [other, setOther] = useState<{ name: string; amount: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stamped, setStamped] = useState<any>(null);

  const people = team?.data ?? [];
  const who = staff ?? people[0]?.id ?? null;
  const subtotal = lines.reduce((s, l) => s + l.unit_cents * l.qty, 0);
  const total = subtotal + tip;

  const add = (kind: Line['kind'], item: { id: string; name: string; price_cents: number }) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.ref_id === item.id && l.kind === kind && l.key !== 'visit');
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key: `${kind}-${item.id}-${ls.length}`, kind, ref_id: item.id, name: item.name, unit_cents: item.price_cents, qty: 1 }];
    });
  const bump = (key: string, d: number) => setLines((ls) => ls.flatMap((l) => (l.key !== key ? [l] : l.qty + d <= 0 ? (l.key === 'visit' ? [l] : []) : [{ ...l, qty: l.qty + d }])));
  const setPrice = (key: string, cents: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, unit_cents: cents } : l)));
  const tipPct = (p: number) => {
    const c = Math.round((subtotal * p) / 100 / 100) * 100; // round to whole units
    setTip(c);
    setTipText('');
  };

  const charge = async () => {
    if (!lines.length || busy) return;
    setBusy(true);
    try {
      const body = {
        ...(appointment ? { appointment_id: appointment.id } : { staff_id: owner ? who : undefined }),
        method,
        tip_cents: tip,
        lines: lines.map((l) => ({ kind: l.kind, ref_id: l.ref_id, name: l.name, unit_cents: l.unit_cents, qty: l.qty })),
      };
      const sale = await api.post('/sales', body);
      setStamped(sale);
      toast(t('tillPaid', { amount: fmt(sale.total_cents) }));
      // A visit's checkout reloads its own day; a counter sale refreshes the rest of the app.
      if (!appointment) refreshAll();
      setTimeout(() => {
        setStamped(null);
        if (onDone) onDone();
        else {
          setLines([]);
          setTip(0);
          setTipText('');
        }
      }, 1600);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const svc = (services?.data ?? []).filter((s: any) => s.active);
  const prod = (products?.data ?? []).filter((p: any) => p.active);

  return (
    <div className={`register ${appointment ? 'checkout' : ''}`}>
      {owner && !appointment && people.length > 1 && (
        <div className="who-row" role="radiogroup" aria-label={t('tillWho')}>
          <span className="eyebrow">{t('tillWho')}</span>
          <div className="chips">
            {people.map((p: any) => (
              <button key={p.id} className={`chip-btn ${who === p.id ? 'on' : ''}`} role="radio" aria-checked={who === p.id} onClick={() => setStaff(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="register-grid">
        <div className="shelf">
          {!!svc.length && (
            <>
              <span className="eyebrow">{t('services')}</span>
              <div className="tiles">
                {svc.map((s: any) => (
                  <button key={s.id} className="tile" onClick={() => add('service', s)}>
                    <span className="tile-name">{s.name}</span>
                    <span className="numeral">{fmt(s.price_cents)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {!!prod.length && (
            <>
              <span className="eyebrow">{t('products')}</span>
              <div className="tiles">
                {prod.map((p: any) => (
                  <button key={p.id} className="tile product" onClick={() => add('product', p)} disabled={p.stock === 0}>
                    <span className="tile-name">{p.name}</span>
                    <span className="numeral">{fmt(p.price_cents)}</span>
                    {p.stock !== null && <span className="tile-stock">{t('inStock', { n: p.stock })}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          {other ? (
            <div className="row other-line">
              <input value={other.name} onChange={(e) => setOther({ ...other, name: e.target.value })} placeholder={t('tillOtherName')} autoFocus />
              <input className="narrow" inputMode="decimal" value={other.amount} onChange={(e) => setOther({ ...other, amount: e.target.value })} placeholder={t('price')} />
              <button
                className="btn"
                disabled={!other.name.trim() || !toCents(other.amount)}
                onClick={() => {
                  setLines((ls) => [...ls, { key: `other-${ls.length}-${Date.now()}`, kind: 'other', ref_id: null, name: other.name.trim(), unit_cents: toCents(other.amount), qty: 1 }]);
                  setOther(null);
                }}
                aria-label={t('add')}
              >
                <Icon name="plus" />
              </button>
            </div>
          ) : (
            <button className="link-btn" onClick={() => setOther({ name: '', amount: '' })}>
              + {t('tillOther')}
            </button>
          )}
        </div>

        <section className={`receipt ticket ${stamped ? 'is-paid' : ''}`} aria-live="polite">
          <header className="receipt-head">
            <strong>{appointment ? t('tillCheckout') : t('tillTicket')}</strong>
            <span>
              {appointment ? appointment.client_name : people.find((p: any) => p.id === who)?.name ?? me.staff?.name ?? me.user.name}
            </span>
          </header>
          <hr className="rule" />
          {!lines.length ? (
            <p className="muted small ticket-empty">{t('tillEmpty')}</p>
          ) : (
            <ol className="ticket-lines">
              {lines.map((l) => (
                <li key={l.key}>
                  <span className="qty">
                    <button className="qty-btn" onClick={() => bump(l.key, -1)} aria-label={t('less')}>
                      −
                    </button>
                    <span className="numeral">{l.qty}</span>
                    <button className="qty-btn" onClick={() => bump(l.key, 1)} aria-label={t('more')}>
                      +
                    </button>
                  </span>
                  <span className="grow ticket-name">{l.name}</span>
                  {l.key === 'visit' ? (
                    <PriceEdit cents={l.unit_cents} onChange={(c) => setPrice(l.key, c)} />
                  ) : (
                    <span className="numeral">{fmt(l.unit_cents * l.qty)}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <hr className="rule" />
          <div className="ledger-line">
            <span>{t('subtotal')}</span>
            <span className="leader" />
            <span className="numeral">{fmt(subtotal)}</span>
          </div>
          <div className="tip-row">
            <span>{t('tip')}</span>
            <div className="chips">
              {[0, 10, 15, 20].map((p) => (
                <button key={p} className={`chip-btn ${p === 0 ? (tip === 0 ? 'on' : '') : tip && tip === Math.round((subtotal * p) / 100 / 100) * 100 && !tipText ? 'on' : ''}`} onClick={() => tipPct(p)}>
                  {p === 0 ? t('none') : `%${p}`}
                </button>
              ))}
              <input
                className="narrow tip-input"
                inputMode="decimal"
                value={tipText}
                placeholder={t('other')}
                aria-label={t('tip')}
                onChange={(e) => {
                  setTipText(e.target.value);
                  setTip(e.target.value.trim() ? toCents(e.target.value) : 0);
                }}
              />
            </div>
          </div>
          {tip > 0 && (
            <div className="ledger-line">
              <span>{t('tip')}</span>
              <span className="leader" />
              <span className="numeral">{fmt(tip)}</span>
            </div>
          )}
          <div className="till-line">
            <span className="eyebrow">{t('total')}</span>
            <strong className="numeral big">{fmt(total)}</strong>
          </div>
          <Segmented
            value={method}
            onChange={(v) => setMethod(v as Method)}
            options={[
              { value: 'card', label: t('payCard') },
              { value: 'cash', label: t('payCash') },
              { value: 'other', label: t('payOther') },
            ]}
          />
          <button className="btn primary charge" disabled={!lines.length || busy || !!stamped} onClick={charge}>
            <Icon name="check" /> {t('takePayment')} · <span className="numeral">{fmt(total)}</span>
          </button>
          {stamped && <span className="stamp paid-stamp">{t('paidStamp')}</span>}
        </section>
      </div>
    </div>
  );
}

function PriceEdit({ cents, onChange }: { cents: number; onChange(c: number): void }) {
  const { fmt, t } = useApp();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState('');
  if (!edit)
    return (
      <button className="link-btn numeral" onClick={() => (setV(String(cents / 100)), setEdit(true))} title={t('changePrice')}>
        {fmt(cents)}
      </button>
    );
  return (
    <input
      className="narrow"
      inputMode="decimal"
      autoFocus
      value={v}
      aria-label={t('price')}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const c = toCents(v);
        if (c || v.trim() === '0') onChange(c);
        setEdit(false);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function PeriodPick({ value, onChange }: { value: Period; onChange(p: Period): void }) {
  const { t } = useApp();
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { value: 'day', label: t('today') },
        { value: 'week', label: t('thisWeek') },
        { value: 'month', label: t('thisMonth') },
      ]}
    />
  );
}

/** "%50 prim", "Koltuk kirası $350/hafta", "Maaş $3.000 + %10". */
export function dealText(t: ReturnType<typeof useApp>['t'], fmt: (c: number) => string, p: any) {
  if (p.is_owner) return t('dealOwner');
  if (p.pay_model === 'booth_rent') return t('dealRent', { amount: fmt(p.rent_cents ?? 0), per: t(p.rent_period === 'month' ? 'perMonth' : 'perWeek') });
  if (p.pay_model === 'salary') return p.service_pct ? t('dealSalaryPlus', { amount: fmt(p.salary_cents ?? 0), pct: p.service_pct }) : t('dealSalary', { amount: fmt(p.salary_cents ?? 0) });
  return t('dealCommission', { pct: p.service_pct, ppct: p.product_pct });
}

/** One settlement slip per person: what they sold, what the deal makes of it, what is still to settle. */
function TeamSlips() {
  const { api, t, fmt, lang } = useApp();
  const [period, setPeriod] = useState<Period>('week');
  const { data, reload } = useLoad(() => api.get(`/team/report?period=${period}`), [period]);
  const [settle, setSettle] = useState<any>(null);
  const totals = data?.totals;
  return (
    <div className="stack">
      <PeriodPick value={period} onChange={setPeriod} />
      {data && (
        <p className="muted small center">
          {data.from === data.to ? dateLabel(data.from, lang) : `${dateLabel(data.from, lang, { day: 'numeric', month: 'short' })} – ${dateLabel(data.to, lang, { day: 'numeric', month: 'short' })}`}
        </p>
      )}
      {totals && (
        <section className="kpis team-kpis">
          <div className="kpi">
            <span className="eyebrow">{t('teamGross')}</span>
            <strong className="numeral">{fmt(totals.gross_cents)}</strong>
          </div>
          <div className="kpi">
            <span className="eyebrow">{t('teamOwed')}</span>
            <strong className="numeral">{fmt(totals.owed_cents)}</strong>
          </div>
          <div className="kpi">
            <span className="eyebrow">{t('shopKeeps')}</span>
            <strong className="numeral">{fmt(totals.shop_cents)}</strong>
          </div>
        </section>
      )}
      {data && !data.data.length && <Empty icon="users" text={t('teamEmpty')} />}
      {data?.data.map((p: any) => {
        const renter = p.pay_model === 'booth_rent' && !p.is_owner;
        const due = p.is_owner ? 0 : renter ? p.rent_cents - p.rent_paid_cents : p.owed_cents - p.paid_cents;
        return (
          <section key={p.staff_id} className="receipt slip">
            <header className="slip-head">
              <div>
                <strong className="slip-name">{p.name}</strong>
                {p.title && <span className="muted small"> · {p.title}</span>}
              </div>
              <span className="chip">{dealText(t, fmt, p)}</span>
            </header>
            <div className="till-line">
              <span className="eyebrow">{t('grossSales')}</span>
              <strong className="numeral big">{fmt(p.gross_cents)}</strong>
            </div>
            <div className="ledger-line">
              <span>{t('services')}</span>
              <span className="leader" />
              <span className="numeral">{fmt(p.service_cents)}</span>
            </div>
            <div className="ledger-line">
              <span>{t('products')}</span>
              <span className="leader" />
              <span className="numeral">{fmt(p.product_cents)}</span>
            </div>
            <div className="ledger-line">
              <span>{t('tips')}</span>
              <span className="leader" />
              <span className="numeral">{fmt(p.tips_cents)}</span>
            </div>
            <p className="muted small">
              {t('jobsDone', { n: p.visits })}
              {p.missed ? ` · ${t('noShows', { n: p.missed })}` : ''}
            </p>
            <hr className="rule" />
            {p.is_owner ? (
              <p className="muted small">{t('ownerSlipNote')}</p>
            ) : renter ? (
              <>
                <div className="ledger-line">
                  <span>{t('rentDue')}</span>
                  <span className="leader" />
                  <span className="numeral">{fmt(p.rent_cents)}</span>
                </div>
                <div className="ledger-line">
                  <span>{t('rentPaid')}</span>
                  <span className="leader" />
                  <span className="numeral">{fmt(p.rent_paid_cents)}</span>
                </div>
              </>
            ) : (
              <>
                {p.salary_cents > 0 && (
                  <div className="ledger-line">
                    <span>{t('salaryPart')}</span>
                    <span className="leader" />
                    <span className="numeral">{fmt(p.salary_cents)}</span>
                  </div>
                )}
                <div className="ledger-line">
                  <span>{t('commission')}</span>
                  <span className="leader" />
                  <span className="numeral">{fmt(p.commission_cents)}</span>
                </div>
                <div className="ledger-line strong">
                  <span>{t('owedToThem')}</span>
                  <span className="leader" />
                  <span className="numeral">{fmt(p.owed_cents)}</span>
                </div>
                {p.paid_cents > 0 && (
                  <div className="ledger-line">
                    <span>{t('alreadyPaid')}</span>
                    <span className="leader" />
                    <span className="numeral">{fmt(p.paid_cents)}</span>
                  </div>
                )}
              </>
            )}
            <div className="slip-foot">
              <span className="muted small">
                {t('shopKeeps')}: <span className="numeral">{fmt(p.shop_cents)}</span>
              </span>
              {due > 0 ? (
                <button className="btn" onClick={() => setSettle({ ...p, due, from: data.from, to: data.to })}>
                  {renter ? t('rentReceived') : t('payOut')} · <span className="numeral">{fmt(due)}</span>
                </button>
              ) : (
                (p.paid_cents > 0 || p.rent_paid_cents > 0) && <span className="stamp inline">{t('settledStamp')}</span>
              )}
            </div>
          </section>
        );
      })}
      <Sheet open={!!settle} onClose={() => setSettle(null)} title={settle ? `${settle.name} · ${settle.pay_model === 'booth_rent' ? t('rentReceived') : t('payOut')}` : ''}>
        {settle && <Settle slip={settle} onDone={() => (setSettle(null), reload())} />}
      </Sheet>
    </div>
  );
}

function Settle({ slip, onDone }: { slip: any; onDone(): void }) {
  const { api, t, fmt, fail, toast, lang } = useApp();
  const [amount, setAmount] = useState(String(slip.due / 100));
  const rent = slip.pay_model === 'booth_rent';
  return (
    <div className="stack">
      <p className="muted">
        {dateLabel(slip.from, lang, { day: 'numeric', month: 'short' })} – {dateLabel(slip.to, lang, { day: 'numeric', month: 'short' })} · {rent ? t('settleRentHint') : t('settlePayHint')}
      </p>
      <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t('amount')} />
      <button
        className="btn primary"
        disabled={!toCents(amount)}
        onClick={async () => {
          try {
            await api.post(`/team/${slip.staff_id}/payouts`, { kind: rent ? 'rent' : 'pay', from: slip.from, to: slip.to, amount_cents: toCents(amount) });
            toast(t(rent ? 'rentRecorded' : 'payRecorded', { amount: fmt(toCents(amount)) }));
            onDone();
          } catch (e) {
            fail(e);
          }
        }}
      >
        {rent ? t('rentReceived') : t('payOut')}
      </button>
    </div>
  );
}

/** The day's receipts, newest first. The owner can void one. */
function Receipts() {
  const { api, me, t, fmt, lang, fail, refreshAll } = useApp();
  const tz = me.shop.timezone;
  const owner = me.user.role === 'owner';
  const [date, setDate] = useState(todayIn(tz));
  const { data, reload } = useLoad(() => api.get(`/sales?period=day&date=${date}`), [date]);
  const [voiding, setVoiding] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="date-nav">
        <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="previous day">
          <Icon name="chevL" />
        </button>
        <button className="date-title" onClick={() => setDate(todayIn(tz))}>
          <span>{dateLabel(date, lang)}</span>
        </button>
        <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="next day">
          <Icon name="chevR" />
        </button>
      </div>
      {data && (
        <section className="kpis">
          <div className="kpi">
            <span className="eyebrow">{t('total')}</span>
            <strong className="numeral">{fmt(data.totals.total_cents)}</strong>
          </div>
          <div className="kpi">
            <span className="eyebrow">{t('payCard')}</span>
            <strong className="numeral">{fmt(data.totals.card_cents)}</strong>
          </div>
          <div className="kpi">
            <span className="eyebrow">{t('payCash')}</span>
            <strong className="numeral">{fmt(data.totals.cash_cents)}</strong>
          </div>
        </section>
      )}
      {data && !data.data.length && <Empty icon="book" text={t('noReceipts')} />}
      <ul className="list receipts-list">
        {data?.data.map((s: any) => (
          <li key={s.id} className="list-row">
            <div className="grow">
              <div className="row-title">
                <span className="numeral">{timeIn(s.sold_at, tz)}</span> · {s.items.map((i: any) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name)).join(', ')}
              </div>
              <div className="row-meta">
                {[s.staff_name, s.client_name, t(`pay_${s.method}` as any)].filter(Boolean).join(' · ')}
                {s.tip_cents > 0 && ` · ${t('tip').toLocaleLowerCase(lang)} ${fmt(s.tip_cents)}`}
              </div>
            </div>
            <strong className="numeral">{fmt(s.total_cents)}</strong>
            {owner &&
              (voiding === s.id ? (
                <button
                  className="btn danger small"
                  onClick={async () => {
                    try {
                      await api.del(`/sales/${s.id}`);
                      setVoiding(null);
                      reload();
                      refreshAll();
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  {t('voidConfirm')}
                </button>
              ) : (
                <button className="icon-btn" onClick={() => setVoiding(s.id)} aria-label={t('voidSale')}>
                  <Icon name="undo" size={18} />
                </button>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

const dayIn = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));

/** A team member's own slip: sold, tips, their share; and what is next on their day. */
function MySlip({ onRingUp }: { onRingUp(): void }) {
  const { api, me, t, fmt, lang } = useApp();
  const tz = me.shop.timezone;
  const [period, setPeriod] = useState<Period>('day');
  const { data } = useLoad(() => api.get(`/me/work?period=${period}`), [period]);
  const row = data?.row;
  const renter = data?.staff?.pay_model === 'booth_rent';
  const label = useMemo(() => (period === 'day' ? t('soldToday') : period === 'week' ? t('soldThisWeek') : t('soldThisMonth')), [period, t]);
  if (data && !data.staff) return <Empty icon="users" text={t('notLinked')} />;
  return (
    <div className="stack">
      <PeriodPick value={period} onChange={setPeriod} />
      <section className="receipt slip mine">
        <header className="slip-head">
          <strong className="slip-name">{data?.staff?.name ?? me.user.name}</strong>
          {data?.staff && <span className="chip">{dealText(t, fmt, data.staff)}</span>}
        </header>
        <div className="till-line">
          <span className="eyebrow">{label}</span>
          <strong className="numeral big">{fmt(row?.gross_cents ?? 0)}</strong>
        </div>
        <div className="ledger-line">
          <span>{t('jobsDone', { n: row?.visits ?? 0 })}</span>
        </div>
        <div className="ledger-line">
          <span>{t('tips')}</span>
          <span className="leader" />
          <span className="numeral">{fmt(row?.tips_cents ?? 0)}</span>
        </div>
        <hr className="rule" />
        {renter ? (
          <div className="ledger-line strong">
            <span>{t('rentDue')}</span>
            <span className="leader" />
            <span className="numeral">{fmt(row?.rent_cents ?? 0)}</span>
          </div>
        ) : (
          <div className="ledger-line strong">
            <span>{t('yourShare')}</span>
            <span className="leader" />
            <span className="numeral">{fmt(row?.owed_cents ?? 0)}</span>
          </div>
        )}
        <p className="muted small">{renter ? t('renterNote') : t('shareNote')}</p>
      </section>
      <button className="btn primary" onClick={onRingUp}>
        <Icon name="plus" /> {t('tillRingUp')}
      </button>
      {!!data?.next?.length && (
        <section className="card">
          <h3 className="mini-title">
            <Icon name="clock" size={16} /> {t('nextUp')}
          </h3>
          <ul className="mini-list">
            {data.next.map((a: any) => (
              <li key={a.id}>
                <span className="numeral">
                  {dayIn(a.starts_at, tz) !== todayIn(tz) ? `${dateLabel(dayIn(a.starts_at, tz), lang, { weekday: 'short' })} ` : ''}
                  {timeIn(a.starts_at, tz)}
                </span>
                <span className="grow">
                  {a.client_name} · {a.service_name}
                </span>
                {a.station_name && <span className="muted small">{a.station_name}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!data?.sales?.length && (
        <section className="card">
          <h3 className="mini-title">{t('tillMyReceipts')}</h3>
          <ul className="mini-list">
            {data.sales.slice(0, 8).map((s: any) => (
              <li key={s.id}>
                <span className="numeral">{period === 'day' ? timeIn(s.sold_at, tz) : dateLabel(s.sold_on, lang, { day: 'numeric', month: 'short' })}</span>
                <span className="grow">{s.items.map((i: any) => i.name).join(', ')}</span>
                <span className="numeral">{fmt(s.total_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
