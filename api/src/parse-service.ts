import type { Deps } from '@makas/core';

/**
 * Client for Tony's parse service (DeepSeek runs behind it; its key lives only there).
 * Contract: POST {url}/parse  Authorization: Bearer <PARSE_SERVICE_KEY>
 *   body  {text, lang, today, timezone}
 *   reply {kind, amount_cents, category, entry_date, note}
 */
export function parseServiceClient(url: string, key: string): Deps['parseNote'] {
  if (!url || !key) return undefined;
  return async (input) => {
    const res = await fetch(new URL('/parse', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`parse service ${res.status}`);
    return res.json();
  };
}
