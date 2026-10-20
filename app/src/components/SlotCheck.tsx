// "That time is taken": checks the chosen time as it changes and offers the nearest free times,
// one tap each. Used by the voice draft card and the appointment form.
import { useEffect, useState } from 'react';
import { useApp } from '../state';

export function SlotCheck({ date, time, serviceId, barberId, onPick }: { date?: string; time?: string | null; serviceId?: string | null; barberId?: string | null; onPick(time: string, barberId: string): void }) {
  const { api, t } = useApp();
  const [r, setR] = useState<{ taken: boolean; reason: 'busy' | 'past' | 'closed' | null; hours: { from: string; to: string }; slots: { time: string; barber_id: string; barber_name: string }[] } | null>(null);
  useEffect(() => {
    setR(null);
    if (!date || !time || !serviceId) return;
    let live = true;
    const q = new URLSearchParams({ date, service_id: serviceId, near: time.slice(0, 5), ...(barberId ? { barber_id: barberId } : {}) });
    const id = setTimeout(() => api.get(`/appointments/free?${q}`).then((x: any) => live && setR(x)).catch(() => {}), 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [api, date, time, serviceId, barberId]);
  if (!r?.taken) return null;
  return (
    <div className="notice warn small slot-check" role="status">
      <span>
        {r.reason === 'past' ? t('slotPast') : r.reason === 'closed' ? t('slotClosed', { from: r.hours.from, to: r.hours.to }) : t('slotTaken')}{' '}
        {r.slots.length ? t('slotNearest') : t('slotNoneLeft')}
      </span>
      {!!r.slots.length && (
        <div className="chips wrap">
          {r.slots.map((s) => (
            <button type="button" key={`${s.time}-${s.barber_id}`} className="chip-btn" onClick={() => onPick(s.time, s.barber_id)}>
              {s.time}
              {!barberId && <span className="muted"> · {s.barber_name}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
