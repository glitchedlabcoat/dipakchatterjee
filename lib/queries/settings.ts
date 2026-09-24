// lib/queries/settings.ts
//
// The one place that reads the `site_settings` singleton row for public
// pages — app/(site)/layout.tsx (header/footer chrome + metadata),
// app/(site)/page.tsx (homepage), and app/(site)/complaints/page.tsx
// (contact email) all import this instead of each running their own
// `site_settings` query, so a single TAG_SETTINGS-tagged cache entry
// covers all of them: one admin save invalidates one entry, not three,
// and an unrelated post/homepage-sections change never touches this one.
//
// Wrapped in React's `cache()` (not just `unstable_cache`) so that
// within a single request — e.g. the homepage, where both
// app/(site)/layout.tsx's generateMetadata/SiteLayout *and*
// app/(site)/page.tsx's HomePage all want settings — every caller
// shares one call instead of each hitting unstable_cache separately.
// See "Memoizing data requests" in
// node_modules/next/dist/docs/01-app/01-getting-started/14-metadata-and-og-images.md.

import { cache } from "react";
import { createPublicClient } from "@/utils/supabase/public";
import { PUBLIC_CACHE_TAG, PUBLIC_REVALIDATE_SECONDS, TAG_SETTINGS, createTrackedCache } from "@/lib/cache";
import type { SiteSettings } from "@/types/domain";

export const getSiteSettings = cache(
  createTrackedCache(
    "settings",
    async () => {
      const supabase = createPublicClient();
      // select("*"), not a named column list — see app/(site)/layout.tsx's
      // former inline version of this query for why: stays resilient if a
      // column hasn't reached this database yet, degrading to omitting it
      // rather than erroring PostgREST's whole select.
      const { data } = await supabase.from("site_settings").select("*").eq("id", "default").single();
      return (data as SiteSettings | null) ?? null;
    },
    ["site-settings"],
    { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [TAG_SETTINGS, PUBLIC_CACHE_TAG] }
  )
);
