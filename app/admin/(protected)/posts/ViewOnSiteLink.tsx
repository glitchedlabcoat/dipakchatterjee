// app/admin/(protected)/posts/ViewOnSiteLink.tsx
//
// "View on Site" on the post editor: opens the post's public page in a new
// tab. A draft has no public page (/posts/[id] only serves published
// posts, so the link would 404), so it shows as a disabled control with
// the reason in plain text instead. `href` comes from
// lib/post-cards.ts's publicPostHref and reflects the last saved state.

import { ExternalLink } from "lucide-react";

const BASE_CLASS =
  "inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold border bg-white px-3.5 py-2 rounded-md transition-colors";

export default function ViewOnSiteLink({ href }: { href: string | null }) {
  if (!href) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-disabled="true" className={`${BASE_CLASS} border-line text-ink-400 cursor-not-allowed`}>
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
          View on Site
        </span>
        <span className="text-xs text-ink-400">Draft: publish and save it to view it on the site.</span>
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${BASE_CLASS} border-line text-navy-900 hover:border-saffron hover:text-saffron-600`}
    >
      <ExternalLink className="w-4 h-4" aria-hidden="true" />
      View on Site
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
