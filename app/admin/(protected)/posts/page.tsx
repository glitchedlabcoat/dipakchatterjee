// app/admin/(protected)/posts/page.tsx
//
// Every post, 25 per page, with a title/body search at the top left (see
// lib/queries/admin-posts.ts; the old fixed .limit(200) hid everything
// past the 200th post). The search and page both live in the URL
// (?q=&page=), so they survive reloads and the back button; the search
// form doesn't send `page`, so a new search always starts at page 1, and
// the page links keep the current search.

import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import {
  adminPostsHref,
  adminPostsPageCount,
  cleanPostSearch,
  countAdminPosts,
  fetchAdminPosts,
  pageWindow,
  parseAdminPostsPage,
} from "@/lib/queries/admin-posts";
import PostList from "./PostList";

export const metadata: Metadata = {
  title: "Posts - Dashboard | Dipak Chatterjee",
};

function Pager({ q, page, pages }: { q: string; page: number; pages: number }) {
  if (pages <= 1) return null;
  const linkClass =
    "inline-flex items-center justify-center gap-1 min-w-9 h-9 px-2.5 rounded-md border text-sm font-semibold transition-colors";
  return (
    <nav aria-label="Posts pages" className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={adminPostsHref({ q, page: page - 1 })} className={`${linkClass} border-line bg-white text-ink-600 hover:border-saffron`}>
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          Previous
        </Link>
      ) : (
        <span aria-disabled="true" className={`${linkClass} border-line bg-white text-ink-400 opacity-50`}>
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          Previous
        </span>
      )}

      {pageWindow(page, pages).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="px-1 text-ink-400" aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={adminPostsHref({ q, page: p })}
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
            className={`${linkClass} ${
              p === page ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-ink-600 hover:border-saffron"
            }`}
          >
            {p}
          </Link>
        )
      )}

      {page < pages ? (
        <Link href={adminPostsHref({ q, page: page + 1 })} className={`${linkClass} border-line bg-white text-ink-600 hover:border-saffron`}>
          Next
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      ) : (
        <span aria-disabled="true" className={`${linkClass} border-line bg-white text-ink-400 opacity-50`}>
          Next
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const raw = await searchParams;
  const q = cleanPostSearch(raw.q);
  const page = parseAdminPostsPage(raw.page);

  const supabase = await createClient();
  const { posts, total, outOfRange, error } = await fetchAdminPosts(supabase, { q, page });

  if (outOfRange) {
    redirect(adminPostsHref({ q, page: adminPostsPageCount(await countAdminPosts(supabase, q)) }));
  }
  if (error) console.error("[admin/posts] list failed:", error);

  const pages = adminPostsPageCount(total);

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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5">
        <form method="get" action="/admin/posts" role="search" className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="posts-search" className="sr-only">
            Search posts
          </label>
          <div className="relative flex-1 sm:w-80 sm:flex-none">
            <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            {/* keyed by the query so "Clear" (a client-side navigation) empties it */}
            <input
              key={q}
              id="posts-search"
              name="q"
              type="search"
              defaultValue={q}
              maxLength={80}
              placeholder="Search title or text"
              className="w-full rounded-md border border-line bg-white pl-9 pr-3 py-2.5 text-sm text-ink focus:border-saffron focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="shrink-0 bg-navy-900 hover:bg-navy-900/90 text-white text-sm font-semibold px-4 py-2.5 rounded-md"
          >
            Search
          </button>
          {q && (
            <Link href="/admin/posts" className="shrink-0 text-sm text-ink-600 hover:text-navy-900 px-1 py-2.5">
              Clear
            </Link>
          )}
        </form>

        <p className="text-sm text-ink-400 sm:ml-auto" aria-live="polite">
          {q
            ? `${total} post${total === 1 ? "" : "s"} match “${q}”`
            : `${total} post${total === 1 ? "" : "s"}`}
          {pages > 1 && ` · page ${page} of ${pages}`}
        </p>
      </div>

      {error ? (
        <div className="border border-rust/40 bg-white rounded-lg p-6 text-sm text-rust" role="alert">
          Couldn&apos;t load posts right now. Reload the page to try again.
        </div>
      ) : (
        <PostList
          posts={posts}
          emptyMessage={q ? `No posts match “${q}”.` : "No posts yet. Add one to get started."}
        />
      )}

      <Pager q={q} page={page} pages={pages} />
    </div>
  );
}
