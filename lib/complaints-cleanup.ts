// lib/complaints-cleanup.ts
//
// Permanently deletes any complaint past its expiration timestamp — row,
// attached media rows, and the actual files in storage. There is no
// "expired" state to view afterward; once a complaint's time is up, it is
// gone. Uses the service-role client since this runs both from an
// authenticated admin page load and from the unauthenticated cron route
// (app/api/cron/purge-complaints/route.ts).

import { createServiceClient } from "@/utils/supabase/admin";
import { deleteComplaintMediaBatch } from "@/lib/complaint-storage-delete";

export async function purgeExpiredComplaints(): Promise<{ deleted: number }> {
  const supabase = createServiceClient();

  const { data: expired } = await supabase
    .from("complaints")
    .select("id, complaint_media(storage_path)")
    .lte("expires_at", new Date().toISOString());

  if (!expired || expired.length === 0) return { deleted: 0 };

  const paths = expired.flatMap((c) => c.complaint_media.map((m) => m.storage_path));
  await deleteComplaintMediaBatch(supabase, paths);

  const ids = expired.map((c) => c.id);
  await supabase.from("complaints").delete().in("id", ids);

  return { deleted: ids.length };
}
