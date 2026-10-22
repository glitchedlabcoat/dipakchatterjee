// app/admin/(protected)/posts/PostList.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Eye, EyeOff, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { AdminPostListItem } from "@/lib/queries/admin-posts";
import { deletePost, togglePostPinned, togglePostPublished } from "./actions";

// Fixed timeZone so this is a pure function of `value` — otherwise it
// depends on the server process's local timezone (often UTC) vs. the
// visitor's browser timezone, which differ on every load and cause a
// guaranteed hydration mismatch for this "use client" list.
function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export default function PostList({ posts, emptyMessage }: { posts: AdminPostListItem[]; emptyMessage: string }) {
  const [items, setItems] = useState(posts);
  const [isPending, startTransition] = useTransition();

  // A new page, a new search, or the server's refresh after one of the
  // actions below all arrive as a new `posts` array: show it, replacing
  // the optimistic copy (the refresh is the truth, e.g. a newly pinned
  // post moves to page 1).
  const [shownPosts, setShownPosts] = useState(posts);
  if (posts !== shownPosts) {
    setShownPosts(posts);
    setItems(posts);
  }

  function handleTogglePublished(id: string, next: boolean) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, is_published: next } : p)));
    startTransition(async () => {
      await togglePostPublished(id, next);
    });
  }

  function handleTogglePinned(id: string, next: boolean) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, is_pinned: next } : p)));
    startTransition(async () => {
      await togglePostPinned(id, next);
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this post and all its media? This cannot be undone.")) return;
    setItems((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => {
      await deletePost(id);
    });
  }

  if (items.length === 0) {
    return (
      <div className="border border-dashed border-line rounded-lg p-10 text-center text-sm text-ink-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((post) => (
        // Below sm the four controls wrap under the text: on a phone they
        // left the title one word wide and pushed the date over the Pin
        // button.
        <li
          key={post.id}
          className="flex flex-wrap sm:flex-nowrap items-center gap-3 bg-white border border-line rounded-lg p-4"
        >
          <div className="w-full sm:w-auto sm:flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-navy-900 truncate">
                {post.title || "Untitled update"}
              </p>
              {post.is_pinned && (
                <span className="shrink-0 text-[11px] font-semibold text-saffron-600 bg-saffron-100 border border-saffron/30 rounded px-2 py-0.5">
                  [Pinned]
                </span>
              )}
              <span className="shrink-0 text-[11px] font-medium text-ink-400 bg-paper-100 border border-line rounded px-2 py-0.5">
                {formatDate(post.published_at)}
              </span>
            </div>
            {post.body && <p className="text-sm text-ink-600 truncate mt-0.5">{post.body}</p>}
          </div>

          <button
            type="button"
            onClick={() => handleTogglePinned(post.id, !post.is_pinned)}
            disabled={isPending}
            aria-pressed={post.is_pinned}
            title={post.is_pinned ? "Pinned — click to unpin" : "Pin to top of Notable Works"}
            className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border disabled:opacity-60 ${
              post.is_pinned
                ? "border-saffron text-saffron-600 bg-saffron-100"
                : "border-line text-ink-400 bg-paper-100"
            }`}
          >
            {post.is_pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
            {post.is_pinned ? "Pinned" : "Pin"}
          </button>

          <button
            type="button"
            onClick={() => handleTogglePublished(post.id, !post.is_published)}
            disabled={isPending}
            className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border disabled:opacity-60 ${
              post.is_published
                ? "border-forest text-forest bg-forest-100"
                : "border-line text-ink-400 bg-paper-100"
            }`}
          >
            {post.is_published ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {post.is_published ? "Published" : "Draft"}
          </button>

          <Link
            href={`/admin/posts/${post.id}`}
            aria-label="Edit post"
            className="shrink-0 w-9 h-9 rounded-md border border-line flex items-center justify-center text-ink-600 hover:border-saffron hover:text-saffron-600"
          >
            <Pencil className="w-4 h-4" />
          </Link>

          <button
            type="button"
            onClick={() => handleDelete(post.id)}
            disabled={isPending}
            aria-label="Delete post"
            className="shrink-0 w-9 h-9 rounded-md border border-line flex items-center justify-center text-ink-600 hover:border-rust hover:text-rust disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
