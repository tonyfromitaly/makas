# Monacount: how the software works (technical overview for counsel)

**Prepared for:** outside counsel reviewing the Terms of Service, Privacy Policy, DPA and SMS Terms in this folder.
**Prepared by:** the engineering side of Mona Mile Lab. **As of:** October 22, 2026.
**Status:** factual description of the code as it runs today. It is not legal analysis. Where something is planned but not live, it says so.

The goal is that every statement in the legal drafts can be checked against something here. If a draft promises something this document does not describe, the draft is wrong, not the other way round.

---

## 1. What the product is, in one paragraph

Monacount is a web app (it installs on a phone like an app, but it is a website) for small businesses that work by appointment: barbershops, hair and nail salons, and similar. The business owner and their staff use it to book appointments, ring up sales, keep a simple income-and-expense book, track what clients owe ("tabs"), work out what each staff member is owed, and send appointment reminders to clients who opted in. An assistant called **Mona** lets the owner type or say a sentence ("Tomorrow at 3, John, beard trim"; "made $100, paid $300 rent") and turns it into draft entries the owner confirms, and answers questions ("how much do I still owe this month?") from the business's own records.

Monacount is **not**: an accounting firm, a tax preparer, a payment processor, a bank, a payroll provider, or a source of financial advice. It does not file anything with any government. It does not move money.

## 2. Who is who (roles under privacy law)

| Party | Role |
|---|---|
| Mona Mile Lab (to be incorporated) | Runs the service. **Controller** of website visitors' and business owners' account data. **Processor / service provider** for the records each business keeps about its own clients. |
| The business (our customer) | **Controller** of its clients' data (names, phone numbers, visit history, tabs). Decides whom to text. |
| The business's clients | Data subjects. They never log in; they receive reminder texts only if the business recorded their consent. |
| Sub-processors | See section 9. |

## 3. Where things run

| Piece | Where | Notes |
|---|---|---|
| Website, app files, booking page | Cloudflare Pages (`monacount.com`) | Static files plus small functions that forward `/api/*` to the server. No cookies, no ad or analytics trackers; Cloudflare's own analytics script is blocked by our Content-Security-Policy. |
| API server | Render, Virginia (US) | Node.js. All business logic and every database write happens here. |
| Database | Render Postgres, Virginia (US) | One database for all businesses, separated as described in section 7. **Currently the free plan: no automated backups.** A paid plan with daily backups is required before real customer data (see section 12). |
| Company site | Cloudflare Pages (`monamilelab.com`) | A single image and the word "soon". It collects nothing: no forms, no cookies, no connection to the API. A Turkey offering is planned there later. |

Speech-to-text for Mona runs **in the user's browser** (the device's own speech recognition). Audio is never sent to our servers.

## 4. The records the app keeps

