# Security & privacy

## Security checklist

| Requirement | How |
|---|---|
| Tenant isolation | `shop_id` filter in every query **and** Postgres RLS (`FORCE`) under the `makas_tenant` role; composite FKs; foreign ids → 404. Tested in `api/test/tenant-isolation.test.ts`, including a raw `select * from clients` that still only sees its own shop. |
| Password hashing | argon2id (19 MiB, t=2, p=1). Unknown emails do the same hashing work, so timing does not reveal accounts. |
| Tokens | HS256 access token, 15 min, audience-bound. Opaque refresh token (32 random bytes), stored as SHA-256, 30 days, rotated on every use; reuse of a rotated token revokes the whole family. Logout revokes. |
| Rate limiting | 300 req/min per IP overall, 10 req/min on `/auth/*`. |
| Input validation | zod schema on every body and query; E.164 phones; amount bounds; uuid ids; 64 KB body limit. DB `check` constraints as a second net. |
| Secrets | Only in environment variables. `.env.example` keys are empty (enforced by a test). Production refuses to boot without `JWT_SECRET`, `SERVICE_API_KEY`, `ADMIN_API_KEY` of 32+ chars. Service and admin keys are compared in constant time. |
| HTTPS only | Caddy terminates TLS with automatic certificates and HSTS; the API rejects non-HTTPS requests in production. |
| CORS | Allow-list of the app's own origin(s) only (`CORS_ORIGINS`). |
| Headers | helmet (HSTS, nosniff, frame-ancestors, etc.); `cache-control: no-store` on API responses. |
| Least privilege | The tenant role can only `select/insert` on `audit_log` and `feedback` (append-only); it cannot touch `subscriptions` or delete shops. |
| Errors | One shape; database errors are mapped to stable codes and never echo SQL or stack traces. |

## Privacy checklist

| Requirement | How |
|---|---|
| Consent | Adding a client requires the barber to confirm consent; `consent_at` is stamped. Without it, no reminder row is ever written. |
| Opt-out | Every template ends with a STOP line. A STOP reply (`POST /reminders/optout`) or a manual revoke stops the queue immediately; the worker endpoint re-checks consent before handing out a message. |
| Data minimisation | Client = name, phone, language, channel, consent, short note. Lists show a masked phone. |
| Phone access audit | `client.phone_read` (UI reveal), `client.phone_change`, `client.phone_read_worker` (each number handed to the message worker) in `audit_log`. |
| Export | `GET /shops/me/export`: one JSON file with every row the shop owns (still available when locked). |
| Erasure | `DELETE /shops/me` with password: cascades through every table. |
| Retention | Cancelled subscriptions keep data 90 days, then a daily job deletes the shop (`npm run retention -w api` or `POST /admin/retention/run`). |
| Speech | Speech-to-text runs in the browser (Web Speech API); audio never reaches our servers. |

## Reporting
Security issues: please open a private advisory on the repository rather than a public issue.
