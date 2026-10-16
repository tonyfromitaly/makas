import { useState } from 'react';
import { useApp } from '../state';
import { Icon } from './ui';

/** Opens Stripe's customer portal (card, invoices, cancel). Owners only; hidden in the browser demo. */
export function ManagePlan({ renew = false }: { renew?: boolean }) {
  const { api, t, me, demo, fail } = useApp();
  const [busy, setBusy] = useState(false);
  if (demo || me.user.role !== 'owner') return null;
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
