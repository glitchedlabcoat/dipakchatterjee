-- Lets the post editor show/hide the time portion of published_at on the
-- public site without touching the stored timestamp — existing posts
-- default to true, so every post already published keeps rendering its
-- saved time exactly as before, and only changes when an admin
-- explicitly flips it in the editor.
alter table public.posts
  add column if not exists show_published_time boolean not null default true;
