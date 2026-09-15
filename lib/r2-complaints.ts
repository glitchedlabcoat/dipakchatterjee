// lib/r2-complaints.ts
//
// A SEPARATE Cloudflare R2 bucket from lib/r2.ts's admin-media bucket,
// and deliberately never given a public custom domain / r2.dev URL.
// Complaint attachments are private citizen submissions (see the
// complaints migration's "Private bucket" comment) — the admin-media
// bucket (R2_BUCKET_NAME) already has R2_PUBLIC_DOMAIN pointed at it,
// and Cloudflare's public-access toggle is bucket-wide, not
// per-object. Reusing that bucket for complaint media would make every
// citizen's photos fetchable by anyone who obtains (or guesses) the
// object key, with no signature required — the same "public policy
// exposes the whole row" mistake this codebase already avoided once for
// Meta's App Secret (see integration_settings). So this bucket is
// reached exclusively through short-lived presigned S3 URLs: a PUT URL
// for the citizen's browser to upload directly to (see
// app/api/complaints/upload-url/route.ts), and a GET URL for the admin
// dashboard to view attachments with (mirroring the Supabase
// createSignedUrl pattern it replaces).
//
// Requires its own R2_COMPLAINT_BUCKET_NAME env var (see .env.example)
// — create a second R2 bucket in the Cloudflare dashboard and leave its
// public access / custom domain OFF. Reuses the same account-level
// R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY as lib/r2.ts.
//
// SERVER-ONLY — never import from a "use client" file.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_COMPLAINT_BUCKET_NAME = process.env.R2_COMPLAINT_BUCKET_NAME;

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// Every key this app writes for a complaint attachment carries this
// prefix — used by lib/complaint-storage-delete.ts to tell a
// post-migration R2 key apart from a pre-migration Supabase Storage
// path (same `${id}/${filename}` shape otherwise) without a schema
// change, the same way lib/storage-delete.ts's R2_FOLDER_PREFIXES does
// for admin media.
export const R2_COMPLAINT_KEY_PREFIX = "r2-media/";

export const COMPLAINT_UPLOAD_URL_TTL_SECONDS = 5 * 60; // plenty for one direct browser PUT
export const COMPLAINT_VIEW_URL_TTL_SECONDS = 60 * 60; // matches the Supabase signed URL TTL it replaces

function requireBucket(): string {
  if (!R2_COMPLAINT_BUCKET_NAME) {
    throw new Error(
      "R2_COMPLAINT_BUCKET_NAME is not configured. Create a second, private R2 bucket in the Cloudflare dashboard (no public access / custom domain) and set R2_COMPLAINT_BUCKET_NAME in .env.local."
    );
  }
  return R2_COMPLAINT_BUCKET_NAME;
}

/**
 * A presigned PUT URL good for one upload of exactly `contentLength`
 * bytes of `contentType` — R2 rejects the PUT if the browser's actual
 * request doesn't match the signed Content-Length/Content-Type, so this
 * doubles as the enforcement point for the size caps validated in
 * app/api/complaints/upload-url/route.ts before this is called.
 */
export async function createComplaintUploadUrl(
  key: string,
  contentType: string,
  contentLength: number
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: requireBucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(r2Client, command, { expiresIn: COMPLAINT_UPLOAD_URL_TTL_SECONDS });
}

/** Short-lived GET URL for the admin dashboard — never a public/static URL. */
export async function createComplaintViewUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: requireBucket(), Key: key });
  return getSignedUrl(r2Client, command, { expiresIn: COMPLAINT_VIEW_URL_TTL_SECONDS });
}

/**
 * Confirms an object a citizen claims to have uploaded really exists
 * (i.e. the presigned PUT actually succeeded) before a complaint row is
 * ever created referencing it — see submitComplaint in
 * app/(site)/complaints/actions.ts. Returns null if it doesn't exist
 * (or on any error), never throws.
 */
export async function headComplaintObject(
  key: string
): Promise<{ size: number; contentType: string | undefined } | null> {
  try {
    const result = await r2Client.send(new HeadObjectCommand({ Bucket: requireBucket(), Key: key }));
    return { size: result.ContentLength ?? 0, contentType: result.ContentType };
  } catch {
    return null;
  }
}

/** Batch delete (R2/S3 caps a single DeleteObjects call at 1000 keys). */
export async function deleteComplaintObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const bucket = requireBucket();

  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await r2Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      })
    );
  }
}
