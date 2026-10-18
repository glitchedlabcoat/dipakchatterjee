// lib/email/sanitize.ts
//
// Turns received (untrusted) email HTML into something safe to show an
// admin. Two independent layers, so a gap in one isn't a hole:
//   1. sanitize-html with a strict allowlist: no scripts, styles blocks,
//      forms, iframes, event handlers, external stylesheets or CSS
//      url(); links are forced to open in a new tab with no referrer;
//      images only from inline data: URIs (remote images, the usual
//      tracking pixels, are removed and counted).
//   2. The admin page renders the result inside a sandboxed iframe
//      (no allow-scripts, no allow-same-origin), which also inherits the
//      site's Content-Security-Policy.
// The plain-text view never interprets markup at all.

import sanitizeHtml from "sanitize-html";

const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const SAFE_LINK_RE = /^(?:https?:\/\/|mailto:)[^\s<>"]+$/i;

const SAFE_STYLE_VALUE = /^(?!.*(?:url\(|expression|javascript:|@import|behavior|-moz-binding))[#(),.%\w\s'"-]{1,200}$/i;

const ALLOWED_STYLES = Object.fromEntries(
  [
    "color",
    "background-color",
    "font-size",
    "font-weight",
    "font-style",
    "font-family",
    "text-align",
    "text-decoration",
    "line-height",
    "margin",
    "margin-top",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "padding",
    "padding-top",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "border",
    "border-collapse",
    "width",
    "max-width",
    "height",
    "vertical-align",
    "white-space",
  ].map((property) => [property, [SAFE_STYLE_VALUE]])
);

export type SanitizedHtml = { html: string; blockedImages: number };

export function sanitizeEmailHtml(input: string): SanitizedHtml {
  let blockedImages = 0;
  const html = sanitizeHtml(input, {
    allowedTags: [
      "a", "abbr", "b", "blockquote", "br", "caption", "center", "code", "col", "colgroup", "dd", "del", "div",
      "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "li", "ol", "p",
      "pre", "q", "s", "small", "span", "strike", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th",
      "thead", "tr", "u", "ul",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      font: ["color", "size"],
      table: ["width", "border", "cellpadding", "cellspacing", "align"],
      td: ["colspan", "rowspan", "align", "valign", "width"],
      th: ["colspan", "rowspan", "align", "valign", "width"],
      "*": ["style", "align", "dir"],
    },
    allowedStyles: { "*": ALLOWED_STYLES },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "head", "template", "svg", "math"],
    transformTags: {
      // Keeps only http(s)/mailto links, shows the real destination as the
      // tooltip (link text can lie), and opens it in a new tab with no
      // opener or referrer.
      a: (_tagName, attribs): sanitizeHtml.Tag => {
        const href = (attribs.href ?? "").trim();
        if (!SAFE_LINK_RE.test(href)) return { tagName: "a", attribs: {} };
        return { tagName: "a", attribs: { href, title: href, target: "_blank", rel: "noopener noreferrer nofollow" } };
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag !== "img") return false;
      const src = frame.attribs.src ?? "";
      if (DATA_IMAGE_RE.test(src)) return false;
      blockedImages += 1;
      return true;
    },
  });
  return { html, blockedImages };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Readable plain text from HTML, for messages that arrived without a text part. */
export function htmlToText(input: string): string {
  const withBreaks = input
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, "\n");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/&(#?\w+);/g, (match, name: string) => {
      if (ENTITIES[name]) return ENTITIES[name];
      if (/^#\d+$/.test(name)) {
        const code = Number(name.slice(1));
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
      }
      return match;
    })
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Wraps sanitized HTML in a minimal document for the sandboxed iframe's srcdoc. */
export function emailPreviewDocument(sanitized: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${sanitized}</body></html>`;
}
