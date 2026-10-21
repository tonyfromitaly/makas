> **DRAFT. Not reviewed by counsel. Do not publish.** Bracketed items are placeholders. See `docs/legal/README.md`.

# Fade Data Processing Addendum

This Data Processing Addendum ("DPA") forms part of the Fade Terms of Service between [COMPANY LEGAL NAME] ("Processor", "we") and the Customer ("Business", "you"). It applies when we process personal information on your behalf.

## 1. Roles

- You are the business (controller) for personal information about your clients and staff that you put into Fade or bring in through a connection ("Client Personal Information").
- We are your service provider, also called processor or contractor (the terms used in the CCPA/CPRA and other U.S. state privacy laws).

## 2. What we process

| | |
|---|---|
| **Subject matter** | Providing the Service under the Terms |
| **Duration** | The term of the subscription, plus the deletion periods in section 8 |
| **Nature and purpose** | Hosting, storing, organizing, displaying and analyzing records. Sending reminders. Syncing connected services. Answering assistant requests |
| **Data subjects** | Your clients, your staff and owners |
| **Categories** | Names, phone numbers, e-mail addresses (staff), appointment and purchase history, consent records, notes, staff pay and sales figures, and bank and payment transactions from connected services |
| **Sensitive data** | Not required by the Service. Do not enter health, financial-account or government ID information in free-text notes. The assistant is instructed not to keep such information in its notes |

## 3. Our commitments

We will:

1. process Client Personal Information only on your documented instructions. The Terms, your settings and your use of the Service are those instructions. We will tell you if we believe an instruction breaks the law;
2. not sell or share it, and not use it for any purpose other than providing the Service. This includes not using it to train AI models for others and not combining it with data from other customers, except as the law allows for service providers;
3. ensure that everyone with access is bound by confidentiality;
4. apply the security measures in Annex 1;
5. help you respond to data-subject requests, mainly through export, correction and deletion in the app;
6. notify you without undue delay, and in any case within [72] hours of confirming it, of a security breach affecting Client Personal Information. We will include what we know and what we are doing about it;
7. make information needed to show compliance with this DPA available to you on reasonable request. This is limited to once a year, unless a breach or a regulator requires more;
8. notify you if we can no longer meet our obligations under applicable privacy law.

## 4. Subprocessors

- You authorize the subprocessors listed in the Privacy Policy (section 3).
- We will give at least 30 days' notice, by e-mail or in the app, before adding or replacing one.
- You may object on reasonable data-protection grounds. If we cannot address the objection, you may terminate the affected Service without penalty.
- We remain responsible for our subprocessors' compliance.

## 5. Your commitments

You confirm that:

- you have a lawful basis, including any required notice and consent, to give us Client Personal Information;
- you have recorded consent before any client receives reminders.

## 6. Messaging

- Consent and opt-out handling are described in the Terms (section 4) and the SMS Terms.
- We stop all reminders to a number as soon as a STOP reply is received or you revoke consent.
- Consent is re-checked immediately before each message is sent.

## 7. International transfers

[Where any processing takes place outside the United States, list the location and the safeguard. Decide with counsel.]

## 8. Deletion and return

- You can export all data at any time.
- After the subscription ends, we delete Client Personal Information within 90 days.
- If you delete your business, we delete it within 30 days.
- Backups are overwritten within [BACKUP RETENTION] days after that, unless the law requires us to keep it.

## Annex 1: Security measures

- **Access.**
  - Every business's data is separated by database row-level security.
  - Staff accounts see only their own work.
  - Operator access requires a separate secret key.
- **Encryption.**
  - TLS in transit.
  - Tokens for connected services are stored encrypted with a key kept outside the database.
- **Audit.** Each reveal of a client phone number, each change to it and each hand-off to the message sender is logged.
- **Authentication.**
  - Passwords are hashed with Argon2.
  - Access tokens are short-lived.
  - Login attempts are rate-limited.
- **Data minimization.** Lists show masked phone numbers. Only the fields needed for reminders are sent to messaging providers.
- **Availability.**
  - Daily database backups (managed by the hosting provider on the paid database plan).
  - Health monitoring with alerts to the operator.
  - Background jobs designed so that a restart neither loses nor duplicates a reminder.
- **People.** Access to production systems is limited to the people who need it, with multi-factor authentication on provider accounts.
