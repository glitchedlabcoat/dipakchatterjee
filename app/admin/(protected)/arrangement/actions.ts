// app/admin/(protected)/arrangement/actions.ts
//
// Saving a new order is the one action that's specific to this page —
// visibility toggles reuse the same actions the old Settings -> Homepage
// Sections tab used (updateHomepageSectionVisibility, toggleFeaturePublished)
// since the underlying data (site_settings booleans / features.is_published)
// hasn't changed, only where the UI to edit it lives.

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { logDashboardActivity } from "@/lib/activity-log";
import { revalidatePublicPages } from "@/lib/cache";

export async function updateArrangementOrder(orderedKeys: string[]) {
  const { supabase, user } = await requireAdmin();

  const { error } = await supabase
    .from("site_settings")
    .update({ homepage_layout: orderedKeys, updated_at: new Date().toISOString() })
    .eq("id", "default");

  if (error) throw new Error(error.message);

  await logDashboardActivity(supabase, user, {
    action: "UPDATE_ARRANGEMENT",
    entityType: "settings",
    details: "Reordered homepage sections",
  });

  revalidatePath("/admin/arrangement");
  revalidatePublicPages();
}
