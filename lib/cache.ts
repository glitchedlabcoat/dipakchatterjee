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
