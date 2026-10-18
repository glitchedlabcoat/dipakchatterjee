-- supabase/snippets/email-scheduler-pg-cron.sql
--
-- OPTIONAL, NOT A MIGRATION, NOT APPLIED. Run by hand in the Supabase SQL
-- editor only after approval. It makes Supabase call the site's email
-- scheduler endpoint every 15 minutes, which drives reminders, retries,
-- inbound body fetches and retention (see docs/email-system.md, Step 5).
--
-- Cost: pg_cron and pg_net are included in Supabase's plans; nothing
-- here is billed separately. Each call is one small HTTP request.
--
-- Before running:
--   1. CRON_SECRET is set on Render and the site has been redeployed.
--   2. supabase/migrations/20261017000000_email_system.sql is applied.
--   3. Store the SAME CRON_SECRET value in Supabase Vault under the name
--      `email_cron_secret`. Prefer the dashboard's Vault page (Integrations
--      -> Vault -> Add new secret) so the value never sits in SQL editor
--      history. The SQL alternative is section 1 below.
--
-- Never paste the secret into this file or commit it anywhere.

-- ---------------------------------------------------------------------------
-- 0. Extensions (or enable both under Database -> Extensions).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. The secret (skip if added through the Vault page). Replace the
--    placeholder in the editor only, run it, then clear the editor tab.
--
-- select vault.create_secret('<paste CRON_SECRET here>', 'email_cron_secret', 'Bearer token for /api/cron/email');
--
-- To rotate later (update Render's CRON_SECRET at the same time):
-- select vault.update_secret(
--   (select id from vault.secrets where name = 'email_cron_secret'),
--   '<paste the new CRON_SECRET here>'
-- );

-- ---------------------------------------------------------------------------
-- 2. The scheduler job. Every 15 minutes, POST /api/cron/email with the
--    bearer token read from Vault at run time. The 60 s timeout covers a
--    Render free-tier cold start; a missed or timed-out call is harmless
--    because the next one catches up (every step is idempotent).
--    Re-running cron.schedule with the same name updates the job.

select cron.schedule(
  'janatardipak-email-dispatch',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://janatardipak.com/api/cron/email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'email_cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ---------------------------------------------------------------------------
-- 3. Housekeeping: pg_cron keeps a row per run forever. Keep a week.
--    (pg_net already discards its responses after about 6 hours.)

select cron.schedule(
  'janatardipak-cron-history-cleanup',
  '17 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);

-- ---------------------------------------------------------------------------
-- 4. Optional, unrelated to email: the existing expired-complaint purge
--    (/api/cron/purge-complaints, GET, same CRON_SECRET). The admin
--    complaints page already purges on every load, so this is only for
--    purging when nobody opens the dashboard. Uncomment to enable.
--
-- select cron.schedule(
--   'janatardipak-purge-complaints',
--   '40 * * * *',
--   $$
--   select net.http_get(
--     url := 'https://janatardipak.com/api/cron/purge-complaints',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || (
--         select decrypted_secret from vault.decrypted_secrets where name = 'email_cron_secret'
--       )
--     ),
--     timeout_milliseconds := 60000
--   );
--   $$
-- );

-- ---------------------------------------------------------------------------
-- 5. Checking it works (read-only).
--
-- Jobs:
--   select jobid, jobname, schedule, active from cron.job order by jobid;
--
-- Recent runs of the email job (did the SQL run?):
--   select start_time, status, return_message
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'janatardipak-email-dispatch')
--   order by start_time desc limit 20;
--
-- Recent HTTP results (did the site answer?): 200 = fine, 401 = the Vault
-- secret doesn't match Render's CRON_SECRET, 404 = CRON_SECRET unset on
-- Render, 500 = a step failed (see Render logs for [email-dispatch]),
-- timed_out = the site took over 60 s (usually a cold start; the next
-- run retries).
--   select created, status_code, timed_out, error_msg
--   from net._http_response
--   order by created desc limit 20;
--
-- The dashboard shows the same heartbeat under Emails -> Settings ->
-- Scheduler.

-- ---------------------------------------------------------------------------
-- 6. Turning it off.
--
--   select cron.unschedule('janatardipak-email-dispatch');
--   select cron.unschedule('janatardipak-cron-history-cleanup');
--   select cron.unschedule('janatardipak-purge-complaints');  -- if enabled
--
-- Optionally remove the secret afterwards:
--   delete from vault.secrets where name = 'email_cron_secret';
