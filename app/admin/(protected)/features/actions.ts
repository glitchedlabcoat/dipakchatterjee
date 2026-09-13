// app/admin/(protected)/features/actions.ts
//
// "Image Gallery" is now the only Feature type creatable from the UI
// ("Phases" — the other Section Type — creates a row in the `phases`
// table instead; see ../phases/actions.ts). `type` is still stored
// (features.type is a non-null Postgres enum with legacy values like
// "about"/"stats"/"custom_section" from before this unification) but is
// no longer admin-editable, so it's hardcoded to "public_life_gallery"
// here rather than accepted from FeatureFormInput.
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { revalidatePublicPages } from "@/lib/cache";
import { FEATURE_BUCKET, type MediaKind } from "@/types/domain";

export type FeatureFormInput = {
  title: string;
  subtitle: string;
  slideshow_interval: number;
  is_published: boolean;
};

export async function createFeature(input: FeatureFormInput) {
  const { supabase } = await requireAdmin();

  const { count } = await supabase
    .from("features")
    .select("*", { count: "exact", head: true });

  const { data, error } = await supabase
    .from("features")
    .insert({
      title: input.title,
      subtitle: input.subtitle || null,
      type: "public_life_gallery",
      slideshow_interval: input.slideshow_interval,
      is_published: input.is_published,
      display_order: count ?? 0,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/admin/features");
  revalidatePublicPages();
  redirect(`/admin/features/${data.id}`);
}

export async function updateFeature(id: string, input: FeatureFormInput) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase
    .from("features")
    .update({
      title: input.title,
      subtitle: input.subtitle || null,
      slideshow_interval: input.slideshow_interval,
      is_published: input.is_published,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/features");
  revalidatePath(`/admin/features/${id}`);
  revalidatePublicPages();
}

export async function deleteFeature(id: string) {
  const { supabase } = await requireAdmin();

  const { data: media } = await supabase
    .from("feature_media")
    .select("storage_path")
    .eq("feature_id", id);

  if (media && media.length > 0) {
    await supabase.storage
      .from(FEATURE_BUCKET)
      .remove(media.map((m) => m.storage_path));
  }

  const { error } = await supabase.from("features").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/features");
  revalidatePublicPages();
}

export type SectionRef = { kind: "feature" | "phase"; id: string };

/**
 * Persists the unified /admin/features list's order (Image Galleries
 * and Phases interleaved) in one call. Both kinds get their new
 * position from the same 0..n-1 sequence over the *whole* merged list —
 * not renumbered per-kind — so that sorting features by display_order
 * and phases by sort_order and merging by that shared number (see
 * lib/homepage-layout.ts's computeHomepageOrder) reconstructs the exact
 * interleaved order chosen here.
 */
export async function reorderSections(items: SectionRef[]) {
  const { supabase } = await requireAdmin();

  await Promise.all(
    items.map((item, index) =>
      item.kind === "feature"
        ? supabase.from("features").update({ display_order: index }).eq("id", item.id)
        : supabase.from("phases").update({ sort_order: index }).eq("id", item.id)
    )
  );

  revalidatePath("/admin/features");
  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function toggleFeaturePublished(id: string, is_published: boolean) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase
    .from("features")
    .update({ is_published })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/features");
  revalidatePath("/admin/arrangement");
  revalidatePublicPages();
}

export async function addFeatureMedia(
  featureId: string,
  input: { kind: MediaKind; storage_path: string; public_url: string; caption?: string }
) {
  const { supabase } = await requireAdmin();

  const { count } = await supabase
    .from("feature_media")
    .select("*", { count: "exact", head: true })
    .eq("feature_id", featureId);

  // Returns the real row id — MediaManager needs it (not the storage
  // path) as the item's key/identity so a delete or reorder right after
  // upload targets the actual database row instead of failing against
  // a non-UUID "id".
  const { data, error } = await supabase
    .from("feature_media")
    .insert({
      feature_id: featureId,
      kind: input.kind,
      storage_path: input.storage_path,
      public_url: input.public_url,
      caption: input.caption || null,
      display_order: count ?? 0,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/features/${featureId}`);
  revalidatePublicPages();

  return { id: data.id };
}

export async function deleteFeatureMedia(featureId: string, mediaId: string) {
  const { supabase } = await requireAdmin();

  const { data: row } = await supabase
    .from("feature_media")
    .select("storage_path")
    .eq("id", mediaId)
    .single();

  if (row) {
    await supabase.storage.from(FEATURE_BUCKET).remove([row.storage_path]);
  }

  const { error } = await supabase.from("feature_media").delete().eq("id", mediaId);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/features/${featureId}`);
  revalidatePublicPages();
}

export async function updateFeatureMediaMeta(
  featureId: string,
  mediaId: string,
  input: { title?: string; caption?: string }
) {
  const { supabase } = await requireAdmin();

  const patch: { title?: string | null; caption?: string | null } = {};
  if (input.title !== undefined) patch.title = input.title || null;
  if (input.caption !== undefined) patch.caption = input.caption || null;

  const { error } = await supabase.from("feature_media").update(patch).eq("id", mediaId);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/features/${featureId}`);
  revalidatePublicPages();
}

export async function reorderFeatureMedia(featureId: string, orderedIds: string[]) {
  const { supabase } = await requireAdmin();

  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("feature_media").update({ display_order: index }).eq("id", id)
    )
  );

  revalidatePath(`/admin/features/${featureId}`);
  revalidatePublicPages();
}
