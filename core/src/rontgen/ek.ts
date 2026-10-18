// Turkish suffixes after numerals follow how the number is read aloud: 2009 is "iki bin dokuz" → 2009'dan,
// 2018 "iki bin on sekiz" → 2018'e, %35 "yüzde otuz beş" → %35'i, %27 → %27'si.
const BIRLER = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const ONLAR = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];

function sonKelime(n: number) {
  n = Math.abs(Math.round(n));
  if (n === 0) return 'sıfır';
  if (n % 1_000_000_000 === 0) return 'milyar';
  if (n % 1_000_000 === 0) return 'milyon';
  if (n % 1000 === 0) return 'bin';
  if (n % 100 === 0) return 'yüz';
  if (n % 10 === 0) return ONLAR[(n % 100) / 10];
  return BIRLER[n % 10];
}

const KALIN = 'aıou';
const sesliler = (w: string) => [...w].filter((c) => 'aeıioöuü'.includes(c));
const sert = (w: string) => 'fstkçşhp'.includes(w[w.length - 1]);
const sesliyleBiter = (w: string) => 'aeıioöuü'.includes(w[w.length - 1]);

export type Ek = 'den' | 'de' | 'e' | 'i' | 'ini' | 'in';

/** The suffix (with apostrophe) for a number: ek(2009, 'den') → "'dan". */
export function ek(n: number, tip: Ek): string {
  const w = sonKelime(n);
  const v = sesliler(w).pop() ?? 'e';
  const kalin = KALIN.includes(v);
  const dort = v === 'a' || v === 'ı' ? 'ı' : v === 'e' || v === 'i' ? 'i' : v === 'o' || v === 'u' ? 'u' : 'ü';
  const sesli = sesliyleBiter(w);
  switch (tip) {
    case 'den':
      return `'${sert(w) ? 't' : 'd'}${kalin ? 'an' : 'en'}`;
    case 'de':
      return `'${sert(w) ? 't' : 'd'}${kalin ? 'a' : 'e'}`;
    case 'e':
      return `'${sesli ? 'y' : ''}${kalin ? 'a' : 'e'}`;
    case 'i': // possessive: cironun %35'i, %27'si
      return `'${sesli ? 's' : ''}${dort}`;
    case 'ini': // possessive + accusative: cironun %35'ini, %27'sini
      return `'${sesli ? 's' : ''}${dort}n${dort}`;
    case 'in': // genitive: 2'nin, 9'un
      return `'${sesli ? 'n' : ''}${dort}n`;
  }
}

/** "%35" + suffix, from a fraction. */
export const yuzdeEk = (f: number, tip: Ek) => {
  const n = Math.round(f * 100);
  return `%${n.toLocaleString('tr-TR')}${ek(n, tip)}`;
};
