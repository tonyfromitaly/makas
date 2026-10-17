// SQL migrations. The same files run on server Postgres and on PGlite (demo + tests).
// Every tenant table carries shop_id and is guarded twice: the app filters by the
// token's shop_id, and Postgres row-level security rejects anything else.

const TENANT_TABLES = [
  'users',
  'refresh_tokens',
  'services',
  'barbers',
  'clients',
  'appointments',
  'ledger_entries',
  'book_entries',
  'feedback',
  'reminder_queue',
  'subscriptions',
  'audit_log',
];

/** Grants to the tenant role, skipped when the database could not create it. */
const toTenant = (sql: string) => `
do $grant$ begin
  if exists (select 1 from pg_roles where rolname = 'makas_tenant') then
    execute $sql$ ${sql} $sql$;
  end if;
end $grant$;`;

const rls = (table: string) => `
alter table ${table} enable row level security;
alter table ${table} force row level security;
create policy tenant_isolation on ${table}
  using (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid)
  with check (shop_id = nullif(current_setting('app.shop_id', true), '')::uuid);
create trigger ${table}_updated_at before update on ${table}
  for each row execute function set_updated_at();
`;

const init = `
do $$ begin
  create extension if not exists btree_gist;
exception when insufficient_privilege then
  null; -- without it the no-overlap rule is enforced in the API instead
end $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'makas_tenant') then
    create role makas_tenant nologin;
  end if;
exception when insufficient_privilege then
  -- Managed Postgres (e.g. Render) without CREATEROLE: RLS still applies to the table owner (FORCE).
  null;
end $$;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  owner_user_id uuid,
  country char(2) not null,
  timezone text not null,
  language text not null default 'en' check (language in ('tr', 'en', 'es')),
  currency char(3) not null default 'USD',
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- Reminder rule constants, adjustable per shop.
  reminder_day_before_hour int not null default 18 check (reminder_day_before_hour between 0 and 23),
  reminder_hours_before int not null default 2 check (reminder_hours_before between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  email text not null,
  password_hash text not null,
  role text not null check (role in ('owner', 'barber')),
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id)
);
create unique index users_email_unique on users (lower(email));

alter table shops add constraint shops_owner_fk
  foreign key (owner_user_id) references users(id) on delete set null deferrable initially deferred;

create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null,
  token_hash text not null unique,
  family_id uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shop_id, user_id) references users(shop_id, id) on delete cascade
);

create table services (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  price_cents int not null check (price_cents >= 0),
  duration_min int not null check (duration_min between 5 and 600),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id)
);

create table barbers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  active boolean not null default true,
  user_id uuid, -- reserved for the staff app (later)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id)
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  phone_e164 text not null check (phone_e164 ~ '^\\+[1-9][0-9]{6,14}$'),
  language text not null default 'en' check (language in ('tr', 'en', 'es')),
  channel_pref text not null default 'whatsapp' check (channel_pref in ('whatsapp', 'sms')),
  consent_status text not null check (consent_status in ('granted', 'revoked')),
  consent_at timestamptz,
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id),
  unique (shop_id, phone_e164)
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  barber_id uuid not null,
  client_id uuid not null,
  service_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_cents_snapshot int not null check (price_cents_snapshot >= 0),
  status text not null default 'booked' check (status in ('booked', 'done', 'missed', 'cancelled')),
  source text not null default 'manual' check (source in ('manual', 'voice')),
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (shop_id, id),
  -- Composite FKs: an appointment can never point at another shop's rows.
  foreign key (shop_id, barber_id) references barbers(shop_id, id),
  foreign key (shop_id, client_id) references clients(shop_id, id) on delete cascade,
  foreign key (shop_id, service_id) references services(shop_id, id)
);
-- One barber, one chair: no overlapping live appointments (the API checks too).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'btree_gist') then
    alter table appointments add constraint appointments_no_overlap exclude using gist (
      barber_id with =, tstzrange(starts_at, ends_at) with &&
    ) where (status in ('booked', 'done'));
  end if;
end $$;
create index appointments_day on appointments (shop_id, starts_at);

create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  client_id uuid not null,
  amount_cents int not null check (amount_cents > 0),
  kind text not null check (kind in ('charge', 'payment')),
  note text check (length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shop_id, client_id) references clients(shop_id, id) on delete cascade
);
create index ledger_client on ledger_entries (shop_id, client_id);

create table book_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  category text not null check (category in
    ('service', 'product', 'tips', 'rent', 'supplies', 'utilities', 'wages', 'other')),
  amount_cents int not null check (amount_cents > 0),
  entry_date date not null,
  note text check (length(note) <= 200),
  raw_text text check (length(raw_text) <= 500),
  source text not null default 'manual' check (source in ('manual', 'ai_note', 'appointment')),
  -- A done appointment writes exactly one income row; undoing it removes it.
  appointment_id uuid unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shop_id, appointment_id) references appointments(shop_id, id) on delete cascade
);
create index book_entries_date on book_entries (shop_id, entry_date);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid,
  message text not null check (length(message) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table reminder_queue (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  appointment_id uuid not null,
  client_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'sms')),
  template_key text not null check (template_key in ('reminder_day_before', 'reminder_day_of')),
  scheduled_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  provider_ref text,
  sent_at timestamptz,
  error text,
  -- Lease: a row handed to the message worker is hidden for a while so it is never sent twice.
  locked_until timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shop_id, appointment_id) references appointments(shop_id, id) on delete cascade,
  foreign key (shop_id, client_id) references clients(shop_id, id) on delete cascade
);
create index reminder_due on reminder_queue (scheduled_at) where status = 'queued';

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references shops(id) on delete cascade,
  plan_key text not null default 'basic',
  status text not null check (status in ('trial', 'active', 'past_due', 'cancelled')),
  current_period_end timestamptz,
  cancelled_at timestamptz,
  -- Ready for Stripe, unused in v1.
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_shop_at on audit_log (shop_id, at desc);

-- shops is keyed by id rather than shop_id.
alter table shops enable row level security;
alter table shops force row level security;
create policy tenant_isolation on shops
  using (id = nullif(current_setting('app.shop_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.shop_id', true), '')::uuid);
create trigger shops_updated_at before update on shops
  for each row execute function set_updated_at();

${TENANT_TABLES.map(rls).join('\n')}

${toTenant(`
grant select, update on shops to makas_tenant;
grant select, insert, update, delete on
  users, refresh_tokens, services, barbers, clients, appointments,
  ledger_entries, book_entries, reminder_queue
  to makas_tenant;
