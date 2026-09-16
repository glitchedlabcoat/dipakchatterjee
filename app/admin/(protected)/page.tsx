// app/admin/(protected)/page.tsx
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";
import { getAuthedUser, getViewerProfile } from "@/lib/admin-auth";
import { ArrowRight, Layers, MessageSquareWarning, Rss } from "lucide-react";
import type { Profile } from "@/types/domain";
import MyContactInfoCard from "@/components/admin/MyContactInfoCard";

export const metadata: Metadata = {
  title: "Dashboard | Dipak Chatterjee",
};

export default async function AdminOverviewPage() {
  const supabase = await createClient();

  // Each count and the auth check are independent of one another — a
  // transient failure in one (e.g. a dropped connection mid-request)
  // shouldn't take down the whole overview page via an unhandled
  // Promise.all rejection. Any query that fails just falls back to a
  // safe default (0 / no profile card) instead of crashing.
  let featureCount = 0;
  let postCount = 0;
  let complaintCount = 0;

  // getAuthedUser() is react cache()-wrapped (lib/admin-auth.ts) — the
  // (protected) layout already called it this same request, so this
  // reuses that result instead of a second Supabase Auth round trip.
  const user = await getAuthedUser();

  try {
    const [featureResult, postResult, complaintResult] = await Promise.all([
      supabase.from("features").select("*", { count: "exact", head: true }),
      supabase.from("posts").select("*", { count: "exact", head: true }),
      supabase
        .from("complaints")
        .select("*", { count: "exact", head: true })
        .eq("is_expired", false)
        .gt("expires_at", new Date().toISOString()),
    ]);
    featureCount = featureResult.count ?? 0;
    postCount = postResult.count ?? 0;
    complaintCount = complaintResult.count ?? 0;
  } catch (err) {
    console.error("[AdminOverviewPage] initial data load failed:", err);
  }

  // Likewise reuses the layout's profile fetch (same cache(), same
  // userId argument) instead of a third full-row query this request.
  const viewerProfile: Profile | null = user ? await getViewerProfile(user.id) : null;

  return (
    <div>
      <p className="text-sm font-semibold text-saffron-600 mb-2">Overview</p>
      <h1 className="font-display text-3xl text-navy-900 mb-8">
        Welcome back
      </h1>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <Link
          href="/admin/features"
          className="group bg-white border border-line rounded-xl p-6 hover:border-saffron transition-colors"
        >
          <div className="flex items-center justify-between">
            <Layers className="w-6 h-6 text-saffron-600" />
            <span className="font-display text-3xl text-navy-900">
              {featureCount ?? 0}
            </span>
          </div>
          <p className="mt-4 font-semibold text-navy-900">Features</p>
          <p className="mt-1 text-sm text-ink-600">
            Manage the About, Public Life, and other modular sections.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-saffron-600 group-hover:underline">
            Manage Features <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>

        <Link
          href="/admin/posts"
          className="group bg-white border border-line rounded-xl p-6 hover:border-saffron transition-colors"
        >
          <div className="flex items-center justify-between">
            <Rss className="w-6 h-6 text-saffron-600" />
            <span className="font-display text-3xl text-navy-900">
              {postCount ?? 0}
            </span>
          </div>
          <p className="mt-4 font-semibold text-navy-900">Posts</p>
          <p className="mt-1 text-sm text-ink-600">
            Share updates, events, and links to reels or press coverage.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-saffron-600 group-hover:underline">
            Manage Posts <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>

        <Link
          href="/admin/complaints"
          className="group bg-white border border-line rounded-xl p-6 hover:border-saffron transition-colors"
        >
          <div className="flex items-center justify-between">
            <MessageSquareWarning className="w-6 h-6 text-saffron-600" />
            <span className="font-display text-3xl text-navy-900">
              {complaintCount ?? 0}
            </span>
          </div>
          <p className="mt-4 font-semibold text-navy-900">Complaints</p>
          <p className="mt-1 text-sm text-ink-600">
            Active complaints awaiting review. Private to admins only.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-saffron-600 group-hover:underline">
            Review Complaints <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>
      </div>

      {viewerProfile && (
        <div className="mt-5 max-w-sm">
          <MyContactInfoCard profile={viewerProfile as Profile} />
        </div>
      )}
    </div>
  );
}
