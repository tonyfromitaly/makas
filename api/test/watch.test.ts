import { afterEach, describe, expect, it } from 'vitest';
import { alertPlan, healthChecks, markSent, runExclusive, withSystem } from '@makas/core';
import { alertText } from '../src/alerts';
import { ADMIN_KEY, setup } from './helpers';

let env: Awaited<ReturnType<typeof setup>> | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

const job = (holder: string, now: () => Date, name = 'sync') => ({ name, holder, leaseMinutes: 55, now });

describe('hourly jobs run on one server copy at a time', () => {
  it('a second copy skips while the first holds the lease, and runs once it is released', async () => {
    env = await setup();
    const now = () => env!.clock.now;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const runs: string[] = [];
    const first = runExclusive(env.db, job('a', now), async () => {
      runs.push('a');
      await gate;
    });
    await new Promise((r) => setTimeout(r, 50));
    const second = await runExclusive(env.db, job('b', now), async () => runs.push('b'));
    expect(second.ran).toBe(false);
    release();
    expect((await first).ran).toBe(true);
    expect((await runExclusive(env.db, job('b', now), async () => runs.push('b'))).ran).toBe(true);
    expect(runs).toEqual(['a', 'b']);
  });

  it('a lease left by a crashed copy expires and another copy takes over', async () => {
    env = await setup();
    await withSystem(env.db, (tx) =>
      tx.query(`insert into job_runs (name, holder, locked_until) values ('sync', 'dead', $1::timestamptz + interval '10 minutes')`, [env!.clock.now]),
    );
    const now = () => env!.clock.now;
    expect((await runExclusive(env.db, job('b', now), async () => 1)).ran).toBe(false);
    env.clock.now = new Date(env.clock.now.getTime() + 11 * 60_000);
    expect((await runExclusive(env.db, job('b', now), async () => 1)).ran).toBe(true);
  });

  it('a failure is recorded, rethrown and frees the lease', async () => {
    env = await setup();
    const now = () => env!.clock.now;
    await expect(runExclusive(env.db, job('a', now), async () => { throw new Error('square down'); })).rejects.toThrow('square down');
    const row = (await withSystem(env.db, (tx) => tx.query(`select * from job_runs where name = 'sync'`))).rows[0];
    expect(row.last_error).toBe('square down');
    expect(row.locked_until).toBeNull();
    expect(row.last_ok_at).toBeNull();
    expect((await runExclusive(env.db, job('b', now), async () => 1)).ran).toBe(true);
  });
});

describe('health checks', () => {
  const by = (cs: { name: string; ok: boolean }[], n: string) => cs.find((c) => c.name === n)!;

  it('jobs: fine before the first run and while it runs, failing after a failed run or 3 silent hours', async () => {
    env = await setup();
    const at = () => env!.clock.now;
    const check = async () => by(await healthChecks(env!.db, { now: at(), sending: false, jobs: ['sync'] }), 'job sync');
    expect((await check()).ok).toBe(true);

    let release!: () => void;
    const running = runExclusive(env.db, job('a', at), () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 50));
    expect((await check()).ok).toBe(true);
    release();
    await running;
    expect((await check()).ok).toBe(true);

    env.clock.now = new Date(at().getTime() + 4 * 3600_000);
    expect((await check()).ok).toBe(false);

    await runExclusive(env.db, job('a', at), async () => 1);
    expect((await check()).ok).toBe(true);
    await runExclusive(env.db, job('a', at), async () => { throw new Error('boom'); }).catch(() => {});
    const failed = await check();
    expect(failed.ok).toBe(false);
    expect((failed as any).detail).toContain('boom');
  });

  it('reminders: late rows count only when a channel is on', async () => {
    env = await setup();
    const shop = await env.registerShop('Late');
    const appt = await env.call('POST', '/appointments', {
      token: shop.token,
      body: { client_id: shop.client.id, service_id: shop.service.id, starts_at: '2026-10-16T15:00:00Z' },
    });
    expect(appt.status).toBe(201);
    const queued = (await withSystem(env.db, (tx) => tx.query(`select count(*)::int as n from reminder_queue where status = 'queued'`))).rows[0].n;
    expect(queued).toBeGreaterThan(0);
    const later = new Date('2026-10-16T16:00:00Z');
    expect(by(await healthChecks(env.db, { now: later, sending: false }), 'reminders').ok).toBe(true);
    expect(by(await healthChecks(env.db, { now: later, sending: true }), 'reminders').ok).toBe(false);
    expect(by(await healthChecks(env.db, { now: env.clock.now, sending: true }), 'reminders').ok).toBe(true);
  });

  it('server errors: too many 5xx in 15 minutes', async () => {
    env = await setup();
    expect(by(await healthChecks(env.db, { now: env.clock.now, sending: false, errors5xx: 3 }), 'server errors').ok).toBe(true);
    expect(by(await healthChecks(env.db, { now: env.clock.now, sending: false, errors5xx: 25 }), 'server errors').ok).toBe(false);
  });

  it('the public probe says only what is failing; the operator sees the details', async () => {
    env = await setup('2026-10-15T09:00:00Z', { health: () => ({ sending: false, errors5xx: 0, jobs: ['sync'] }) });
    expect(await env.call('GET', '/health/ready')).toEqual({ status: 200, body: { ok: true, failing: [] } });
    const now = () => env!.clock.now;
    await runExclusive(env.db, job('a', now), async () => { throw new Error('token expired for shop 123'); }).catch(() => {});
    const ready = await env.call('GET', '/health/ready');
    expect(ready).toEqual({ status: 503, body: { ok: false, failing: ['job sync'] } });
    expect(JSON.stringify(ready.body)).not.toContain('token');

    expect((await env.call('GET', '/admin/health')).status).toBe(401);
    const res = await env.app.inject({ method: 'GET', url: '/admin/health', headers: { authorization: `Bearer ${ADMIN_KEY}` } });
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.checks.find((c: any) => c.name === 'job sync').detail).toContain('token expired');
  });
});

describe('alerts', () => {
  const t0 = new Date('2026-10-21T10:00:00Z');
  const h = (n: number) => new Date(t0.getTime() + n * 3600_000);
  const bad = { name: 'connections', ok: false, detail: 'square: 2 not synced in 24 h' };
  const good = { name: 'connections', ok: true, detail: '' };

  it('tells once, repeats after 6 hours while still broken, then says when it recovers', () => {
    const sent = new Map<string, Date>();
    let p = alertPlan([bad], sent, t0);
    expect(p.problems.map((c) => c.name)).toEqual(['connections']);
    markSent(p, sent, t0);
    expect(alertPlan([bad], sent, h(1)).problems).toEqual([]);
    p = alertPlan([bad], sent, h(6));
    expect(p.problems).toHaveLength(1);
    markSent(p, sent, h(6));
    p = alertPlan([good], sent, h(7));
    expect(p.recovered).toEqual(['connections']);
    markSent(p, sent, h(7));
    expect(alertPlan([good], sent, h(8))).toEqual({ problems: [], recovered: [] });
  });

  it('one readable message per round', () => {
    expect(alertText({ problems: [bad, { name: 'reminders', ok: false, detail: '' }], recovered: ['job sync'] })).toEqual({
      subject: '2 problems: connections, reminders',
      lines: ['✗ connections: square: 2 not synced in 24 h', '✗ reminders', '✓ job sync is fine again'],
    });
    expect(alertText({ problems: [], recovered: ['database'] }).subject).toBe('recovered: database');
  });
});
