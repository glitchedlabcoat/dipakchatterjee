// lib/queries/posts.ts
//
// Shared, tagged reads for published posts — used by both the homepage
// feed and /notable-works (getPostsList) and by /posts/[id]
// (getPostById), so one admin edit only busts the cache entries that
// actually changed instead of every cached post/list on the site. See
// lib/cache.ts's TAG_POSTS_LIST / TAG_POST_ITEM and
// app/admin/(protected)/posts/actions.ts for the invalidation side.

import { cache } from "react";
import { createPublicClient } from "@/utils/supabase/public";
import { PUBLIC_CACHE_TAG, PUBLIC_REVALIDATE_SECONDS, TAG_POSTS_LIST, TAG_POST_ITEM, createTrackedCache, trackedCacheRead } from "@/lib/cache";
import type { PostWithMedia } from "@/types/domain";

// Same shape (pinned first, then newest) powers both the homepage's
// limited feed and /notable-works' full paginated archive — a plain
// `limit(n)` is just `range(0, n - 1)` with page 1, so one query covers
// both call sites. Tagged with TAG_POSTS_LIST only (not a per-post
// tag): this reads *which* posts are published and in what order, which
// changes on any post's create/publish/unpublish/reorder, not just one
// post's own content.
//
// `id` is the last tie-breaker so the order is total: imported posts can
// share published_at and created_at exactly, and without it Postgres may
// order those ties differently per query, so "View More" batches could
// repeat one post and skip another.
export const getPostsList = cache(
  createTrackedCache(
    "posts-list",
    async ({ page, pageSize }: { page: number; pageSize: number }) => {
      const supabase = createPublicClient();
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data: posts, count, error } = await supabase
        .from("posts")
        .select("*, post_media(*)", { count: "exact" })
        .eq("is_published", true)
        .order("is_pinned", { ascending: false })
        .order("published_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .order("display_order", { foreignTable: "post_media", ascending: true })
        .range(from, to);

      // An offset past the last post is PostgREST's PGRST103 ("range not
      // satisfiable"): an empty page, not a failure. Anything else throws,
      // so unstable_cache doesn't keep a transient outage as "no posts" for
      // the whole revalidate window; see getPostsListOrEmpty below.
      if (error && error.code !== "PGRST103") throw new Error(`posts list: ${error.message}`);

      return { posts: (posts as PostWithMedia[]) ?? [], count: count ?? 0 };
    },
    ["posts-list"],
    { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [TAG_POSTS_LIST, PUBLIC_CACHE_TAG] }
  )
);

// For pages that should still render, with their empty state, if
// Supabase is briefly unreachable (the homepage feed, /notable-works).
// The "View More" endpoint calls getPostsList directly instead, so a
// failure there shows as an error rather than as the end of the list.
export async function getPostsListOrEmpty(args: { page: number; pageSize: number }) {
  try {
    return await getPostsList(args);
  } catch (err) {
    console.error("[getPostsList]", err instanceof Error ? err.message : err);
    return { posts: [] as PostWithMedia[], count: 0 };
  }
}

// One cache entry per post id, tagged with that post's own
// TAG_POST_ITEM(id) — unstable_cache can't take a per-call dynamic tag
// directly (see trackedCacheRead's comment in lib/cache.ts for why this
// isn't built on createTrackedCache like the rest of this file), so this
// builds a fresh tagged wrapper on every call instead of reusing one
// module-scoped wrapper across every id.
export const getPostById = cache(async (id: string): Promise<PostWithMedia | null> => {
  return trackedCacheRead(
    "/posts/[id]",
    async () => {
      const supabase = createPublicClient();
      const { data: post } = await supabase
        .from("posts")
        .select("*, post_media(*)")
        .eq("id", id)
        .eq("is_published", true)
        .order("display_order", { foreignTable: "post_media", ascending: true })
        .single();
      return (post as PostWithMedia | null) ?? null;
    },
    ["post-item", id],
    { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [TAG_POST_ITEM(id), PUBLIC_CACHE_TAG] }
  );
});
