// lib/media-upload-client.ts
//
// Browser-side counterpart to app/api/admin/upload-url/route.ts (and
// its fallback, app/api/admin/upload/route.ts) — every admin media
// component calls this instead of uploading straight to Supabase
// Storage the way they used to, since R2 uploads need the secret access
// key those routes hold server-side (see lib/r2.ts).
//
// `folder` mirrors the old Supabase Storage bucket name (see
// types/domain.ts's *_BUCKET constants and the route's ALLOWED_FOLDERS),
// and `path` is the same relative path shape every caller already
// built for itself (typically `${entityId}/${crypto.randomUUID()}-${filename}`)
// — this only changes *where* that path is uploaded to, not how
// callers construct it.

export type MediaUploadResult = { path: string; public_url: string };

// Direct browser -> R2 upload via a presigned URL first, so no file
// bytes pass through Render (whose outbound "Service-Initiated"
// bandwidth the old proxy-only path was burning). Falls back to the
// server-proxied route if the direct PUT itself fails — most likely the
// admin bucket's CORS policy doesn't allow this origin/header yet — so
// uploads keep working either way. Validation errors from the presign
// route (bad type, too large, not signed in) are thrown as-is: the
// proxy route would reject the same file for the same reason.
export async function uploadMediaFile(file: File, folder: string, path: string): Promise<MediaUploadResult> {
  const presignRes = await fetch("/api/admin/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder, path, contentType: file.type, size: file.size }),
  });
  const presign = await presignRes.json().catch(() => ({}));

  if (presignRes.ok) {
    try {
      const putRes = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, "Cache-Control": presign.cacheControl },
        body: file,
      });
      if (putRes.ok) {
        return { path: presign.key, public_url: presign.url };
      }
    } catch {
      // Network/CORS failure — fall through to the proxied upload.
    }
  } else if (presignRes.status === 400 || presignRes.status === 401) {
    throw new Error(presign.error || "Upload failed.");
  }

  return uploadViaServer(file, folder, path);
}

async function uploadViaServer(file: File, folder: string, path: string): Promise<MediaUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", folder);
  formData.append("path", path);

  const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body.error || "Upload failed.");
  }

  return { path: body.key, public_url: body.url };
}

// Best-effort rollback for a file that uploaded successfully but whose
// follow-up database save then failed — mirrors every existing call
// site's own best-effort `supabase.storage.from(bucket).remove([path])`
// cleanup, just routed through the API (the browser can't delete from
// R2 directly). Never throws: a failed cleanup here is a minor storage
// leak, not something that should surface over the save error that's
// already being shown.
export async function deleteUploadedMediaFile(path: string): Promise<void> {
  try {
    await fetch(`/api/admin/upload?key=${encodeURIComponent(path)}`, { method: "DELETE" });
  } catch {
    // Best-effort — see comment above.
  }
}
