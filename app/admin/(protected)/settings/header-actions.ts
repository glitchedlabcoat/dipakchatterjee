// app/admin/(protected)/settings/header-actions.ts
//
// Server Actions for the dynamic header action buttons/links (the
// header builder — see components/site/SiteHeader.tsx for how these
// render). Split out from actions.ts to keep it alongside the other
// dedicated builder files (footer-actions.ts).

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { revalidatePublicPages } from "@/lib/cache";
import type { HeaderActionIcon, HeaderActionPosition, HeaderActionStyle } from "@/types/domain";

export type HeaderActionInput = {
  label?: string;
  url: string;
  icon?: HeaderActionIcon;
  style?: HeaderActionStyle;
  position?: HeaderActionPosition;
  bg_color?: string | null;
  text_color?: string | null;
  is_visible?: boolean;
};

export type HeaderActionPatch = Partial<Omit<HeaderActionInput, "url">> & { url?: string };

export async function createHeaderAction(input: HeaderActionInput) {
  const { supabase } = await requireAdmin();

  // Every column below already exists on header_actions as of the
  // 20260911230000/20260912000000/20260912010000 migrations — a payload
  // referencing a column that hasn't been pushed to the target database
  // yet is exactly what surfaces here as a PostgREST "column ... does
  // not exist" error (visible to the admin via the caller's try/catch,
  // not swallowed into an opaque Server Action digest).
  const { count } = await supabase.from("header_actions").select("*", { count: "exact", head: true });

  const { data, error } = await supabase
    .from("header_actions")
    .insert({
      label: input.label ?? "",
      url: input.url,
      icon: input.icon ?? "none",
      style: input.style ?? "solid",
      position: input.position ?? "right",
      bg_color: input.bg_color ?? null,
      text_color: input.text_color ?? null,
      is_visible: input.is_visible ?? true,
      display_order: count ?? 0,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Couldn't add header action: ${error.message}`);

  revalidatePath("/admin/settings");
  revalidatePublicPages();

  return data;
}

export async function updateHeaderAction(id: string, input: HeaderActionPatch) {
  const { supabase } = await requireAdmin();

  const patch: HeaderActionPatch = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.url !== undefined) patch.url = input.url;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.style !== undefined) patch.style = input.style;
  if (input.position !== undefined) patch.position = input.position;
  if (input.bg_color !== undefined) patch.bg_color = input.bg_color;
  if (input.text_color !== undefined) patch.text_color = input.text_color;
  if (input.is_visible !== undefined) patch.is_visible = input.is_visible;

  const { error } = await supabase.from("header_actions").update(patch).eq("id", id);
  if (error) throw new Error(`Couldn't save header action: ${error.message}`);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function deleteHeaderAction(id: string) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("header_actions").delete().eq("id", id);
  if (error) throw new Error(`Couldn't delete header action: ${error.message}`);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}

export async function reorderHeaderActions(orderedIds: string[]) {
  const { supabase } = await requireAdmin();

  const results = await Promise.all(
    orderedIds.map((id, index) => supabase.from("header_actions").update({ display_order: index }).eq("id", id))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`Couldn't save the new order: ${failed.error.message}`);

  revalidatePath("/admin/settings");
  revalidatePublicPages();
}
