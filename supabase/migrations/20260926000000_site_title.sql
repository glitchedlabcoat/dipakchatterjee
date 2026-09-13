-- Browser tab / <title> branding, editable from Admin > Settings > General.
-- Read by app/(site)/layout.tsx's generateMetadata to drive the site-wide
-- title template; see lib/cache.ts for why that read goes through the
-- same PUBLIC_CACHE_TAG-tagged cache as the rest of site_settings.
alter table public.site_settings
  add column if not exists site_title text not null default 'Janatar Dipak';