grant select on subscriptions to makas_tenant;
-- Append-only for tenants: the shop can read its trail but never rewrite it.
grant select, insert on audit_log, feedback to makas_tenant;
`)}
`;

// The barber's own reminders and upcoming payments (rent, bills, suppliers), created by the assistant or by hand.
const tasks = `
create table shop_tasks (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  kind text not null default 'reminder' check (kind in ('reminder', 'payment')),
  title text not null check (length(title) between 1 and 200),
  due_date date not null,
  due_time time,
  amount_cents int check (amount_cents > 0),
  status text not null default 'open' check (status in ('open', 'done')),
  done_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'assistant')),
  raw_text text check (length(raw_text) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shop_tasks_due on shop_tasks (shop_id, status, due_date);
${rls('shop_tasks')}
${toTenant('grant select, insert, update, delete on shop_tasks to makas_tenant;')}
`;

// "Bize yaz" becomes a live support thread: the feedback table holds both sides of the conversation.
const support = `
alter table feedback add column author text not null default 'shop' check (author in ('shop', 'operator'));
alter table feedback add column read_at timestamptz;
create index feedback_thread on feedback (shop_id, created_at);
${toTenant('grant update (read_at) on feedback to makas_tenant;')}
`;

// Subscriptions sold on the website: Stripe checkout, pending sign-ups, one-time access keys.
// Policies gain an explicit system switch so the owner connection works on non-superuser Postgres,
// where FORCE row-level security applies to the owner too.
const POLICY = (col: string) =>
  `(${col} = nullif(current_setting('app.shop_id', true), '')::uuid or current_setting('app.system', true) = 'on')`;
