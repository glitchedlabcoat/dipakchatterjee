// app/admin/(protected)/features/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { FEATURE_BUCKET, type Feature, type FeatureMedia } from "@/types/domain";
import MediaManager from "@/components/admin/MediaManager";
import DeleteEntityButton from "@/components/admin/DeleteEntityButton";
import FeatureForm from "../FeatureForm";
import {
  addFeatureMedia,
  deleteFeature,
  deleteFeatureMedia,
  reorderFeatureMedia,
  updateFeature,
  updateFeatureMediaMeta,
} from "../actions";

export default async function EditFeaturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: feature }, { data: media }] = await Promise.all([
    supabase.from("features").select("*").eq("id", id).single(),
    supabase
      .from("feature_media")
      .select("*")
      .eq("feature_id", id)
      .order("display_order", { ascending: true }),
  ]);

  if (!feature) notFound();

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/features"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-navy-900 mb-6"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Features
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-sm font-semibold text-saffron-600 mb-2">Edit Feature</p>
          <h1 className="font-display text-3xl text-navy-900">{feature.title}</h1>
        </div>

        <DeleteEntityButton
          label="Delete feature"
          confirmMessage="Delete this feature and all its media? This cannot be undone."
          redirectTo="/admin/features"
          onDelete={deleteFeature.bind(null, id)}
        />
      </div>

      <div className="bg-white border border-line rounded-xl p-6 md:p-8 mb-6">
        <FeatureForm feature={feature as Feature} onSubmit={updateFeature.bind(null, id)} />
      </div>

      <div className="bg-white border border-line rounded-xl p-6 md:p-8">
        <MediaManager
          folder={FEATURE_BUCKET}
          entityId={id}
          media={(media as FeatureMedia[]) ?? []}
          addAction={addFeatureMedia.bind(null, id)}
          deleteAction={deleteFeatureMedia.bind(null, id)}
          reorderAction={reorderFeatureMedia.bind(null, id)}
          editableMeta
          updateMetaAction={updateFeatureMediaMeta.bind(null, id)}
        />
        {feature.type === "public_life_gallery" && (
          <p className="text-xs text-ink-400 mt-4">
            Title and caption appear as an overlay on the Public Life gallery carousel. Drag to
            reorder slides.
          </p>
        )}
      </div>
    </div>
  );
}
