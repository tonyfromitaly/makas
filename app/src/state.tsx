import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Client } from './api';
import { ApiFailure } from './api';
import { makeT, type Lang, type T } from './i18n';
import { money } from './format';

export interface Me {
  shop: {
    id: string;
    name: string;
    timezone: string;
    language: Lang;
    currency: string;
    country: string;
    reminder_day_before_hour: number;
    reminder_hours_before: number;
    /** What the setup wizard switched on; null for shops set up before it (see DEFAULT_MODULES). */
    modules?: string[] | null;
    look?: { skin: string; accent: string | null } | null;
    set_up?: boolean;
    agent_name?: string | null;
    /** Deleted and waiting out its 30 days; purge_after is when it goes for good. */
    deleted_at?: string | null;
    purge_after?: string | null;
    slug?: string | null;
    booking_enabled?: boolean;
  };
  user: { id: string; name: string; email: string; role: 'owner' | 'barber' };
  /** The team member behind this login: always for staff, and for an owner who works the floor. */
  staff?: { id: string; name: string; title: string | null; pay_model: string; station_id: string | null; station_name: string | null } | null;
  subscription: { plan_key: string; status: string; current_period_end: string | null };
  locked: boolean;
}

interface AppState {
  api: Client;
  me: Me;
  lang: Lang;
  setLang(l: Lang): void;
  t: T;
  fmt(cents: number): string;
  reloadMe(): Promise<void>;
  toast(msg: string): void;
  fail(e: unknown): void;
  signOut(): void;
  demo: boolean;
  bump: number;
  refreshAll(): void;
  openAssistant(mic?: boolean): void;
  showWelcome(): void;
  markSupportRead(): void;
  /** Is this module on for the shop? */
  has(module: string): boolean;
  openSetup(): void;
  /** Open a tab, optionally on a filter or section (agent note buttons). */
  go(tab: 'today' | 'till' | 'clients' | 'assistant' | 'books' | 'settings', hint?: string): void;
}

/** Shops from before the wizard keep what they had, except store credit, which is now opt-in. */
export const DEFAULT_MODULES = ['defter', 'randevu', 'hatirlatma', 'musteri', 'personel', 'bahsis', 'rontgen', 'kasa-kocu'];

export const Ctx = createContext<AppState>(null as any);
export const useApp = () => useContext(Ctx);

/** Small data hook: loads on mount and whenever deps or the global refresh counter change. */
export function useLoad<R>(fn: () => Promise<R>, deps: unknown[]) {
  const { bump, fail } = useApp();
  const [data, setData] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => live && setData(d))
      .catch((e) => live && fail(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, bump]);
  return { data, loading, reload, setData };
}

export function errorText(t: T, e: unknown) {
  if (e instanceof ApiFailure) {
    const k = `error_${e.code}` as any;
    const s = t(k);
    return s === k ? e.message || t('error_generic') : s;
  }
  return t('error_generic');
}

export function useMoney(me: Me, lang: Lang) {
  return (c: number) => money(c, me.shop.currency, lang);
}

export { makeT };
