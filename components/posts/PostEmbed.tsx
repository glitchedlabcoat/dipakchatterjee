// components/posts/PostEmbed.tsx
//
// Responsive iframe wrapper for a recognized YouTube/Instagram/Facebook
// embed (see lib/embed.ts). Vertical formats (Shorts/Reels) get a
// centered 9:16 portrait frame instead of being forced into a
// letterboxed 16:9 box; regular horizontal video keeps a locked 16:9
// frame; everything else (a plain Instagram post, a Facebook link/post
// embed) sizes to its own natural height since that isn't reliably one
// aspect ratio or the other.
//
// Graceful failure: if the iframe fails to load at all (onError — a
// genuine network-level failure, e.g. blocked by a privacy/ad-blocking
// extension), this swaps to a fallback card with a direct "Watch on
// X" link instead of a broken embed box. Worth being honest about the
// limits here: a cross-origin iframe whose *content* errors (a deleted
// post, a login wall) typically still returns a normal 200 response and
// fires onLoad, not onError — the browser has no API for "the page
// inside this iframe rendered an error", so that class of failure can't
// be caught this way. What this achieves is specifically the case a
// plain <iframe src> can hit on its own: a network error, a
// blocked/refused connection, or a CSP violation.

"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { EmbedInfo } from "@/lib/embed";

const CONTAINER_CLASS: Record<EmbedInfo["orientation"], string> = {
  horizontal: "w-full aspect-video",
  vertical: "w-full max-w-[360px] aspect-[9/16] mx-auto",
  auto: "w-full min-h-[560px]",
};

const PROVIDER_LABEL: Record<EmbedInfo["provider"], string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  instagram: "Instagram",
};

// The original link the admin entered (not `embed.embedUrl`, which is
// the transformed plugin/iframe URL — not something a visitor should
// land on directly).
export default function PostEmbed({ embed, sourceUrl }: { embed: EmbedInfo; sourceUrl: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="rounded-lg border border-line bg-paper-100 p-6 text-center">
        <p className="text-sm text-ink-600 mb-4">
          This embed couldn&apos;t be loaded — it may be blocked by a privacy extension or ad
          blocker.
        </p>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[var(--theme-primary,#C1832B)] hover:opacity-90 px-4 py-2.5 rounded-md transition-opacity"
        >
          Watch on {PROVIDER_LABEL[embed.provider]}
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg overflow-hidden border border-line bg-navy-900 ${CONTAINER_CLASS[embed.orientation]}`}
    >
      <iframe
        src={embed.embedUrl}
        title={`${embed.provider} embed`}
        className="w-full h-full"
        style={embed.orientation === "auto" ? { minHeight: 560 } : undefined}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
