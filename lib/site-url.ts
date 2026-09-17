// lib/site-url.ts
//
// Single source of truth for this site's canonical origin — no `www.`,
// always `https://`. Google Search Console flagged root-domain variants
// (http://, www.) showing up under "Page with redirect"; every place
// that needs to build an absolute site URL (root layout's metadataBase,
// the (site) layout's OpenGraph/JSON-LD, sitemap.ts, robots.ts) imports
// this instead of repeating the literal, so a future copy-paste can't
// introduce a www./http:// variant in only one of them.
export const SITE_URL = "https://janatardipak.com";
