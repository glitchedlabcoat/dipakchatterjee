# Changelog

## [v1.7.1] - 2026-09-13

### Summary of What Changed

- Fixed a CI build break introduced by v1.7.0: GitHub Actions' `npm run build` step (`.github/workflows/discord-notify.yml`) has no `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and once `app/(site)/layout.tsx` switched to the cookie-free public Supabase client, Next's build-time static-eligibility probe had no `cookies()` call left to trip its "bail to dynamic" signal — so it fully executed `getSiteChrome()` while probing `/complaints`, hit the missing env var, and failed the build outright (`Error: supabaseUrl is required.`). This passed locally only because `.env.local` happens to supply that value, masking the same latent bug.
- Fixed by adding `export const dynamic = "force-dynamic"` to `app/(site)/layout.tsx`, so Next skips that static probe for every page under `(site)` — matching reality, since the CSP nonce already prevents any of them from being served static — instead of relying on each page to accidentally trip a Dynamic API early enough. `app/(site)/page.tsx` keeps its own `force-dynamic` too, now as a belt-and-suspenders guard.
- Verified by building with `.env.local` removed entirely (true CI conditions): build failed before this fix with the exact CI error, and passed cleanly after it, with `/complaints` and every other `(site)` route still correctly `ƒ (Dynamic)`.

### Files Edited

- `app/(site)/layout.tsx`
- `app/(site)/page.tsx`
- `CHANGELOG.txt`
- `CHANGELOG.md`

## [v1.7.0] - 2026-09-13

### Summary of What Changed

- Added an egress-reduction caching layer for public pages: `app/(site)/layout.tsx`, `page.tsx`, `notable-works/page.tsx`, `posts/[id]`, and `phases/[id]` now read through a new cookie-free public Supabase client (`utils/supabase/public.ts`), wrapped in `unstable_cache(..., { revalidate: 60, tags: ['public-content'] })` — verified with an instrumented run: 5 back-to-back homepage requests produced only 1 actual database query.
- Added `revalidatePublicPages()` (`lib/cache.ts`) for instant on-demand cache flush, and wired it into every admin mutation that previously called `revalidatePath("/")` (arrangement, features, phases, posts, and every Settings sub-area — footer, header, nav) — roughly 20 call sites, so a dashboard save no longer waits out the 60-second window.
- Bumped all Supabase Storage upload `cacheControl` values from 1 hour to 30 days (`2592000`) across feature media, organization logos, hero/avatar, post thumbnails, and phase photos, so a visitor's browser never re-fetches an already-downloaded image.
- Added `images.minimumCacheTTL: 86400` to `next.config.ts` (currently inert — the site renders every image via a plain `<img>`, not `next/image`, so this only matters if that changes later).
- **Correctness note:** the task's literal `export const revalidate = 60` snippet was a no-op here — this site's `proxy.ts` issues a fresh per-request CSP nonce on every route, which Next.js's own docs say requires dynamic rendering site-wide (confirmed by building with that export set and seeing the route stay `ƒ (Dynamic)`, not become ISR'd). Caching therefore happens one level down, at the data-fetch layer, not the route layer. One page (`app/(site)/page.tsx`) briefly became static/ISR *by accident* once its data-fetch stopped needing a Dynamic API (cookies) — caught by curling a built+started production server twice and finding the cached HTML's embedded script nonce no longer matched the live CSP header (would have blocked all scripts in a real browser). Fixed with an explicit, documented `export const dynamic = "force-dynamic"` on that page. The admin dashboard was already effectively uncached by construction (its Supabase client always reads cookies first) and remains untouched.

### Files Edited

- `lib/cache.ts` (new)
- `utils/supabase/public.ts` (new)
- `app/(site)/layout.tsx`
- `app/(site)/page.tsx`
- `app/(site)/notable-works/page.tsx`
- `app/(site)/posts/[id]/page.tsx`
- `app/(site)/phases/[id]/page.tsx`
- `app/admin/(protected)/arrangement/actions.ts`
- `app/admin/(protected)/features/actions.ts`
- `app/admin/(protected)/phases/actions.ts`
- `app/admin/(protected)/phases/PhasePhotosManager.tsx`
- `app/admin/(protected)/posts/actions.ts`
- `app/admin/(protected)/posts/PostThumbnailUploader.tsx`
- `app/admin/(protected)/settings/actions.ts`
- `app/admin/(protected)/settings/footer-actions.ts`
- `app/admin/(protected)/settings/header-actions.ts`
- `app/admin/(protected)/settings/nav-links-actions.ts`
- `app/admin/(protected)/settings/OrganizationsManager.tsx`
- `app/admin/(protected)/settings/SiteImageUploader.tsx`
- `components/admin/MediaManager.tsx`
- `next.config.ts`
- `CHANGELOG.txt`
- `CHANGELOG.md`

