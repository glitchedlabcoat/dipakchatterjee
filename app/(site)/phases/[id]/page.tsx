// app/(site)/phases/[id]/page.tsx
//
// A Phase's dedicated "Read More" permalink — mirrors
// app/(site)/posts/[id]/page.tsx's shape: back link, title/period,
// full narrative, full media. The homepage (PhaseEntry) only ever shows
// the short `summary` plus a link here; this page shows the complete
// `full_content` narrative (falling back to `summary` when an admin
// hasn't written a separate long-form story) and every photo with its
// caption and fact — never capped to max_display_images, unlike the
// homepage's gallery.

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { ArrowLeft } from "lucide-react";
import { createPublicClient } from "@/utils/supabase/public";
import { PUBLIC_CACHE_TAG, PUBLIC_REVALIDATE_SECONDS, createTrackedCache } from "@/lib/cache";
import type { Phase, PhasePhoto } from "@/types/domain";
import PhaseFullGallery from "@/components/phases/PhaseFullGallery";

// See app/(site)/layout.tsx and lib/cache.ts for why this is cached at
// the data-fetch layer (unstable_cache) rather than via page-level ISR.
const getPublishedPhase = createTrackedCache(
  "/phases/[id]",
  async (id: string) => {
    const supabase = createPublicClient();
    const { data: phase } = await supabase.from("phases").select("*").eq("id", id).eq("is_published", true).single();
    return phase;
  },
  ["phase"],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAG] }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // getPublishedPhase isn't React `cache()`-wrapped like getPostById, so
  // this and PhasePage below each run their own Supabase call — matches
  // this file's pre-existing pattern (createTrackedCache/unstable_cache
  // already dedupes the underlying query at the Data Cache layer).
  const phase = await getPublishedPhase(id);
  if (!phase) return {};

  return {
    title: (phase as Phase).title,
    alternates: { canonical: `/phases/${id}` },
  };
}

export default async function PhasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const phase = await getPublishedPhase(id);

  if (!phase) notFound();

  const typedPhase = phase as Phase;
  const photos = (typedPhase.photos as unknown as PhasePhoto[] | null) ?? [];
  const narrative = typedPhase.full_content?.trim() || typedPhase.summary;

  return (
    <main className="bg-paper-100 min-h-screen">
      <article className="max-w-4xl mx-auto px-5 md:px-8 py-12 md:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--theme-primary)] hover:opacity-80 mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <h1 className="font-display text-3xl md:text-4xl text-navy-900 leading-tight">{typedPhase.title}</h1>
        {typedPhase.period && (
          <p className="font-display text-3xl md:text-4xl text-navy-900 leading-tight">{typedPhase.period}</p>
        )}

        <div className="mt-8 max-w-none text-ink-600 leading-relaxed [&_p]:leading-relaxed [&_p]:mb-4">
          <ReactMarkdown>{narrative}</ReactMarkdown>
        </div>
      </article>

      {photos.length > 0 && (
        <section className="border-y border-line bg-white py-12 md:py-16">
          <div className="max-w-4xl mx-auto px-5 md:px-8">
            <PhaseFullGallery photos={photos} />
          </div>
        </section>
      )}
    </main>
  );
}