const billing = `
create table signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  shop_name text not null check (length(shop_name) between 1 and 120),
  owner_name text not null check (length(owner_name) between 1 and 120),
  country char(2) not null,
  timezone text not null,
  language text not null check (language in ('tr', 'en', 'es')),
  currency char(3) not null default 'USD',
  stripe_session_id text unique,
  status text not null default 'pending' check (status in ('pending', 'completed', 'expired')),
  shop_id uuid references shops(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index signups_email on signups (lower(email));

create table access_keys (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null,
  key_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shop_id, user_id) references users(shop_id, id) on delete cascade
);
${rls('access_keys')}
${toTenant('grant select on access_keys to makas_tenant;')}

alter policy tenant_isolation on shops using ${POLICY('id')} with check ${POLICY('id')};
${[...TENANT_TABLES, 'shop_tasks', 'access_keys']
  .map((t) => `alter policy tenant_isolation on ${t} using ${POLICY('shop_id')} with check ${POLICY('shop_id')};`)
  .join('\n')}
`;

// Beyond barbers: the kind of business picks the starting service menu and wording.
const businessTypes = `
alter table shops add column business_type text not null default 'barber'
  check (business_type in ('barber', 'salon', 'beauty', 'other'));
alter table signups add column business_type text not null default 'barber'
  check (business_type in ('barber', 'salon', 'beauty', 'other'));
`;

// The assistant remembers the conversation: every turn per (shop, user), each user turn with a
// one-line summary for when it leaves the recent window, plus the focus ("him", "make it 4").
// Turns are kept 90 days (retention job) and can be cleared by the user at any time.
const assistantMemory = `
create table assistant_turns (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  text text not null check (length(text) between 1 and 4000),
  summary text check (length(summary) <= 300),
  items jsonb,
  drafts jsonb,
  engine text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shop_id, user_id) references users(shop_id, id) on delete cascade
);
create index assistant_turns_thread on assistant_turns (shop_id, user_id, created_at desc);
${rls('assistant_turns')}

create table assistant_memory (
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null,
  focus jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_id, user_id),
  foreign key (shop_id, user_id) references users(shop_id, id) on delete cascade
);
${rls('assistant_memory')}
${['assistant_turns', 'assistant_memory']
  .map((t) => `alter policy tenant_isolation on ${t} using ${POLICY('shop_id')} with check ${POLICY('shop_id')};`)
  .join('\n')}
${toTenant('grant select, insert, update, delete on assistant_turns, assistant_memory to makas_tenant;')}
`;

// Long-term memory (core/agent/AGENT.md): short notes the assistant keeps about the shop, its clients
// and its people. A note lives 90 days from when it was last confirmed; pinned notes stay.
// user_id null = shared in the shop; set = personal to that user.
const assistantNotes = `
create table assistant_notes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid,
  kind text not null check (kind in ('client', 'money', 'team', 'shop', 'preference')),
  subject text check (length(subject) <= 80),
  text text not null check (length(text) between 1 and 280),
  source text not null check (source in ('said', 'learned', 'data', 'owner')),
  data_key text,
  pinned boolean not null default false,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shop_id, user_id) references users(shop_id, id) on delete cascade
);
create unique index assistant_notes_key on assistant_notes (shop_id, data_key) where data_key is not null;
create index assistant_notes_live on assistant_notes (shop_id, expires_at);
${rls('assistant_notes')}
alter policy tenant_isolation on assistant_notes using ${POLICY('shop_id')} with check ${POLICY('shop_id')};
${toTenant('grant select, insert, update, delete on assistant_notes to makas_tenant;')}
alter table assistant_memory add column reflected_at timestamptz;
`;

export const migrations: { id: string; sql: string }[] = [
  { id: '001_init', sql: init },
  { id: '002_shop_tasks', sql: tasks },
  { id: '003_support_thread', sql: support },
  { id: '004_billing_access', sql: billing },
  { id: '005_business_types', sql: businessTypes },
  { id: '006_assistant_memory', sql: assistantMemory },
  { id: '007_assistant_notes', sql: assistantNotes },
];