## [v1.6.0] - 2026-09-13

### Summary of What Changed

- Converted all site timers (`features.slideshow_interval`, `posts.slideshow_interval`, `phases.slideshow_interval`) from integer to `numeric(4,2)`, and every timer input (Image Galleries, Notable Works, Phases) to `step="0.1"`, so decimal intervals like `2.5` seconds are supported end to end.
- Added a dedicated `is_published` toggle for Phases, matching the Image Gallery feature toggle — Phases now default to draft on creation, everywhere that toggle appears (its own form, the unified Features/Phases list, and the Arrangement page).
- Stripped the generic category eyebrow labels ("Image Gallery" above an Image Gallery section, "Notable Works" above the posts feed and its full listing page) that duplicated what the section type already was.
- Restored a short `summary` vs. long-form `full_content` split for Phases: the homepage shows only the concise summary plus a "Read More" link; the period now renders directly beneath the title in the title's exact typography instead of as a small eyebrow above it.
- Implemented conditional Phase media rendering (`components/phases/PhaseGallery.tsx`): an auto-advancing slideshow when `slideshow_interval > 0`, otherwise a static grid capped to the new configurable `max_display_images` (default 4).
- Added a Phase "Read More" page (`/phases/[id]`) with the full narrative and the complete, uncapped photo gallery — each photo alongside its caption and a new optional per-photo "fact/detail" field.

### Files Edited

- `supabase/migrations/20260924000000_phases_and_timer_enhancements.sql`
- `types/database.types.ts`
- `types/domain.ts`
- `app/(site)/page.tsx`
- `app/(site)/notable-works/page.tsx`
- `app/(site)/phases/[id]/page.tsx`
- `components/phases/PhaseEntry.tsx`
- `components/phases/PhaseGallery.tsx`
- `components/phases/PhaseSlideshow.tsx`
- `components/phases/PhaseFullGallery.tsx`
- `components/features/FeatureSection.tsx`
- `components/posts/PostsFeed.tsx`
- `app/admin/(protected)/phases/actions.ts`
- `app/admin/(protected)/phases/PhaseForm.tsx`
- `app/admin/(protected)/phases/PhasePhotosManager.tsx`
- `app/admin/(protected)/features/FeatureForm.tsx`
- `app/admin/(protected)/features/SectionList.tsx`
- `app/admin/(protected)/posts/PostForm.tsx`
- `app/admin/(protected)/arrangement/ArrangementManager.tsx`
- `lib/homepage-layout.ts`
- `CHANGELOG.txt`
- `CHANGELOG.md`

## [v1.0.0] - 2026-09-13

### Summary of What Changed

- Added a dedicated `/admin/arrangement` page for reordering homepage sections, replacing the old Settings -> Homepage Sections tab.
- Enforced layout boundaries in the admin UI: Header and Hero are shown as locked cards fixed at the top, Footer as a locked card fixed at the bottom (these were already structurally fixed on the public site by `app/(site)/layout.tsx` and `app/(site)/page.tsx` — this makes that boundary visible and explicit in the dashboard too).
- Kept "Posts / Notable Works", Organizations, and every modular Feature/Phase section dynamically reorderable between the locked Header/Hero and Footer.
- Added drag-and-drop handles plus Move Up / Move Down directional buttons (disabled at the top/bottom of the movable zone) and a visibility (eye) toggle per section.
- Added an "Arrangement" item (with a rows/reorder icon) to the admin sidebar navigation.
- Wired an audit log entry (`UPDATE_ARRANGEMENT` / "Reordered homepage sections") whenever the layout order is saved.

### Note on database changes

No new migration was required. The ordering/visibility data model this page needs (`site_settings.homepage_layout`, `show_organizations_section`, `show_posts_feed_section`, and each feature's `is_published`) already existed from prior migrations (see `20260913000000_homepage_layout.sql` and `20260923000000_unify_features_phases_slideshow.sql`). `npx supabase db push --linked` was run and confirmed the remote database is already up to date, and `npm run update-types` produced no diff in `types/database.types.ts`.

### Files Edited

- `app/admin/(protected)/arrangement/page.tsx`
- `app/admin/(protected)/arrangement/ArrangementManager.tsx`
- `app/admin/(protected)/arrangement/actions.ts`
- `app/admin/(protected)/settings/page.tsx`
- `app/admin/(protected)/settings/actions.ts`
- `app/admin/(protected)/settings/HomepageLayoutManager.tsx` (removed, superseded by the Arrangement page)
- `app/admin/(protected)/features/actions.ts`
- `components/admin/AdminSidebar.tsx`
- `CHANGELOG.txt`
- `CHANGELOG.md`
