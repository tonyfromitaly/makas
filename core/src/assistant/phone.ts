/** Pulls a phone number out of free text (spoken numbers come as digit groups) and returns it with the text minus the number. */
export function extractPhone(text: string): { raw: string; rest: string } | null {
  const m = text.match(/(\+?\d[\d\s().-]{6,}\d)/g);
  if (!m) return null;
  for (const cand of m) {
    const digits = cand.replace(/\D/g, '');
    if (digits.length >= 10 || (cand.trim().startsWith('+') && digits.length >= 8)) {
      return { raw: cand.trim(), rest: text.replace(cand, ' ').replace(/\s+/g, ' ').trim() };
    }
  }
  return null;
}

const DIAL: Record<string, { cc: string; national: number; trunk?: string }> = {
  US: { cc: '1', national: 10 },
  CA: { cc: '1', national: 10 },
  TR: { cc: '90', national: 10, trunk: '0' },
  MX: { cc: '52', national: 10 },
  ES: { cc: '34', national: 9 },
  GB: { cc: '44', national: 10, trunk: '0' },
  DE: { cc: '49', national: 11, trunk: '0' },
};

/** Local or international input → E.164, using the shop's country for local numbers. Null when it can't be sure. */
export function toE164(raw: string, country: string): string | null {
  const t = raw.trim();
  let digits = t.replace(/\D/g, '');
  if (t.startsWith('+')) return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.startsWith('00')) return /^[1-9]\d{6,14}$/.test(digits.slice(2)) ? `+${digits.slice(2)}` : null;
  const d = DIAL[country.toUpperCase()];
  if (!d) return null;
  if (d.trunk && digits.startsWith(d.trunk) && digits.length === d.national + 1) digits = digits.slice(1);
  if (digits.length === d.national) return `+${d.cc}${digits}`;
  if (digits.startsWith(d.cc) && digits.length === d.national + d.cc.length) return `+${digits}`;
  return null;
}
