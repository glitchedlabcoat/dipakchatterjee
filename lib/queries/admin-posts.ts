// lib/queries/admin-posts.ts
//
// The admin Posts tab's list: one page at a time (count: "exact" plus a
// range) with an optional title/body search. It replaces a fixed
// .limit(200), which cut the list off at the 200th post in feed order,
// so the oldest posts (the archive goes back to 2015; 257 were published
// on 2026-10-22) never appeared in the dashboard even though the public
// archive showed them. Reads run on the signed-in admin's own client, so
// RLS still decides what's visible (drafts included).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Post } from "@/types/domain";

export const ADMIN_POSTS_PAGE_SIZE = 25;
export const ADMIN_POSTS_MAX_PAGE = 1000;
const SEARCH_MAX_LENGTH = 80;

export type AdminPostListItem = Pick<Post, "id" | "title" | "body" | "is_published" | "is_pinned" | "published_at">;

type PostsClient = Pick<SupabaseClient<Database>, "from">;

/**
 * The search box's text, made safe to put inside a PostgREST or() filter:
 * letters, combining marks, digits, spaces, hyphens and the zero-width
 * joiners are kept and everything else becomes a space. The marks matter:
 * Bengali vowel signs, the virama and chandrabindu are combining marks,
 * not letters, so a letters-only filter (like the Inbox's) would break up
 * every Bengali word. Commas, dots, colons, brackets, quotes and the
 * * % _ wildcards never get through.
 */
export function cleanPostSearch(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[^\p{L}\p{M}\p{N}‌‍ -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH)
    .trim();
}

export function parseAdminPostsPage(value: string | null | undefined): number {
  const n = Number.parseInt(value ?? "1", 10) || 1;
  return Math.min(Math.max(n, 1), ADMIN_POSTS_MAX_PAGE);
}

export function adminPostsHref({ q, page }: { q: string; page: number }): string {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `/admin/posts?${qs}` : "/admin/posts";
}

export function adminPostsPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / ADMIN_POSTS_PAGE_SIZE));
}

/** Page links to show: the first, the last and those next to the current page; null marks a gap of two or more. */
export function pageWindow(current: number, pages: number, radius = 1): (number | null)[] {
  const keep = new Set<number>([1, pages]);
  for (let p = current - radius; p <= current + radius; p++) {
    if (p >= 1 && p <= pages) keep.add(p);
  }
  const out: (number | null)[] = [];
  let prev = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - prev === 2) out.push(prev + 1); // a one-page gap: show the page, not "…"
    else if (p - prev > 2) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

function searchFilter(q: string) {
  return `title.ilike.*${q}*,body.ilike.*${q}*`;
}

export type AdminPostsResult = {
  posts: AdminPostListItem[];
  total: number;
  /** The page is past the last one (PostgREST PGRST103), e.g. after deleting the last post on it. */
  outOfRange: boolean;
  error: string | null;
};

export async function fetchAdminPosts(supabase: PostsClient, { q, page }: { q: string; page: number }): Promise<AdminPostsResult> {
  const from = (page - 1) * ADMIN_POSTS_PAGE_SIZE;

  // Same order as the public archive (pinned, then newest), with id as
  // the last tie-breaker so posts sharing a timestamp can't swap between
  // pages.
  let query = supabase
    .from("posts")
    .select("id, title, body, is_published, is_pinned, published_at", { count: "exact" })
    .order("is_pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + ADMIN_POSTS_PAGE_SIZE - 1);
  if (q) query = query.or(searchFilter(q));

  const { data, count, error } = await query;
  if (error?.code === "PGRST103") return { posts: [], total: 0, outOfRange: true, error: null };

  return {
    posts: (data as AdminPostListItem[] | null) ?? [],
    total: count ?? 0,
    outOfRange: false,
    error: error ? error.message : null,
  };
}

/** Matching posts only (no rows), to find the last page when a request lands past it. */
export async function countAdminPosts(supabase: PostsClient, q: string): Promise<number> {
  let query = supabase.from("posts").select("id", { count: "exact", head: true });
  if (q) query = query.or(searchFilter(q));
  const { count } = await query;
  return count ?? 0;
}
