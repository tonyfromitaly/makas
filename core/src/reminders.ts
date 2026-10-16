import { DateTime } from 'luxon';
import type { Queryable } from './db';

export type TemplateKey = 'reminder_day_before' | 'reminder_day_of';
export type Lang = 'tr' | 'en' | 'es';

// Every template ends with an opt-out line (STOP), as required by TCPA and WhatsApp policy.
export const TEMPLATES: Record<Lang, Record<TemplateKey, string>> = {
  tr: {
    reminder_day_before:
      'Merhaba {name}, yarın {time} için {shop} randevunuz var ({service}). Görüşmek üzere!\nMesaj almak istemiyorsanız STOP yazın.',
    reminder_day_of:
      '{name}, bugün {time} randevunuzu hatırlatırız. {shop}\nÇıkmak için STOP yazın.',
  },
  en: {
    reminder_day_before:
      'Hi {name}, your {service} at {shop} is tomorrow at {time}. See you soon!\nReply STOP to opt out.',
    reminder_day_of: '{name}, a reminder: your appointment at {shop} is today at {time}.\nReply STOP to opt out.',
  },
  es: {
    reminder_day_before:
      'Hola {name}, tu cita de {service} en {shop} es mañana a las {time}. ¡Te esperamos!\nResponde STOP para no recibir más mensajes.',
    reminder_day_of: '{name}, te recordamos tu cita en {shop} hoy a las {time}.\nResponde STOP para darte de baja.',
  },
};

export function renderTemplate(lang: Lang, key: TemplateKey, vars: Record<string, string>) {
  const tpl = (TEMPLATES[lang] ?? TEMPLATES.en)[key];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export interface ScheduleRule {
  timezone: string;
  dayBeforeHour: number;
  hoursBefore: number;
}

/** Day before at local HH:00, and N hours before on the day. Slots already in the past are skipped. */
export function computeSchedule(startsAt: Date, rule: ScheduleRule, now: Date) {
  const local = DateTime.fromJSDate(startsAt, { zone: rule.timezone });
  const dayBefore = local.minus({ days: 1 }).set({ hour: rule.dayBeforeHour, minute: 0, second: 0, millisecond: 0 });
  const dayOf = local.minus({ hours: rule.hoursBefore });
  return [
    { key: 'reminder_day_before' as const, at: dayBefore.toJSDate() },
    { key: 'reminder_day_of' as const, at: dayOf.toJSDate() },
  ].map((s) => ({ ...s, late: s.at.getTime() <= now.getTime() }));
}

/**
 * Writes the two reminder rows for an appointment. A client without consent gets no rows at all.
 * Slots whose time has already passed are written as skipped, so the timeline stays honest.
 */
export async function enqueueReminders(db: Queryable, appointmentId: string, now: Date) {
  const { rows } = await db.query(
    `select a.id, a.shop_id, a.client_id, a.starts_at, c.channel_pref, c.consent_status,
            s.timezone, s.reminder_day_before_hour, s.reminder_hours_before
       from appointments a
       join clients c on c.id = a.client_id
       join shops s on s.id = a.shop_id
      where a.id = $1 and a.status = 'booked'`,
    [appointmentId],
  );
  const a = rows[0];
  if (!a || a.consent_status !== 'granted') return 0;
  const slots = computeSchedule(new Date(a.starts_at), {
    timezone: a.timezone,
    dayBeforeHour: a.reminder_day_before_hour,
    hoursBefore: a.reminder_hours_before,
  }, now);
  for (const s of slots) {
    await db.query(
      `insert into reminder_queue (shop_id, appointment_id, client_id, channel, template_key, scheduled_at, status, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [a.shop_id, a.id, a.client_id, a.channel_pref, s.key, s.at, s.late ? 'skipped' : 'queued', s.late ? 'too_late' : null],
    );
  }
  return slots.length;
}

/** Drops unsent reminders for an appointment (cancel, done, missed or a time change). */
export async function dropQueued(db: Queryable, where: { appointmentId?: string; clientId?: string }, reason: string) {
  const col = where.appointmentId ? 'appointment_id' : 'client_id';
  const id = where.appointmentId ?? where.clientId;
  const { rows } = await db.query(
    `update reminder_queue set status = 'skipped', error = $2, locked_until = null
      where ${col} = $1 and status = 'queued' returning id`,
    [id, reason],
  );
  return rows.length;
}
