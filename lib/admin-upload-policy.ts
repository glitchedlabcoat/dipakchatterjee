// lib/admin-upload-policy.ts
//
// Validation shared by both admin upload paths — the presigned
// direct-to-R2 route (app/api/admin/upload-url/route.ts, preferred) and
// the legacy server-proxied route (app/api/admin/upload/route.ts, kept
// as a fallback for when the direct browser PUT fails, e.g. the admin
// bucket's CORS policy doesn't allow this site's origin yet). Keeping it
// in one place means the two paths can never drift on what's allowed.

// Server-proxied uploads buffer the whole file in memory (see the legacy
// route's comment), which is what capped video at 25MB on the 512MB
// Render instance. The direct path never touches server memory, but it
// keeps the same caps so both paths accept exactly the same files.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

// One folder per media feature, mirroring the Supabase Storage buckets
// they replace (SITE_BUCKET, POST_BUCKET, FEATURE_BUCKET, PHASE_BUCKET
// — see types/domain.ts) — R2 has a single bucket for the whole app, so
// these keep each feature's objects in their own namespace within it.
// Deliberately excludes complaint-media: citizen complaint uploads use
// their own private bucket and presign route (lib/r2-complaints.ts).
export const ALLOWED_FOLDERS = new Set(["site-media", "post-media", "feature-media", "phase-media"]);

function sanitizeKeySegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9.-]/g, "_");
}

// Sanitizes a client-supplied relative path per path segment (rather
// than rejecting slashes outright, since callers legitimately pass
// `${entityId}/${filename}`), and drops any segment that could escape
// the folder namespace (`.`, `..`, or anything that sanitizes to empty).
export function sanitizeKeyPath(path: string): string {
  return path
    .split("/")
    .map(sanitizeKeySegment)
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

type UploadRequest = { folder: unknown; path: unknown; contentType: unknown; size: unknown };

// Returns the validated R2 key, or a user-facing error message.
export function validateAdminUpload({ folder, path, contentType, size }: UploadRequest):
  | { ok: true; key: string; contentType: string; size: number }
  | { ok: false; error: string } {
  if (typeof folder !== "string" || !ALLOWED_FOLDERS.has(folder)) {
    return { ok: false, error: "Invalid upload folder." };
  }
  if (typeof path !== "string" || !path.trim()) {
    return { ok: false, error: "Invalid upload path." };
  }
  if (typeof contentType !== "string") {
    return { ok: false, error: "Only image and video files are supported." };
  }
  const isImage = contentType.startsWith("image/");
  const isVideo = contentType.startsWith("video/");
  if (!isImage && !isVideo) {
    return { ok: false, error: "Only image and video files are supported." };
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "Invalid file size." };
  }

  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > maxBytes) {
    return { ok: false, error: `File is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).` };
  }

  const sanitizedPath = sanitizeKeyPath(path);
  if (!sanitizedPath) {
    return { ok: false, error: "Invalid upload path." };
  }
  return { ok: true, key: `${folder}/${sanitizedPath}`, contentType, size };
}
