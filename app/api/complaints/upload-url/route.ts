// app/api/complaints/upload-url/route.ts
//
// Public, unauthenticated — a citizen filling out the complaint form
// calls this once per attachment (after client-side compression, see
// components/complaints/ComplaintMediaPicker.tsx) to get a presigned R2
// PUT URL, then uploads the file straight from their browser to R2. No
// file bytes ever pass through this Next.js server — this route only
// ever hands back a URL.
//
// Rate-limited the same honest, single-instance way as submitComplaint
// (see lib/rate-limit.ts) — a separate bucket/key from the submission
// limiter since one complaint can legitimately request several of these
// (up to MAX_IMAGES photos + one video).

import { NextResponse } from "next/server";
import { createComplaintUploadUrl } from "@/lib/r2-complaints";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // safety margin above the client's 0.8MB compression target
const MAX_VIDEO_BYTES = 10 * 1024 * 1024; // matches the fast-track/WebCodecs ceiling — see ComplaintMediaPicker

const ALLOWED_IMAGE_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const RATE_LIMIT_MAX = 30; // ~1 complaint's worth of attachments, several times over
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const DRAFT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9.-]/g, "_").toLowerCase();
}

async function getClientIp(request: Request): Promise<string> {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  const ip = await getClientIp(request);
  if (!checkRateLimit(`complaint-upload:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many upload requests. Please try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { draftId, kind, filename, contentType, size } = (body ?? {}) as Record<string, unknown>;

  if (typeof draftId !== "string" || !DRAFT_ID_RE.test(draftId)) {
    return NextResponse.json({ error: "Invalid draft id." }, { status: 400 });
  }
  if (kind !== "image" && kind !== "video") {
    return NextResponse.json({ error: "Invalid media kind." }, { status: 400 });
  }
  if (typeof filename !== "string" || !filename.trim()) {
    return NextResponse.json({ error: "Invalid filename." }, { status: 400 });
  }
  if (typeof contentType !== "string") {
    return NextResponse.json({ error: "Invalid content type." }, { status: 400 });
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "Invalid file size." }, { status: 400 });
  }

  const allowedTypes = kind === "video" ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
  if (!allowedTypes.has(contentType)) {
    return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
  }

  const maxBytes = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > maxBytes) {
    return NextResponse.json(
      { error: `File is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).` },
      { status: 400 }
    );
  }

  const key = `r2-media/${draftId}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;

  try {
    const uploadUrl = await createComplaintUploadUrl(key, contentType, size);
    return NextResponse.json({ key, uploadUrl });
  } catch (err) {
    console.error("[api/complaints/upload-url] presign failed:", err);
    return NextResponse.json({ error: "Could not prepare upload. Please try again." }, { status: 502 });
  }
}
