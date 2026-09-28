// components/embeds/EmbedConsentGate.tsx
//
// Click-to-load gate for third-party embeds (YouTube, Facebook,
// Instagram). Before this, opening a post page immediately loaded the
// provider's iframe — or, for Facebook, Meta's JS SDK from
// connect.facebook.net — which hands the visitor's IP address, browser
// fingerprint and any existing provider cookies to Google/Meta before
// the visitor has done anything but open the page. Nothing from the
// provider is requested until the visitor clicks "Load", and the card
// says plainly what that click does.
//
// Consent is remembered per provider for the rest of the browser tab's
// session (sessionStorage, not localStorage): one click covers every
// later embed from that provider during the visit, but nothing persists
// past it — so there's no stored consent anyone needs a way to withdraw.
// Storage access is wrapped in try/catch because it can throw outright
// (blocked site data, some private-browsing modes); consent then simply
// lasts for the current page only.
//
// Read through useSyncExternalStore (same reasoning as
// lib/hooks/useHydrated.ts): the server snapshot is always "not
// consented", so SSR and the first client render agree, and a grant in
// one embed instance re-renders every other instance on the page via
// the in-memory listener set below.

"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { ExternalLink, ShieldCheck } from "lucide-react";
import type { EmbedInfo } from "@/lib/embed";

type Provider = EmbedInfo["provider"];

const STORAGE_PREFIX = "embed-consent:";

const PROVIDER_INFO: Record<Provider, { label: string; company: string }> = {
  youtube: { label: "YouTube", company: "Google" },
  facebook: { label: "Facebook", company: "Meta" },
  instagram: { label: "Instagram", company: "Meta" },
};

const listeners = new Set<() => void>();
// Fallback for when sessionStorage is unavailable, so a click still
// takes effect for the current page.
const memoryGrants = new Set<Provider>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hasConsent(provider: Provider): boolean {
  if (memoryGrants.has(provider)) return true;
  try {
    return window.sessionStorage.getItem(STORAGE_PREFIX + provider) === "1";
  } catch {
    return false;
  }
}

function grantConsent(provider: Provider) {
  memoryGrants.add(provider);
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + provider, "1");
  } catch {
    // Storage blocked — memoryGrants above still covers this page.
  }
  listeners.forEach((listener) => listener());
}

export function useEmbedConsent(provider: Provider): [boolean, () => void] {
  const consented = useSyncExternalStore(
    subscribe,
    () => hasConsent(provider),
    () => false
  );
  const grant = useCallback(() => grantConsent(provider), [provider]);
  return [consented, grant];
}

export default function EmbedConsentGate({
  provider,
  sourceUrl,
  onLoad,
}: {
  provider: Provider;
  sourceUrl: string;
  onLoad: () => void;
}) {
  const { label, company } = PROVIDER_INFO[provider];

  return (
    <div className="rounded-lg border border-line bg-paper-100 p-6 text-center">
      <ShieldCheck className="w-6 h-6 text-ink-400 mx-auto mb-3" aria-hidden="true" />
      <p className="text-sm font-semibold text-navy-900 mb-1">This post includes content from {label}</p>
      <p className="text-sm text-ink-600 max-w-md mx-auto mb-5">
        Loading it connects your browser to {label} ({company}), which receives your IP address and
        may set cookies. Nothing is sent to {label} until you choose to load it.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          type="button"
          onClick={onLoad}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[var(--theme-primary,#C1832B)] hover:opacity-90 px-4 py-2.5 rounded-md transition-opacity"
        >
          Load {label} content
        </button>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-navy-900"
        >
          Open on {label} instead
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      <p className="mt-4 text-xs text-ink-400">
        Your choice applies to {label} content for the rest of this visit.{" "}
        <Link href="/privacy#third-party-content" className="underline hover:text-navy-900">
          Privacy notice
        </Link>
      </p>
    </div>
  );
}
