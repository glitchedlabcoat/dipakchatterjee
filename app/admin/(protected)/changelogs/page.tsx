// app/admin/(protected)/changelogs/page.tsx
//
// Reads lib/changelog-data.ts (a static, in-repo array — no Supabase query,
// no unstable_cache needed) and hands it to the client-side browser below.
// Auth is already enforced by app/admin/(protected)/layout.tsx, same as
// every sibling page here (posts, features, etc. don't re-check either).

import type { Metadata } from "next";
import { CHANGELOG_ENTRIES } from "@/lib/changelog-data";
import ChangelogBrowser from "@/components/admin/ChangelogBrowser";

export const metadata: Metadata = {
  title: "Changelogs - Dashboard | Dipak Chatterjee",
};

export default function ChangelogsPage() {
  return (
    <div>
      <p className="text-sm font-semibold text-saffron-600 mb-2">Changelogs</p>
      <h1 className="font-display text-3xl text-navy-900 mb-1.5">What&apos;s changed</h1>
      <p className="text-sm text-ink-600 mb-6">
        Every update to the site and dashboard, in plain English or full technical detail — your choice.
      </p>

      <ChangelogBrowser entries={CHANGELOG_ENTRIES} />
    </div>
  );
}
