// app/api/admin/upload/route.ts
//
// The only place the browser reaches Cloudflare R2: uploading (and,
// via DELETE, rolling back a just-uploaded-but-never-saved file) both
// need R2's secret access key, which must never ship to client code
// (see lib/r2.ts). Every admin media component (MediaManager,
// SiteImageUploader, PostThumbnailUploader, OrganizationsManager,
// PhasePhotosManager) now calls this through
// lib/media-upload-client.ts instead of uploading straight to Supabase
// Storage from the browser the way they used to.
//
// Deleting an already-saved media row (as opposed to rolling back a
// failed save right after upload) doesn't come through here — those
// Server Actions already run server-side, so they call
// lib/storage-delete.ts directly instead of round-tripping through
// this route.

import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { uploadToR2, deleteFromR2 } from "@/lib/r2";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

// One folder per media feature, mirroring the Supabase Storage buckets
// they replace (SITE_BUCKET, POST_BUCKET, FEATURE_BUCKET, PHASE_BUCKET
// — see types/domain.ts) — R2 has a single bucket for the whole app, so
// these keep each feature's objects in their own namespace within it.
// Deliberately excludes complaint-media: citizen complaint uploads stay
// on Supabase Storage (a distinct, anonymous-submission flow with its
// own service-role-only code path — see utils/supabase/admin.ts), not
// part of this admin-only endpoint.
const ALLOWED_FOLDERS = new Set(["site-media", "post-media", "feature-media", "phase-media"]);

function sanitizeKeySegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9.-]/g, "_");
}

// Sanitizes a client-supplied relative path per path segment (rather
// than rejecting slashes outright, since callers legitimately pass
// `${entityId}/${filename}`), and drops any segment that could escape
// the folder namespace (`.`, `..`, or anything that sanitizes to empty).
function sanitizeKeyPath(path: string): string {
  return path
    .split("/")
    .map(sanitizeKeySegment)
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  const file = formData.get("file");
  const folder = formData.get("folder");
  const relativePath = formData.get("path");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (typeof folder !== "string" || !ALLOWED_FOLDERS.has(folder)) {
    return NextResponse.json({ error: "Invalid upload folder." }, { status: 400 });
  }
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    return NextResponse.json({ error: "Invalid upload path." }, { status: 400 });
  }

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) {
    return NextResponse.json({ error: "Only image and video files are supported." }, { status: 400 });
  }

  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return NextResponse.json(
      { error: `File is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).` },
      { status: 400 }
    );
  }

  const sanitizedPath = sanitizeKeyPath(relativePath);
  if (!sanitizedPath) {
    return NextResponse.json({ error: "Invalid upload path." }, { status: 400 });
  }
  const key = `${folder}/${sanitizedPath}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(buffer, key, file.type);
    return NextResponse.json({ key, url });
  } catch (err) {
    console.error("[api/admin/upload] R2 upload failed:", err);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 502 });
  }
}

// Rollback for a successful R2 upload whose follow-up database save
// then failed — the same case every upload component already handled
// for Supabase Storage, just now needing a server round-trip since the
// browser can't call deleteFromR2 directly.
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key." }, { status: 400 });
  }
  // Defense in depth: even though this endpoint is admin-only, only ever
  // allow deleting something this same endpoint could have written —
  // never an arbitrary key elsewhere in the bucket.
  const folder = key.split("/")[0];
  if (!ALLOWED_FOLDERS.has(folder)) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }

  try {
    await deleteFromR2(key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/upload] R2 delete failed:", err);
    return NextResponse.json({ error: "Delete failed." }, { status: 502 });
  }
}
