# Architecture

## Three layers

```
┌──────────────────────────┐   REST + Bearer (user token)   ┌──────────────────────────┐
│  app (React PWA, phone)  │ ─────────────────────────────▶ │  api (Fastify + core)     │
└──────────────────────────┘                                │  Postgres + RLS           │
                                                            │  reminder_queue (outbox)  │
┌──────────────────────────┐   REST + Bearer (service key)  │                           │
│  message infra (Tony)    │ ◀────────── GET /reminders/due │                           │
│  WhatsApp / SMS provider │ ──── POST /reminders/:id/result│                           │
│  POST /parse (DeepSeek)  │ ◀──── POST /books/parse proxy  │                           │
└──────────────────────────┘                                └──────────────────────────┘
┌──────────────────────────┐   REST + Bearer (admin key)
│  operator (us)           │ ──── /admin/*  (subscriptions, feedback, retention)
└──────────────────────────┘
```

* The app never sends a message. Booking writes two rows to `reminder_queue`; the worker pulls,
  sends and reports back. Swapping WhatsApp Cloud API for SMS (or anything else) changes only the worker.
* The AI note parser lives on Tony's side behind `POST /parse`. The DeepSeek key never reaches this
  app. If the service is not configured or fails, a local rule parser (tr/en/es) produces the draft.
  Either way the result is only a draft until the barber confirms it.

## One core, two transports

`core/` holds every route (validation, auth rules, SQL) as a plain table of handlers, plus a
`createApi()` dispatcher. It runs in two places:

* **Server:** `api/` wraps it in Fastify and adds what only a server needs: helmet headers, CORS
  allow-list, per-IP rate limits (strict on `/auth/*`), HTTPS enforcement, argon2id, the `pg` pool.
* **Browser demo:** `app/src/demo.ts` runs the exact same `createApi()` against PGlite (Postgres
  compiled to WebAssembly, persisted in IndexedDB). The GitHub Pages demo is therefore the real
  backend logic, not a mock.

## Tenant isolation, twice

1. **Application:** every handler filters by `shop_id` taken from the verified token. An id that
   belongs to another shop is indistinguishable from a missing one → `404`.
2. **Database:** each user request runs in a transaction as the `makas_tenant` role with
   `app.shop_id` set. `FORCE ROW LEVEL SECURITY` policies on every tenant table hide and reject other
   shops' rows, so even a query that forgets its filter cannot leak. Composite foreign keys
   (`(shop_id, client_id) → clients(shop_id, id)`) make cross-shop references impossible.

Only auth, the message worker and the operator run as the system role, and those code paths are small.

## Reminder engine

* Rules per shop (`reminder_day_before_hour` = 18, `reminder_hours_before` = 2), computed in the
  shop's IANA timezone with Luxon, so DST changes land on the right wall-clock time.
* Created on booking. Cancel, done or no-show → unsent rows become `skipped`. Time or barber change →
  old rows `skipped (rescheduled)`, a fresh pair queued.
* Revoked consent → no rows are ever written; revoking later skips everything queued; granting again
  re-queues upcoming visits.
* `GET /reminders/due` leases rows for 5 minutes (`locked_until`, `FOR UPDATE SKIP LOCKED`) and
  re-checks consent, booking state and subscription at send time.

## Money

* All amounts are integer minor units (`*_cents`) with `shops.currency`.
* A done appointment owns exactly one `book_entries` row (`appointment_id unique`); undoing removes
  it. Day takings and the books summary therefore never double count.
* Summaries (`/books/summary`) are SQL aggregates. The one-line insight is computed from those
  numbers; the client only words it.

## Data model

See `core/src/migrations.ts`. Every table has `created_at` / `updated_at` (trigger-maintained).
Additions to the brief: `shops.currency`, reminder rule columns, `refresh_tokens`,
`reminder_queue.locked_until/attempts`, `book_entries.appointment_id`, `subscriptions.cancelled_at`
and Stripe placeholders, `barbers.user_id` for the future staff app.