Every row below belongs to exactly one business (it carries that business's id).

| Record | What is in it |
|---|---|
| Users | Owner and staff logins: name, email, role (owner or staff), password hash. |
| Clients | Name, phone number (E.164), language, preferred channel, **consent status and the time consent was recorded**, short note. |
| Appointments | Who, which service, which staff member and chair/room, start and end time, price at booking, status (booked, done, missed, cancelled). |
| Sales and sale lines | What was sold (services, products, other), quantities, prices, tip, payment method (cash, card, other), who did the work. Card details are never entered or stored. |
| Book entries | The income-and-expense book (section 5). |
| Tabs (ledger entries) | Charges and payments per client: "what this client owes the business". |
| Reminders (tasks) | The owner's own to-dos and upcoming payments ("rent $1,800 on the 1st"). |
| Voids | A record of every voided sale and every cancelled or missed appointment, with a reason (section 5.4). |
| Staff payouts | What was paid to a staff member for a period. |
| Reminder queue | Each text that is scheduled, sent, failed or skipped, with the provider's message id. |
| Audit log | Who did what (create, change, void, export, phone-number views), when. |
| Assistant conversations and notes | What the user typed to Mona and what Mona answered; short notes Mona keeps about the business (section 8). |
| Connections | Encrypted access tokens for Square or Plaid, if the owner connected them (section 10). |

## 5. How the bookkeeping works

### 5.1 The model

The book is **single-entry, cash-basis**: each line is either *income* or *expense*, with an amount, a date and one category. Categories: service, product, tips (income); rent, supplies, utilities, wages, other (expense). It is a management record for the owner. It is **not** double-entry accounting, does not produce tax forms, and does not claim to be GAAP-compliant. Amounts are stored as whole cents, so totals never suffer from rounding drift.

### 5.2 Where entries come from

Each entry records its source, so it can always be traced:

| Source | How it is written | How it is undone |
|---|---|---|
| `manual` | The owner adds it. | The owner deletes it. |
| `ai_note` | Mona drafted it from a sentence; **the owner confirmed it** before it was saved (section 8). | The owner deletes it. |
| `sale` | Ringing up a sale writes one income line per category (service, product, tips). Tips earned by a booth renter are not the shop's income. | Voiding the sale (5.4). The lines cannot be deleted on their own. |
| `appointment` | Older visits marked done before the till existed. | Changing the appointment. |
| `payout` | Paying a staff member writes a wages expense. | Stays: a settlement is part of the record. |
| `task` | Ticking a **payment reminder** as paid writes that amount as an expense on the day it was ticked. The category is taken from the title (rent, utilities, supplies, wages, or other). | Reopening the reminder removes the entry; deleting the entry reopens the reminder. A reminder never writes more than one entry. |
| `import` | Bank transactions from Plaid, mapped to categories. Deposits are skipped when sales are already recorded, so the same money is not counted twice. | Re-sync with the bank. |

### 5.3 Numbers are computed, never generated

Every total the app shows or Mona says is computed by the database from these rows at the moment it is asked: today's till, this month's net, what is still to pay, what a client owes, who sold what. The AI model never produces a number (section 8).

### 5.4 Voids and cancellations

- Only the **owner** can void a sale, and a **reason is required**: wrong entry, refund, duplicate, client cancelled, or other, with an optional note.
- Voiding removes the sale and its book lines, returns sold products to stock, and, if the sale came from an appointment, puts the appointment back to "booked". A **void record** keeps what the sale was (amount, client, staff member, time) and why it was voided.
- Cancelling an appointment asks for a reason in the same way. Marking it missed records "no-show".
- The owner can list voids, and Mona can answer "how many were cancelled today, and why?" from these records.

### 5.5 Staff pay

Each staff member has a pay arrangement: commission (a percentage of services and of products), booth rent (they keep their takings and pay the shop rent), or salary (optionally plus commission). The app computes what each person is owed for a period. It does **not** withhold taxes, run payroll or pay anyone; the owner pays and records the payment.

## 6. Accounts and sign-in

- **Business accounts** are created by invitation or after an application we approve. Public self-signup is off in production.
- **Passwords** are hashed with argon2id and never stored in readable form.
- **Sessions:** a short-lived access token (15 minutes) plus a refresh token (30 days) that is replaced on every use. If an old refresh token is ever reused, the whole session family is revoked.
- **Staff** see their own appointments and their own sales and pay. They cannot see the business's books, other staff members' pay, or the shop-wide numbers.
- **Rate limits:** at most 300 requests per minute per address overall, and 10 per minute on sign-in routes.

## 7. How businesses are kept apart

Every query filters by the signed-in user's business, and in addition the database itself enforces **row-level security**: a database session opened for business A cannot read or change business B's rows even if the application code had a bug. Ids of other businesses' records return "not found". This is covered by automated tests that try to cross the line.

## 8. The AI assistant (Mona)

| Question | Answer |
|---|---|
| Which model? | Anthropic's Claude (Claude Sonnet 5.5), through Anthropic's API. |
| What is sent to it? | For a sentence: the sentence, today's date, the business's service names, staff names and up to 300 client names (so it can match "John" to a client). For an open question: the question and a summary of numbers the database computed (for example this month's income, no-show rate, today's voids by reason). For the morning brief and memory: short notes about the business. |
| What is *not* sent? | Passwords, payment card data, bank account numbers, bank tokens, full transaction lists, and client phone numbers from the records. (A phone number the user types into a sentence, for example to add a client, is part of that sentence.) |
| What can it do? | Turn a sentence into **drafts** (an appointment, a client, a book entry, a reminder, a tab entry). **Nothing is saved until the user taps confirm.** It can word an answer to a question using the computed numbers. |
| What can it not do? | Write to the database, send messages, move money, or compute totals. Its output is checked against a strict schema; anything outside it is discarded. |
| If it fails? | A built-in rule engine (no AI) takes over for the same tasks. |
| Memory | Conversations are kept per user so Mona can follow context ("and last month?"). The user can clear them at any time; otherwise they are deleted after 90 days. Mona's notes about the business (for example "rent is usually paid on the 3rd") expire after 90 days unless the owner pins them, and the owner can read and delete every note. Mona refuses to note health, religion, politics or phone numbers. |
| Training | Anthropic's commercial terms state that API inputs are not used to train its models. Counsel should confirm against Anthropic's current terms and DPA. |

## 9. Sub-processors (live today)

| Provider | What for | Data it sees |
|---|---|---|
| Cloudflare | Website hosting, DNS, forwarding of API requests | Request metadata (IP address, URL); passes API traffic through to Render. |
| Render | API server and database (Virginia, US) | Everything stored in the app. |
| Resend | Sending email (invitations, sign-in links, operator alerts) | Recipient address and the message. |
| Anthropic | The assistant's AI model | Section 8. |

Integrations that are **built but not live** (sandbox or off) and would be added to this list when turned on: Twilio (SMS reminders), Meta WhatsApp Business (WhatsApp reminders), Stripe (subscription billing), Square (importing sales and bookings), Plaid (bank balances and transactions).

## 10. Connections to other services (when turned on)

- **Square** and **Plaid** are connected by the owner through each provider's own sign-in screen. We never see the owner's Square or bank password.
- The access tokens they give us are stored **encrypted (AES-GCM)** with a key held only in the server's environment.
- Connected businesses are synced once an hour. Plaid is asked for at most two years of history on the first connection.
- The owner can disconnect at any time. That deletes the stored tokens, and the owner chooses whether the rows already imported stay or are deleted too.

## 11. Text message reminders (TCPA and carrier rules)

- A client gets reminders **only if the business recorded consent** for that client. Without consent, no reminder is ever scheduled. On the public booking page the consent box starts **unchecked** and names the message count, "Msg & data rates may apply", STOP and HELP.
- Two messages per appointment at most: the evening before (at an hour the business chooses) and a set number of hours before.
- **Every message ends with "Reply STOP to opt out."** A STOP reply marks the client as opted out at once and cancels anything queued; consent is checked again at the moment each message is handed to the provider.
- Every time a client's phone number is shown in the app or handed to the sending service, it is written to the audit log.
- The business is the sender in the sense that it decides whom to remind; whether Mona Mile Lab is also treated as a sender is question 1 for counsel in `README.md`.

## 12. Retention, export and deletion

| Data | Kept |
|---|---|
| Business records | While the subscription is active. **Deleted 90 days after a subscription is cancelled**, by the hourly maintenance job. |
| A business the owner deletes | Locked at once, **permanently deleted 30 days later** (the owner can restore it within those 30 days). |
| Assistant conversations | Until the user clears them, at most 90 days. |
| Assistant notes | 90 days after they were last confirmed, unless pinned. |
| Website demo requests and pilot applications | Deleted 12 months after they were received. |
| Operator activity log | Kept; retention period to be set with counsel. |
| **Backups** | **None yet** (free database plan). With the paid plan, backups would keep deleted data for the plan's backup window; the Privacy Policy has a `[BACKUP RETENTION]` placeholder for this. |

**Export:** the owner can download every row the business owns as one JSON file, even when the subscription has lapsed. **Erasure:** the owner can delete the business with their password; this cascades through every table.

## 13. Our own access (the operator panel)

- Mona Mile Lab staff answer support messages, review applications and send invitations from an **operator panel**. It is not linked from anywhere and is not at a guessable address: it opens only at a long random URL, and every other address returns "not found".
- Signing in requires the **admin key and a 6-digit code from an authenticator app** (multi-factor, as the FTC Safeguards Rule and Plaid's security requirements expect for anyone who can reach customer data). A sign-in lasts 30 minutes. Five failed attempts from one address lock it for 15 minutes. Rotating the admin key ends every open session.
- **Every operator request is logged** (what, when, from which address, allowed or refused). The panel shows the log.
- The panel shows support threads, applications and demo requests. It does **not** show any business's books, clients or sales.

## 14. Security measures in place

- HTTPS only; HSTS; strict Content-Security-Policy on every page; no third-party scripts on the website.
- Input validation on every request; database constraints as a second check; errors never reveal internals.
- Secrets only in the hosting providers' environment settings, never in the code repository (an automated test checks the example config is empty).
- Health monitoring every 15 minutes (database, reminders, sync jobs, server errors) with alerts to the operator.
- Automated test suite (237 tests) runs on the code, including tenant isolation, consent, voids, retention and operator sign-in.

## 15. Open items counsel should know about

1. **No backups yet.** The database is on Render's free plan. A paid plan (daily backups) is needed before onboarding real businesses. It is a purchase decision, not yet made.
2. **Company not formed.** All `[COMPANY LEGAL NAME]`-type placeholders remain.
3. **Integrations not live.** Twilio, WhatsApp, Stripe, Square and Plaid are in sandbox or off. Each needs its own terms review and a sub-processor list update before it goes live.
4. **Two-factor for business owners** is not implemented; only the operator panel has it. Plaid's production review may ask for it.
5. **Founder location.** The founder works from Turkey; operator access from Turkey may be an international transfer (question 6 in `README.md`).
6. **Turkey, later.** `monamilelab.com` is a placeholder today. If Turkish businesses become customers, their data would be stored in the US, so KVKK article 9 transfer rules and a Turkish privacy notice (aydınlatma metni) would apply.
7. **Operator log retention** needs a period.

---

*Where to look in the code for each point:* bookkeeping and sales in `core/src/ekip/kasa.ts`, paid reminders in `core/src/ekip/odeme.ts`, voids in `core/src/voids.ts`, the assistant in `core/src/assistant/` and `api/src/assistant-llm.ts`, reminders and consent in `core/src/reminders.ts`, retention in `core/src/routes/shop.ts`, the operator panel in `core/src/ops.ts` and `functions/o/`, database structure in `core/src/migrations.ts`.
