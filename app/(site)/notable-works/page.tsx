// app/(site)/notable-works/page.tsx
//
// Full archive of every published post, pinned posts first, then newest
// first — same ordering as the homepage feed, just without its limit.
// Page-number pagination (?page=N) rather than infinite scroll: simpler
// to implement correctly server-side and keeps each page a plain,
// shareable/cacheable URL.

import Link from "next/link";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { createPublicClient } from "@/utils/supabase/public";
import { PUBLIC_CACHE_TAG } from "@/lib/cache";
import type { PostWithMedia } from "@/types/domain";
import MediaPlayer from "@/components/MediaPlayer";

export const metadata: Metadata = {
  title: "Notable Works | Dipak Chatterjee",
};

const PAGE_SIZE = 12;

// See app/(site)/layout.tsx and lib/cache.ts for why this is cached at
// the data-fetch layer (unstable_cache) rather than via page-level ISR.
// Keyed by page number so each page of results gets its own cache entry.
const getNotableWorksPage = unstable_cache(
  async (page: number) => {
    const supabase = createPublicClient();
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data: posts, count } = await supabase
      .from("posts")
      .select("*, post_media(*)", { count: "exact" })
      .eq("is_published", true)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("display_order", { foreignTable: "post_media", ascending: true })
      .range(from, to);

    return { posts, count };
  },
  ["notable-works"],
  { revalidate: 60, tags: [PUBLIC_CACHE_TAG] }
);

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const EXCERPT_LENGTH = 140;
function excerpt(body: string) {
  if (body.length <= EXCERPT_LENGTH) return body;
  return `${body.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

function PostCard({ post }: { post: PostWithMedia }) {
  const media = post.post_media[0];
  const cardImageUrl = post.thumbnail_url ?? media?.public_url;

  return (
    <article className="h-full bg-white border border-line rounded-lg overflow-hidden flex flex-col">
      {cardImageUrl && (
        <MediaPlayer
          kind={post.thumbnail_url ? "image" : media!.kind}
          src={cardImageUrl}
          className="[&_figcaption]:hidden"
        />
      )}

      <div className="p-5 flex-1 flex flex-col">
        <p className="text-xs text-[var(--theme-primary)] font-semibold">{formatDate(post.published_at)}</p>

        {post.title && <h3 className="font-display text-xl text-navy-900 mt-2">{post.title}</h3>}

        {post.body && <p className="mt-3 text-sm text-ink-600 leading-relaxed">{excerpt(post.body)}</p>}

        <Link
          href={`/posts/${post.id}`}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--theme-primary)] hover:underline"
        >
          Read More <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </article>
  );
}

export default async function NotableWorksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { posts, count } = await getNotableWorksPage(page);

  const postList = (posts as PostWithMedia[]) ?? [];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <main className="bg-paper-100 min-h-screen">
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-12 md:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--theme-primary)] hover:opacity-80 mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <h1 className="font-display text-3xl md:text-4xl text-navy-900 leading-tight max-w-xl mb-10">
          A record of service, community work, and public action.
        </h1>

        {postList.length === 0 ? (
          <p className="text-ink-400 text-sm">Updates will appear here soon.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {postList.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>

            {totalPages > 1 && (
              <nav className="mt-12 flex items-center justify-center gap-4" aria-label="Pagination">
                <Link
                  href={page > 1 ? `/notable-works?page=${page - 1}` : "#"}
                  aria-disabled={page <= 1}
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-md border border-line bg-white ${
                    page <= 1 ? "opacity-40 pointer-events-none" : "text-navy-900 hover:border-saffron"
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Link>

                <span className="text-sm text-ink-600">
                  Page {page} of {totalPages}
                </span>

                <Link
                  href={page < totalPages ? `/notable-works?page=${page + 1}` : "#"}
                  aria-disabled={page >= totalPages}
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-md border border-line bg-white ${
                    page >= totalPages ? "opacity-40 pointer-events-none" : "text-navy-900 hover:border-saffron"
                  }`}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </nav>
            )}
          </>
        )}
      </div>
    </main>
  );
}
