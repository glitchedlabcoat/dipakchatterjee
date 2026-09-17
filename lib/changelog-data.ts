// lib/changelog-data.ts
//
// Structured source for the admin dashboard's Changelogs tab
// (app/admin/(protected)/changelogs/page.tsx). CHANGELOG.md/CHANGELOG.txt
// remain the canonical engineering record (Keep a Changelog format, root
// causes, exact file lists) and are NOT replaced by this file — they're
// written for a developer. This file exists because that developer-facing
// prose can't be mechanically turned into something a non-technical admin
// would want to read: every entry here pairs the same underlying change
// with a `simple` (plain English, "what changed and how to use it") and an
// `advanced` (technical: root cause, files touched) side, so the dashboard
// can toggle between them instantly with no re-fetch. `advanced.filesChanged`
// mirrors CHANGELOG.md's own "Files Changed"/"Files Edited" list for that
// version. Newest first. Dates are the version's actual ship date.
//
// Adding a new entry: prepend it to CHANGELOG_ENTRIES (and add the matching
// dated section to CHANGELOG.md/CHANGELOG.txt) — per the standing changelog
// convention, don't self-reference the commit that introduces the entry,
// since amending would immediately invalidate the reference.

export type ChangelogChangeType = "added" | "changed" | "fixed" | "security";

