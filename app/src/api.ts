export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface Transport {
  request(method: string, path: string, body?: unknown, authorization?: string): Promise<{ status: number; body?: any }>;
}

const RT_KEY = 'makas.refresh';
const store = {
  get: () => {
    try {
      return localStorage.getItem(RT_KEY);
    } catch {
      return null;
    }
  },
  set: (v: string | null) => {
    try {
      if (v) localStorage.setItem(RT_KEY, v);
      else localStorage.removeItem(RT_KEY);
    } catch {
      /* private mode */
    }
  },
};

export function httpTransport(base: string): Transport {
  return {
    async request(method, path, body, authorization) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(authorization ? { authorization } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined };
    },
  };
}

/** Access token in memory only; the refresh token survives reloads. 401 → one silent refresh. */
export function createClient(transport: Transport, onSignedOut: () => void) {
  let access: string | null = null;
  let refreshing: Promise<boolean> | null = null;

  async function refresh(): Promise<boolean> {
    const rt = store.get();
    if (!rt) return false;
    refreshing ??= transport
      .request('POST', '/auth/refresh', { refresh_token: rt })
      .then((r) => {
        if (r.status !== 200) {
          store.set(null);
          return false;
        }
        access = r.body.access_token;
        store.set(r.body.refresh_token);
        return true;
      })
      .finally(() => (refreshing = null));
    return refreshing;
  }

  async function call<T = any>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const r = await transport.request(method, path, body, access ? `Bearer ${access}` : undefined);
    if (r.status === 401 && retry && !path.startsWith('/auth/')) {
      if (await refresh()) return call(method, path, body, false);
      onSignedOut();
    }
    if (r.status >= 400) throw new ApiFailure(r.status, r.body?.error?.code ?? 'ERROR', r.body?.error?.message ?? 'Error');
    return r.body as T;
  }

  return {
    get: <T = any>(p: string) => call<T>('GET', p),
    post: <T = any>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
    patch: <T = any>(p: string, b: unknown) => call<T>('PATCH', p, b),
    del: <T = any>(p: string, b?: unknown) => call<T>('DELETE', p, b),
    async signIn(tokens: { access_token: string; refresh_token: string }) {
      access = tokens.access_token;
      store.set(tokens.refresh_token);
    },
    async resume() {
      return refresh();
    },
    async signOut() {
      const rt = store.get();
      if (rt) await transport.request('POST', '/auth/logout', { refresh_token: rt }).catch(() => {});
      access = null;
      store.set(null);
    },
    /** Service/admin calls for the demo panel (in production these live in separate systems). */
    raw: (method: string, path: string, key: string, body?: unknown) => transport.request(method, path, body, `Bearer ${key}`),
  };
}

export type Client = ReturnType<typeof createClient>;
