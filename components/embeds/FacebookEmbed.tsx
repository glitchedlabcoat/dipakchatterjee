// components/embeds/FacebookEmbed.tsx
//
// Renders a Facebook post/video/photo via Meta's official client-side
// XFBML Social Plugin instead of a plain iframe src — PostEmbed.tsx
// switches to this specifically for Facebook links (YouTube and
// Instagram keep the direct iframe/plugin-URL approach in
// lib/embed.ts, which still works fine for those providers and isn't
// touched here). Meta's plugins/post.php iframe endpoint has become
// unreliable for apps without Business Verification — XFBML is the
// officially documented no-API-key path and doesn't hit that wall,
// since it never calls the Graph API at all (see
// app/admin/(protected)/settings/MetaOEmbedSettingsForm.tsx, whose App
// ID/Secret fields are unrelated to this and stay in place for future
// use once verified).
//
// Every requirement here comes from Meta's own XFBML integration docs:
//   - A single #fb-root element must exist in the page, created once
//     and shared across every embed instance on it — not one per post.
//   - The SDK script (connect.facebook.net/en_US/sdk.js#xfbml=1) loads
//     once; next/script's `id` prop dedupes that automatically across
//     multiple FacebookEmbed instances.
//   - window.FB.XFBML.parse() must be called any time new .fb-post
//     markup is added to the DOM *after* the SDK's own initial parse —
//     which is exactly what happens on every client-side navigation
//     between posts in the App Router, since Next never reloads the
//     page. next/script's `onReady` (unlike `onLoad`, which only ever
//     fires once) covers this: it re-fires on every mount of a
//     component using this script id, even when the script itself was
//     already loaded by an earlier instance.

"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import { ExternalLink } from "lucide-react";
import { sanitizeFacebookUrl } from "@/lib/facebook-url";

declare global {
  interface Window {
    FB?: {
      XFBML: { parse: (element?: HTMLElement) => void };
    };
  }
}

const SDK_VERSION = "v20.0";

function ensureFbRoot() {
  if (typeof document === "undefined") return;
  if (document.getElementById("fb-root")) return;
  const root = document.createElement("div");
  root.id = "fb-root";
  document.body.insertBefore(root, document.body.firstChild);
}

export default function FacebookEmbed({ url, width = 500 }: { url: string; width?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanUrl = sanitizeFacebookUrl(url);

  useEffect(() => {
    ensureFbRoot();
  }, []);

  // Re-parse whenever the target URL changes on an already-mounted
  // instance (the `key={cleanUrl}` below gives React a fresh, unparsed
  // div to hand the SDK in that case) — a no-op if the SDK hasn't
  // loaded yet, since next/script's onReady below handles that first
  // pass instead.
  useEffect(() => {
    if (!cleanUrl) return;
    window.FB?.XFBML?.parse(containerRef.current ?? undefined);
  }, [cleanUrl]);

  if (!cleanUrl) {
    return (
      <div className="rounded-lg border border-line bg-paper-100 p-6 text-center">
        <p className="text-sm text-ink-600 mb-4">This Facebook link couldn&apos;t be recognized.</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[#1877F2] hover:opacity-90 px-4 py-2.5 rounded-md transition-opacity"
        >
          View on Facebook
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="rounded-lg border border-line bg-white p-4 flex justify-center overflow-hidden">
      <Script
        id="facebook-jssdk"
        src={`https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=${SDK_VERSION}`}
        strategy="afterInteractive"
        onReady={() => window.FB?.XFBML?.parse(containerRef.current ?? undefined)}
      />
      <div key={cleanUrl} className="fb-post" data-href={cleanUrl} data-width={width} data-show-text="true" />
    </div>
  );
}
