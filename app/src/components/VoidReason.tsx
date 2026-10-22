import { useState } from 'react';
import { useApp } from '../state';

export type Reason = 'client_cancelled' | 'no_show' | 'wrong_entry' | 'refund' | 'duplicate' | 'shop_cancelled' | 'other';

/**
 * Asks why before a sale is voided or a visit cancelled. The reason (and an optional note) is kept with
 * the record, so the owner and Mona can later say how many were cancelled and why.
 */
export function VoidReason({
  title,
  reasons,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  reasons: Reason[];
  confirm: string;
  onConfirm(reason: Reason, note: string): void;
  onCancel(): void;
}) {
  const { t } = useApp();
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  return (
    <div className="stack void-reason">
      <p className="mini-title">{title}</p>
      <div className="chips" role="radiogroup" aria-label={title}>
        {reasons.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} className={`chip-btn ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
            {t(`reason_${r}` as any)}
          </button>
        ))}
      </div>
      <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t('reasonNote')} aria-label={t('reasonNote')} />
      <div className="row">
        <button className="btn" type="button" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button className="btn danger" type="button" disabled={!reason} onClick={() => reason && onConfirm(reason, note.trim())}>
          {confirm}
        </button>
      </div>
    </div>
  );
}
