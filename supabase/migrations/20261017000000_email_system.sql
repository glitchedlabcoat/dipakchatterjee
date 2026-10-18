-- Email system: complaint receipts, office notifications, scheduled
-- reminders, an outbound delivery log, an inbound inbox, and the admin
-- Emails sections (Inbox, Drafts, Outbox, Sent, Trashed, New Message).
--
-- NOT APPLIED. Review, then run it in the Supabase SQL editor (the
-- repo's migration history was pruned on 2026-09-24, so `supabase db
-- push` would complain about missing remote versions). Checked
-- 2026-10-18: none of these tables exist in production yet, so the
-- drafts/trash columns were folded into this one file instead of a
-- second migration. Section 5 makes it safe to re-run, including over
-- an older copy of this file.
--
-- Additive and idempotent: it creates three new tables and, defensively,
-- re-adds complaints.contact_email with IF NOT EXISTS. That column is in
-- the original complaints migration (20260911170000_complaints.sql) and
-- no later migration dropped it, so on the live database that statement
-- should be a no-op. Nothing is dropped, renamed or rewritten.
--
-- Access model, the same as integration_settings and complaints:
--   * RLS on every new table. Signed-in dashboard users (is_admin(),
--     i.e. any recognized profile) may SELECT. There are NO insert,
--     update or delete policies, so the anon key can do nothing and
--     every write goes through the server's service-role client, after
--     the server action has checked requireAdmin() (any dashboard
--     profile, the same rule as is_admin()).
--   * No secrets are stored here. The Resend API key, webhook secret and
--     cron secret stay in Render environment variables.

-- ---------------------------------------------------------------------
-- 1. Optional citizen email on a complaint (should already exist).
alter table public.complaints
  add column if not exists contact_email text;

-- ---------------------------------------------------------------------
-- 2. Email settings: one row, edited from Admin > Emails > Settings.
--    A separate table, not site_settings columns, because site_settings
--    is readable by anyone through the anon key.
create table if not exists public.email_settings (
  id text primary key default 'default',
  sender_name text,
  sender_address text,
  reply_to text,
  office_notification_email text,
  citizen_confirmation_enabled boolean not null default true,
  office_notification_enabled boolean not null default true,
  reminders_enabled boolean not null default false,
  reminder_frequency text not null default 'weekly',
  reminder_time text not null default '09:00',
  reminder_timezone text not null default 'Asia/Kolkata',
  reminder_weekday smallint not null default 1,
  reminder_month_day smallint not null default 1,
  reminder_interval smallint not null default 7,
  reminder_start_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  -- Occurrences scheduled before this instant are never sent, so turning
  -- reminders on (or changing the schedule) can't fire a stale one.
  reminder_schedule_updated_at timestamptz not null default now(),
  scheduler_last_run_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint email_settings_singleton check (id = 'default'),
  constraint email_settings_frequency check (
    reminder_frequency in ('daily', 'weekly', 'monthly', 'every_n_days', 'every_n_months')
  ),
  constraint email_settings_time check (reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint email_settings_weekday check (reminder_weekday between 1 and 7),
  constraint email_settings_month_day check (reminder_month_day between 1 and 31),
  constraint email_settings_interval check (reminder_interval between 1 and 365)
);

insert into public.email_settings (id) values ('default')
  on conflict (id) do nothing;

alter table public.email_settings enable row level security;

drop policy if exists "Admins can read email settings" on public.email_settings;
create policy "Admins can read email settings"
  on public.email_settings for select
  to authenticated
  using (is_admin());

-- ---------------------------------------------------------------------
-- 3. Inbound messages received through Resend (email.received webhook).
--    Bodies are fetched from Resend's API afterwards; attachments are
--    recorded as metadata only (never downloaded or stored here).
create table if not exists public.email_inbound (
  id uuid primary key default gen_random_uuid(),
  provider_email_id text not null unique,
  message_id text,
  from_address text not null,
  from_name text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  reply_to_addresses text[] not null default '{}',
  subject text,
  text_body text,
  html_body text,
  body_truncated boolean not null default false,
  body_status text not null default 'pending',
  body_fetch_attempts smallint not null default 0,
  body_error text,
  attachments jsonb not null default '[]'::jsonb,
  auth_spf text,
  auth_dkim text,
  auth_dmarc text,
  is_read boolean not null default false,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Soft delete: Admin > Emails > Trashed. Restoring clears it; nothing
  -- in the UI deletes a row (retention below is time-based only).
  trashed_at timestamptz,
  trashed_by uuid references auth.users(id) on delete set null,
  constraint email_inbound_body_status check (body_status in ('pending', 'fetched', 'failed'))
);

create index if not exists email_inbound_received_at_idx on public.email_inbound (received_at desc);
create index if not exists email_inbound_body_pending_idx on public.email_inbound (body_status)
  where body_status = 'pending';

alter table public.email_inbound enable row level security;

drop policy if exists "Admins can read inbound email" on public.email_inbound;
create policy "Admins can read inbound email"
  on public.email_inbound for select
  to authenticated
  using (is_admin());

-- ---------------------------------------------------------------------
-- 4. Outbound messages: the queue and the delivery log in one table.
--    dedupe_key is unique and doubles as Resend's Idempotency-Key, so a
--    repeated submission, retry or scheduler run can't create a second
--    copy of the same receipt, notification or reminder.
--    Rows about a complaint are deleted with it (ON DELETE CASCADE), so
--    a citizen's address never outlives the complaint's retention.
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  dedupe_key text not null unique,
  status text not null default 'pending',
  complaint_id uuid references public.complaints(id) on delete cascade,
  inbound_id uuid references public.email_inbound(id) on delete set null,
  to_addresses text[] not null default '{}',
  -- The rendered message. An admin's own message (compose/reply/test) is
  -- stored when queued; a system email (receipt, notification, reminder)
  -- is rendered on its first send attempt. Either way it's then frozen,
  -- so every retry sends a byte-identical payload: Resend only honours
  -- an Idempotency-Key for an identical request.
  from_header text,
  reply_to text,
  subject text,
  body_text text,
  body_html text,
  extra_headers jsonb,
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  first_attempt_at timestamptz,
  last_error text,
  provider_message_id text unique,
  sent_at timestamptz,
  last_event_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- When the row entered the outbox. NULL while it is a draft; set when a
  -- draft is sent. Sending limits count this, not created_at, so drafts
  -- neither use up the limit nor let old drafts slip past it.
  queued_at timestamptz default now(),
  -- Soft delete (Admin > Emails > Trashed); see email_inbound.
  trashed_at timestamptz,
  trashed_by uuid references auth.users(id) on delete set null,
  constraint email_messages_kind check (
    kind in ('complaint_receipt', 'office_notification', 'reminder', 'compose', 'reply', 'test')
  ),
  -- 'draft': a composed message saved but not sent (kind 'compose'). The
  -- outbox never picks it up; sending it is a compare-and-set to 'pending'.
  constraint email_messages_status check (
    status in ('draft', 'pending', 'sending', 'sent', 'delivered', 'delivery_delayed', 'bounced',
               'complained', 'failed', 'suppressed', 'skipped')
  ),
  constraint email_messages_dedupe_key_length check (char_length(dedupe_key) between 1 and 256)
);

create index if not exists email_messages_due_idx on public.email_messages (status, next_attempt_at);
create index if not exists email_messages_created_at_idx on public.email_messages (created_at desc);
create index if not exists email_messages_complaint_idx on public.email_messages (complaint_id);

alter table public.email_messages enable row level security;

drop policy if exists "Admins can read email messages" on public.email_messages;
create policy "Admins can read email messages"
  on public.email_messages for select
  to authenticated
  using (is_admin());

-- ---------------------------------------------------------------------
-- 5. Re-run safety. On a fresh database the statements above already
--    created everything and these are no-ops. They only matter if an
--    older copy of this file (without drafts/trash) was applied first:
--    add the columns it lacked and widen the status check to 'draft'.
--    No data is touched.
alter table public.email_inbound add column if not exists trashed_at timestamptz;
alter table public.email_inbound add column if not exists trashed_by uuid references auth.users(id) on delete set null;
alter table public.email_messages add column if not exists queued_at timestamptz default now();
alter table public.email_messages add column if not exists trashed_at timestamptz;
alter table public.email_messages add column if not exists trashed_by uuid references auth.users(id) on delete set null;

alter table public.email_messages drop constraint if exists email_messages_status;
alter table public.email_messages add constraint email_messages_status check (
  status in ('draft', 'pending', 'sending', 'sent', 'delivered', 'delivery_delayed', 'bounced',
             'complained', 'failed', 'suppressed', 'skipped')
);

-- Admin > Emails folder lists.
create index if not exists email_messages_queued_at_idx on public.email_messages (queued_at desc);
create index if not exists email_messages_sent_at_idx on public.email_messages (sent_at desc)
  where sent_at is not null;
create index if not exists email_messages_trashed_idx on public.email_messages (trashed_at desc)
  where trashed_at is not null;
create index if not exists email_inbound_trashed_idx on public.email_inbound (trashed_at desc)
  where trashed_at is not null;
