// lib/embed.ts
//
// Turns a post link's `url` into a responsive iframe embed when it
// recognizably points at YouTube, Instagram, or Facebook. Falls back to
// null for anything else — this is a best-effort URL-pattern match, not
// a full oEmbed integration, so it deliberately fails closed rather than
// guessing at surprising URL shapes. A link this returns null for still
// isn't wasted: components/posts/PostEmbed.tsx's caller treats "no
// recognized embed" the same as "no working embed", per the graceful
// embed-failure rule on post pages.
//
// The Facebook/Instagram/YouTube iframe endpoints below are all public,
// no-JS-SDK, no-API-key plugin URLs (Meta's plugins/post.php and
// plugins/video.php, Instagram's /embed suffix, YouTube's /embed/
// path) — see proxy.ts's CSP frame-src for the matching allowlist.

export type EmbedProvider = "youtube" | "facebook" | "instagram";

// "vertical" locks a 9:16 portrait frame (Shorts/Reels — anything shot
// for a phone screen); "horizontal" locks 16:9; "auto" (a plain
// Instagram photo/carousel post, or a Facebook link/post embed) lets
// the plugin's own iframe report its natural height instead of forcing
// either ratio, since those aren't reliably one shape or the other.
export type EmbedOrientation = "vertical" | "horizontal" | "auto";

export type EmbedInfo = {
  provider: EmbedProvider;
  embedUrl: string;
  orientation: EmbedOrientation;
};

function extractYouTubeId(url: URL): string | null {
  if (url.hostname === "youtu.be") {
    const id = url.pathname.slice(1);
    return id || null;
  }
  if (url.hostname.endsWith("youtube.com")) {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)/);
    if (shortsMatch) return shortsMatch[1];
    const embedMatch = url.pathname.match(/^\/embed\/([^/]+)/);
    if (embedMatch) return embedMatch[1];
  }
  return null;
}

function extractInstagramShortcode(url: URL): string | null {
  const match = url.pathname.match(/^\/(?:p|reel|tv)\/([^/]+)/);
  return match ? match[1] : null;
}

export function getEmbedInfo(rawUrl: string | null | undefined): EmbedInfo | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
    const id = extractYouTubeId(url);
    if (!id) return null;
    const isShort = /^\/shorts\//.test(url.pathname);
    return {
      provider: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
      orientation: isShort ? "vertical" : "horizontal",
    };
  }

  if (host === "instagram.com") {
    const shortcode = extractInstagramShortcode(url);
    if (!shortcode) return null;
    // /reel/ and /tv/ are always shot vertical; /p/ can be square,
    // portrait, or landscape, so that one stays "auto".
    const isReel = /^\/(?:reel|tv)\//.test(url.pathname);
    return {
      provider: "instagram",
      embedUrl: `https://www.instagram.com/p/${shortcode}/embed`,
      orientation: isReel ? "vertical" : "auto",
    };
  }

  if (host === "facebook.com" || host === "fb.watch") {
    // Modern "Share" button links use /share/r/<id> (Reel), /share/v/<id>
    // (video), and /share/p/<id> (post/photo) — as common today as the
    // older /reel/<id>, /<page>/videos/<id>, /watch/?v=<id> permalink
    // shapes, and previously NOT recognized here at all, silently
    // misclassifying every /share/r/ Reel as a plain post (wrong XFBML
    // plugin downstream in components/embeds/FacebookEmbed.tsx — fb-post
    // can't render a video/Reel href, fb-video can).
    const isReel = /\/reel\//.test(url.pathname) || /^\/share\/r\//.test(url.pathname);
    // fb.watch shortlinks resolve to either a regular video or a reel,
    // and there's no way to tell from the URL alone — default those to
    // horizontal, the more common case for shared links.
    const isVideo =
      /\/videos\/|\/reel\/|\/watch\/?\?/.test(url.pathname + url.search) ||
      /^\/share\/[rv]\//.test(url.pathname) ||
      host === "fb.watch";
    const plugin = isVideo ? "video" : "post";
    const href = encodeURIComponent(rawUrl);
    return {
      provider: "facebook",
      embedUrl: `https://www.facebook.com/plugins/${plugin}.php?href=${href}&show_text=false`,
      orientation: isReel ? "vertical" : isVideo ? "horizontal" : "auto",
    };
  }

  return null;
}
