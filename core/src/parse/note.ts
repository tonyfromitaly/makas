import { DateTime } from 'luxon';
import { fold, hasAny, parseAmountCents } from './text';

export type Category = 'service' | 'product' | 'tips' | 'rent' | 'supplies' | 'utilities' | 'wages' | 'other';
export const CATEGORIES: Category[] = ['service', 'product', 'tips', 'rent', 'supplies', 'utilities', 'wages', 'other'];

export interface NoteDraft {
  kind: 'income' | 'expense';
  amount_cents: number;
  category: Category;
  entry_date: string;
  note: string;
}

// Word stems, matched at word start after accent folding (tr, en, es together).
const CATEGORY_WORDS: [Category, string[]][] = [
  ['rent', ['kira', 'rent', 'alquiler', 'renta']],
  ['utilities', ['fatura', 'elektrik', 'dogalgaz', 'internet', 'su faturasi', 'bill', 'electric', 'water', 'luz', 'agua', 'factura']],
  ['wages', ['maas', 'yevmiye', 'kalfa', 'cirak', 'wage', 'salary', 'payroll', 'sueldo', 'salario', 'nomina']],
  ['supplies', ['jilet', 'malzeme', 'sampuan', 'havlu', 'kolonya', 'wax', 'jel', 'tiras bicagi', 'razor', 'blade', 'supplies', 'shampoo', 'towel', 'navaja', 'insumo', 'toalla', 'champu', 'tedarikci', 'supplier', 'proveedor']],
  ['tips', ['bahsis', 'tip', 'propina']],
  ['product', ['urun', 'sattim', 'product', 'sold', 'producto', 'vendi']],
];

const EXPENSE_WORDS = ['odedim', 'odendi', 'verdim', 'harcadim', 'aldim', 'gider', 'masraf', 'paid', 'pay', 'bought', 'spent', 'expense', 'pague', 'compre', 'gaste', 'gasto'];
const INCOME_WORDS = ['kazandim', 'kazanc', 'gelir', 'geldi', 'tahsil', 'kasa', 'ciro', 'sattim', 'earned', 'made', 'income', 'got', 'received', 'sold', 'gane', 'ingreso', 'cobre', 'recibi', 'vendi'];
const EXPENSE_CATEGORIES: Category[] = ['rent', 'utilities', 'wages', 'supplies'];
const CONNECTORS = new Set(['ve', 'ayrica', 'sonra', 'ardindan', 'hem', 'artı', 'arti', 'and', 'also', 'then', 'plus', 'y', 'ademas', 'luego', 'tambien']);
const AMOUNT_TOKEN = /^\$?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2})?(k)?\$?$/;

const isKindToken = (f: string) =>
  [...INCOME_WORDS, ...EXPENSE_WORDS].some((w) => f.startsWith(w));
const isCategoryToken = (f: string) => CATEGORY_WORDS.some(([, ws]) => ws.some((w) => !w.includes(' ') && f.startsWith(w)));

/** One segment (holding exactly one amount) → draft. kind is null when the words don't say. */
function parseSegment(text: string, today: string): (Omit<NoteDraft, 'kind'> & { kind: NoteDraft['kind'] | null; dateSet: boolean }) | null {
  const amount = parseAmountCents(text);
  if (!amount) return null;
  const f = fold(text);
  let category: Category | null = null;
  for (const [cat, words] of CATEGORY_WORDS) {
    if (hasAny(f, words)) {
      category = cat;
      break;
    }
  }
  let kind: NoteDraft['kind'] | null = null;
  if (hasAny(f, INCOME_WORDS) && !hasAny(f, ['aldim', 'bought', 'compre'])) kind = 'income';
  else if (hasAny(f, EXPENSE_WORDS)) kind = 'expense';
  else if (category) kind = EXPENSE_CATEGORIES.includes(category) ? 'expense' : 'income';

  let date = DateTime.fromISO(today);
  let dateSet = false;
  if (hasAny(f, ['dun', 'yesterday', 'ayer'])) (date = date.minus({ days: 1 })), (dateSet = true);
  else if (hasAny(f, ['evvelsi gun', 'onceki gun', 'anteayer'])) (date = date.minus({ days: 2 })), (dateSet = true);
  else if (hasAny(f, ['bugun', 'today', 'hoy'])) dateSet = true;

  return { kind, amount_cents: amount, category: category ?? 'other', entry_date: date.toISODate()!, note: text.trim().slice(0, 200), dateSet };
}

