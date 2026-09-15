-- Meta (Facebook/Instagram) oEmbed API credentials, editable from
-- Admin > Settings > Media & Display. Deliberately a SEPARATE table
-- from site_settings, not new columns on it: site_settings has a
-- `using (true)` public SELECT policy (the whole row is world-readable
-- via the anon key, since the public site reads header/footer/theme
-- settings without an authenticated session) — an App Secret living in
-- that row would be exposed to any anon REST call. This table carries
-- no public SELECT policy at all, so it's reachable only through an
-- authenticated admin session (requireAdmin()'s server client), the
-- same way public.admins is locked down (see
-- 20260921000000_audit_and_fix_rls.sql).
create table if not exists public.integration_settings (
  id text primary key default 'default',
  meta_app_id text,
  meta_app_secret text,
  updated_at timestamptz not null default now(),
  constraint integration_settings_singleton check (id = 'default')
);

insert into public.integration_settings (id) values ('default')
  on conflict (id) do nothing;

alter table public.integration_settings enable row level security;

create policy "Admins can read integration settings"
  on public.integration_settings for select
  using (is_admin());

create policy "Admins can update integration settings"
  on public.integration_settings for update
  using (is_admin())
  with check (is_admin());
