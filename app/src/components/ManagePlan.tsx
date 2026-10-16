import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { Icon } from './ui';

/** Opens Stripe's customer portal (card, invoices, cancel). Owners only; hidden in the demo and while payments are off. */
export function ManagePlan({ renew = false }: { renew?: boolean }) {
  const { api, t, me, demo, fail } = useApp();
  const [busy, setBusy] = useState(false);
  // Only when the server takes payments (Stripe); hand-managed plans have no portal.
  const [billing, setBilling] = useState(false);
  useEffect(() => {
    if (demo) return;
    api.get<{ billing: boolean }>('/meta').then((m) => setBilling(m.billing)).catch(() => setBilling(false));
  }, [api, demo]);
  if (demo || !billing || me.user.role !== 'owner') return null;
  return (
    <button
      className={`btn ${renew ? 'primary' : ''}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api.post<{ url: string }>('/billing/portal');
          location.href = r.url;
        } catch (e) {
          fail(e);
          setBusy(false);
        }
      }}
    >
      <Icon name="lock" size={16} /> {renew ? t('renewSub') : t('manageSub')}
    </button>
  );
}