/**
 * Splits a free note into one segment per amount.
 * Clauses break at punctuation and connectors ("ve", "and", "y"). A clause that still holds several
 * amounts is cut by word order: in Turkish the verb follows its amount ("100 kazandım 300 kira ödedim"),
 * in English and Spanish it comes first ("made 100 paid 300 rent").
 */
export function splitSegments(text: string, lang: 'tr' | 'en' | 'es' = 'tr'): string[] {
  const raw = text.replace(/\s+/g, ' ').trim().split(' ');
  const clauses: string[][] = [[]];
  raw.forEach((tok, i) => {
    const f = fold(tok).replace(/[,;.!?]+$/, '');
    const prev = i > 0 ? fold(raw[i - 1]) : '';
    if (CONNECTORS.has(f) || (f === 'de' && prev === 'hem')) {
      if (clauses[clauses.length - 1].length) clauses.push([]);
      return;
    }
    clauses[clauses.length - 1].push(tok);
    if (/[;!?]$/.test(tok) || /[,.]$/.test(tok)) clauses.push([]);
  });

  const segments: string[] = [];
  for (const words of clauses.filter((c) => c.length)) {
    const f = words.map((w) => fold(w).replace(/[,;.!?]+$/, ''));
    const amountIdx = f
      .map((w, i) => (AMOUNT_TOKEN.test(w) && !/^(saat|at)$/.test(f[i - 1] ?? '') ? i : -1))
      .filter((i) => i >= 0);
    if (amountIdx.length <= 1) {
      segments.push(words.join(' '));
      continue;
    }
    let start = 0;
    for (let k = 0; k < amountIdx.length - 1; k++) {
      const a = amountIdx[k];
      const b = amountIdx[k + 1];
      let cut = b;
      if (lang === 'tr') {
        const verb = f.findIndex((w, i) => i > a && i < b && isKindToken(w));
        if (verb >= 0) cut = verb + 1;
        else {
          // "kira 1800 elektrik 120": this amount already has its category in front of it,
          // so the next category word starts the next segment.
          const hasOwn = f.slice(start, a).some(isCategoryToken);
          const cat = f.findIndex((w, i) => i > a && i < b && isCategoryToken(w));
          if (hasOwn && cat >= 0) cut = cat;
        }
      } else {
        const verb = f.findIndex((w, i) => i > a && i < b && isKindToken(w));
        if (verb >= 0) cut = verb;
      }
      segments.push(words.slice(start, cut).join(' '));
      start = cut;
    }
    segments.push(words.slice(start).join(' '));
  }

  // A clause without an amount ("dün," / "yesterday") gives its words to the next one.
  const out: string[] = [];
  let carry = '';
  for (const s of segments) {
    if (!parseAmountCents(s)) carry = `${carry} ${s}`.trim();
    else {
      out.push(`${carry} ${s}`.trim());
      carry = '';
    }
  }
  if (carry && out.length) out[out.length - 1] += ` ${carry}`;
  return out;
}

/**
 * Local, offline note parser. Turns one sentence into one or more drafts; never totals anything.
 * A segment that doesn't state income or expense inherits it from the one before; the date
 * ("dün", "yesterday") carries forward the same way.
 */
export function parseNotesLocal(text: string, today: string, lang: 'tr' | 'en' | 'es' = 'tr'): NoteDraft[] {
  const drafts: NoteDraft[] = [];
  let lastKind: NoteDraft['kind'] = 'income';
  let lastDate = today;
  for (const seg of splitSegments(text, lang)) {
    const d = parseSegment(seg, today);
    if (!d) continue;
    const kind: NoteDraft["kind"] = d.kind ?? lastKind;
    let category = d.category;
    if (category === 'other' && kind === 'income' && !d.kind) category = 'service';
    if (category === 'other' && kind === 'income' && d.kind) category = 'service';
    if (kind === 'income' && EXPENSE_CATEGORIES.includes(category)) category = 'other';
    if (kind === 'expense' && (category === 'tips' || category === 'service')) category = 'other';
    const entry_date = d.dateSet ? d.entry_date : lastDate;
    drafts.push({ kind, amount_cents: d.amount_cents, category, entry_date, note: d.note });
    lastKind = kind;
    lastDate = entry_date;
  }
  return drafts;
}

/** Single-draft form kept for callers that want one entry. */
export function parseNoteLocal(text: string, today: string): NoteDraft | null {
  return parseNotesLocal(text, today)[0] ?? null;
}
