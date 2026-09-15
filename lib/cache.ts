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
import { revalidateTag, unstable_cache } from "next/cache";
import { createPublicClient } from "@/utils/supabase/public";

// Coarse, whole-site tag — still applied to every cached public read
// below alongside its granular tag(s), so revalidatePublicPages() stays
// a correct (if blunt) "flush everything" fallback for any admin
// mutation that doesn't yet have its own targeted revalidateTag() call.
export const PUBLIC_CACHE_TAG = "public-content";

// Granular tags: an admin mutation that only touches one of these calls
// revalidateTag() with the matching tag instead of PUBLIC_CACHE_TAG, so
// unrelated cached reads (a different post, or settings when a post
// changes) are left untouched and keep serving from cache — no
// Supabase egress — until they actually expire or something that
// actually affects them changes. See lib/queries/*.ts for what's tagged
// with which, and app/admin/(protected)/{settings,posts}/actions.ts for
// the mutations that call revalidateTag() with them.
export const TAG_SETTINGS = "site-settings";
export const TAG_POSTS_LIST = "posts-list";
export const TAG_POST_ITEM = (id: string) => `post-${id}`;
export const TAG_SECTIONS = "homepage-sections";

export function revalidatePublicPages() {
  // Next 16's revalidateTag requires a second "profile" argument.
  // `"max"` (the recommended default) serves stale content while
  // revalidating in the background — the opposite of what "instant
  // flush on save" needs. `{ expire: 0 }` is the non-deprecated way to
  // get the old "next request is a blocking cache miss" behavior, so an
  // admin's save is reflected on the very next public page load.
  revalidateTag(PUBLIC_CACHE_TAG, { expire: 0 });
}

// Same immediate-flush semantics as revalidatePublicPages() above, for
// a single granular tag — use this from a mutation that only touched
// one kind of content (see TAG_* above) so everything else stays cached.
export function revalidatePublicTag(tag: string) {
  revalidateTag(tag, { expire: 0 });
}

// --- Cache Efficiency telemetry (Egress Monitor, /admin/egress) -----------
//
// Fires record_cache_event() (see the cache_metrics migration) on every
// cache hit and miss so the dashboard can show real hit ratios and
// estimated bandwidth saved, per route. Recording is fire-and-forget —
// awaited internally by recordCacheEvent()'s own promise chain, but never
// awaited by the caller — so a slow or failing telemetry write can never
// delay or break an actual page render.
async function recordCacheEvent(route: string, isHit: boolean, bytes: number) {
  try {
    const supabase = createPublicClient();
    await supabase.rpc("record_cache_event", { p_route: route, p_is_hit: isHit, p_bytes: bytes });
  } catch {
    // Telemetry is best-effort. A failure here (network blip, RPC not
    // yet migrated on some environment, etc.) must never surface to a
    // site visitor or affect the page they're loading.
  }
}

// Wraps `unstable_cache` with hit/miss telemetry for one route. Usage is
// identical to `unstable_cache(fn, keyParts, options)` — just pass the
// route label (the string shown in the Egress Monitor's per-route table,
// e.g. "/", "/notable-works", "/posts/[id]") as the first argument.
//
// Hit vs. miss detection: `fn` only ever runs on a genuine cache miss
// (that's what `unstable_cache` guarantees), so the miss side records
// itself unambiguously from inside `fn`. The hit side has no such signal
// — a cache hit returns straight out of `unstable_cache` without telling
// the caller anything happened — so a monotonic per-route counter is
// stashed inside the cached value itself: `fn` stamps its result with the
// counter's value *after* incrementing it, and the outer wrapper compares
// that stamp against the counter value it observed just before calling in.
// A hit replays an old stamp from an earlier (already-recorded) miss, so
// it always compares as "not newer" — cheap, allocation-free, and immune
// to the read-then-write races a shared boolean flag would have under
// concurrent requests (unstable_cache itself coalesces concurrent misses
// for the same key into one execution, so every caller in a coalesced
// batch reads the same "before" value and the same post-increment stamp).
export function createTrackedCache<Args extends unknown[], T>(
  route: string,
  fn: (...args: Args) => Promise<T>,
  keyParts: string[],
  options: { revalidate: number; tags: string[] }
): (...args: Args) => Promise<T> {
  let missCounter = 0;

  const cached = unstable_cache(
    async (...args: Args) => {
      const data = await fn(...args);
      const bytes = Buffer.byteLength(JSON.stringify(data));
      void recordCacheEvent(route, false, bytes);
      missCounter += 1;
      return { data, bytes, missToken: missCounter };
    },
    keyParts,
    options
  );

  return async (...args: Args) => {
    const before = missCounter;
    const { data, bytes, missToken } = await cached(...args);
    if (missToken <= before) {
      void recordCacheEvent(route, true, bytes);
    }
    return data;
  };
}

// For a cached read whose tag depends on the argument it's called with
// — e.g. one TAG_POST_ITEM(id) tag per post — rather than a fixed set
// of tags decided once up front. `unstable_cache`'s own `tags` option
// can't vary per call: it's baked in at the moment `unstable_cache(fn,
// keyParts, options)` is invoked, and createTrackedCache above calls
// that exactly once, reusing the same wrapper (and its `tags`) for
// every subsequent call regardless of arguments. This instead builds
// and immediately calls a *fresh* `unstable_cache` wrapper every time,
// with that call's own tags baked into *this* wrapper. That's safe:
// Next derives the persistent cache key from `keyParts` plus the
// (textually identical, since it's the same function literal below)
// stringified `fn`, not from JS closure/object identity — so repeated
// calls with the same `keyParts` (which must include whatever varies
// the tag, e.g. the id) still correctly hit the same cache entry across
// separate `unstable_cache()` constructions.
//
// Hit/miss detection is correspondingly simpler than createTrackedCache's
// counter/stamp trick: since `fn` here is a fresh closure scoped to this
// one call, a plain local flag it sets is unambiguous — no risk of a
// concurrent call for a *different* argument (and therefore a different
// cache key) racing it, the way a flag shared across every call to one
// long-lived wrapper could.
export async function trackedCacheRead<T>(
  route: string,
  fn: () => Promise<T>,
  keyParts: string[],
  options: { revalidate: number; tags: string[] }
): Promise<T> {
  let ranFn = false;

  const cached = unstable_cache(
    async () => {
      ranFn = true;
      return fn();
    },
    keyParts,
    options
  );

  const data = await cached();
  void recordCacheEvent(route, !ranFn, Buffer.byteLength(JSON.stringify(data)));
  return data;
}
