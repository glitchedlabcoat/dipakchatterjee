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
import { ALLOWED_FOLDERS, validateAdminUpload } from "@/lib/admin-upload-policy";

// FALLBACK PATH ONLY for POST. Uploads normally go browser -> R2 directly
// via a presigned URL (app/api/admin/upload-url/route.ts); this route
// re-sends every byte from Render to R2, which counts against Render's
// "Service-Initiated" bandwidth, so lib/media-upload-client.ts only uses
// it when the direct PUT fails (e.g. bucket CORS not configured).
//
// request.formData() fully buffers the upload in memory before this
// handler ever sees it, then Buffer.from(await file.arrayBuffer())
// copies it again — so a single request transiently holds ~2x the file
// size in RSS. That's why lib/admin-upload-policy.ts caps video at 25MB
// on the 512MB Render instance.

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

  const validated = validateAdminUpload({ folder, path: relativePath, contentType: file.type, size: file.size });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { key } = validated;

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
