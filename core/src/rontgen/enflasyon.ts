// One deflator per currency: the lira uses the central bank's TÜFE (tufe.ts), the dollar and the pound
// their national statistics (enflasyon-seriler.ts). A month outside a series is never guessed:
// the engine then reports in nominal terms and says so.
import { ENDEKS, TUFE_KAYNAK, sonAy as tufeSon } from './tufe';
import { SERILER } from './enflasyon-seriler';

export interface Enflasyon {
  para: string;
  kaynak: string;
  ilk: string;
  son: string;
  endeks(ay: string): number | null;
}

const ayEkle = (ay: string, n: number) => {
  const [y, m] = ay.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export function enflasyon(para: string): Enflasyon | null {
  const p = para.toUpperCase();
  if (p === 'TRY' || p === 'TL') {
    return { para: 'TRY', kaynak: TUFE_KAYNAK, ilk: '2022-12', son: tufeSon(), endeks: (ay) => ENDEKS[ay] ?? null };
  }
  const s = SERILER[p];
  if (!s) return null;
  const son = ayEkle(s.ilk, s.deger.length - 1);
  return {
    para: p,
    kaynak: s.kaynak,
    ilk: s.ilk,
    son,
    endeks: (ay) => {
      if (ay < s.ilk || ay > son) return null;
      const [y0, m0] = s.ilk.split('-').map(Number);
      const [y, m] = ay.split('-').map(Number);
      return s.deger[(y - y0) * 12 + (m - m0)] ?? null;
    },
  };
}

/** Does the series cover every month in the range? */
export const kapsar = (e: Enflasyon | null, bas: string, son: string) => !!e && bas >= e.ilk && son <= e.son;
