// app/admin/(protected)/complaints/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { deleteComplaintMediaBatch } from "@/lib/complaint-storage-delete";

export async function deleteComplaint(id: string) {
  const { supabase } = await requireAdmin();

  const { data: media } = await supabase
    .from("complaint_media")
    .select("storage_path")
    .eq("complaint_id", id);

  if (media && media.length > 0) {
    await deleteComplaintMediaBatch(supabase, media.map((m) => m.storage_path));
  }

  // complaint_media rows cascade automatically (FK ON DELETE CASCADE).
  const { error } = await supabase.from("complaints").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/complaints");
}

export type ComplaintResolutionStatus = "unresolved" | "resolved";

export async function updateComplaintStatus(id: string, status: ComplaintResolutionStatus) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("complaints").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/complaints");
}

export async function updateComplaintExpirationDays(days: number) {
  const { supabase } = await requireAdmin();

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("Expiration must be a whole number of days between 1 and 365.");
  }

  const { error } = await supabase
    .from("site_settings")
    .update({ complaint_expiration_days: days, updated_at: new Date().toISOString() })
    .eq("id", "default");

  if (error) throw new Error(error.message);

  revalidatePath("/admin/complaints");
}
