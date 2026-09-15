// lib/complaint-storage-delete.ts
//
// Routes complaint attachment deletes to whichever backend actually
// stored them. A complaint_media.storage_path from before this R2
// migration is a Supabase Storage path; one from after is an R2 key —
// same `${id}/${filename}` shape, told apart by the `r2-media/` prefix
// every R2 key carries (see lib/r2-complaints.ts). Mirrors
// lib/storage-delete.ts's same prefix-detection approach for admin
// media, applied here to the complaints portal's own (separate,
// private) R2 bucket instead.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { COMPLAINT_BUCKET } from "@/types/domain";
import { deleteComplaintObjects, R2_COMPLAINT_KEY_PREFIX } from "@/lib/r2-complaints";

export async function deleteComplaintMediaBatch(
  supabase: SupabaseClient<Database>,
  storagePaths: string[]
): Promise<void> {
  if (storagePaths.length === 0) return;

  const r2Keys = storagePaths.filter((p) => p.startsWith(R2_COMPLAINT_KEY_PREFIX));
  const legacySupabasePaths = storagePaths.filter((p) => !p.startsWith(R2_COMPLAINT_KEY_PREFIX));

  await Promise.all([
    r2Keys.length > 0
      ? deleteComplaintObjects(r2Keys).catch((err) =>
          console.error("[complaint-storage-delete] R2 batch delete failed:", err)
        )
      : Promise.resolve(),
    legacySupabasePaths.length > 0
      ? supabase.storage
          .from(COMPLAINT_BUCKET)
          .remove(legacySupabasePaths)
          .then(({ error }) => {
            if (error) console.error("[complaint-storage-delete] Supabase Storage delete failed:", error.message);
          })
      : Promise.resolve(),
  ]);
}
