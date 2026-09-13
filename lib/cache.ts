// lib/cache.ts
//
// Central "flush the public cache" hook, called from every admin
// mutation that changes something a public page reads (Posts, Features,
// Phases, homepage Arrangement, or any Settings tab).
//
// This site's proxy.ts issues a fresh per-request CSP nonce on every
// route (`script-src 'nonce-...' 'strict-dynamic'`), and nonce-based CSP
// requires dynamic rendering site-wide (see
// node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
// — "Static optimization and Incremental Static Regeneration (ISR) are
// disabled"). Confirmed by building with `export const revalidate = 60`
// on the homepage: it still built as `ƒ (Dynamic)`, not `◐ (ISR)`. So
// page-level revalidate is a no-op here — freshness and caching both
// have to happen one level down, at the data-fetch layer instead of the
// route layer:
//
//   - Every public page/layout's Supabase reads go through
//     utils/supabase/public.ts's cookie-free client, wrapped in
//     `unstable_cache(fn, keyParts, { revalidate: 60, tags: [PUBLIC_CACHE_TAG] })`.
//   - The page itself still renders fresh HTML on every request (CSP
//     requires that), but on a cache hit that render reuses the cached
//     query result instead of re-hitting Postgres — which is what
//     actually drives Supabase egress, not the HTML response.
//   - revalidatePublicPages() below busts every one of those cached
//     reads immediately, so an admin's save shows up right away instead
//     of waiting out the 60s window.
//
// One coarse tag rather than a tag per table: this site's public pages
// are read-heavy/low-traffic, cross-reference each other pretty freely
// (the homepage alone reads settings, features, posts, phases, and
// organizations), and every admin mutation already called
// `revalidatePath("/")` unconditionally before this — so a single tag
// matches the granularity this codebase already treated as "correct"
// and is trivial to reason about. Split it into per-table tags later
// only if over-invalidation actually becomes a measurable cost.
import { revalidateTag } from "next/cache";

export const PUBLIC_CACHE_TAG = "public-content";

export function revalidatePublicPages() {
  // Next 16's revalidateTag requires a second "profile" argument.
  // `"max"` (the recommended default) serves stale content while
  // revalidating in the background — the opposite of what "instant
  // flush on save" needs. `{ expire: 0 }` is the non-deprecated way to
  // get the old "next request is a blocking cache miss" behavior, so an
  // admin's save is reflected on the very next public page load.
  revalidateTag(PUBLIC_CACHE_TAG, { expire: 0 });
}
