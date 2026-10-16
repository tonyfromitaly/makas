import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { understandLocal, type Plan } from '@makas/core';

export const evalSet = JSON.parse(readFileSync(join(import.meta.dirname, '../test/assistant-eval.json'), 'utf8'));

export function evalContext(lang: 'tr' | 'en' | 'es') {
  const c = evalSet.context;
  const named = (xs: string[]) => xs.map((name, i) => ({ id: String(i + 1), name }));
  return { now: DateTime.fromISO(c.now, { zone: c.timezone }), lang, services: named(c.services), barbers: named(c.barbers), clients: named(c.clients) };
}

export const runLocal = (text: string, lang: 'tr' | 'en' | 'es'): Plan => understandLocal(text, evalContext(lang));

/** Each expected item must be matched, in order, by an item with the same values for the listed fields. */
export function score(plan: Plan, expect: Record<string, unknown>[]) {
  const items = plan.items as Record<string, unknown>[];
  const misses: string[] = [];
  if (items.length !== expect.length) misses.push(`expected ${expect.length} item(s), got ${items.length}`);
  expect.forEach((e, i) => {
    const got = items[i] ?? {};
    for (const [k, v] of Object.entries(e)) if (got[k] !== v) misses.push(`#${i + 1}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
  });
  return misses;
}
