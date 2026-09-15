// lib/storage-delete.ts
//
// Every admin action that deletes/replaces a media row also cleans up
// its underlying file — previously always a Supabase Storage `.remove()`
// call. Now that new uploads go to R2 (see app/api/admin/upload/route.ts),
// a stored `storage_path` can point at either backend depending on when
// it was written: this routes the delete to whichever one actually
// holds it, so neither legacy Supabase-hosted files nor new R2-hosted
// ones get silently orphaned.
//
// Distinguishing the two needs no new column: every R2 upload's key is
// written as `${folder}/...` using one of the folder names below (see
// the upload route), while every pre-R2 Supabase Storage path was
// always just `${entityId}/${file}` — no legacy path in this codebase
// was ever written with one of these prefixes, since Supabase Storage
// kept each feature in its own bucket rather than a shared folder
// namespace the way the single R2 bucket does.
//
// Storage cleanup failures are swallowed (logged, not thrown) here,
// matching how every existing call site already treated Supabase
// Storage `.remove()` errors: the row's already been deleted from
// Postgres by the time this runs, so a failed file cleanup is a
// (recoverable, low-cost) storage leak — not a reason to surface an
// error for a mutation that otherwise succeeded.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { deleteFromR2 } from "@/lib/r2";

const R2_FOLDER_PREFIXES = ["site-media/", "post-media/", "feature-media/", "phase-media/"];

function isR2Key(path: string): boolean {
  return R2_FOLDER_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function removeR2Key(key: string) {
  try {
    await deleteFromR2(key);
  } catch (err) {
    console.error(`[storage-delete] Failed to delete R2 object "${key}":`, err);
  }
}

async function removeSupabasePaths(supabase: SupabaseClient<Database>, bucket: string, paths: string[]) {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) {
    console.error(`[storage-delete] Failed to delete Supabase Storage object(s) from "${bucket}":`, error.message);
  }
}

/** Deletes one stored media file, wherever it actually lives. */
export async function deleteStoredMedia(supabase: SupabaseClient<Database>, bucket: string, path: string): Promise<void> {
  if (isR2Key(path)) {
    await removeR2Key(path);
    return;
  }
  await removeSupabasePaths(supabase, bucket, [path]);
}

/** Same as deleteStoredMedia, for an entity's full set of media files at once (e.g. deleting a whole post). */
export async function deleteStoredMediaBatch(
  supabase: SupabaseClient<Database>,
  bucket: string,
  paths: string[]
): Promise<void> {
  const r2Keys = paths.filter(isR2Key);
  const supabasePaths = paths.filter((p) => !isR2Key(p));

  await Promise.all([...r2Keys.map(removeR2Key), removeSupabasePaths(supabase, bucket, supabasePaths)]);
}
