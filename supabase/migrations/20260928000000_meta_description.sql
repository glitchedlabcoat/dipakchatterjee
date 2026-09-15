-- Google search snippet description, editable from Admin > Settings >
-- General (Google Search Snippet Editor). Paired with the existing
-- site_title column (20260926000000_site_title.sql), which already
-- doubles as the search snippet's title — see app/(site)/layout.tsx's
-- generateMetadata for how both feed <title>/description/OpenGraph.
alter table public.site_settings
  add column if not exists meta_description text;
