# Operations

## Run
* Dev, zero install: `npm install && npm run dev` (PGlite in `api/.data`, demo shop seeded).
* Production: `cp .env.example .env`, fill every secret (`openssl rand -base64 48`), set `APP_DOMAIN`,
  `docker compose up -d`. Migrations run on API start; `npm run migrate -w api` runs them by hand.

## Daily database backup
The `backup` service in `docker-compose.yml` runs `pg_dump -Fc` every day at 03:00 (container time)
into `./backups/makas-YYYY-MM-DD.dump` and keeps 14 days.

* Copy `./backups` off the host as well (object storage with versioning, e.g. `rclone sync`, or a
  managed Postgres with point-in-time recovery, which replaces this service).
* Restore: `pg_restore -h <host> -U makas -d makas --clean --if-exists makas-2026-10-16.dump`
* Test a restore once a month into a scratch database.

## Subscriptions (v1, manual)
There is no payment provider yet. The operator flips status with the admin key:

```bash
curl -X PATCH https://$APP_DOMAIN/api/admin/shops/<shop_id>/subscription \
  -H "authorization: Bearer $ADMIN_API_KEY" -H 'content-type: application/json' \
  -d '{"status":"active","current_period_end":"2026-11-16T00:00:00Z"}'
```

`trial` and `active` (with `current_period_end` in the future or empty) unlock the app; anything
else shows the lock screen (feedback and export stay available). Reminders for locked shops are
skipped at send time. Stripe columns (`stripe_customer_id`, `stripe_subscription_id`) are reserved.

## Feedback
`GET /api/admin/feedback` with the admin key lists every message with the shop name.

## Retention (90 days after cancel)
Run daily, e.g. cron on the host:

```
15 4 * * * cd /srv/makas && docker compose exec -T api npm run retention
```

It deletes shops whose subscription has been `cancelled` for more than `RETENTION_DAYS` (90).
The same job is exposed as `POST /admin/retention/run`.

## Message worker (Tony side) loop
Every minute: `GET /reminders/due?until=<now>` with the service key → send each `message`
(or the provider template `template_key` + `vars`) → `POST /reminders/:id/result`. Unreported rows
come back after the 5-minute lease. Forward STOP replies to `POST /reminders/optout`.
