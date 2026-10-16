import { useApp } from '../state';
import { Icon } from '../components/ui';
import { ExportButton } from './Settings';
import { SupportChat } from '../components/SupportChat';
import { ManagePlan } from '../components/ManagePlan';

export function Locked() {
  const { t, me, signOut } = useApp();
  return (
    <div className="screen locked">
      <div className="lock-hero">
        <span className="logo">
          <Icon name="lock" size={30} />
        </span>
        <h1>{t('lockedTitle')}</h1>
        <p>{t('lockedBody')}</p>
        <span className={`chip sub-${me.subscription?.status}`}>
          {t('subscription')}: {t(`sub_${me.subscription?.status}` as any)}
        </span>
        <ManagePlan renew />
      </div>
      <SupportChat />
      <section className="card stack">
        {me.user.role === 'owner' && <ExportButton />}
        <button className="btn" onClick={signOut}>
          {t('logout')}
        </button>
      </section>
    </div>
  );
}
