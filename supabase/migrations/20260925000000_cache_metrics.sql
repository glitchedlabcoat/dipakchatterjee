-- Cache Efficiency telemetry: aggregate, per-route-per-day hit/miss
-- counters and estimated byte savings for the admin Egress Monitor
-- (/admin/egress). Rows are written exclusively through
-- record_cache_event() below (see lib/cache.ts) — there is no direct
-- insert/update policy on the table itself, so a public/anon caller can
-- only ever add to today's counters for a route via that one function,
-- never read the table or write arbitrary rows.
create table public.cache_metrics (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  route text not null,
  hits integer not null default 0,
  misses integer not null default 0,
  estimated_bytes_saved bigint not null default 0,
  estimated_bytes_spent bigint not null default 0,
  constraint unique_date_route unique (date, route)
);

alter table public.cache_metrics enable row level security;

-- Admin-only read; deliberately no insert/update/delete policy for any
-- role — every write goes through the SECURITY DEFINER function below,
-- which bypasses RLS by design (see its own comment).
create policy "Admins can view cache metrics"
  on public.cache_metrics for select
  to authenticated
  using (is_admin());

-- Atomic upsert: one row per (date, route), incremented in place rather
-- than read-then-write from the client, so concurrent requests from many
-- overlapping site visitors never race/clobber each other's counts.
create or replace function public.record_cache_event(
  p_route text,
  p_is_hit boolean,
  p_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.cache_metrics (date, route, hits, misses, estimated_bytes_saved, estimated_bytes_spent)
  values (
    current_date,
    p_route,
    case when p_is_hit then 1 else 0 end,
    case when p_is_hit then 0 else 1 end,
    case when p_is_hit then p_bytes else 0 end,
    case when p_is_hit then 0 else p_bytes end
  )
  on conflict (date, route) do update set
    hits = public.cache_metrics.hits + excluded.hits,
    misses = public.cache_metrics.misses + excluded.misses,
    estimated_bytes_saved = public.cache_metrics.estimated_bytes_saved + excluded.estimated_bytes_saved,
    estimated_bytes_spent = public.cache_metrics.estimated_bytes_spent + excluded.estimated_bytes_spent;
end;
$$;

-- Called from the public data-fetch layer (lib/cache.ts) using the
-- anon-key client on every page render, so both anon and authenticated
-- need EXECUTE. This is the only write path onto cache_metrics (no
-- table-level insert/update policy exists), and it only ever touches
-- today's row for the given route with a caller-supplied byte count —
-- the worst a visitor could do by calling it directly is skew their own
-- route's telemetry counters, which is a dashboard-accuracy concern, not
-- a security one (no other table or row is reachable through it).
revoke all on function public.record_cache_event(text, boolean, bigint) from public;
grant execute on function public.record_cache_event(text, boolean, bigint) to anon, authenticated;

create index if not exists cache_metrics_date_idx on public.cache_metrics (date);
