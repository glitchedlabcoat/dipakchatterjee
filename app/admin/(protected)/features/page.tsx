// app/admin/(protected)/features/page.tsx
//
// Unified "Modular sections" list: Image Gallery features and Phases,
// merged into one interleaved, drag/move-reorderable list (see
// SectionList) instead of two separate list boxes. The merge order is
// features.display_order and phases.sort_order combined — exactly the
// shared sequence reorderSections() writes on every reorder here — so
// this list's order is always the source of truth SectionList wrote
// last, not a fresh re-derivation of anything.
import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import type { Feature, Phase } from "@/types/domain";
import SectionList, { type SectionItem } from "./SectionList";

export const metadata: Metadata = {
  title: "Features - Dashboard | Dipak Chatterjee",
};

export default async function FeaturesPage() {
  const supabase = await createClient();

  // Capped, not truly unbounded — same reasoning as posts/page.tsx's
  // .limit(200): this container is memory-constrained, and these lists
  // have no pagination UI to fall back on if they ever grew large.
  const [{ data: features }, { data: phases }] = await Promise.all([
    supabase.from("features").select("*").order("display_order", { ascending: true }).limit(200),
    supabase.from("phases").select("*").order("sort_order", { ascending: true }).limit(200),
  ]);

  const featureList = (features as Feature[]) ?? [];
  const phaseList = (phases as Phase[]) ?? [];

  const ordered: Array<{ item: SectionItem; order: number }> = [
    ...featureList.map((f) => ({ item: { kind: "feature", data: f } as SectionItem, order: f.display_order })),
    ...phaseList.map((p) => ({ item: { kind: "phase", data: p } as SectionItem, order: p.sort_order })),
  ].sort((a, b) => a.order - b.order);

  const items = ordered.map((x) => x.item);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-sm font-semibold text-saffron-600 mb-2">Features</p>
          <h1 className="font-display text-3xl text-navy-900">Modular sections</h1>
          <p className="text-sm text-ink-600 mt-1.5">
            Image Galleries and Phases (life &amp; career milestones), interleaved in one order.
            Drag, or use the arrows, to reorder.
          </p>
        </div>

        <Link
          href="/admin/features/new"
          className="inline-flex items-center gap-2 bg-saffron hover:bg-saffron-600 text-white font-semibold px-4 py-2.5 rounded-md transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Section
        </Link>
      </div>

      <SectionList items={items} />
    </div>
  );
}
