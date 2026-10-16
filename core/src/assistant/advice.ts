import { fold } from '../parse/text';
import { replier } from './replies';
import type { ShopSnapshot } from './snapshot';

type L = 'tr' | 'en' | 'es';

const WEEKDAYS: Record<L, string[]> = {
  tr: ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  es: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
};

const S: Record<L, Record<string, string>> = {
  tr: {
    lapsed: 'Son 6 haftadır gelmeyen {n} düzenli müşterin var.',
    noShow: 'Son 60 günde randevuların %{pct} kadarı gelmedi ({missed} kişi).',
    winBack: 'Müşteriler > Gelmeyenler filtresinden onlara tek tek “geri çağır” mesajı atabilirsin; mesaj izni olanlara hatırlatmalar zaten otomatik gidiyor.',
    ticket: 'Ortalama fiş {ticket}. En çok yapılan: {top}.',
    combo: 'Saç kesimine sakalı eklemeyi teklif etmek fişi en hızlı büyüten yol; kombine hizmeti öne çıkar.',
    ratio: 'Bu ay şimdiye kadar gelir {income}, gider {expense}; giderler gelirin %{pct} kadarı.',
    ratioHigh: 'Giderler yüksek; en büyük kalemi Defter > Ay görünümünde kontrol et.',
    busy: 'En kazançlı gün ortalama {best} ile {bestDay}, en sakin gün {worstDay} ({worst}).',
    busyTip: '{worstDay} için mesaj izni olan müşterilere küçük bir indirim duyurusu boş koltukları doldurabilir.',
    summary: 'Bu ay şimdiye kadar net {net} (geçen ay toplam net {lastNet}). Önümüzdeki 7 günde {upcoming} randevu var, bu ay ödenecek {payables}.',
    receivable: 'Müşterilerde {amount} alacağın duruyor; Müşteriler > Borçlu filtresinden takip edebilirsin.',
    noData: 'Bunu yanıtlamak için yeterli kayıt yok henüz; birkaç hafta randevu ve defter girdikçe daha net söylerim.',
  },
  en: {
    lapsed: 'You have {n} regulars who haven’t been in for 6+ weeks.',
    noShow: 'In the last 60 days {pct}% of bookings were no-shows ({missed}).',
    winBack: 'Use Clients > Lapsed to send each a “win back” message; clients who opted in already get automatic reminders.',
    ticket: 'Average ticket is {ticket}. Most popular: {top}.',
    combo: 'Offering a beard trim with every haircut is the fastest way to lift the ticket; push the combo.',
    ratio: 'This month so far: income {income}, expenses {expense}; expenses are {pct}% of income.',
    ratioHigh: 'Expenses run high; check the biggest category in Books > Month.',
    busy: 'Your best day is {bestDay} at {best} on average; the quietest is {worstDay} ({worst}).',
    busyTip: 'A small {worstDay} offer to opted-in clients can fill the empty chairs.',
    summary: 'Net so far this month is {net} (last month’s total net {lastNet}). {upcoming} bookings in the next 7 days, {payables} still to pay this month.',
    receivable: 'Clients owe you {amount}; follow up from Clients > Owes.',
    noData: 'There isn’t enough history to answer that yet; a few weeks of bookings and entries will tell.',
  },
  es: {
    lapsed: 'Tienes {n} clientes habituales que no vienen desde hace 6+ semanas.',
    noShow: 'En los últimos 60 días el {pct}% de las citas no vino ({missed}).',
    winBack: 'Desde Clientes > Ausentes puedes enviarles un mensaje de “recuperar”; quien aceptó mensajes ya recibe recordatorios automáticos.',
    ticket: 'El ticket medio es {ticket}. Lo más pedido: {top}.',
    combo: 'Ofrecer barba con cada corte es la forma más rápida de subir el ticket; destaca el combo.',
    ratio: 'Este mes: ingresos {income}, gastos {expense}; los gastos son el {pct}% de los ingresos.',
    ratioHigh: 'Los gastos están altos; revisa la partida mayor en Cuentas > Mes.',
    busy: 'Tu mejor día es el {bestDay} con {best} de media; el más tranquilo, el {worstDay} ({worst}).',
    busyTip: 'Una pequeña oferta para el {worstDay} a clientes que aceptaron mensajes puede llenar sillas vacías.',
    summary: 'Neto del mes hasta hoy: {net} (neto total del mes pasado {lastNet}). {upcoming} citas en 7 días y {payables} por pagar este mes.',
    receivable: 'Tus clientes te deben {amount}; síguelo en Clientes > Deben.',
    noData: 'Aún no hay suficiente historial para responder; con unas semanas de citas y asientos lo verás.',
  },
};

