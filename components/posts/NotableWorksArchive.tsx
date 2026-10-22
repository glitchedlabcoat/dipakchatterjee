// components/posts/NotableWorksArchive.tsx
//
// /notable-works' card grid plus its "View More" control. The server
// renders the first batch; each click fetches the next one from
// /api/posts and appends it, so visitors keep scrolling one growing list.
// Posts already shown are skipped (see lib/post-cards.ts's appendUnique),
// a failed batch keeps the list and offers "Try again", and the control
// disappears once the archive is exhausted.
//
// The control is a real link to /notable-works?page=N+1: without
// JavaScript (and for crawlers) it still walks the whole archive one
// batch per page; with it, the click is handled here instead. Modified
// clicks (new tab/window) are left to the browser.

"use client";

import { useEffect, useReducer, useRef, type MouseEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import MediaPlayer from "@/components/MediaPlayer";
import {
  archivePageHref,
  archiveReducer,
  initArchiveState,
  parsePostsPage,
  type PostCardData,
  type PostsPage,
} from "@/lib/post-cards";

function PostCard({ post }: { post: PostCardData }) {
  return (
    <article className="h-full bg-white border border-line rounded-lg overflow-hidden flex flex-col">
      {post.image && <MediaPlayer kind={post.image.kind} src={post.image.src} className="[&_figcaption]:hidden" />}

      <div className="p-5 flex-1 flex flex-col">
        <p className="text-xs text-[var(--theme-primary)] font-semibold">{post.dateLabel}</p>

        {post.title && <h3 className="font-display text-xl text-navy-900 mt-2">{post.title}</h3>}

        {post.excerpt && <p className="mt-3 text-sm text-ink-600 leading-relaxed">{post.excerpt}</p>}

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

export default function NotableWorksArchive({ initial }: { initial: PostsPage }) {
  const [state, dispatch] = useReducer(archiveReducer, initial, initArchiveState);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function loadMore(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (inFlight.current) return;

    const controller = new AbortController();
    inFlight.current = controller;
    dispatch({ type: "load" });
    try {
      const res = await fetch(`/api/posts?page=${state.nextPage}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dispatch({ type: "loaded", batch: parsePostsPage(await res.json()) });
    } catch {
      if (!controller.signal.aborted) dispatch({ type: "failed" });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  const loading = state.status === "loading";

  return (
    <>
      <div id="notable-works-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {state.posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>

      <div className="mt-12 flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-ink-400" aria-live="polite">
          {state.hasMore ? `Showing ${state.posts.length} of ${state.total} posts` : "You've reached the end of the archive."}
        </p>

        {state.status === "error" && (
          <p role="alert" className="text-sm text-rust">
            Couldn&apos;t load more posts. Check your connection and try again.
          </p>
        )}

        {state.hasMore && (
          <a
            href={archivePageHref(state.nextPage)}
            onClick={loadMore}
            aria-controls="notable-works-grid"
            aria-disabled={loading || undefined}
            aria-busy={loading || undefined}
            className={`inline-flex items-center justify-center gap-2 min-w-[10rem] text-sm font-semibold text-navy-900 bg-[var(--theme-primary)] hover:opacity-90 px-6 py-3 rounded-md transition-opacity ${
              loading ? "opacity-70 cursor-wait" : ""
            }`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {loading ? "Loading…" : state.status === "error" ? "Try again" : "View More"}
          </a>
        )}
      </div>
    </>
  );
}
