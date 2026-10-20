// A shop deleted less than 30 days ago: nothing works except taking it back, downloading the data,
// talking to us and signing out. On the date shown everything is erased for good.
import { useState } from 'react';
import { useApp } from '../state';
import { Icon } from '../components/ui';
import { ExportButton } from './Settings';
import { SupportChat } from '../components/SupportChat';
import { dateLabel } from '../format';

export function Suspended() {
  const { api, t, me, lang, signOut, reloadMe, fail, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const owner = me.user.role === 'owner';
  const when = me.shop.purge_after ? dateLabel(me.shop.purge_after.slice(0, 10), lang, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const restore = async () => {
    setBusy(true);
    try {
      await api.post('/shops/me/restore');
      await reloadMe();
      toast(t('shopRestored'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen locked">
      <div className="lock-hero">
        <span className="logo">
          <Icon name="trash" size={30} />
        </span>
        <h1>{t('suspendedTitle')}</h1>
        <p>{t(owner ? 'suspendedBody' : 'suspendedStaff', { date: when })}</p>
        {owner && (
          <button className="btn primary block" disabled={busy} onClick={restore}>
            {t('restoreShop')}
          </button>
        )}
      </div>
      <SupportChat />
      <section className="card stack">
        {owner && <ExportButton />}
        <button className="btn" onClick={signOut}>
          {t('logout')}
        </button>
      </section>
    </div>
  );
}
