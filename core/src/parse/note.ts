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
  ['supplies', ['jilet', 'malzeme', 'sampuan', 'havlu', 'kolonya', 'wax', 'jel', 'makas', 'tiras', 'razor', 'blade', 'supplies', 'shampoo', 'towel', 'navaja', 'insumo', 'toalla', 'champu']],
  ['tips', ['bahsis', 'tip', 'propina']],
  ['product', ['urun', 'sattim', 'product', 'sold', 'producto', 'vendi']],
];

const EXPENSE_WORDS = ['odedim', 'odendi', 'verdim', 'harcadim', 'aldim', 'gider', 'masraf', 'paid', 'pay', 'bought', 'spent', 'expense', 'pague', 'compre', 'gaste', 'gasto'];
const INCOME_WORDS = ['kazandim', 'kazanc', 'gelir', 'tahsil', 'kasa', 'ciro', 'sattim', 'earned', 'made', 'income', 'sold', 'gane', 'ingreso', 'cobre', 'vendi'];
const EXPENSE_CATEGORIES: Category[] = ['rent', 'utilities', 'wages', 'supplies'];

/**
 * Local, offline fallback for the AI note parser. It only turns one sentence into one draft;
 * it never totals anything. Totals always come from SQL.
 */
export function parseNoteLocal(text: string, today: string): NoteDraft | null {
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

  let kind: 'income' | 'expense';
  if (hasAny(f, INCOME_WORDS) && !hasAny(f, ['aldim', 'bought', 'compre'])) kind = 'income';
  else if (hasAny(f, EXPENSE_WORDS)) kind = 'expense';
  else kind = category && EXPENSE_CATEGORIES.includes(category) ? 'expense' : 'income';

  if (!category) category = kind === 'income' ? 'service' : 'other';
  if (kind === 'income' && EXPENSE_CATEGORIES.includes(category)) category = 'other';
  if (kind === 'expense' && (category === 'tips' || category === 'service')) category = 'other';

  let date = DateTime.fromISO(today);
  if (hasAny(f, ['dun', 'yesterday', 'ayer'])) date = date.minus({ days: 1 });
  else if (hasAny(f, ['evvelsi gun', 'onceki gun', 'anteayer'])) date = date.minus({ days: 2 });

  return {
    kind,
    amount_cents: amount,
    category,
    entry_date: date.toISODate()!,
    note: text.trim().slice(0, 200),
  };
}
