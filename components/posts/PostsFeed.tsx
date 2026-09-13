// components/posts/PostsFeed.tsx
//
// Chronological feed (pinned posts first — see the page's query),
// styled after the original "Notable Works" section (dark navy band,
// card grid). Each post's first media item (or its dedicated thumbnail)
// renders through MediaPlayer; per-post links render on the post's own
// "Read More" page (app/(site)/posts/[id]/page.tsx), not on this card.

import Link from "next/link";
import MediaPlayer from "@/components/MediaPlayer";
import RevealOnScroll from "@/components/RevealOnScroll";
import type { PostWithMedia } from "@/types/domain";
import { formatPostDate } from "@/lib/post-date";

const EXCERPT_LENGTH = 140;

function excerpt(body: string) {
  if (body.length <= EXCERPT_LENGTH) return body;
  return `${body.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

function PostCard({ post }: { post: PostWithMedia }) {
  // The dedicated thumbnail (Admin -> Posts -> edit) takes priority on
  // every card/feed view; only falls back to the post's first attached
  // media item when no thumbnail has been set.
  const media = post.post_media[0];
  const cardImageUrl = post.thumbnail_url ?? media?.public_url;

  return (
    <article className="h-full bg-black/20 border border-white/10 rounded-lg overflow-hidden flex flex-col">
      {cardImageUrl && (
        <MediaPlayer
          kind={post.thumbnail_url ? "image" : media!.kind}
          src={cardImageUrl}
          className="[&_figcaption]:hidden"
        />
      )}

      <div className="p-5 flex-1 flex flex-col">
        <p className="text-xs text-[var(--theme-primary)] font-semibold">
          {formatPostDate(post.published_at, post.show_published_time)}
        </p>

        {post.title && (
          <h3 className="font-display text-xl text-white mt-2">{post.title}</h3>
        )}

        {post.body && (
          <p className="mt-3 text-sm text-paper-100/70 leading-relaxed">{excerpt(post.body)}</p>
        )}

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

export default function PostsFeed({ posts }: { posts: PostWithMedia[] }) {
  return (
    <section id="works" className="py-16 md:py-24 bg-[var(--theme-secondary)]">
      <div className="max-w-6xl mx-auto px-5 md:px-8">
        <div className="mb-10">
          <h2 className="font-display text-3xl md:text-4xl text-white leading-tight max-w-xl">
            A record of service, community work, and public action.
          </h2>
        </div>

        {posts.length === 0 ? (
          <p className="text-paper-100/60 text-sm">Updates will appear here soon.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {posts.map((post, i) => (
                <RevealOnScroll key={post.id} className="h-full" style={{ transitionDelay: `${Math.min(i, 4) * 75}ms` }}>
                  <PostCard post={post} />
                </RevealOnScroll>
              ))}
            </div>

            <div className="mt-10 flex justify-center">
              <Link
                href="/notable-works"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-900 bg-[var(--theme-primary)] hover:opacity-90 px-5 py-3 rounded-md transition-opacity"
              >
                View All Works <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
