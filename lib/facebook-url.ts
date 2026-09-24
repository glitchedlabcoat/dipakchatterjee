// lib/facebook-url.ts
//
// Normalizes a Facebook post/video/photo permalink before handing it to
// the XFBML fb-post plugin's data-href attribute (see
// components/embeds/FacebookEmbed.tsx) — the plugin wants a canonical
// www.facebook.com URL, but a link an admin pastes (or a citizen
// shares) commonly carries a mobile host or tracking params that vary
// between what a person copied and what the plugin actually needs.
//
// Deliberately permissive on path shape: Facebook has many valid
// permalink forms (/<page>/posts/<id>, /<page>/videos/<id>,
// /watch/?v=<id>, /permalink.php?..., /story.php?..., /reel/<id>,
// /<page>/photos/..., groups/<id>/posts/<id>, and more) with no public
// spec enumerating all of them — rejecting anything that doesn't match
// a hardcoded list risks breaking real, working links. This only
// checks that the host is actually a Facebook domain and the path
// isn't empty; anything that fails that isn't a Facebook link at all,
// not just an unusual permalink shape.

// m.facebook.com and web.facebook.com mirror www.facebook.com's path
// structure 1:1, so rewriting the host is safe. facebook.com (no
// subdomain) does too.
const FACEBOOK_HOSTS_TO_NORMALIZE = new Set(["m.facebook.com", "web.facebook.com", "facebook.com"]);

// fb.watch is a distinct shortlink domain (e.g. fb.watch/AbC123) whose
// path doesn't map onto www.facebook.com's routing at all — left as-is
// rather than "normalized" into a URL that no longer resolves.
const FACEBOOK_SHORTLINK_HOST = "fb.watch";

// rdid/share_url are per-redirect values Facebook appends when a
// /share/ short-link redirects to its canonical URL (see
// lib/facebook-resolver.ts) — different on every request, so they'd
// otherwise make the same post look like a new URL each time.
const TRACKING_PARAMS = ["mibextid", "fbclid", "ref", "rdid", "share_id", "share_url"];

export function sanitizeFacebookUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const isShortlink = host === FACEBOOK_SHORTLINK_HOST;
  const isFacebookHost = host === "www.facebook.com" || FACEBOOK_HOSTS_TO_NORMALIZE.has(host);
  if (!isShortlink && !isFacebookHost) return null;

  if (!url.pathname || url.pathname === "/") return null;

  url.protocol = "https:";
  if (!isShortlink) url.hostname = "www.facebook.com";
  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);

  return url.toString();
}
