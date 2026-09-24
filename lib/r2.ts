// lib/r2.ts
//
// Cloudflare R2 client — this app's primary object storage for media
// (images/video) going forward, alongside Supabase for Postgres. R2 is
// S3-compatible, so this is a plain @aws-sdk/client-s3 client pointed at
// R2's endpoint, not a Cloudflare-specific SDK.
//
// SERVER-ONLY. R2_SECRET_ACCESS_KEY must never reach client code — every
// caller here runs from a Route Handler or Server Action, never a
// "use client" file. See app/api/admin/upload/route.ts for the one
// place the browser can reach this indirectly (an authenticated upload/
// delete proxy), and lib/media-upload-client.ts for the client-side
// fetch wrapper that calls it.

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN!;

// Long-lived + immutable: every key this app writes embeds a fresh
// crypto.randomUUID() (see lib/media-upload-client.ts's callers), so a
// given key's content never changes after it's written — safe to cache
// for a year at any CDN/proxy in front of R2_PUBLIC_DOMAIN.
export const R2_UPLOAD_CACHE_CONTROL = "public, max-age=31536000, immutable";

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export function r2PublicUrl(key: string): string {
  return `https://${R2_PUBLIC_DOMAIN}/${key}`;
}

// True for any URL this app itself generated via uploadToR2 above —
// used by lib/storage-delete.ts's key-shape check isn't enough on its
// own everywhere a full URL (rather than just a key) is at hand, e.g.
// when a caller only has `public_url` and not the original key.
export function isR2Url(url: string): boolean {
  try {
    return new URL(url).host === R2_PUBLIC_DOMAIN;
  } catch {
    return false;
  }
}

export async function uploadToR2(fileBuffer: Buffer, key: string, contentType: string): Promise<string> {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
      CacheControl: R2_UPLOAD_CACHE_CONTROL,
    })
  );

  return r2PublicUrl(key);
}

// Uploads longer than this would need a fresh URL anyway; an admin's
// browser starts the PUT immediately after receiving it.
const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * Presigned PUT so the admin's browser uploads straight to R2 and no
 * file bytes pass through (or count against) this Render instance. R2
 * rejects the PUT unless its Content-Type/Content-Length match what was
 * signed here, so the size caps validated before calling this are
 * enforced by R2 itself. Same immutable Cache-Control as uploadToR2 —
 * the browser must send the identical header, since it's signed too.
 */
export async function createR2UploadUrl(key: string, contentType: string, contentLength: number): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    CacheControl: R2_UPLOAD_CACHE_CONTROL,
  });
  return getSignedUrl(r2Client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
}
