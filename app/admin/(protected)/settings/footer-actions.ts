// app/admin/(protected)/settings/footer-actions.ts
//
// Server Actions for the modular footer builder (footer_blocks +
// footer_links) and the Social Media / Follow links (social_links).
// Split out from actions.ts to keep the footer-builder concerns
// together in one place.

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { revalidatePublicPages } from "@/lib/cache";
import type { FooterBlockType } from "@/types/domain";

// ---------- Footer blocks ----------

export async function createFooterBlock(input: {
  type: FooterBlockType;
  title?: string;
  body?: string;
}) {
  const { supabase } = await requireAdmin();

  const { count } = await supabase.from("footer_blocks").select("*", { count: "exact", head: true });

  const { data, error } = await supabase
    .from("footer_blocks")
    .insert({
      type: input.type,
      title: input.title || null,
      body: input.body || null,
      display_order: count ?? 0,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePublicPages();

  return data;
}

export async function updateFooterBlock(id: string, input: { title?: string; body?: string }) {
  const { supabase } = await requireAdmin();

  const patch: { title?: string | null; body?: string | null } = {};
  if (input.title !== undefined) patch.title = input.title || null;
  if (input.body !== undefined) patch.body = input.body || null;

  const { error } = await supabase.from("footer_blocks").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function deleteFooterBlock(id: string) {
  const { supabase } = await requireAdmin();

  // footer_links for this block cascade automatically (FK ON DELETE CASCADE).
  const { error } = await supabase.from("footer_blocks").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function reorderFooterBlocks(orderedIds: string[]) {
  const { supabase } = await requireAdmin();

  await Promise.all(
    orderedIds.map((id, index) => supabase.from("footer_blocks").update({ display_order: index }).eq("id", id))
  );

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

// ---------- Footer links (inside a Quick Links block) ----------

export async function createFooterLink(blockId: string, input: { label: string; url: string }) {
  const { supabase } = await requireAdmin();

  const { count } = await supabase
    .from("footer_links")
    .select("*", { count: "exact", head: true })
    .eq("footer_block_id", blockId);

  const { data, error } = await supabase
    .from("footer_links")
    .insert({
      footer_block_id: blockId,
      label: input.label,
      url: input.url,
      display_order: count ?? 0,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePublicPages();

  return data;
}

export async function updateFooterLink(id: string, input: { label?: string; url?: string }) {
  const { supabase } = await requireAdmin();

  const patch: { label?: string; url?: string } = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.url !== undefined) patch.url = input.url;

  const { error } = await supabase.from("footer_links").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function deleteFooterLink(id: string) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("footer_links").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function reorderFooterLinks(orderedIds: string[]) {
  const { supabase } = await requireAdmin();

  await Promise.all(
    orderedIds.map((id, index) => supabase.from("footer_links").update({ display_order: index }).eq("id", id))
  );

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

// ---------- Social links (Follow block) ----------

export async function createSocialLink(input: { platform: string; label?: string; url: string }) {
  const { supabase } = await requireAdmin();

  const { count } = await supabase.from("social_links").select("*", { count: "exact", head: true });

  const { data, error } = await supabase
    .from("social_links")
    .insert({
      platform: input.platform,
      label: input.label || null,
      url: input.url,
      display_order: count ?? 0,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePublicPages();

  return data;
}

export async function updateSocialLink(
  id: string,
  input: { platform?: string; label?: string; url?: string }
) {
  const { supabase } = await requireAdmin();

  const patch: { platform?: string; label?: string | null; url?: string } = {};
  if (input.platform !== undefined) patch.platform = input.platform;
  if (input.label !== undefined) patch.label = input.label || null;
  if (input.url !== undefined) patch.url = input.url;

  const { error } = await supabase.from("social_links").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function deleteSocialLink(id: string) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("social_links").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function reorderSocialLinks(orderedIds: string[]) {
  const { supabase } = await requireAdmin();

  await Promise.all(
    orderedIds.map((id, index) => supabase.from("social_links").update({ display_order: index }).eq("id", id))
  );

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}
