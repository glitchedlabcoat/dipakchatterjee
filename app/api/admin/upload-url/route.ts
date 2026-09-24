// app/api/admin/upload-url/route.ts
//
// Preferred admin upload path: hands the browser a short-lived presigned
// R2 PUT URL so the file goes straight from the admin's browser to R2.
// No file bytes pass through this Render instance — the old
// server-proxied route (app/api/admin/upload/route.ts) re-sent every
// byte to R2, which counted against Render's "Service-Initiated"
// bandwidth. Same auth and validation as that route (see
// lib/admin-upload-policy.ts); lib/media-upload-client.ts falls back to
// it only if the direct PUT fails.

import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createR2UploadUrl, r2PublicUrl, R2_UPLOAD_CACHE_CONTROL } from "@/lib/r2";
import { validateAdminUpload } from "@/lib/admin-upload-policy";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  const validated = validateAdminUpload({
    folder: body.folder,
    path: body.path,
    contentType: body.contentType,
    size: body.size,
  });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const uploadUrl = await createR2UploadUrl(validated.key, validated.contentType, validated.size);
    return NextResponse.json({
      key: validated.key,
      url: r2PublicUrl(validated.key),
      uploadUrl,
      // The browser must send this exact header: it's part of the signature.
      cacheControl: R2_UPLOAD_CACHE_CONTROL,
    });
  } catch (err) {
    console.error("[api/admin/upload-url] presign failed:", err);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 502 });
  }
}
