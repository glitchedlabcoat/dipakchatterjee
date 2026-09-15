-- Search Tags & Keywords, editable from Admin > Settings > General
-- (the same Google Search Snippet card that already owns site_title /
-- meta_description — see 20260926000000_site_title.sql and
-- 20260928000000_meta_description.sql). Feeds generateMetadata's
-- `keywords` and the JSON-LD @graph's `alternateName`/`keywords` in
-- app/(site)/layout.tsx.
alter table public.site_settings
  add column if not exists search_tags text[] not null default array[
    'Janatar Dipak',
    'janatardipak',
    'জনতার দীপক',
    'Dipak Chatterjee',
    'Dipak Chatterjee Chanchal',
    'Social Worker Malda'
  ]::text[];
