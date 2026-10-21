import { withSystem, type Database, type Queryable } from './db';

// Keeping the server honest when nobody is looking at the logs:
//   runExclusive – an hourly job runs on one server copy at a time, and its last success/failure is kept
//   healthChecks – what is wrong right now (database, reminders, connections, jobs, server errors)
//   alertPlan    – which of those to tell the operator about now (new problems, still-open ones every
//                  few hours, and recoveries), so one outage is a handful of messages, not one per check

/** Runs fn only if no other copy holds the job's lease; records the outcome either way. */
export async function runExclusive<T>(
  db: Database,
  job: { name: string; holder: string; leaseMinutes: number; now: () => Date },
  fn: () => Promise<T>,
): Promise<{ ran: false } | { ran: true; result: T }> {
  const now = job.now();
  const got = await withSystem(db, async (tx) => {
    await tx.query(`insert into job_runs (name) values ($1) on conflict (name) do nothing`, [job.name]);
    return (
      await tx.query(
        `update job_runs set holder = $2, locked_until = $3::timestamptz + make_interval(mins => $4), last_started_at = $3, updated_at = $3
          where name = $1 and (locked_until is null or locked_until < $3)
          returning name`,
        [job.name, job.holder, now, job.leaseMinutes],
      )
    ).rows.length;
  });
  if (!got) return { ran: false };
  try {
    const result = await fn();
    await finish(db, job, null);
    return { ran: true, result };
  } catch (e) {
    await finish(db, job, String((e as Error).message ?? e).slice(0, 500));
    throw e;
  }
}

async function finish(db: Database, job: { name: string; holder: string; now: () => Date }, error: string | null) {
  const at = job.now();
  await withSystem(db, (tx) =>
    error
      ? tx.query(`update job_runs set locked_until = null, last_error = $3, last_error_at = $4, updated_at = $4 where name = $1 and holder = $2`, [job.name, job.holder, error, at])
      : tx.query(`update job_runs set locked_until = null, last_ok_at = $3, last_error = null, last_error_at = null, updated_at = $3 where name = $1 and holder = $2`, [job.name, job.holder, at]),
  );
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface HealthInput {
  now: Date;
  /** A reminder channel is configured; without one, queued rows wait on purpose. */
  sending: boolean;
  /** Server errors (5xx) in the last window, counted by the HTTP layer. */
  errors5xx?: number;
  /** Hourly jobs expected on this server, by name. */
  jobs?: string[];
}

const REMINDER_LATE_MIN = 15;
const SYNC_STALE_HOURS = 24;
const JOB_STALE_HOURS = 3;
const ERRORS_5XX_MAX = 20;

/** What is wrong right now. Reads only; safe to call from a public probe (details stay with the operator). */
export async function healthChecks(db: Database, input: HealthInput): Promise<Check[]> {
  try {
    return await withSystem(db, (tx) => checksIn(tx, input));
  } catch (e) {
    return [{ name: 'database', ok: false, detail: String((e as Error).message ?? e).slice(0, 200) }];
  }
}

/** The same checks inside a system transaction the caller already holds (the health routes). */
export async function checksIn(tx: Queryable, input: HealthInput): Promise<Check[]> {
  const out: Check[] = [{ name: 'database', ok: true, detail: '' }];

  const late = (
    await tx.query(
      `select count(*)::int as n, min(scheduled_at) as oldest from reminder_queue
        where status = 'queued' and scheduled_at < $1::timestamptz - make_interval(mins => $2)`,
      [input.now, REMINDER_LATE_MIN],
    )
  ).rows[0];
  out.push(
    !input.sending
      ? { name: 'reminders', ok: true, detail: `no channel configured; ${late.n} waiting` }
      : { name: 'reminders', ok: late.n === 0, detail: late.n ? `${late.n} late by ${REMINDER_LATE_MIN}+ min, oldest ${iso(late.oldest)}` : '' },
  );
  const failed = (
    await tx.query(`select count(*)::int as n from reminder_queue where status = 'failed' and updated_at > $1::timestamptz - interval '24 hours'`, [input.now])
  ).rows[0].n;
  out.push({ name: 'reminder failures', ok: failed < 10, detail: `${failed} failed in 24 h` });

  // Only shops that are paying (or trying) and connected are synced; a stale one is a broken promise.
  const stale = (
    await tx.query(
      `select c.provider, count(*)::int as n from connections c
         join subscriptions s on s.shop_id = c.shop_id
         join shops sh on sh.id = c.shop_id and sh.deleted_at is null
        where c.status in ('connected', 'error') and s.status in ('trial', 'active')
          and (c.status = 'error' or c.last_sync_at is null or c.last_sync_at < $1::timestamptz - make_interval(hours => $2))
          and c.created_at < $1::timestamptz - interval '2 hours'
        group by c.provider order by c.provider`,
      [input.now, SYNC_STALE_HOURS],
    )
  ).rows;
  out.push({ name: 'connections', ok: !stale.length, detail: stale.map((r: any) => `${r.provider}: ${r.n} not synced in ${SYNC_STALE_HOURS} h`).join(', ') });

  for (const name of input.jobs ?? []) {
    const j = (await tx.query(`select last_ok_at, last_error, last_error_at, last_started_at, locked_until from job_runs where name = $1`, [name])).rows[0];
    const at = (d: unknown) => (d ? new Date(d as string).getTime() : 0);
    const recent = (d: unknown) => input.now.getTime() - at(d) < JOB_STALE_HOURS * 3600_000;
    // A success clears the error, so an error on the row is always the latest run's.
    const failing = !!j?.last_error_at;
    // Fine when it succeeded lately, is running now (started lately), or has not had its first run on a
    // server that just started. Only a run that failed after the last success, or silence, counts.
    const running = at(j?.locked_until) > input.now.getTime() && recent(j?.last_started_at);
    const ok = !failing && (!j?.last_started_at || recent(j.last_ok_at) || running);
    out.push({
      name: `job ${name}`,
      ok,
      detail: failing ? `last run failed: ${j.last_error}` : j?.last_ok_at ? `last ok ${iso(j.last_ok_at)}` : running ? 'first run in progress' : 'not run yet',
    });
  }

  if (input.errors5xx !== undefined)
    out.push({ name: 'server errors', ok: input.errors5xx < ERRORS_5XX_MAX, detail: `${input.errors5xx} in the last 15 min` });
  return out;
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '');

export const REMIND_EVERY_HOURS = 6;

/** Problems to report now: new ones, ones still open after REMIND_EVERY_HOURS, and the ones that cleared. */
export function alertPlan(checks: Check[], sent: Map<string, Date>, now: Date) {
  const problems: Check[] = [];
  const recovered: string[] = [];
  for (const c of checks) {
    const last = sent.get(c.name);
    if (!c.ok && (!last || now.getTime() - last.getTime() >= REMIND_EVERY_HOURS * 3600_000)) problems.push(c);
    if (c.ok && last) recovered.push(c.name);
  }
  return { problems, recovered };
}

/** Applies a plan once it has been delivered. */
export function markSent(plan: ReturnType<typeof alertPlan>, sent: Map<string, Date>, now: Date) {
  for (const c of plan.problems) sent.set(c.name, now);
  for (const n of plan.recovered) sent.delete(n);
}
