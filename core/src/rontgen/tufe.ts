// Turkey's consumer price index (TÜFE), monthly % change, from the central bank's published table:
// https://www.tcmb.gov.tr → İstatistikler → Enflasyon Verileri → Tüketici Fiyatları (read 18 Oct 2026).
// Update by appending the newest month. Annual figures there are used only to check this series (tests).

export const TUFE_KAYNAK = 'TCMB, Tüketici Fiyatları (TÜFE) aylık % değişim';

/** [YYYY-MM, monthly % change, annual % change] */
export const TUFE: [string, number, number][] = [
  ['2023-01', 6.65, 57.68], ['2023-02', 3.15, 55.18], ['2023-03', 2.29, 50.51], ['2023-04', 2.39, 43.68],
  ['2023-05', 0.04, 39.59], ['2023-06', 3.92, 38.21], ['2023-07', 9.49, 47.83], ['2023-08', 9.09, 58.94],
  ['2023-09', 4.75, 61.53], ['2023-10', 3.43, 61.36], ['2023-11', 3.28, 61.98], ['2023-12', 2.93, 64.77],
  ['2024-01', 6.7, 64.86], ['2024-02', 4.53, 67.07], ['2024-03', 3.16, 68.5], ['2024-04', 3.18, 69.8],
  ['2024-05', 3.37, 75.45], ['2024-06', 1.64, 71.6], ['2024-07', 3.23, 61.78], ['2024-08', 2.47, 51.97],
  ['2024-09', 2.97, 49.38], ['2024-10', 2.88, 48.58], ['2024-11', 2.24, 47.09], ['2024-12', 1.03, 44.38],
  ['2025-01', 5.03, 42.12], ['2025-02', 2.27, 39.05], ['2025-03', 2.46, 38.1], ['2025-04', 3.0, 37.86],
  ['2025-05', 1.53, 35.41], ['2025-06', 1.37, 35.05], ['2025-07', 2.06, 33.52], ['2025-08', 2.04, 32.95],
  ['2025-09', 3.23, 33.29], ['2025-10', 2.55, 32.87], ['2025-11', 0.87, 31.07], ['2025-12', 0.89, 30.89],
  ['2026-01', 4.84, 30.65], ['2026-02', 2.96, 31.53], ['2026-03', 1.94, 30.87], ['2026-04', 4.18, 32.37],
  ['2026-05', 1.71, 32.61], ['2026-06', 0.99, 32.11], ['2026-07', 1.78, 31.75], ['2026-08', 1.84, 31.51],
  ['2026-09', 1.84, 29.73],
];

/** Chained index, December 2022 = 100. */
export const ENDEKS: Record<string, number> = (() => {
  const out: Record<string, number> = { '2022-12': 100 };
  let v = 100;
  for (const [m, pct] of TUFE) out[m] = v *= 1 + pct / 100;
  return out;
})();

export const sonAy = () => TUFE[TUFE.length - 1][0];

/** Index for a month; months after the last published one use the last value (no guessing). */
export function endeks(ay: string) {
  if (ENDEKS[ay]) return ENDEKS[ay];
  return ay > sonAy() ? ENDEKS[sonAy()] : ENDEKS['2022-12'];
}

/** Amount from month `ay` in prices of month `hedef`. */
export const bugununParasi = (tutar: number, ay: string, hedef: string) => (tutar * endeks(hedef)) / endeks(ay);

/** Cumulative inflation between two months, as a fraction (0.28 = %28). */
export const birikmis = (from: string, to: string) => endeks(to) / endeks(from) - 1;