export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  simple: {
    summary: string;
    tutorial?: string[];
  };
  advanced: {
    rootCause?: string;
    changes: { type: ChangelogChangeType; text: string }[];
    filesChanged: string[];
  };
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: "v1.15.0",
    date: "2026-09-17",
    title: "Render memory hardening + the page you're reading right now",
    simple: {
      summary:
        "Several things today. First, we double-checked the site's Render crash (the one that took the whole dashboard down until someone cleared the cache): a full audit found the caching system was never actually the problem — it's already capped and healthy. The real fix is Render's memory limit setting, which is confirmed in place. On top of that we tightened a few safety margins anyway, for extra peace of mind. Second: this Changelogs page. It exists so you don't have to ask a developer \"what did that last update actually do\" — pick a date, pick a version, and read it in plain English. Third, we finally found and fixed the occasional \"Invalid time value\" error in the server logs — it happened only if a post's publish date/time was somehow malformed; that's now caught and handled gracefully instead of crashing. Fourth, the Meta App ID/App Secret fields in Settings > Media & Display have been removed — they never actually worked (a database setup step behind them was never finished), and Facebook/Instagram embeds don't depend on them anyway.",
      tutorial: [
        "Open Changelogs from the sidebar.",
        "Pick a date on the left — the versions shipped that day appear underneath it.",
        "Click a version to see what changed.",
        "Use the Simple / Advanced switch at the top to choose plain-English or technical detail — switching is instant, no page reload.",
      ],
    },
    advanced: {
      rootCause:
        "User-reported hypothesis was that in-memory caching (kept for low egress) was accumulating and causing the exit-134 (V8 heap OOM) crashes. Three parallel Explore passes over the full repo found no unbounded cache anywhere: lib/rate-limit.ts's Map is capped at 5000 keys (FIFO eviction); every unstable_cache call site (6 total) caches only small Postgres row/aggregate data, never image/video bytes, behind Next's own already-bounded 50MB in-memory Data Cache LRU; no on-disk cache precedent exists in server runtime code. The prior session's own diagnosis (see the 2026-09-16 dossier) was a V8 heap-ceiling/headroom mismatch (~256MB auto-sized ceiling on a 512MB container), not a leak — confirmed unchanged by this session's audit. NODE_OPTIONS=--max-old-space-size=400 (documented in .env.example since 2026-09-16) is the actual fix and was confirmed already set on Render.",
      changes: [
        { type: "changed", text: "next.config.ts: added an explicit cacheMaxMemorySize: 20MB (down from Next's implicit 50MB default) for the Data Cache, making the existing bound intentional rather than relying on an undocumented default." },
        { type: "changed", text: "app/(site)/page.tsx: getHomepageSections()'s features/phases/organizations/cta_buttons queries — previously unpaginated — now carry the same .limit(200) safety-cap pattern already used on the admin posts/features list pages." },
        { type: "added", text: "lib/changelog-data.ts: new structured changelog data source (version, date, simple + advanced content per entry) backing the new admin Changelogs tab." },
        { type: "added", text: "app/admin/(protected)/changelogs/page.tsx + components/admin/ChangelogBrowser.tsx: new admin page — Date-then-Version navigation, an instant client-side Simple/Advanced toggle (useTransition, zero re-fetch, since all content for every entry is already in the client's initial props)." },
        { type: "security", text: "Full re-audit of every app/api/*/route.ts and server action, NEXT_PUBLIC_* usage, and proxy.ts's CSP directive set: zero regressions from the 2026-09-15/09-16 baselines. No route/action lacks appropriate auth or validation; no secret is client-exposed; CSP matches the documented post-R2/post-Facebook-embed state." },
        { type: "fixed", text: "RangeError: Invalid time value, root cause found: app/admin/(protected)/posts/actions.ts's published_at handling only truthy-checked the admin's datetime input before calling new Date(...).toISOString(), never validating it actually parsed. New lib/safe-date.ts (parseValidDate, plus safeDate/safeToISOString for future call sites) backs a proper guard there; PostForm.tsx's Zod schema gained a matching .refine() so an unparseable value fails as a normal form error instead of reaching the server. A full repo-wide audit of every date-formatting call site found no other one at genuine risk." },
        { type: "changed", text: "ChangelogBrowser.tsx's date formatter and /admin/usage's istDateString() hardened as low-risk hygiene fixes surfaced by the same date audit (a hypothetical hand-typo'd changelog date, and a fragile toLocaleString()-round-trip pattern, respectively)." },
        { type: "changed", text: "Removed the non-functional Meta App ID/App Secret fields from Settings > Media & Display (MetaOEmbedSettingsForm.tsx, integration-actions.ts deleted) — they wrote to integration_settings, whose schema migration was never actually applied to the live database, so saving always failed. The 3-tier Facebook embed fallback (XFBML → iframe → outbound link) never depended on these credentials." },
        { type: "security", text: "Re-confirmed ENABLE_ADMIN_2FA left unset safely skips the OTP challenge (strict === \"true\" check) rather than dead-ending a login." },
      ],
      filesChanged: [
        "next.config.ts",
        "app/(site)/page.tsx",
        "lib/changelog-data.ts (new)",
        "app/admin/(protected)/changelogs/page.tsx (new)",
        "components/admin/ChangelogBrowser.tsx (new)",
        "components/admin/AdminSidebar.tsx",
        "CHANGELOG.md",
        "CHANGELOG.txt",
        "lib/safe-date.ts (new)",
        "app/admin/(protected)/posts/actions.ts",
        "app/admin/(protected)/posts/PostForm.tsx",
        "app/admin/(protected)/settings/MetaOEmbedSettingsForm.tsx (removed)",
        "app/admin/(protected)/settings/integration-actions.ts (removed)",
        "app/admin/(protected)/settings/page.tsx",
        "lib/settings-nav.ts",
        "components/embeds/FacebookEmbed.tsx",
        "app/admin/(protected)/usage/page.tsx",
      ],
    },
  },
  {
    version: "v1.14.0",
    date: "2026-09-16",
    title: "Fixed the Render crash; made the dashboard feel instant",
    simple: {
      summary:
        "The site was crashing on Render (\"exit status 134\") because the server ran out of memory — mostly triggered by uploading a large admin video. We shrank the maximum upload size and a few internal limits so a single upload can't push the server over the edge, and added logging so any future crash leaves a clear trail instead of a mystery. Separately, the admin dashboard was slow to navigate and could pile up requests if you clicked around impatiently — every sidebar link now shows an instant loading bar and disables itself while a page is loading, so clicking twice can't cause problems, and pages that only needed one piece of data now skip fetching the other eight.",
      tutorial: [
        "Nothing to configure — navigation is just faster now. A thin progress bar appears at the top while a page loads.",
        "Video uploads in the dashboard are capped at 25MB (down from 100MB) — if a video is larger, compress or trim it before uploading.",
      ],
    },
    advanced: {
      rootCause:
        "Render production crashed repeatedly with exit status 134 (confirmed V8 'JavaScript heap out of memory' from the crash log, not a native-module or assertion failure). The container's auto-sized V8 heap ceiling (~256MB) left almost no headroom over the app's steady-state footprint, and app/api/admin/upload/route.ts fully buffered uploads in memory with a 100MB video cap — a single admin video upload could transiently double-buffer ~200MB on top of that baseline.",
      changes: [
        { type: "fixed", text: "MAX_VIDEO_BYTES reduced 100MB → 25MB; experimental.serverActions.bodySizeLimit reduced 30mb → 1mb (a leftover from the pre-R2 complaint upload path, now dead)." },
        { type: "added", text: "instrumentation.ts/instrumentation-node.ts: periodic process.memoryUsage() logging (15 min) and onRequestError logging with digests, so a future crash leaves a trace." },
        { type: "added", text: "AdminNavPendingContext (shared useTransition pending state): every sidebar/Settings-tab link shows a top progress bar and disables itself the instant it's clicked, so rage-clicking can't stack concurrent server requests." },
        { type: "added", text: "app/admin/(protected)/loading.tsx: shared skeleton fallback for a page's own data fetch (doesn't cover the shared layout's auth fetch)." },
        { type: "changed", text: "/admin/settings now fetches only the active tab's data instead of unconditionally querying all 9 tables on every load." },
        { type: "changed", text: "Admin layout/Overview/Settings share one react cache()-wrapped auth/profile lookup (lib/admin-auth.ts) instead of 3 independent Supabase Auth calls per navigation." },
        { type: "changed", text: "posts/features/phases admin list queries capped at .limit(200) — a safety cap, not real pagination." },
        { type: "changed", text: "The 6 heaviest @dnd-kit Settings managers now load via next/dynamic, so /admin/settings' client bundle only pays for whichever tab is open." },
        { type: "changed", text: "SessionTimer.tsx no longer resets on scroll/touchstart — only pointerdown/keydown keeps the 15-minute session alive." },
        { type: "security", text: "Dedicated review of this diff: no high/medium findings. Repo-wide dead-code/dependency audit: eslint clean, no unused deps/files/assets." },
      ],
      filesChanged: [
        ".env.example",
        "app/admin/(protected)/features/page.tsx",
        "app/admin/(protected)/layout.tsx",
        "app/admin/(protected)/loading.tsx (new)",
        "app/admin/(protected)/page.tsx",
        "app/admin/(protected)/posts/page.tsx",
        "app/admin/(protected)/settings/page.tsx",
        "app/api/admin/upload/route.ts",
        "components/admin/AdminNavPendingContext.tsx (new)",
        "components/admin/AdminSidebar.tsx",
        "components/admin/AdminTopProgressBar.tsx (new)",
        "components/admin/SessionTimer.tsx",
        "instrumentation.ts (new)",
        "instrumentation-node.ts (new)",
        "lib/admin-auth.ts (new)",
        "next.config.ts",
      ],
    },
  },
  {
    version: "v1.13.1",
    date: "2026-09-15",
    title: "Fixed: every image and video on the site had stopped loading",
    simple: {
      summary:
        "Right after moving media storage to Cloudflare, every image and video on the public site silently failed to load — not broken files, just blocked by the browser's own security rules because we'd forgotten to tell it the new storage location was trusted. Fixed within hours of the migration; nothing else changed for visitors.",
    },
    advanced: {
      rootCause:
        "The Content-Security-Policy's img-src/media-src directives in proxy.ts were never updated to include the R2 host after v1.13.0 moved every media URL in the database to R2 — every image/video request was blocked by CSP enforcement, not missing or 404ing. next.config.ts's remotePatterns was already correct but inert (media renders as plain <img>/<video>, not next/image). Verified by diffing the live CSP header against real rendered <img src> values.",
      changes: [
        { type: "fixed", text: "Added R2_PUBLIC_DOMAIN and the raw {account}.r2.cloudflarestorage.com endpoint to img-src/media-src, and the latter to connect-src too (needed for the complaint form's direct-to-R2 presigned upload)." },
        { type: "security", text: "Full audit of the R2/complaints surface added in v1.13.0: no NEXT_PUBLIC_-prefixed secrets, no client component imports a server-only R2/service-role module." },
        { type: "security", text: "/api/admin/upload's DELETE handler now validates the key's folder prefix before calling deleteFromR2, instead of trusting any key an authenticated admin's browser sends." },
      ],
      filesChanged: ["app/api/admin/upload/route.ts", "proxy.ts"],
    },
  },
  {
    version: "v1.13.0",
    date: "2026-09-15",
    title: "Moved media storage to Cloudflare R2; new Usage Metrics dashboard",
    simple: {
      summary:
        "All site photos/videos now live on Cloudflare R2 instead of Supabase, which is faster and doesn't cost anything extra as the site grows (Cloudflare doesn't charge for bandwidth). Citizen complaint attachments got their own separate, private storage bucket that can never accidentally become public. The old Egress Monitor page is now the fuller \"Usage Metrics\" dashboard, showing how much storage and database bandwidth you're using against the free plan limits.",
      tutorial: [
        "Open Usage Metrics from the sidebar to see storage used and free-tier headroom, in Simple mode by default.",
        "Switch to Advanced mode for a monthly breakdown and live Cloudflare operation counts (only shown if a Cloudflare API token is configured).",
      ],
    },
    advanced: {
      changes: [
        { type: "added", text: "Cloudflare R2 as primary object storage for admin media, via a server-side upload proxy (app/api/admin/upload/route.ts) — a browser never holds R2's signing key directly." },
        { type: "added", text: "One-off migration (scripts/migrate-supabase-to-r2.ts, npm run migrate:r2) copied every Supabase Storage file to R2 and rewrote every stored URL. Ran successfully: 402 files transferred, 0 failed, 390 DB rows updated. Nothing deleted from Supabase Storage." },
        { type: "added", text: "Citizen complaint attachments move to R2 through a separate, private bucket (R2_COMPLAINT_BUCKET_NAME) reached only via presigned PUT/GET URLs — the admin-media bucket's public-access toggle is bucket-wide, so mixing private submissions into it would have exposed them." },
        { type: "added", text: "Client-side WebP compression and WebCodecs video re-encoding for complaint uploads — no file bytes pass through the Next.js server." },
        { type: "added", text: "Usage Metrics dashboard (/admin/usage, Simple/Advanced) replacing Egress Monitor — real R2 storage size/object counts alongside Supabase egress telemetry, with optional live Cloudflare operation counts." },
        { type: "changed", text: "Storage deletes route to R2 or legacy Supabase Storage per-object based on key shape, since both backends coexist until old buckets are cleaned up by hand." },
        { type: "fixed", text: "Migration script's header-corruption bug: .env.local's CRLF line endings leaked a stray \\r into R2's signed Authorization header. Fixed by sanitizing every parsed value." },
        { type: "security", text: "Complaint attachments deliberately kept out of the public R2 bucket to avoid exposing private citizen submissions." },
      ],
      filesChanged: [
        ".env.example", "app/(site)/complaints/actions.ts", "app/admin/(protected)/complaints/actions.ts",
        "app/admin/(protected)/complaints/page.tsx", "app/admin/(protected)/egress/page.tsx",
        "app/admin/(protected)/features/[id]/page.tsx", "app/admin/(protected)/features/actions.ts",
        "app/admin/(protected)/phases/PhasePhotosManager.tsx", "app/admin/(protected)/phases/actions.ts",
        "app/admin/(protected)/posts/PostThumbnailUploader.tsx", "app/admin/(protected)/posts/[id]/page.tsx",
        "app/admin/(protected)/posts/actions.ts", "app/admin/(protected)/settings/OrganizationsManager.tsx",
        "app/admin/(protected)/settings/SiteImageUploader.tsx", "app/admin/(protected)/settings/actions.ts",
        "app/admin/(protected)/usage/page.tsx (new)", "app/api/admin/upload/route.ts (new)",
        "app/api/complaints/upload-url/route.ts (new)", "components/admin/AdminSidebar.tsx",
        "components/admin/MediaManager.tsx", "components/complaints/ComplaintForm.tsx",
        "components/complaints/ComplaintMediaPicker.tsx (new)", "lib/cloudflare-analytics.ts (new)",
        "lib/complaint-storage-delete.ts (new)", "lib/complaints-cleanup.ts", "lib/media-upload-client.ts (new)",
        "lib/r2-complaints.ts (new)", "lib/r2-usage.ts (new)", "lib/r2.ts (new)", "lib/storage-delete.ts (new)",
        "lib/video-transcode.ts (new)", "next.config.ts", "package.json / package-lock.json",
        "scripts/migrate-supabase-to-r2.ts (new)",
      ],
    },
  },
  {
    version: "v1.12.0",
    date: "2026-09-15",
    title: "Facebook/Instagram embed settings + smarter link warnings",
    simple: {
      summary:
        "Added a place in Settings to connect a Meta (Facebook) developer account so post embeds can work more reliably, with a \"Test Connection\" button so you know immediately if it's set up right. The post editor now warns you inline if a link you've pasted won't embed properly (with a one-click way to turn it into a plain button instead), and a failed embed now shows a \"Watch on Facebook/YouTube\" card instead of just disappearing.",
      tutorial: [
        "Go to Settings > Media & Display.",
        "Enter your Meta App ID and App Secret, then click Test Connection to confirm they work.",
        "In the post editor, paste a Facebook/Instagram link — if it needs the source post to be Public, you'll see a note right there.",
      ],
    },
    advanced: {
      changes: [
        { type: "added", text: "Meta oEmbed API Settings card: App ID/Secret with a Test Connection button against Meta's Graph API. Credentials live in a new integration_settings table (admin-only RLS), not site_settings (public-readable via the anon key)." },
        { type: "added", text: "Real-time embed validation in the post editor's link rows; Facebook/Instagram links get a Public-source-post note." },
        { type: "added", text: "Load-failure fallback on PostEmbed: a blocked/failed iframe renders a \"Watch on Facebook/YouTube\" card instead of silently hiding." },
        { type: "added", text: "search_tags (site_settings) + tag manager UI, feeding metadata.keywords and a new JSON-LD @graph (WebSite + Person)." },
        { type: "changed", text: "PasswordInput's required attribute made opt-out, so it's reusable for an optional secret field." },
        { type: "security", text: "Meta App Secret isolated in the new admin-only integration_settings table rather than the public-readable site_settings row." },
      ],
      filesChanged: [
        "app/(site)/layout.tsx", "app/(site)/posts/[id]/page.tsx", "app/admin/(protected)/posts/PostForm.tsx",
        "app/admin/(protected)/settings/MetaOEmbedSettingsForm.tsx (new)", "app/admin/(protected)/settings/SeoSnippetForm.tsx",
        "app/admin/(protected)/settings/actions.ts", "app/admin/(protected)/settings/integration-actions.ts (new)",
        "app/admin/(protected)/settings/page.tsx", "components/admin/PasswordInput.tsx", "components/posts/PostEmbed.tsx",
        "lib/settings-nav.ts", "supabase/migrations/20260929000000_integration_settings.sql (new)",
        "supabase/migrations/20260929010000_search_tags.sql (new)", "types/database.types.ts", "types/domain.ts",
      ],
    },
  },
  {
    version: "v1.11.0",
    date: "2026-09-15",
    title: "Google search snippet editor + reorganized Settings menu",
    simple: {
      summary:
        "You can now edit exactly what shows up when the site appears in Google search results — the title, description, and a live preview of how it'll look. Settings itself got reorganized into a collapsible sub-menu (General, Sections, Header, Hero, Media, Users) instead of one long page with tabs.",
      tutorial: [
        "Go to Settings > General.",
        "Edit the search title and description — a live counter and a Google-style preview show exactly how it'll appear.",
        "Save. The homepage was also fixed to load its data through the same fast caching path as every other public page.",
      ],
    },
    advanced: {
      changes: [
        { type: "added", text: "Google Search Snippet editor (meta title + description, live counter, Google-style preview), wired into app/(site)/layout.tsx's title/description/OpenGraph metadata." },
        { type: "added", text: "Granular cache tags (TAG_SETTINGS, TAG_POSTS_LIST, TAG_POST_ITEM(id), TAG_SECTIONS) via new shared lib/queries/{settings,posts}.ts reads, replacing one coarse PUBLIC_CACHE_TAG." },
        { type: "changed", text: "Settings sidebar entry converted into a collapsible sub-menu; page header/tab title now driven by the active tab; dropped the redundant in-page tab bar." },
        { type: "changed", text: "Settings/posts admin actions now call targeted revalidateTag() instead of a coarse flush." },
        { type: "fixed", text: "/complaints was querying Supabase directly on every request instead of going through the cache-first architecture every other public page used." },
      ],
      filesChanged: [
        "app/(site)/complaints/page.tsx", "app/(site)/layout.tsx", "app/(site)/notable-works/page.tsx",
        "app/(site)/page.tsx", "app/(site)/posts/[id]/page.tsx", "app/admin/(protected)/posts/actions.ts",
        "app/admin/(protected)/settings/BrowserTabSettingsForm.tsx (removed)", "app/admin/(protected)/settings/SeoSnippetForm.tsx (new)",
        "app/admin/(protected)/settings/SettingsTabs.tsx", "app/admin/(protected)/settings/actions.ts",
        "app/admin/(protected)/settings/page.tsx", "components/admin/AdminSidebar.tsx", "lib/cache.ts",
        "lib/queries/posts.ts (new)", "lib/queries/settings.ts (new)", "lib/settings-nav.ts (new)",
        "supabase/migrations/20260928000000_meta_description.sql (new)", "types/database.types.ts",
      ],
    },
  },
  {
    version: "v1.10.0",
    date: "2026-09-14",
    title: "Favicon, browser tab title, and optional post times",
    simple: {
      summary:
        "The site now has a proper browser tab icon and an editable site title that appears in the browser tab. Each post can now optionally show its exact published time, not just the date.",
      tutorial: [
        "Go to Settings > General to edit the browser tab title.",
        "When writing or editing a post, toggle whether its published time is shown publicly.",
      ],
    },
    advanced: {
      changes: [
        { type: "added", text: "app/icon.tsx + public/favicon.ico (\"DC\" mark) as the sitewide favicon." },
        { type: "added", text: "site_settings.site_title driving a sitewide <title> template via generateMetadata, with a dedicated Browser Tab Settings admin card." },
        { type: "added", text: "posts.show_published_time, letting the editor toggle whether a post's published time renders publicly." },
        { type: "added", text: "Word-boundary truncation for long post titles in the browser tab." },
        { type: "changed", text: "Dashboard layout uses h-dvh + independent scroll regions instead of body scroll, fixing the admin sidebar scrolling away on long pages." },
        { type: "fixed", text: "The public site_settings query was breaking the entire header whenever a not-yet-migrated column was referenced explicitly — switched to select(\"*\") for resilience." },
      ],
      filesChanged: [
        "app/(site)/complaints/page.tsx", "app/(site)/layout.tsx", "app/(site)/notable-works/page.tsx",
        "app/(site)/posts/[id]/page.tsx", "app/admin/(protected)/layout.tsx", "app/admin/(protected)/posts/PostForm.tsx",
        "app/admin/(protected)/posts/actions.ts", "app/admin/(protected)/settings/BrowserTabSettingsForm.tsx (new)",
        "app/admin/(protected)/settings/actions.ts", "app/admin/(protected)/settings/page.tsx", "app/icon.tsx (new)",
        "components/admin/AdminSidebar.tsx", "components/posts/PostsFeed.tsx", "components/site/SiteHeader.tsx",
        "lib/post-date.ts (new)", "lib/truncate-title.ts (new)", "public/favicon.ico (new)",
        "supabase/migrations/20260926000000_site_title.sql (new)", "supabase/migrations/20260927000000_post_optional_time.sql (new)",
        "types/database.types.ts",
      ],
    },
  },
  {
    version: "v1.9.0",
    date: "2026-09-13",
    title: "Sitemap and robots.txt for search engines",
    simple: {
      summary:
        "Added the standard files search engines use to discover and correctly index the site's pages, while keeping the admin dashboard out of search results entirely.",
    },
    advanced: {
      changes: [
        { type: "added", text: "app/sitemap.ts and app/robots.ts using the App Router metadata route convention, pointing crawlers to core public pages while excluding /admin." },
      ],
      filesChanged: ["app/robots.ts (new)", "app/sitemap.ts (new)"],
    },
  },
  {
    version: "v1.8.0",
    date: "2026-09-13",
    title: "Egress & Cache Efficiency Monitor (later replaced by Usage Metrics)",
    simple: {
      summary:
        "Added a dashboard page showing how much database bandwidth caching was saving. This page was later replaced by the fuller Usage Metrics dashboard in v1.13.0 — the underlying tracking it introduced is still in use.",
    },
    advanced: {
      changes: [
        { type: "added", text: "Egress & Cache Efficiency Monitor at /admin/egress: new cache_metrics table + atomic record_cache_event() upsert function (RLS: admin-only SELECT, no direct write policy — every write goes through the SECURITY DEFINER function). Reduction-rate banner, baseline-vs-actual-vs-saved comparison, per-route hit/miss/bandwidth table, Today/7-day/30-day filter." },
        { type: "added", text: "Hit/miss telemetry wired into lib/cache.ts's createTrackedCache() (drop-in unstable_cache replacement), used at all 5 public data-fetch call sites. Hit vs. miss detected via a monotonic per-route counter stamped into the cached value itself — confirmed race-free (a shared mutable flag would not have been) by checking recorded rows against known request counts on a running production server." },
        { type: "changed", text: "Build-source detection (RENDER/CI/GITHUB_ACTIONS) added to both Discord notification paths, each labeling its embed Remote or Local." },
      ],
      filesChanged: [
        "supabase/migrations/20260925000000_cache_metrics.sql (new)", "types/database.types.ts", "types/domain.ts",
        "lib/cache.ts", "app/(site)/layout.tsx", "app/(site)/page.tsx", "app/(site)/notable-works/page.tsx",
        "app/(site)/posts/[id]/page.tsx", "app/(site)/phases/[id]/page.tsx", "app/admin/(protected)/egress/page.tsx (new)",
        "components/admin/AdminSidebar.tsx", "scripts/notify-discord.js", ".github/workflows/discord-notify.yml",
      ],
    },
  },
  {
    version: "v1.7.1",
    date: "2026-09-13",
    title: "Fixed a build break in automated deployment checks",
    simple: {
      summary:
        "A behind-the-scenes automated check (that runs every time code is pushed) started failing right after the previous update. Fixed the same day — never affected the live site, only the automated checks.",
    },
    advanced: {
      rootCause:
        "GitHub Actions' npm run build step has no NEXT_PUBLIC_SUPABASE_URL/ANON_KEY; once app/(site)/layout.tsx switched to the cookie-free public Supabase client, Next's build-time static-eligibility probe had no cookies() call left to trip its dynamic-bail signal, so it fully executed getSiteChrome() while probing /complaints and hit the missing env var. Passed locally only because .env.local happens to supply that value.",
      changes: [
        { type: "fixed", text: "Added export const dynamic = \"force-dynamic\" to app/(site)/layout.tsx so Next skips the static probe for every page under (site), matching reality (the CSP nonce already prevents static serving). Verified by building with .env.local removed entirely." },
      ],
      filesChanged: ["app/(site)/layout.tsx", "app/(site)/page.tsx", "CHANGELOG.txt", "CHANGELOG.md"],
    },
  },
  {
    version: "v1.7.0",
    date: "2026-09-13",
    title: "Added a caching layer to cut database bandwidth costs",
    simple: {
      summary:
        "Public pages now reuse recently-fetched data for up to a minute instead of re-querying the database on every visit, cutting database costs substantially. Images also now stay cached in visitors' browsers for 30 days instead of 1 hour, so repeat visits load faster.",
    },
    advanced: {
      changes: [
        { type: "added", text: "Public pages read through a new cookie-free public Supabase client, wrapped in unstable_cache(revalidate: 60, tags: ['public-content']) — verified: 5 back-to-back homepage requests produced only 1 actual database query." },
        { type: "added", text: "revalidatePublicPages() for instant on-demand cache flush, wired into ~20 admin mutation call sites (arrangement, features, phases, posts, every Settings sub-area) so a dashboard save doesn't wait out the 60-second window." },
        { type: "changed", text: "Supabase Storage upload cacheControl bumped from 1 hour to 30 days across all media types." },
      ],
      filesChanged: [
        "lib/cache.ts (new)", "utils/supabase/public.ts (new)", "app/(site)/layout.tsx", "app/(site)/page.tsx",
        "app/(site)/notable-works/page.tsx", "app/(site)/posts/[id]/page.tsx", "app/(site)/phases/[id]/page.tsx",
        "app/admin/(protected)/arrangement/actions.ts", "app/admin/(protected)/features/actions.ts",
        "app/admin/(protected)/phases/actions.ts", "app/admin/(protected)/posts/actions.ts",
        "app/admin/(protected)/settings/actions.ts", "next.config.ts",
      ],
    },
  },
  {
    version: "v1.6.0",
    date: "2026-09-13",
    title: "Decimal slideshow speeds, Phase publish toggle, Phase detail pages",
    simple: {
      summary:
        "Slideshow speeds can now be set with decimals (like 2.5 seconds), not just whole numbers. Phases (life & career milestones) got their own draft/published toggle, just like galleries already had, and each Phase now has a \"Read More\" page with its full story and complete photo gallery.",
      tutorial: [
        "When editing a Phase or gallery, set the slideshow speed to any value like 2.5 using the number field.",
        "Toggle a Phase to Published when it's ready to appear on the site.",
      ],
    },
    advanced: {
      changes: [
        { type: "changed", text: "Converted all slideshow interval columns from integer to numeric(4,2), with step=\"0.1\" inputs, end to end." },
        { type: "added", text: "Dedicated is_published toggle for Phases, defaulting to draft on creation." },
        { type: "added", text: "Phase \"Read More\" page (/phases/[id]) with full narrative and uncapped photo gallery, each photo with caption and an optional per-photo fact/detail field." },
        { type: "changed", text: "Conditional Phase media rendering: auto-advancing slideshow when interval > 0, otherwise a static grid capped at a configurable max_display_images." },
      ],
      filesChanged: [
        "supabase/migrations/20260924000000_phases_and_timer_enhancements.sql", "types/database.types.ts", "types/domain.ts",
        "app/(site)/page.tsx", "app/(site)/notable-works/page.tsx", "app/(site)/phases/[id]/page.tsx",
        "components/phases/PhaseEntry.tsx", "components/phases/PhaseGallery.tsx", "components/phases/PhaseSlideshow.tsx",
        "components/phases/PhaseFullGallery.tsx", "components/features/FeatureSection.tsx", "components/posts/PostsFeed.tsx",
        "app/admin/(protected)/phases/actions.ts", "app/admin/(protected)/phases/PhaseForm.tsx",
        "app/admin/(protected)/phases/PhasePhotosManager.tsx", "app/admin/(protected)/features/FeatureForm.tsx",
        "app/admin/(protected)/features/SectionList.tsx", "app/admin/(protected)/posts/PostForm.tsx",
        "app/admin/(protected)/arrangement/ArrangementManager.tsx", "lib/homepage-layout.ts",
      ],
    },
  },
  {
    version: "v1.0.0",
    date: "2026-09-13",
    title: "Dedicated Arrangement page for reordering the homepage",
    simple: {
      summary:
        "Reordering homepage sections now has its own dedicated page, separate from the general Settings. Header and Hero are locked at the top, Footer locked at the bottom, and everything else (Posts, Organizations, each Feature/Phase) can be freely reordered or hidden between them.",
      tutorial: [
        "Open Arrangement from the sidebar.",
        "Drag a section, or use the up/down arrows, to reorder it.",
        "Click the eye icon to show or hide a section on the public site.",
      ],
    },
    advanced: {
      changes: [
        { type: "added", text: "Dedicated /admin/arrangement page, replacing the old Settings > Homepage Sections tab." },
        { type: "added", text: "Drag-and-drop handles plus Move Up/Down buttons (disabled at the top/bottom of the movable zone) and a visibility toggle per section." },
        { type: "added", text: "Audit log entry (UPDATE_ARRANGEMENT) whenever the layout order is saved." },
      ],
      filesChanged: [
        "app/admin/(protected)/arrangement/page.tsx", "app/admin/(protected)/arrangement/ArrangementManager.tsx",
        "app/admin/(protected)/arrangement/actions.ts", "app/admin/(protected)/settings/page.tsx",
        "app/admin/(protected)/settings/actions.ts", "app/admin/(protected)/settings/HomepageLayoutManager.tsx (removed)",
        "app/admin/(protected)/features/actions.ts", "components/admin/AdminSidebar.tsx",
      ],
    },
  },
  {
    version: "v0.7.0",
    date: "2026-09-13",
    title: "Phases as a content type; Notable Works archive; admin presence",
    simple: {
      summary:
        "Added \"Phases\" (life & career milestones) as their own content type, then streamlined them under the existing Features model to cut duplicate code. Notable Works (posts) got its own archive page and post pinning. The dashboard now shows who else is currently logged in, keeps a 24-hour activity log, and works properly on mobile with a slide-in menu.",
      tutorial: [
        "Open the Modular Sections list to add a new Phase alongside your Image Galleries.",
        "Visit Activity Logs to see recent dashboard actions from any admin.",
      ],
    },
    advanced: {
      changes: [
        { type: "added", text: "Phases as first-class content (admin CRUD, public showcase, photo manager), then merged under Features as a distinct Section Type." },
        { type: "changed", text: "Notable Works refactored: dedicated /notable-works archive page, post pinning, reworked carousel/slideshow." },
        { type: "added", text: "Admin presence indicators and a 24-hour rolling activity log (dashboard_activity_logs)." },
        { type: "added", text: "Responsive admin sidebar: slide-in mobile drawer replacing a desktop-only fixed sidebar." },
        { type: "security", text: "Fixed an RLS infinite-recursion bug and audited every admin-auth policy end to end." },
      ],
      filesChanged: [
        "app/(site)/error.tsx (new)", "app/global-error.tsx (new)", "app/(site)/notable-works/page.tsx (new)",
        "app/(site)/page.tsx", "app/(site)/posts/[id]/page.tsx", "app/admin/(protected)/error.tsx (new)",
        "app/admin/(protected)/layout.tsx", "app/admin/(protected)/page.tsx", "app/admin/(protected)/logs/page.tsx (new)",
        "app/admin/(protected)/features/*", "app/admin/(protected)/phases/*", "app/admin/(protected)/posts/PostForm.tsx",
        "components/admin/AdminPresence.tsx (new)", "components/admin/AdminSidebar.tsx (new)",
        "components/admin/MobileSidebarContext.tsx (new)", "lib/activity-log.ts (new)",
        "supabase/migrations/20260921000000_audit_and_fix_rls.sql (new)",
      ],
    },
  },
  {
    version: "v0.6.0",
    date: "2026-09-12",
    title: "Mandatory 2-step login (OTP), password self-service",
    simple: {
      summary:
        "Admin login now requires a code (sent by email/SMS) in addition to your password, for extra security. Admins can now change their own password, and the primary admin can reset another user's password if they get locked out.",
      tutorial: [
        "Log in as usual — you'll now also be asked for a 6-digit code sent to your email/phone.",
        "Go to your profile card to change your own password at any time.",
      ],
    },
    advanced: {
      changes: [
        { type: "added", text: "Mandatory two-step OTP login and a MODERATOR role tier." },
        { type: "added", text: "Self-service password change and an admin-override reset for other users' passwords." },
        { type: "fixed", text: "Broken handle_new_user Postgres trigger and a login Server Action redirect race condition that could leave a session in an inconsistent state." },
      ],
      filesChanged: [
        "app/admin/(protected)/layout.tsx", "app/admin/(protected)/settings/UsersManager.tsx",
        "app/admin/login/LoginForm.tsx (new)", "app/admin/verify-otp/VerifyOtpForm.tsx (new)",
        "components/admin/AdminResetPasswordModal.tsx (new)", "components/admin/ChangePasswordModal.tsx (new)",
        "lib/admin-guard.ts", "lib/otp-login.ts", "lib/otp-session.ts", "proxy.ts",
        "supabase/migrations/20260915000000_moderator_role.sql (new)",
      ],
    },
  },
  {
    version: "v0.5.0",
    date: "2026-09-12",
    title: "Homepage layout builder, dual-column post layout, user management",
    simple: {
      summary:
        "Added the first version of the homepage section reorder tool (later replaced by the dedicated Arrangement page), a two-column post detail layout on desktop, dual-channel (email/SMS) login codes, a 15-minute auto-logout timer, and the ability to manage dashboard users and their roles.",
    },
    advanced: {
      changes: [
        { type: "added", text: "Homepage layout builder (HomepageLayoutManager.tsx) — precursor to the later dedicated /admin/arrangement page." },
        { type: "changed", text: "Post detail page: embed sits beside post text in two columns on desktop (stacked on mobile); uploaded media renders only in the dedicated Media section below." },
        { type: "added", text: "Dual-channel (email/SMS) login OTP, 15-minute inactivity session timer, user/role management (UsersManager.tsx)." },
        { type: "fixed", text: "A media-rendering crash on the public post page; a bug in the single-admin migration." },
      ],
      filesChanged: [
        "app/(site)/page.tsx", "app/(site)/posts/[id]/page.tsx", "app/admin/(protected)/layout.tsx",
        "app/admin/(protected)/settings/HomepageLayoutManager.tsx (new)", "app/admin/(protected)/settings/UsersManager.tsx (new)",
        "components/admin/SessionTimer.tsx (new)", "lib/admin-guard.ts (new)", "lib/otp-login.ts (new)",
        "supabase/migrations/20260914000000_otp_and_user_roles.sql (new)",
      ],
    },
  },
  {
    version: "v0.4.0",
    date: "2026-09-12",
    title: "Custom header action colors, Discord push notifications",
    simple: {
      summary:
        "Header action buttons can now each have their own color. Every code push now sends a Discord notification. Removed dark mode, redesigned the mobile header, and added post thumbnails.",
      tutorial: [
        "In Settings > Header & Navigation, set a custom color per header action button.",
      ],
    },
    advanced: {
      changes: [
        { type: "added", text: "Per-header-action colors, side-by-side post detail layout, per-post carousel speed control." },
        { type: "added", text: "Discord push notifications via a GitHub Actions workflow, plus a local notify-discord.js script for dev-machine pushes." },
        { type: "fixed", text: "Root cause of an earlier dashboard crash; unified header/nav settings, hero badge, and organization-wrap controls." },
        { type: "changed", text: "Removed dark mode entirely, redesigned the mobile header, added post thumbnails, split post media into its own section." },
      ],
      filesChanged: [
        "app/(site)/page.tsx", "app/(site)/posts/[id]/page.tsx", "app/admin/(protected)/posts/PostForm.tsx",
        "app/admin/(protected)/settings/HeaderActionsManager.tsx", "app/admin/(protected)/settings/NavLinksManager.tsx (new)",
        ".github/workflows/discord-notify.yml (new)", "scripts/notify-discord.js (new)",
        "supabase/migrations/20260912000000_header_action_colors_and_post_interval.sql (new)",
      ],
    },
  },
  {
    version: "v0.3.0",
    date: "2026-09-11",
    title: "Header builder, post embeds, complaint reference numbers",
    simple: {
      summary:
        "Added a header builder for custom action buttons, embeddable posts (YouTube/Facebook/etc.) with image carousels, an editable contact email, and reference numbers for citizen complaints so they can be tracked.",
      tutorial: [
        "In Settings > Header & Navigation, add or edit custom header action buttons.",
      ],
    },
    advanced: {
      changes: [
        { type: "added", text: "Header builder (custom header actions/buttons), post embeds and image carousels, dynamic contact email, complaint reference numbers." },
        { type: "added", text: "Full-color organization hover showcase and an optional complaint phone number field." },
        { type: "added", text: "Root-relative section anchors with cross-page smooth scrolling (AnchorAwareLink.tsx)." },
      ],
      filesChanged: [
        "app/(site)/complaints/page.tsx", "app/(site)/layout.tsx", "app/(site)/page.tsx", "app/(site)/posts/[id]/page.tsx",
        "app/admin/(protected)/complaints/ComplaintDetailModal.tsx", "app/admin/(protected)/settings/HeaderActionsManager.tsx (new)",
        "components/posts/PostEmbed.tsx (new)", "components/posts/PostImageCarousel.tsx (new)",
        "components/site/AnchorAwareLink.tsx (new)", "lib/embed.ts (new)", "lib/reference.ts (new)",
      ],
    },
  },
  {
    version: "v0.2.0",
    date: "2026-09-11",
    title: "Render deployment configuration",
    simple: {
      summary: "Behind-the-scenes work getting the site properly deployed on Render. No visible change for visitors or admins.",
    },
    advanced: {
      changes: [
        { type: "added", text: "Render Blueprint (render.yaml) with standalone Next.js output for deployment, then fixed the build (devDependencies weren't installed), then removed render.yaml entirely in favor of configuring the build directly in Render's dashboard." },
      ],
      filesChanged: ["next.config.ts", "render.yaml (added, then removed)"],
    },
  },
  {
    version: "v0.1.0",
    date: "2026-09-11",
    title: "Launch: the dynamic site and admin dashboard",
    simple: {
      summary:
        "This is where the current site began: replacing the old hand-built static pages with the full dynamic application — the public site, the admin dashboard (login, Features, Posts, Complaints), and citizen complaints with automatic deletion after their retention period expires.",
    },
    advanced: {
      changes: [
        { type: "added", text: "Replaced the hand-authored static HTML/CSS site with the current dynamic Next.js application: public site, full admin dashboard, initial Supabase schema/RLS/storage setup. ~106 files added in one commit (0f06030) — the actual starting point of this changelog." },
        { type: "added", text: "Citizen complaint retention policy: purgeExpiredComplaints() permanently deletes any complaint past its expires_at timestamp (row, media rows, storage files). Runs inline on every admin dashboard load and via an unauthenticated cron endpoint (optionally gated behind CRON_SECRET)." },
      ],
      filesChanged: [
        "Full application scaffold — see commit 0f06030 for the complete ~106-file list.",
        "app/(site)/*", "app/admin/*", "utils/supabase/{admin,client,middleware,server}.ts",
        "supabase/migrations/20260911170000_complaints.sql", "supabase/migrations/20260911220000_complaint_status.sql",
      ],
    },
  },
];
