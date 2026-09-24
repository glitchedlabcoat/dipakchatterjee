// app/(site)/posts/[id]/page.tsx
//
// Single post permalink. Async `params`, per the Next.js 15+ App Router
// convention already used across the admin edit pages in this project.
//
// A post's `links` (see types/domain.ts's PostLink) are split into:
//   - "embed" links: the first one whose URL matches a known provider
//     (see lib/embed.ts) is rendered as a live embed. An embed link
//     that doesn't match anything recognized is simply not rendered —
//     same as it always failing closed — and PostEmbed itself hides
//     silently if the iframe genuinely fails to load at runtime.
//   - "button" links: always render as plain call-to-actions below the
//     text, regardless of whether an embed is present.
//
// Adaptive layout:
//   - A working embed present: the embed sits beside the text (2-column
//     on desktop); any uploaded media/photos render full-width below.
//   - No working embed: uploaded media/photos sit beside the text
//     instead.
//   - Neither an embed nor uploaded media: the text renders full-width.

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { ExternalLink, ArrowLeft } from "lucide-react";
import { getPostById } from "@/lib/queries/posts";
import type { PostLink, PostWithMedia } from "@/types/domain";
import MediaPlayer from "@/components/MediaPlayer";
import PostEmbed from "@/components/posts/PostEmbed";
import PostImageCarousel from "@/components/posts/PostImageCarousel";
import { getEmbedInfo, type EmbedInfo } from "@/lib/embed";
import { resolveFacebookUrl } from "@/lib/facebook-resolver";
import { formatPostDate } from "@/lib/post-date";
import { truncateTitle } from "@/lib/truncate-title";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // getPostById (lib/queries/posts.ts) is itself wrapped in React's
  // `cache()`, so this and PostPage below (both called once per request
  // for the same id) already share a single call.
  const post = await getPostById(id);
  if (!post) return {};

  return {
    title: truncateTitle(post.title || "Update"),
    alternates: { canonical: `/posts/${id}` },
  };
}

function buttonLabel(link: PostLink) {
  if (link.label) return link.label;
  try {
    const host = new URL(link.url).hostname.replace(/^www\./, "");
    if (host === "facebook.com" || host === "fb.watch") return "View on Facebook";
  } catch {
    // Not a parseable URL — fall through to the generic label. Links
    // persist as-is regardless of format, per the admin link builder's
    // "no blocking validation" rule.
  }
  return "View Link";
}

function MediaGallery({
  images,
  videos,
  intervalMs,
}: {
  images: PostWithMedia["post_media"];
  videos: PostWithMedia["post_media"];
  intervalMs?: number;
}) {
  return (
    <div className="space-y-6">
      {images.length > 1 ? (
        <PostImageCarousel images={images} intervalMs={intervalMs} />
      ) : (
        images.map((media) => <MediaPlayer key={media.id} kind={media.kind} src={media.public_url} />)
      )}
      {videos.map((media) => (
        <MediaPlayer key={media.id} kind={media.kind} src={media.public_url} />
      ))}
    </div>
  );
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPostById(id);

  if (!post) notFound();

  const typedPost = post;
  const links = (typedPost.links as unknown as PostLink[] | null) ?? [];
  const buttonLinks = links.filter((l) => l.type === "button");

  // The first embed-type link that resolves to a recognized provider
  // wins; any others (or an embed link that doesn't resolve) are
  // silently ignored rather than shown as an error.
  //
  // Facebook /share/ short-links are swapped for their canonical
  // permalink first (lib/facebook-resolver.ts) — Meta's embed plugins
  // can't play a short-link, and whether it's a video or a post can
  // only be told from the resolved URL. Non-Facebook URLs pass through
  // untouched, as does any short-link that fails to resolve.
  let embed: EmbedInfo | null = null;
  let embedSourceUrl: string | null = null;
  let embedShowText = true;
  for (const link of links) {
    if (link.type !== "embed") continue;
    const url = await resolveFacebookUrl(link.url);
    const info = getEmbedInfo(url);
    if (info) {
      embed = info;
      embedSourceUrl = url;
      embedShowText = link.showText ?? true;
      break;
    }
  }

  const images = typedPost.post_media.filter((m) => m.kind === "image");
  const videos = typedPost.post_media.filter((m) => m.kind === "video");
  const hasUploadedMedia = typedPost.post_media.length > 0;
  const slideshowMs = typedPost.slideshow_interval ? typedPost.slideshow_interval * 1000 : 0;

  const showEmbedBesideText = Boolean(embed);
  const showMediaBesideText = !showEmbedBesideText && hasUploadedMedia;
  const isSplitLayout = showMediaBesideText || showEmbedBesideText;
  const showMediaBelow = showEmbedBesideText && hasUploadedMedia;

  return (
    <main className="bg-paper-100 min-h-screen">
      <article className="max-w-6xl mx-auto px-5 md:px-8 py-12 md:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--theme-primary)] hover:opacity-80 mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <div className={isSplitLayout ? "grid lg:grid-cols-2 gap-8 lg:gap-12 items-start" : ""}>
          <div className={isSplitLayout ? "" : "max-w-2xl"}>
            <p className="text-xs text-ink-400 font-medium">
              {formatPostDate(typedPost.published_at, typedPost.show_published_time)}
            </p>
            <h1 className="font-display text-3xl md:text-4xl text-navy-900 leading-tight mt-2">
              {typedPost.title || "Update"}
            </h1>

            {typedPost.body && (
              <div className="mt-8 max-w-none text-ink-600 leading-relaxed [&_p]:leading-relaxed [&_p]:mb-4">
                <ReactMarkdown>{typedPost.body}</ReactMarkdown>
              </div>
            )}

            {buttonLinks.length > 0 && (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {buttonLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[#1877F2] hover:bg-[#1665d8] px-4 py-2 rounded-md transition-colors"
                  >
                    {buttonLabel(link)}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {showEmbedBesideText && embed && embedSourceUrl && (
            <div>
              <PostEmbed embed={embed} sourceUrl={embedSourceUrl} showText={embedShowText} />
            </div>
          )}

          {showMediaBesideText && (
            <div>
              <MediaGallery images={images} videos={videos} intervalMs={slideshowMs} />
            </div>
          )}
        </div>
      </article>

      {showMediaBelow && (
        <section className="border-y border-[var(--theme-secondary)]/15 bg-[var(--theme-secondary)]/[0.04] py-12 md:py-16">
          <div className="max-w-6xl mx-auto px-5 md:px-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-secondary)] mb-6">
              Media
            </p>

            <MediaGallery images={images} videos={videos} intervalMs={slideshowMs} />
          </div>
        </section>
      )}
    </main>
  );
}
