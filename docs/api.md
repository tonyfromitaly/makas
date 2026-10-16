# API contract (v1)

REST, JSON. Every call except `/auth/*` and `/health` needs `Authorization: Bearer <token>`.
Three credentials, never interchangeable:

| Credential | Who | Reaches |
|---|---|---|
| user access token (JWT, 15 min) | shop app | everything below except reminders and admin |
| `SERVICE_API_KEY` | message infrastructure | `/reminders/due`, `/reminders/:id/result`, `/reminders/optout` |
| `ADMIN_API_KEY` | operator | `/admin/*` |

**Errors** always look like `{"error": {"code": "SLOT_TAKEN", "message": "..."}}`.
Common codes: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `INVALID_CREDENTIALS` 401, `TOKEN_REUSED` 401,
`SUBSCRIPTION_INACTIVE` 402, `FORBIDDEN` 403, `NOT_FOUND` 404, `SLOT_TAKEN` 409, `DUPLICATE` 409,
`ALREADY_FINAL` 409, `PARSE_FAILED` 422, `RATE_LIMITED` 429.

**Lists** are paged: `?page=1&page_size=50` → `{"data": [...], "page": 1, "page_size": 50, "total": 123}`.

## Auth
| | |
|---|---|
| `POST /auth/register` | `{shop_name, owner_name, email, password, country, timezone, language, currency}` → 201 tokens, user, shop. Opens shop + owner + 14-day trial + one barber. |
| `POST /auth/login` | `{email, password}` → `{access_token, refresh_token, expires_in, user}` |
| `POST /auth/refresh` | `{refresh_token}` → new pair. Rotation; reusing an old token ends the whole session family. |
| `POST /auth/logout` | `{refresh_token}` → 204, family revoked |

Auth endpoints are limited to 10 requests/min per IP.

## Shop
| | |
|---|---|
| `GET /shops/me` | `{shop, user, subscription, locked}` (works while locked) |
| `PATCH /shops/me` | owner: name, country, timezone, language, currency, reminder_day_before_hour, reminder_hours_before |
| `GET /shops/me/export` | owner: full JSON export (works while locked) |
| `DELETE /shops/me` | owner: `{password}` → 204, everything deleted |
| `POST /feedback` | `{message}` → 201 (works while locked) |

## Catalog
`GET/POST /services`, `PATCH /services/:id`, `DELETE /services/:id` (soft: `active=false`).
`GET/POST /barbers`, `PATCH /barbers/:id`. `?include_inactive=true` shows inactive rows.

## Clients
| | |
|---|---|
| `GET /clients?q=&filter=all\|debt\|lapsed\|risk&lapsed_days=30` | phone masked; `visits, missed, last_visit, next_at, balance_cents, risk` |
| `GET /clients/:id` | details + last 20 visits |
| `GET /clients/:id/phone` | full E.164 number; **audited** (`client.phone_read`) |
| `POST /clients` | `{name, phone_e164, language?, channel_pref?, consent: boolean, notes?}`; `consent=true` stamps `consent_at` |
| `PATCH /clients/:id` | any field + `consent`; phone change audited; revoking skips queued reminders |

## Appointments
| | |
|---|---|
| `GET /appointments?date=YYYY-MM-DD&barber_id=` | the shop-local day, with names, reminder states and `summary {expected_cents, done_cents, booked, done, missed}` |
| `POST /appointments` | `{client_id, service_id, barber_id?, starts_at (ISO) \| starts_local ("YYYY-MM-DDTHH:mm", shop time), notes?, source: manual\|voice}` → 201, two reminders queued |
| `PATCH /appointments/:id` | `{status?, starts_at?/starts_local?, barber_id?, service_id?, notes?}`; done ⇄ income row; reschedule re-queues reminders |

Voice booking has no server endpoint: the browser turns speech into text (Web Speech API), the
parser in `core/src/parse/voice.ts` drafts the booking, the barber confirms, and the app calls
`POST /appointments` with `source: "voice"`.

