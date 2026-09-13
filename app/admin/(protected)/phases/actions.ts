// app/admin/(protected)/phases/actions.ts
//
// CRUD for phases plus its inline photo gallery. Unlike features/posts,
// a phase's photos live directly on the row as a JSONB array
// (phases.photos) rather than a separate foreign-keyed media table, so
// adding/removing/reordering a photo is a read-modify-write of that one
// column instead of an insert/delete against a child table.
//
// Phases is a modular subsection of Features, with the same
// is_published gate Image Gallery features have (see togglePhasePublished
// below and SectionList.tsx) — a new phase starts as a draft, same as a
// new feature.
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { logDashboardActivity } from "@/lib/activity-log";
import { revalidatePublicPages } from "@/lib/cache";
import { PHASE_BUCKET, type PhasePhoto } from "@/types/domain";

export type PhaseFormInput = {
  title: string;
  period: string;
  summary: string;
  full_content: string;
  slideshow_interval: number;
  max_display_images: number;
  is_published: boolean;
};

export async function createPhase(input: PhaseFormInput) {
  const { supabase, user } = await requireAdmin();

  const { count } = await supabase.from("phases").select("*", { count: "exact", head: true });

  const { data, error } = await supabase
    .from("phases")
    .insert({
      title: input.title,
      period: input.period || null,
      summary: input.summary,
      full_content: input.full_content || null,
      slideshow_interval: input.slideshow_interval,
      max_display_images: input.max_display_images,
      is_published: input.is_published,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await logDashboardActivity(supabase, user, {
    action: "CREATE_PHASE",
    entityType: "phases",
    entityId: data.id,
    details: `Created phase: '${input.title}'`,
  });

  revalidatePath("/admin/features");
  revalidatePath("/admin/phases");
  revalidatePath("/admin/arrangement");
  revalidatePublicPages();
  redirect(`/admin/phases/${data.id}`);
}

export async function updatePhase(id: string, input: PhaseFormInput) {
  const { supabase, user } = await requireAdmin();

  const { error } = await supabase
    .from("phases")
    .update({
      title: input.title,
      period: input.period || null,
      summary: input.summary,
      full_content: input.full_content || null,
      slideshow_interval: input.slideshow_interval,
      max_display_images: input.max_display_images,
      is_published: input.is_published,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  await logDashboardActivity(supabase, user, {
    action: "UPDATE_PHASE",
    entityType: "phases",
    entityId: id,
    details: `Updated phase: '${input.title}'`,
  });

  revalidatePath("/admin/features");
  revalidatePath("/admin/phases");
  revalidatePath(`/admin/phases/${id}`);
  revalidatePath("/admin/arrangement");
  revalidatePublicPages();
}

export async function togglePhasePublished(id: string, is_published: boolean) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("phases").update({ is_published }).eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/features");
  revalidatePath("/admin/arrangement");
  revalidatePublicPages();
}

export async function deletePhase(id: string) {
  const { supabase, user } = await requireAdmin();

  const { data: phase } = await supabase.from("phases").select("title, photos").eq("id", id).single();

  const photos = ((phase?.photos as PhasePhoto[] | null) ?? []).filter((p) => p.path);
  if (photos.length > 0) {
    await supabase.storage.from(PHASE_BUCKET).remove(photos.map((p) => p.path));
  }

  const { error } = await supabase.from("phases").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logDashboardActivity(supabase, user, {
    action: "DELETE_PHASE",
    entityType: "phases",
    entityId: id,
    details: `Deleted phase: '${phase?.title ?? id}'`,
  });

  revalidatePath("/admin/features");
  revalidatePath("/admin/phases");
  revalidatePublicPages();
}

export async function addPhasePhoto(
  phaseId: string,
  input: { url: string; path: string; caption?: string; fact?: string }
) {
  const { supabase } = await requireAdmin();

  const { data: phase, error: fetchError } = await supabase
    .from("phases")
    .select("photos")
    .eq("id", phaseId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  const photos = (phase?.photos as PhasePhoto[] | null) ?? [];
  const next: PhasePhoto[] = [
    ...photos,
    { url: input.url, path: input.path, caption: input.caption ?? "", fact: input.fact ?? "" },
  ];

  const { error } = await supabase.from("phases").update({ photos: next }).eq("id", phaseId);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/phases/${phaseId}`);
  revalidatePublicPages();
}

export async function deletePhasePhoto(phaseId: string, path: string) {
  const { supabase } = await requireAdmin();

  const { data: phase, error: fetchError } = await supabase
    .from("phases")
    .select("photos")
    .eq("id", phaseId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  const photos = (phase?.photos as PhasePhoto[] | null) ?? [];
  const next = photos.filter((p) => p.path !== path);

  const { error } = await supabase.from("phases").update({ photos: next }).eq("id", phaseId);
  if (error) throw new Error(error.message);

  await supabase.storage.from(PHASE_BUCKET).remove([path]);

  revalidatePath(`/admin/phases/${phaseId}`);
  revalidatePublicPages();
}

export async function updatePhasePhotoCaption(phaseId: string, path: string, caption: string) {
  const { supabase } = await requireAdmin();

  const { data: phase, error: fetchError } = await supabase
    .from("phases")
    .select("photos")
    .eq("id", phaseId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  const photos = (phase?.photos as PhasePhoto[] | null) ?? [];
  const next = photos.map((p) => (p.path === path ? { ...p, caption } : p));

  const { error } = await supabase.from("phases").update({ photos: next }).eq("id", phaseId);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/phases/${phaseId}`);
  revalidatePublicPages();
}

export async function updatePhasePhotoFact(phaseId: string, path: string, fact: string) {
  const { supabase } = await requireAdmin();

  const { data: phase, error: fetchError } = await supabase
    .from("phases")
    .select("photos")
    .eq("id", phaseId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  const photos = (phase?.photos as PhasePhoto[] | null) ?? [];
  const next = photos.map((p) => (p.path === path ? { ...p, fact } : p));

  const { error } = await supabase.from("phases").update({ photos: next }).eq("id", phaseId);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/phases/${phaseId}`);
  revalidatePublicPages();
}

export async function reorderPhasePhotos(phaseId: string, orderedPaths: string[]) {
  const { supabase } = await requireAdmin();

  const { data: phase, error: fetchError } = await supabase
    .from("phases")
    .select("photos")
    .eq("id", phaseId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  const photos = (phase?.photos as PhasePhoto[] | null) ?? [];
  const byPath = new Map(photos.map((p) => [p.path, p]));
  const next = orderedPaths.map((path) => byPath.get(path)).filter((p): p is PhasePhoto => Boolean(p));

  const { error } = await supabase.from("phases").update({ photos: next }).eq("id", phaseId);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/phases/${phaseId}`);
  revalidatePublicPages();
}
