// app/(site)/notable-works/page.tsx
//
// Full archive of every published post, pinned posts first, then newest
// first — same ordering as the homepage feed, just without its limit.
// The first batch renders here; "View More" (components/posts/
// NotableWorksArchive.tsx) appends the next batches in place, so the
// archive reads as one list. ?page=N still renders batch N on its own:
// it's where the View More link points without JavaScript (and for
// crawlers), and it keeps old shared ?page= links working.

import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getPostsListOrEmpty } from "@/lib/queries/posts";
import { ARCHIVE_PAGE_SIZE, parseArchivePage, toPostsPage } from "@/lib/post-cards";
import NotableWorksArchive from "@/components/posts/NotableWorksArchive";

export const metadata: Metadata = {
  title: "Notable Works",
  alternates: { canonical: "/notable-works" },
};

export default async function NotableWorksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = parseArchivePage(pageParam);

  const initial = toPostsPage(page, await getPostsListOrEmpty({ page, pageSize: ARCHIVE_PAGE_SIZE }));

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

        {page > 1 && (
          <p className="-mt-6 mb-8 text-sm text-ink-600">
            Showing older posts.{" "}
            <Link href="/notable-works" className="font-semibold text-[var(--theme-primary)] hover:underline">
              Start from the latest
            </Link>
          </p>
        )}

        {initial.posts.length === 0 ? (
          <p className="text-ink-400 text-sm">
            {page > 1 ? "There are no more posts here." : "Updates will appear here soon."}
          </p>
        ) : (
          <NotableWorksArchive initial={initial} />
        )}
      </div>
    </main>
  );
}
