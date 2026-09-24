// lib/facebook-resolver.ts
//
// SERVER-ONLY. Resolves a Facebook share short-link
// (www.facebook.com/share/{v,r,p}/<code>/, or fb.watch/<code>) to the
// canonical permalink it redirects to, BEFORE it reaches
// lib/embed.ts / components/embeds/FacebookEmbed.tsx.
//
// Why: Meta's XFBML fb-video/fb-post plugins can't resolve share
// short-links — every stored /share/v/ link rendered "Video Unavailable",
// while the exact same videos (including Reels) played once given their
// canonical /videos/<id>/ or /reel/<id>/ URL. Some /share/v/ links even
// point at a regular post (/posts/pfbid...), which needs fb-post, not
// fb-video — so classification must happen on the RESOLVED URL.
//
// How (measured 2026-09-24 from both a residential IP and this Render
// instance's datacenter IP, identical results): Facebook answers a
// crawler/tool User-Agent with a bodyless `302` whose `Location` header
// is the canonical URL; any browser User-Agent gets a `400` instead. So
// this is one header-only request — redirect: "manual", body cancelled
// unread — and never follows the redirect or downloads a page.
//
// Cost: results are cached for 30 days via unstable_cache (a resolved
// permalink never changes), so each link costs roughly one ~1KB request
// per month (or per deploy, since Render's cache dir is ephemeral).
// Failures are NOT cached — the cached function throws, and
// unstable_cache never stores a thrown result — so a transient Facebook
// hiccup can't pin a link to its unresolved form for 30 days.
//
// Fail-soft: any timeout, network error, non-redirect status, or odd
// redirect target (login wall, checkpoint, another short-link, a
// non-Facebook host) returns the ORIGINAL URL, i.e. exactly what the
// page rendered before this existed.

import { unstable_cache } from "next/cache";
import { sanitizeFacebookUrl } from "@/lib/facebook-url";

const RESOLVE_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const TIMEOUT_MS = 4000;
const CACHE_SECONDS = 30 * 24 * 60 * 60;

export function isFacebookShortLink(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace(/^(www|m|web)\./, "");
    if (host === "fb.watch") return url.pathname.length > 1;
    return host === "facebook.com" && /^\/share\/[vrp]\/[^/]+/.test(url.pathname);
  } catch {
    return false;
  }
}

async function resolveUncached(shortUrl: string): Promise<string> {
  const res = await fetch(shortUrl, {
    redirect: "manual",
    headers: { "User-Agent": RESOLVE_UA },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Headers are all we need — never download the body.
  await res.body?.cancel().catch(() => {});

  const location = res.headers.get("location");
  if (res.status < 300 || res.status >= 400 || !location) {
    throw new Error(`unexpected response ${res.status}`);
  }

  const target = new URL(location, shortUrl).toString();
  if (/\/(login|checkpoint)\b/i.test(target) || isFacebookShortLink(target)) {
    throw new Error(`unusable redirect target ${target}`);
  }

  const clean = sanitizeFacebookUrl(target);
  if (!clean) throw new Error(`redirect left Facebook: ${target}`);
  return clean;
}

// unstable_cache folds the function's arguments into the cache key, so
// each short URL gets its own entry under this one key prefix.
const resolveCached = unstable_cache(resolveUncached, ["facebook-short-link"], {
  revalidate: CACHE_SECONDS,
  tags: ["facebook-short-link"],
});

/**
 * Canonical permalink for a Facebook share short-link; any other URL
 * (including a failed resolution) is returned unchanged.
 */
export async function resolveFacebookUrl(rawUrl: string): Promise<string> {
  if (!isFacebookShortLink(rawUrl)) return rawUrl;
  try {
    return await resolveCached(rawUrl);
  } catch (err) {
    console.warn(`[facebook-resolver] kept original ${rawUrl}: ${err instanceof Error ? err.message : err}`);
    return rawUrl;
  }
}
