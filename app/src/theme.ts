// Looks: six skins over the same layout, plus the shop's own colour. Kept on this device only;
// a phone that loses it simply falls back to Adisyon, which follows the system's light/dark.

export type Skin = 'auto' | 'adisyon' | 'karbon' | 'defter' | 'cini' | 'pudra' | 'buyuk';

export interface SkinInfo {
  id: Skin;
  dark: boolean | null; // null: follows the system
  /** paper, ink, accent, counter: for the little preview in Settings. */
  swatch: [string, string, string, string];
}

export const SKINS: SkinInfo[] = [
  { id: 'auto', dark: null, swatch: ['#fbfbf8', '#1d2433', '#2b4fd8', '#1b2029'] },
  { id: 'adisyon', dark: false, swatch: ['#fbfbf8', '#1d2433', '#2b4fd8', '#c9cfd3'] },
  { id: 'karbon', dark: true, swatch: ['#1b2029', '#e9ecf3', '#8ea6ff', '#0f1216'] },
  { id: 'defter', dark: false, swatch: ['#f6f8f1', '#16332a', '#1e6a47', '#d5dccf'] },
  { id: 'cini', dark: false, swatch: ['#ffffff', '#0f2650', '#1546a8', '#dbe6f0'] },
  { id: 'pudra', dark: false, swatch: ['#fffbfb', '#3b1f33', '#8a2f6b', '#eedfe2'] },
  { id: 'buyuk', dark: false, swatch: ['#ffffff', '#000000', '#0033b3', '#e9e9e9'] },
];

/** The shop's colour, with a lighter variant that stays readable on the dark skin. */
export const ACCENTS: { id: string; light: string; dark: string }[] = [
  { id: 'lacivert', light: '#2b4fd8', dark: '#8ea6ff' },
  { id: 'zumrut', light: '#1e7a52', dark: '#5fd19b' },
  { id: 'bordo', light: '#9b1d3a', dark: '#ff8aa3' },
  { id: 'mor', light: '#6a35b8', dark: '#c4a4ff' },
  { id: 'turuncu', light: '#b5480f', dark: '#ffa36b' },
  { id: 'petrol', light: '#0b6b78', dark: '#5fd0dc' },
  { id: 'hardal', light: '#8a6500', dark: '#f1c75a' },
  { id: 'grafit', light: '#374151', dark: '#c7cdd8' },
];

export interface Look {
  skin: Skin;
  accent: string | null; // null: the skin's own colour
}

const KEY = 'makas.look';
const DEFAULT: Look = { skin: 'auto', accent: null };

export function loadLook(): Look {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && SKINS.some((s) => s.id === v.skin)) return { skin: v.skin, accent: ACCENTS.some((a) => a.id === v.accent) ? v.accent : null };
  } catch {
    /* private window or blocked storage: the default look */
  }
  return DEFAULT;
}

export function saveLook(look: Look) {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    /* not kept; it still applies until the page closes */
  }
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

export function isDark(look: Look) {
  const s = SKINS.find((x) => x.id === look.skin)!;
  return s.dark ?? systemDark();
}

export function applyLook(look: Look) {
  const root = document.documentElement;
  const skin = SKINS.find((x) => x.id === look.skin) ?? SKINS[0];
  if (skin.id === 'auto' || skin.id === 'adisyon') delete root.dataset.skin;
  else root.dataset.skin = skin.id;
  // Adisyon and auto keep the system's light/dark; every other skin is fixed.
  if (skin.id === 'auto') delete root.dataset.theme;
  else root.dataset.theme = skin.dark ? 'dark' : 'light';

  const accent = ACCENTS.find((a) => a.id === look.accent);
  if (accent) {
    const c = isDark(look) ? accent.dark : accent.light;
    root.style.setProperty('--carbon', c);
    root.style.setProperty('--carbon-soft', `color-mix(in srgb, ${c} 16%, var(--paper))`);
  } else {
    root.style.removeProperty('--carbon');
    root.style.removeProperty('--carbon-soft');
  }
  const bar = getComputedStyle(root).getPropertyValue('--counter').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar || '#1d1a15');
}

/** Re-applies when the system switches light/dark, for the skins that follow it. */
export function watchSystem(get: () => Look) {
  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyLook(get()));
}
