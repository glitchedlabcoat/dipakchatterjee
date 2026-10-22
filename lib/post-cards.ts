// lib/post-cards.ts
//
// Shared by the public archive (/notable-works), its "View More" endpoint
// (app/api/posts/route.ts) and the button's client state
// (components/posts/NotableWorksArchive.tsx): the batch size, the bounded
// page parsers, and the slim card shape sent to the browser. Cards are
// built on the server, date label included, so the first batch and every
// appended batch render identically (formatPostDate uses the server's
// timezone; formatting in the browser would differ and break hydration),
// and a batch never carries a post's full media list or links, only what
// a card shows.

import { formatPostDate } from "@/lib/post-date";
import type { PostMedia, PostWithMedia } from "@/types/domain";

export const ARCHIVE_PAGE_SIZE = 12;

// Far beyond the real archive (257 published posts, 22 batches, on
// 2026-10-22); it only stops a client from asking for arbitrarily deep
// offsets.
export const ARCHIVE_MAX_PAGE = 1000;

const EXCERPT_LENGTH = 140;

export type PostCardData = {
  id: string;
  title: string | null;
  excerpt: string | null;
  dateLabel: string;
  image: { kind: PostMedia["kind"]; src: string } | null;
};

export type PostsPage = {
  posts: PostCardData[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

export function excerpt(body: string) {
  if (body.length <= EXCERPT_LENGTH) return body;
  return `${body.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

/** The archive page's own ?page=: anything unparseable is page 1, and it never goes past ARCHIVE_MAX_PAGE. */
export function parseArchivePage(value: string | null | undefined): number {
  const n = Number.parseInt(value ?? "1", 10) || 1;
  return Math.min(Math.max(n, 1), ARCHIVE_MAX_PAGE);
}

/** The API's ?page=: a plain positive integer up to ARCHIVE_MAX_PAGE, or null (rejected with a 400). */
export function parseStrictArchivePage(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return 1;
  if (!/^[1-9]\d{0,3}$/.test(value)) return null;
  const n = Number(value);
  return n <= ARCHIVE_MAX_PAGE ? n : null;
}

export function archivePageHref(page: number) {
  return page > 1 ? `/notable-works?page=${page}` : "/notable-works";
}

/** A post's public page, or null while it's a draft: /posts/[id] only serves published posts. */
export function publicPostHref(post: { id: string; is_published: boolean }): string | null {
  return post.is_published ? `/posts/${post.id}` : null;
}

export function toPostCardData(post: PostWithMedia): PostCardData {
  // The dedicated thumbnail wins; otherwise the first attached media item.
  const media = post.post_media?.[0];
  const src = post.thumbnail_url ?? media?.public_url ?? null;
  return {
    id: post.id,
    title: post.title,
    excerpt: post.body ? excerpt(post.body) : null,
    dateLabel: formatPostDate(post.published_at, post.show_published_time),
    image: src ? { kind: post.thumbnail_url ? "image" : media!.kind, src } : null,
  };
}

export function toPostsPage(page: number, list: { posts: PostWithMedia[]; count: number }): PostsPage {
  return {
    posts: list.posts.map(toPostCardData),
    page,
    pageSize: ARCHIVE_PAGE_SIZE,
    total: list.count,
    hasMore: page * ARCHIVE_PAGE_SIZE < list.count,
  };
}

/** Appends only posts not already shown, keeping order (an offset batch can repeat one if a post was published in between). */
export function appendUnique(existing: PostCardData[], incoming: PostCardData[]): PostCardData[] {
  const seen = new Set(existing.map((p) => p.id));
  const fresh: PostCardData[] = [];
  for (const post of incoming) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    fresh.push(post);
  }
  return fresh.length > 0 ? [...existing, ...fresh] : existing;
}

/** Checks the API's JSON before it reaches state, so a bad response shows the error message instead of breaking the list. */
export function parsePostsPage(json: unknown): PostsPage {
  const value = json as Partial<PostsPage> | null;
  if (
    !value ||
    !Array.isArray(value.posts) ||
    typeof value.page !== "number" ||
    typeof value.total !== "number" ||
    typeof value.hasMore !== "boolean" ||
    !value.posts.every((p) => p && typeof p.id === "string" && typeof p.dateLabel === "string")
  ) {
    throw new Error("Unexpected posts response");
  }
  return { posts: value.posts, page: value.page, pageSize: value.pageSize ?? ARCHIVE_PAGE_SIZE, total: value.total, hasMore: value.hasMore };
}

// --- "View More" state ------------------------------------------------------

export type ArchiveState = {
  posts: PostCardData[];
  nextPage: number;
  total: number;
  hasMore: boolean;
  status: "idle" | "loading" | "error";
};

export type ArchiveAction = { type: "load" } | { type: "loaded"; batch: PostsPage } | { type: "failed" };

export function initArchiveState(initial: PostsPage): ArchiveState {
  return {
    posts: appendUnique([], initial.posts),
    nextPage: initial.page + 1,
    total: initial.total,
    hasMore: initial.hasMore && initial.posts.length > 0,
    status: "idle",
  };
}

export function archiveReducer(state: ArchiveState, action: ArchiveAction): ArchiveState {
  switch (action.type) {
    case "load":
      return { ...state, status: "loading" };
    case "failed":
      // Keeps everything already shown and the same next page, so "Try
      // again" asks for exactly the batch that failed.
      return { ...state, status: "error" };
    case "loaded":
      return {
        posts: appendUnique(state.posts, action.batch.posts),
        nextPage: action.batch.page + 1,
        total: action.batch.total,
        // An empty batch ends the list even if the count said otherwise
        // (posts unpublished meanwhile), so the button can't loop forever.
        hasMore: action.batch.hasMore && action.batch.posts.length > 0,
        status: "idle",
      };
  }
}
