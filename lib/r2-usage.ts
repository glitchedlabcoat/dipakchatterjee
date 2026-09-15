// lib/r2-usage.ts
//
// Real, S3-API-derived usage stats for the Usage Metrics dashboard
// (/admin/usage) — total stored bytes and object count for both R2
// buckets this app uses (admin media: lib/r2.ts, complaint
// attachments: lib/r2-complaints.ts), computed via a paginated
// ListObjectsV2. Deliberately not a Cloudflare-specific API call: this
// works with just the S3-compatible credentials already configured, no
// extra Cloudflare API token needed — see lib/cloudflare-analytics.ts
// for the one thing that DOES need one (live Class A/B operation
// counts, which ListObjectsV2 can't tell you).
//
// Cached for an hour: a full bucket listing on every dashboard load
// would be wasteful egress/compute for a number that only actually
// changes on an upload or delete, far less often than an admin is
// likely to check this page.

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { unstable_cache } from "next/cache";

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

export type BucketStats = { bytes: number; objectCount: number };

async function statBucket(bucket: string): Promise<BucketStats> {
  let bytes = 0;
  let objectCount = 0;
  let continuationToken: string | undefined;

  do {
    const result = await r2Client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken })
    );
    for (const obj of result.Contents ?? []) {
      bytes += obj.Size ?? 0;
      objectCount += 1;
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return { bytes, objectCount };
}

export type R2UsageStats = {
  media: BucketStats;
  // null if R2_COMPLAINT_BUCKET_NAME isn't configured yet (see
  // .env.example) — the complaints R2 migration is opt-in until then.
  complaints: BucketStats | null;
};

async function fetchR2UsageStats(): Promise<R2UsageStats> {
  const mediaBucket = process.env.R2_BUCKET_NAME;
  const complaintBucket = process.env.R2_COMPLAINT_BUCKET_NAME;

  const [media, complaints] = await Promise.all([
    mediaBucket ? statBucket(mediaBucket) : Promise.resolve({ bytes: 0, objectCount: 0 }),
    complaintBucket ? statBucket(complaintBucket) : Promise.resolve(null),
  ]);

  return { media, complaints };
}

export const getR2UsageStats = unstable_cache(fetchR2UsageStats, ["r2-usage-stats"], {
  revalidate: 3600,
});

// --- Free tier / pricing reference figures ---------------------------
// Cloudflare's published R2 free tier and pricing as of writing — verify
// at https://developers.cloudflare.com/r2/pricing/ before treating as
// billing-accurate; Cloudflare can change these at any time and this
// app has no way to detect that automatically.
export const R2_FREE_TIER = {
  storageGB: 10,
  classAOpsPerMonth: 1_000_000,
  classBOpsPerMonth: 10_000_000,
};

export const R2_PRICING = {
  storagePerGBMonth: 0.015,
  classAOpsPerMillion: 4.5,
  classBOpsPerMillion: 0.36,
};

// Supabase's published free-plan database egress as of writing — verify
// at https://supabase.com/pricing before treating as billing-accurate.
export const SUPABASE_FREE_EGRESS_GB = 5;
