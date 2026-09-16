// app/admin/(protected)/posts/page.tsx
import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import type { Post } from "@/types/domain";
import PostList from "./PostList";

export const metadata: Metadata = {
  title: "Posts - Dashboard | Dipak Chatterjee",
};

export default async function PostsPage() {
  const supabase = await createClient();

  // Unpaginated by design (PostList has no pagination UI), but capped
  // rather than truly unbounded — this dashboard runs on a
  // memory-constrained Render container (see the OOM fix in
  // app/api/admin/upload/route.ts's MAX_VIDEO_BYTES comment), and an
  // unbounded select('*') would grow this page's cost linearly with the
  // post count forever. 200 is far beyond current real usage; if the
  // list ever approaches it, this needs real pagination, not a higher cap.
  const { data: posts } = await supabase
    .from("posts")
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-sm font-semibold text-saffron-600 mb-2">Posts</p>
          <h1 className="font-display text-3xl text-navy-900">Chronological feed</h1>
          <p className="text-sm text-ink-600 mt-1.5">
            Updates, events, and links to reels or press coverage.
          </p>
        </div>

        <Link
          href="/admin/posts/new"
          className="inline-flex items-center gap-2 bg-saffron hover:bg-saffron-600 text-white font-semibold px-4 py-2.5 rounded-md transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Post
        </Link>
      </div>

      <PostList posts={(posts as Post[]) ?? []} />
    </div>
  );
}
