// In-browser backend for the live demo: the real @makas/core API on PGlite (Postgres in WebAssembly).
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { createApi, fromPGlite, migrate, randomToken, seedDemo, seedSample, DEMO_LOGIN, SAMPLE_LOGINS, type Database, type SampleKind } from '@makas/core';
import type { Transport } from './api';

// PBKDF2 stands in for argon2 here (argon2 is native code on the server).
async function pbkdf2(plain: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(plain), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 100_000 }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
const deps = {
  async hashPassword(plain: string) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return `pbkdf2$${btoa(String.fromCharCode(...salt))}$${await pbkdf2(plain, salt)}`;
  },
  async verifyPassword(hash: string, plain: string) {
    const [, s, h] = hash.split('$');
    if (!s || !h) return false;
    const salt = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    return (await pbkdf2(plain, salt)) === h;
  },
};

export const DEMO_KEYS = { service: randomToken(), admin: randomToken() };
export { DEMO_LOGIN };

let lite: PGlite | null = null;
const DATA_DIR = 'idb://fade-demo-v4';
// Earlier demo databases (with sample data) are removed so every visitor starts from the empty shop.
const OLD_DBS = ['/pglite/makas-demo-v1', '/pglite/makas-demo-v2', '/pglite/fade-demo-v3'];

/** ?ornek=berber or ?ornek=kuafor opens a lived-in sample shop (website "try with sample data"). */
export function sampleKind(): SampleKind | null {
  const v = new URLSearchParams(location.search).get('ornek');
  return v === 'berber' || v === 'barber' ? 'barber' : v === 'kuafor' || v === 'salon' ? 'salon' : null;
}

export function demoLogin() {
  const k = sampleKind();
  return k ? SAMPLE_LOGINS[k] : DEMO_LOGIN;
}

export async function startDemo(): Promise<Transport> {
  const kind = sampleKind();
  for (const name of OLD_DBS) {
    try {
      indexedDB.deleteDatabase(name);
    } catch {
      /* ignore */
    }
  }
  try {
    lite = await PGlite.create({ dataDir: kind ? `idb://fade-sample-${kind}-v1` : DATA_DIR, extensions: { btree_gist }, parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) } });
  } catch {
    // IndexedDB blocked (private mode): fall back to memory.
    lite = await PGlite.create({ extensions: { btree_gist }, parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) } });
  }
  const db: Database = fromPGlite(lite as any);
  await migrate(db);
  if (kind) await seedSample(db, kind, { hashPassword: deps.hashPassword, now: new Date() });
  else await seedDemo(db, { hashPassword: deps.hashPassword, now: new Date() });
  const handle = createApi({
    db,
    deps,
    config: {
      jwtSecret: randomToken() + randomToken(),
      serviceApiKey: DEMO_KEYS.service,
      adminApiKey: DEMO_KEYS.admin,
      accessTtlSec: 900,
      refreshTtlSec: 60 * 60 * 24 * 30,
      trialDays: 14,
      now: () => new Date(),
    },
    log: (e) => console.error(e),
  });
  return {
    async request(method, path, body, authorization) {
      const url = new URL(path, 'http://demo');
      const res = await handle({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, authorization });
      // Same wire format as the server: JSON in, JSON out.
      return { status: res.status, body: res.body === undefined ? undefined : JSON.parse(JSON.stringify(res.body)) };
    },
  };
}

export async function resetDemo() {
  await lite?.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('/pglite/fade-demo-v4');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  location.reload();
}