## Ledger (client tabs)
`GET /ledger?client_id=` → entries + `balance_cents`. `GET /ledger` → who owes, plus `outstanding_cents`.
`POST /ledger {client_id, kind: charge|payment, amount_cents, note?}` → entry + new balance.

## Books (shop accounting)
| | |
|---|---|
| `POST /books/parse` | `{text, lang?}` → `{drafts: [{kind, amount_cents, category, entry_date, note, raw_text}], engine: ai\|local}`, one draft per amount. Saves nothing. |
| `POST /books` | `{kind, category, amount_cents, entry_date, note?, raw_text?, source: manual\|ai_note}` |
| `GET /books?from=&to=&kind=` | entries |
| `DELETE /books/:id` | not for rows that come from an appointment (`LINKED_TO_APPOINTMENT`) |
| `GET /books/summary?period=day\|week\|month&date=` | `income_cents, expense_cents, net_cents, previous, by_category, series, insight`. All SQL. |

Categories: `service, product, tips, rent, supplies, utilities, wages, other`.

## Assistant
| | |
|---|---|
| `POST /assistant` | `{text, lang?}` → `{reply, drafts[], engine: ai\|local}`. Understands bookings, client registration, money notes (one draft per amount), client tabs, reminders/payments and questions. **Writes nothing**: each draft is confirmed in the app and saved through the normal endpoints (`/appointments`, `/clients`, `/books`, `/ledger`, `/tasks`). Questions are answered in `reply` with SQL-computed numbers. |
| `GET /assistant/brief` | the day's opening line: appointments, the till so far, reminders due (overdue first) |
| `GET /tasks?status=open\|done\|all&until=` | the barber's reminders and payments |
| `POST /tasks` | `{kind: reminder\|payment, title, due_date, due_time?, amount_cents?, source?}` |
| `PATCH /tasks/:id` | `{status?, title?, due_date?, amount_cents?}`; `DELETE /tasks/:id` |

Question metrics: `income, expense, net, payables` (open payment tasks due in the period, overdue included),
`receivables` (client tabs), `appointments, top_service, client_balance, reminders`; periods `today … this_year`.

LLM (optional): any OpenAI-compatible chat API (`AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`; DeepSeek by default)
returns the plan described in `core/src/assistant/plan.ts`. Output is validated; on any failure the local engine is used.

## Message infrastructure (service key)
| | |
|---|---|
| `GET /reminders/due?until=ISO&limit=100` | Leases due rows for 5 min. Each item: `{id, channel, to, language, template_key, vars, message, scheduled_at, attempt, lease_expires_at}`. Rows whose client revoked consent, whose booking changed or whose shop is locked are skipped instead of returned. Each phone handed out is audited. |
| `POST /reminders/:id/result` | `{status: sent\|failed\|skipped, provider_ref?, error?}` → 409 if already final |
| `POST /reminders/optout` | `{reminder_id}` (that shop's client) or `{phone_e164}` (every shop) → consent revoked, queue stopped |

Templates (`tr`, `en`, `es` × `reminder_day_before`, `reminder_day_of`) live in `core/src/reminders.ts`;
every one ends with a STOP opt-out line. `message` is rendered for convenience; `template_key` + `vars`
are there for providers that need pre-approved templates (WhatsApp Business).

## Parse service (Tony side, called by the API)
`POST {PARSE_SERVICE_URL}/parse`, `Authorization: Bearer PARSE_SERVICE_KEY`,
body `{text, lang, today, timezone}` → `{kind, amount_cents, category, entry_date, note}`. 4 s timeout,
output validated; on any failure the local parser is used.

## Operator (admin key)
`GET /admin/shops`, `GET /admin/feedback`, `PATCH /admin/shops/:id/subscription {status?, plan_key?, current_period_end?}`,
`POST /admin/retention/run {days?: 90}`.
