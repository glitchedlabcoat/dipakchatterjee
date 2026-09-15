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

const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN!;

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
      // Long-lived + immutable: every key this app writes embeds a fresh
      // crypto.randomUUID() (see app/api/admin/upload/route.ts), so a
      // given key's content never changes after it's written — safe to
      // cache for a year at any CDN/proxy in front of R2_PUBLIC_DOMAIN.
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return r2PublicUrl(key);
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
}