const has = (f: string, words: string[]) => words.some((w) => f.includes(w));

/** Rule-based answer to an open question, used when no model key is configured. Only quotes snapshot numbers. */
export function localAdvice(question: string, snap: ShopSnapshot, lang: L, currency: string): string {
  const r = replier(lang, currency);
  const d = S[lang] ?? S.en;
  const say = (k: string, v: Record<string, string | number> = {}) => d[k].replace(/\{(\w+)\}/g, (_, x) => String(v[x] ?? ''));
  const f = fold(question);
  const s60 = snap.last_60_days;
  const parts: string[] = [];

  if (has(f, ['musteri az', 'azald', 'gelmiyor', 'kaybed', 'fewer', 'dropping', 'losing', 'less client', 'pocos', 'menos client', 'perdiendo'])) {
    if (snap.lapsed_clients_6_weeks) parts.push(say('lapsed', { n: snap.lapsed_clients_6_weeks }));
    if (s60.no_shows) parts.push(say('noShow', { pct: s60.no_show_rate_pct, missed: s60.no_shows }));
    parts.push(say('winBack'));
  } else if (has(f, ['yogun', 'hangi gun', 'sakin', 'busiest', 'quiet', 'which day', 'dia mas', 'que dia', 'tranquilo'])) {
    const days = s60.income_by_weekday;
    if (days.length >= 2) {
      const best = days[0];
      const worst = days[days.length - 1];
      const wd = WEEKDAYS[lang];
      parts.push(say('busy', { bestDay: wd[best.weekday - 1], best: r.money(best.avg_income_cents), worstDay: wd[worst.weekday - 1], worst: r.money(worst.avg_income_cents) }));
      parts.push(say('busyTip', { worstDay: wd[worst.weekday - 1] }));
    }
  } else if (has(f, ['masraf', 'gider', 'expense', 'cost', 'spend', 'gasto'])) {
    const m = snap.this_month_so_far;
    if (m.income_cents) {
      const pct = Math.round((m.expense_cents / m.income_cents) * 100);
      parts.push(say('ratio', { income: r.money(m.income_cents), expense: r.money(m.expense_cents), pct }));
      if (pct > 60) parts.push(say('ratioHigh'));
    }
  } else if (has(f, ['kazan', 'fis', 'artir', 'buyut', 'earn', 'more money', 'grow', 'ticket', 'ganar', 'crecer'])) {
    if (s60.finished_visits) parts.push(say('ticket', { ticket: r.money(s60.average_ticket_cents), top: s60.top_services.map((t: any) => t.name).join(', ') }));
    parts.push(say('combo'));
    if (snap.receivables_cents) parts.push(say('receivable', { amount: r.money(snap.receivables_cents) }));
  } else {
    parts.push(
      say('summary', {
        net: r.money(snap.this_month_so_far.net_cents),
        lastNet: r.money(snap.last_month.net_cents),
        upcoming: snap.booked_next_7_days,
        payables: r.money(snap.payables_this_month.total_cents),
      }),
    );
  }
  return parts.length ? parts.join(' ') : say('noData');
}
