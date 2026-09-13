// app/admin/(protected)/settings/nav-links-actions.ts
//
// Server Actions for the dynamic primary nav row ("About", "Public
// Life", "Notable Works", "Contact" — see components/site/SiteHeader.tsx
// for how these render). Split out from actions.ts, same pattern as
// header-actions.ts.

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { revalidatePublicPages } from "@/lib/cache";

export type NavLinkInput = {
  label: string;
  url: string;
  is_visible?: boolean;
};

export type NavLinkPatch = Partial<NavLinkInput>;

export async function createNavLink(input: NavLinkInput) {
  const { supabase } = await requireAdmin();

  const { count } = await supabase.from("nav_links").select("*", { count: "exact", head: true });

  const { data, error } = await supabase
    .from("nav_links")
    .insert({
      label: input.label,
      url: input.url,
      is_visible: input.is_visible ?? true,
      display_order: count ?? 0,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Couldn't add nav link: ${error.message}`);

  revalidatePath("/admin/settings");
  revalidatePublicPages();

  return data;
}

export async function updateNavLink(id: string, input: NavLinkPatch) {
  const { supabase } = await requireAdmin();

  const patch: NavLinkPatch = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.url !== undefined) patch.url = input.url;
  if (input.is_visible !== undefined) patch.is_visible = input.is_visible;

  const { error } = await supabase.from("nav_links").update(patch).eq("id", id);
  if (error) throw new Error(`Couldn't save nav link: ${error.message}`);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function deleteNavLink(id: string) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("nav_links").delete().eq("id", id);
  if (error) throw new Error(`Couldn't delete nav link: ${error.message}`);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function reorderNavLinks(orderedIds: string[]) {
  const { supabase } = await requireAdmin();

  const results = await Promise.all(
    orderedIds.map((id, index) => supabase.from("nav_links").update({ display_order: index }).eq("id", id))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`Couldn't save the new order: ${failed.error.message}`);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}
