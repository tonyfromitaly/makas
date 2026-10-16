/** Lowercase and fold accents so "Ödedim", "odedim" and "ÖDEDİM" all match. */
export function fold(s: string) {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}:.,\s'$€₺-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "1.800" and "1,800" mean 1800; "12,50" and "12.50" mean 12.5; "1.5k" or "2 bin" multiply.
 * Returns cents, or null when the text holds no amount.
 */
export function parseAmountCents(text: string): number | null {
  const m = fold(text).match(/(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(k|bin|mil)?\b/);
  if (!m) return null;
  const whole = Number(m[1].replace(/[.,]/g, ''));
  const frac = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  const mult = m[3] ? 1000 : 1;
  const cents = Math.round((whole + frac / 100) * mult * 100);
  return cents > 0 ? cents : null;
}

export const hasAny = (folded: string, words: string[]) =>
  words.some((w) => new RegExp(`(^|\\s)${w}`).test(folded));
