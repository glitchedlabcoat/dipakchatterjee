#!/usr/bin/env node
// scripts/migrate-supabase-to-r2.ts
//
// One-off: copies every file in this app's Supabase Storage buckets to
// Cloudflare R2 (same relative path, under an R2 folder matching the
// bucket name — see app/api/admin/upload/route.ts's ALLOWED_FOLDERS),
// then rewrites every stored Supabase Storage URL in Postgres to point
// at R2 instead. Self-contained, mirroring scripts/purge-content.mjs:
// reads .env.local directly rather than importing lib/r2.ts or
// utils/supabase/admin.ts, since this runs standalone via `npx tsx`,
// outside Next's module resolution/bundling — only *type-only* imports
// from the app (see the Database import below) are used, which compile
// away entirely and so can't affect how this actually runs.
//
// Does NOT delete anything from Supabase Storage — verify the site
// renders correctly from R2 first, then clean up the old buckets by
// hand (e.g. adapting purge-content.mjs's emptyBucket(), or via the
// Supabase dashboard) whenever you're ready.
//
// Usage:
//   npx tsx scripts/migrate-supabase-to-r2.ts            # do the migration
//   npx tsx scripts/migrate-supabase-to-r2.ts --dry-run   # list what would happen, change nothing

import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Database } from "../types/database.types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");

// .env.local was authored/saved on Windows (CRLF line endings) at some
// point, so a naive split("\n") leaves a trailing "\r" on every value —
// and some editors also wrap values in quotes. Either one, baked into
// R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY, corrupts the SigV4
// Authorization header @aws-sdk/client-s3 builds from them (Node's fetch
// then rejects it outright: `Invalid character in header content
// ["authorization"]`). Strip both defensively from every value.
const sanitize = (val?: string) => val?.trim().replace(/^["']|["']$/g, "").replace(/[\r\n]/g, "") || "";

const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), sanitize(line.slice(i + 1))];
    })
) as Record<string, string>;

const DRY_RUN = process.argv.includes("--dry-run");

const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_DOMAIN",
] as const;

const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !env[key]);
if (missingKeys.length > 0) {
  console.error(`Missing required .env.local value(s): ${missingKeys.join(", ")}`);
  process.exit(1);
}

const supabase = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

// Every bucket name below doubles as its R2 folder — see
// app/api/admin/upload/route.ts's ALLOWED_FOLDERS. complaint-media is
// deliberately excluded: citizen complaint uploads stay on Supabase
// Storage (a separate, anonymous-submission flow — see
// utils/supabase/admin.ts), not part of this admin-media migration.
const BUCKETS = ["site-media", "post-media", "feature-media", "phase-media"] as const;

const SUPABASE_STORAGE_PREFIX = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;
const R2_PUBLIC_BASE = `https://${env.R2_PUBLIC_DOMAIN}/`;

type FileMetrics = { transferred: number; failed: number };

/** Same one-level-of-subfolders traversal as purge-content.mjs's emptyBucket() — every file in these buckets lives at `<entityId-or-kind>/<file>`. */
async function listAllFiles(bucket: string): Promise<string[]> {
  const paths: string[] = [];
  const { data: topLevel, error } = await supabase.storage.from(bucket).list("", { limit: 1000 });
  if (error) throw error;

  for (const entry of topLevel ?? []) {
    const { data: children } = await supabase.storage.from(bucket).list(entry.name, { limit: 1000 });
    if (children && children.length > 0) {
      for (const child of children) paths.push(`${entry.name}/${child.name}`);
    } else {
      paths.push(entry.name);
    }
  }
  return paths;
}

async function migrateBucket(bucket: (typeof BUCKETS)[number]): Promise<FileMetrics> {
  const metrics: FileMetrics = { transferred: 0, failed: 0 };
  console.log(`\n[${bucket}] Listing files...`);
  const files = await listAllFiles(bucket);
  console.log(`[${bucket}] Found ${files.length} file(s).`);

  for (const filePath of files) {
    const key = `${bucket}/${filePath}`;

    if (DRY_RUN) {
      console.log(`  [dry-run] would copy ${bucket}/${filePath} -> ${key}`);
      metrics.transferred += 1;
      continue;
    }

    try {
      const { data: blob, error: downloadError } = await supabase.storage.from(bucket).download(filePath);
      if (downloadError || !blob) {
        console.error(`  x ${filePath}: download failed - ${downloadError?.message ?? "no data returned"}`);
        metrics.failed += 1;
        continue;
      }

      const buffer = Buffer.from(await blob.arrayBuffer());

      await r2.send(
        new PutObjectCommand({
          Bucket: env.R2_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: blob.type || "application/octet-stream",
          CacheControl: "public, max-age=31536000, immutable",
        })
      );

      console.log(`  ok ${filePath} -> ${key}`);
      metrics.transferred += 1;
    } catch (err) {
      console.error(`  x ${filePath}:`, err instanceof Error ? err.message : err);
      metrics.failed += 1;
    }
  }

  return metrics;
}

/** `https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>` -> `https://<R2_PUBLIC_DOMAIN>/<bucket>/<path>`, or the input unchanged if it isn't a Supabase Storage URL from one of BUCKETS. */
function rewriteUrl(url: string | null): string | null {
  if (!url || !url.startsWith(SUPABASE_STORAGE_PREFIX)) return url;

  const rest = url.slice(SUPABASE_STORAGE_PREFIX.length); // "<bucket>/<path>"
  const slashIndex = rest.indexOf("/");
  if (slashIndex === -1) return url;

  const bucket = rest.slice(0, slashIndex);
  const filePath = rest.slice(slashIndex + 1);
  if (!(BUCKETS as readonly string[]).includes(bucket)) return url; // e.g. complaint-media — left as-is

  return `${R2_PUBLIC_BASE}${bucket}/${filePath}`;
}

