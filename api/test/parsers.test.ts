import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { computeSchedule, parseAmountCents, parseNoteLocal, parseVoiceAppointment } from '@makas/core';

describe('note parser (local fallback)', () => {
  const today = '2026-10-15';
  it.each([
    ['bugün 500 kazandım', { kind: 'income', amount_cents: 50000, category: 'service' }],
    ['kira 1800 ödedim', { kind: 'expense', amount_cents: 180000, category: 'rent' }],
    ['jilet aldım 40', { kind: 'expense', amount_cents: 4000, category: 'supplies' }],
    ['bahşiş 150', { kind: 'income', amount_cents: 15000, category: 'tips' }],
    ['elektrik faturası 1.250,50', { kind: 'expense', amount_cents: 125050, category: 'utilities' }],
    ['paid rent 1,200', { kind: 'expense', amount_cents: 120000, category: 'rent' }],
    ['made 640 today', { kind: 'income', amount_cents: 64000, category: 'service' }],
    ['pagué la luz 85', { kind: 'expense', amount_cents: 8500, category: 'utilities' }],
    ['gané 300 hoy', { kind: 'income', amount_cents: 30000 }],
  ])('%s', (text, expected) => {
    expect(parseNoteLocal(text, today)).toMatchObject(expected);
  });
  it('yesterday shifts the date', () => {
    expect(parseNoteLocal('dün 200 kazandım', today)?.entry_date).toBe('2026-10-14');
  });
  it('no amount, no draft', () => {
    expect(parseNoteLocal('bugün çok yoruldum', today)).toBeNull();
  });
  it('amount formats', () => {
    expect(parseAmountCents('2 bin')).toBe(200000);
    expect(parseAmountCents('12.50')).toBe(1250);
  });
});

describe('voice appointment parser', () => {
  const now = DateTime.fromISO('2026-10-15T09:00', { zone: 'Europe/Istanbul' }); // Thursday
  const lists = {
    services: [{ id: 's1', name: 'Saç kesimi' }, { id: 's2', name: 'Sakal tıraşı' }, { id: 's3', name: 'Haircut' }],
    barbers: [{ id: 'b1', name: 'Emre' }],
    clients: [{ id: 'c1', name: 'Ahmet Yılmaz' }],
  };
  it('tr: yarın saat 3te ahmet sakal', () => {
    expect(parseVoiceAppointment("yarın saat 3'te Ahmet sakal", now, lists)).toMatchObject({
      date: '2026-10-16', time: '15:00', service_id: 's2', client_id: 'c1',
    });
  });
  it('tr: cuma 14:30 yeni müşteri, emre', () => {
    expect(parseVoiceAppointment('Cuma 14:30 Kerem saç kesimi Emre', now, lists)).toMatchObject({
      date: '2026-10-16', time: '14:30', service_id: 's1', barber_id: 'b1', client_id: null, client_name: 'Kerem',
    });
  });
  it('tr: bugün beş buçukta', () => {
    expect(parseVoiceAppointment('bugün beş buçukta Ahmet', now, lists)).toMatchObject({ date: '2026-10-15', time: '17:30' });
  });
  it('en: tomorrow at 11 am haircut for John', () => {
    expect(parseVoiceAppointment('tomorrow at 11 am haircut for John', now, lists)).toMatchObject({
      date: '2026-10-16', time: '11:00', service_id: 's3', client_name: 'John',
    });
  });
  it('es: el lunes a las 4 y media', () => {
    expect(parseVoiceAppointment('el lunes a las 4 y media Pedro', now, lists)).toMatchObject({
      date: '2026-10-19', time: '16:30', client_name: 'Pedro',
    });
  });
});

describe('reminder schedule', () => {
  it('day before at 18:00 local and 2h before, across DST', () => {
    // Nov 2 2026: US DST ends on Nov 1.
    const s = computeSchedule(new Date('2026-11-02T15:00:00Z'), { timezone: 'America/New_York', dayBeforeHour: 18, hoursBefore: 2 }, new Date('2026-10-01'));
    expect(s[0].at.toISOString()).toBe('2026-11-01T23:00:00.000Z'); // 18:00 EST
    expect(s[1].at.toISOString()).toBe('2026-11-02T13:00:00.000Z');
  });
  it('a slot that has already passed is marked late', () => {
    const s = computeSchedule(new Date('2026-10-15T20:00:00Z'), { timezone: 'UTC', dayBeforeHour: 18, hoursBefore: 2 }, new Date('2026-10-15T10:00:00Z'));
    expect(s.map((x) => x.late)).toEqual([true, false]);
  });
});
