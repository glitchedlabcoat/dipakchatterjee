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
// since it never calls the Graph API at all. (The Graph API App ID/
// Secret credentials this could someday use if Business Verification is
// obtained were removed from the admin Settings UI — see
// supabase/migrations/20260929000000_integration_settings.sql for the
// still-standing table they'd live in.)
//
// XFBML has two DISTINCT plugins, not one: fb-post (text/photo posts)
// and fb-video (videos and Reels) — handing a video/Reel permalink to
// fb-post is a documented no-op/failure on Meta's side (the plugin
// simply doesn't know how to resolve that href), which is exactly why
// "some embeds work, most don't" before this fix: every plain post
// rendered fine, every Reel/video silently failed. `isVideo` (derived
// from lib/embed.ts's own isReel/isVideo classification via
// `embed.orientation !== "auto"`) picks the right one.
//
// Every requirement here comes from Meta's own XFBML integration docs:
//   - A single #fb-root element must exist in the page, created once
//     and shared across every embed instance on it — not one per post.
//   - The SDK script (connect.facebook.net/en_US/sdk.js#xfbml=1) loads
//     once; next/script's `id` prop dedupes that automatically across
//     multiple FacebookEmbed instances.
//   - window.FB.XFBML.parse() must be called any time new fb-post/
//     fb-video markup is added to the DOM *after* the SDK's own initial
//     parse — which is exactly what happens on every client-side
//     navigation between posts in the App Router, since Next never
//     reloads the page. next/script's `onReady` (unlike `onLoad`, which
//     only ever fires once) covers this: it re-fires on every mount of
//     a component using this script id, even when the script itself
//     was already loaded by an earlier instance.
//
// Automated fallback: when XFBML successfully processes a fb-post/
// fb-video div, it replaces that div's contents with an <iframe> — so
// "no iframe appeared inside our container within FALLBACK_TIMEOUT_MS"
// is a real, observable "XFBML never mounted" signal (ad blocker
// stripped the SDK, the SDK failed to load, Meta's plugin backend
// refused the href outright, etc.), watched for via a MutationObserver
// with the timeout as a backstop. On that signal, this swaps to the
// direct plugins/{post,video}.php iframe (embed.embedUrl — the same
// URL this app used before switching to XFBML), which in turn has its
// own onError fallback to a plain "View on Facebook" link. Worth being
// honest about what this can't catch, same as PostEmbed.tsx's iframe
// path: an iframe that mounts (XFBML "succeeded") but whose *content*
// Meta renders as "Content Currently Unavailable" is invisible from
// here — the browser has no API for that, cross-origin. That failure
// mode (confirmed real for some Reels specifically, independent of
// anything in this app) has no further client-side fix; a visitor
// hitting it sees Meta's own iframe say so, with no crash.

"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { ExternalLink } from "lucide-react";
import { sanitizeFacebookUrl } from "@/lib/facebook-url";
import type { EmbedInfo } from "@/lib/embed";

declare global {
  interface Window {
    FB?: {
      XFBML: { parse: (element?: HTMLElement) => void };
    };
  }
}

const SDK_VERSION = "v20.0";
const FALLBACK_TIMEOUT_MS = 8000;

const FALLBACK_CONTAINER_CLASS: Record<EmbedInfo["orientation"], string> = {
  horizontal: "w-full aspect-video",
  vertical: "w-full max-w-[360px] aspect-[9/16] mx-auto",
  auto: "w-full min-h-[560px]",
};

function ensureFbRoot() {
  if (typeof document === "undefined") return;
  if (document.getElementById("fb-root")) return;
  const root = document.createElement("div");
  root.id = "fb-root";
  document.body.insertBefore(root, document.body.firstChild);
}

function ViewOnFacebookCard({ url, message }: { url: string; message: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-100 p-6 text-center">
      <p className="text-sm text-ink-600 mb-4">{message}</p>
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

export default function FacebookEmbed({ embed, sourceUrl }: { embed: EmbedInfo; sourceUrl: string }) {
  const isVideo = embed.orientation !== "auto";
  const cleanUrl = sanitizeFacebookUrl(sourceUrl);
  // Reels/videos read better narrower (closer to their natural portrait
  // shape) than the 500px default that suits a horizontal post/photo.
  const width = isVideo ? 360 : 500;

  const containerRef = useRef<HTMLDivElement>(null);
  const [xfbmlFailed, setXfbmlFailed] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);

  useEffect(() => {
    ensureFbRoot();
  }, []);

  // Re-parse whenever the target URL changes on an already-mounted
  // instance (the `key={cleanUrl}` below gives React a fresh, unparsed
  // div to hand the SDK in that case) — a no-op if the SDK hasn't
  // loaded yet, since next/script's onReady below handles that first
  // pass instead.
  useEffect(() => {
    if (!cleanUrl || xfbmlFailed) return;
    window.FB?.XFBML?.parse(containerRef.current ?? undefined);
  }, [cleanUrl, xfbmlFailed]);

  // Automated mount-failure detection (see file header) — watches for
  // XFBML replacing our div with an <iframe>; falls back to the direct
  // plugin iframe if that hasn't happened within FALLBACK_TIMEOUT_MS.
  useEffect(() => {
    if (!cleanUrl || xfbmlFailed) return;
    const container = containerRef.current;
    if (!container) return;

    const hasMounted = () => !!container.querySelector("iframe");
    if (hasMounted()) return;

    const observer = new MutationObserver(() => {
      if (hasMounted()) {
        cleanup();
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      if (!hasMounted()) setXfbmlFailed(true);
      cleanup();
    }, FALLBACK_TIMEOUT_MS);

    function cleanup() {
      observer.disconnect();
      clearTimeout(timer);
    }

    return cleanup;
  }, [cleanUrl, xfbmlFailed]);

  if (!cleanUrl) {
    return <ViewOnFacebookCard url={sourceUrl} message="This Facebook link couldn't be recognized." />;
  }

  if (xfbmlFailed) {
    if (iframeFailed) {
      return (
        <ViewOnFacebookCard
          url={sourceUrl}
          message="This embed couldn't be loaded — it may be blocked by a privacy extension or ad blocker."
        />
      );
    }
    return (
      <div
        className={`rounded-lg overflow-hidden border border-line bg-navy-900 ${FALLBACK_CONTAINER_CLASS[embed.orientation]}`}
      >
        <iframe
          src={embed.embedUrl}
          title="Facebook embed"
          className="w-full h-full"
          style={embed.orientation === "auto" ? { minHeight: 560 } : undefined}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          onError={() => setIframeFailed(true)}
        />
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
      {isVideo ? (
        <div
          key={cleanUrl}
          className="fb-video"
          data-href={cleanUrl}
          data-width={width}
          data-show-text="false"
          data-allowfullscreen="true"
        />
      ) : (
        <div key={cleanUrl} className="fb-post" data-href={cleanUrl} data-width={width} data-show-text="true" />
      )}
    </div>
  );
}