async function applyUpdate(
  label: string,
  run: () => PromiseLike<{ error: { message: string } | null }>
): Promise<boolean> {
  if (DRY_RUN) {
    console.log(`  [dry-run] would update ${label}`);
    return true;
  }
  const { error } = await run();
  if (error) {
    console.error(`  x ${label}:`, error.message);
    return false;
  }
  return true;
}

async function migrateSiteSettingsUrls(): Promise<number> {
  const { data, error } = await supabase.from("site_settings").select("id, hero_image_url, avatar_url").eq("id", "default").single();
  if (error) throw error;
  if (!data) return 0;

  const nextHero = rewriteUrl(data.hero_image_url);
  const nextAvatar = rewriteUrl(data.avatar_url);
  if (nextHero === data.hero_image_url && nextAvatar === data.avatar_url) return 0;

  const ok = await applyUpdate("site_settings (hero_image_url/avatar_url)", () =>
    supabase.from("site_settings").update({ hero_image_url: nextHero, avatar_url: nextAvatar }).eq("id", "default")
  );
  return ok ? 1 : 0;
}

async function migratePostThumbnails(): Promise<number> {
  const { data, error } = await supabase.from("posts").select("id, thumbnail_url");
  if (error) throw error;

  let updated = 0;
  for (const row of data ?? []) {
    const next = rewriteUrl(row.thumbnail_url);
    if (next === row.thumbnail_url) continue;
    const ok = await applyUpdate(`posts.thumbnail_url (id=${row.id})`, () =>
      supabase.from("posts").update({ thumbnail_url: next }).eq("id", row.id)
    );
    if (ok) updated += 1;
  }
  return updated;
}

async function migratePostMedia(): Promise<number> {
  const { data, error } = await supabase.from("post_media").select("id, public_url");
  if (error) throw error;

  let updated = 0;
  for (const row of data ?? []) {
    const next = rewriteUrl(row.public_url);
    if (next === row.public_url || next === null) continue;
    const ok = await applyUpdate(`post_media.public_url (id=${row.id})`, () =>
      supabase.from("post_media").update({ public_url: next }).eq("id", row.id)
    );
    if (ok) updated += 1;
  }
  return updated;
}

async function migrateFeatureMedia(): Promise<number> {
  const { data, error } = await supabase.from("feature_media").select("id, public_url");
  if (error) throw error;

  let updated = 0;
  for (const row of data ?? []) {
    const next = rewriteUrl(row.public_url);
    if (next === row.public_url || next === null) continue;
    const ok = await applyUpdate(`feature_media.public_url (id=${row.id})`, () =>
      supabase.from("feature_media").update({ public_url: next }).eq("id", row.id)
    );
    if (ok) updated += 1;
  }
  return updated;
}

async function migrateOrganizationLogos(): Promise<number> {
  const { data, error } = await supabase.from("organizations").select("id, logo_url");
  if (error) throw error;

  let updated = 0;
  for (const row of data ?? []) {
    const next = rewriteUrl(row.logo_url);
    if (next === row.logo_url || next === null) continue;
    const ok = await applyUpdate(`organizations.logo_url (id=${row.id})`, () =>
      supabase.from("organizations").update({ logo_url: next }).eq("id", row.id)
    );
    if (ok) updated += 1;
  }
  return updated;
}

type PhasePhotoRecord = { url: string; path: string; caption?: string; fact?: string };

async function migratePhasesPhotos(): Promise<number> {
  const { data, error } = await supabase.from("phases").select("id, photos");
  if (error) throw error;

  let updated = 0;
  for (const row of data ?? []) {
    const photos = (row.photos as PhasePhotoRecord[] | null) ?? [];
    let changed = false;
    const next = photos.map((photo) => {
      const rewritten = rewriteUrl(photo.url);
      if (rewritten !== photo.url) changed = true;
      return rewritten && rewritten !== photo.url ? { ...photo, url: rewritten } : photo;
    });
    if (!changed) continue;

    const ok = await applyUpdate(`phases.photos (id=${row.id})`, () =>
      supabase.from("phases").update({ photos: next }).eq("id", row.id)
    );
    if (ok) updated += 1;
  }
  return updated;
}

async function main() {
  console.log("Supabase Storage -> Cloudflare R2 migration");
  if (DRY_RUN) console.log("(DRY RUN — no files copied, no database rows changed)");

  const totals: FileMetrics = { transferred: 0, failed: 0 };
  for (const bucket of BUCKETS) {
    const metrics = await migrateBucket(bucket);
    totals.transferred += metrics.transferred;
    totals.failed += metrics.failed;
  }

  console.log("\nRewriting database URLs...");
  let rowsUpdated = 0;
  rowsUpdated += await migrateSiteSettingsUrls();
  rowsUpdated += await migratePostThumbnails();
  rowsUpdated += await migratePostMedia();
  rowsUpdated += await migrateFeatureMedia();
  rowsUpdated += await migrateOrganizationLogos();
  rowsUpdated += await migratePhasesPhotos();

  console.log("\n--- Summary ---");
  console.log(`Files transferred: ${totals.transferred}`);
  console.log(`Files failed:      ${totals.failed}`);
  console.log(`DB rows updated:   ${rowsUpdated}`);
  console.log(
    "\nSupabase Storage files were NOT deleted. Verify the site renders correctly from R2, then remove the old files manually (dashboard, or your own script) once you're confident."
  );

  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
