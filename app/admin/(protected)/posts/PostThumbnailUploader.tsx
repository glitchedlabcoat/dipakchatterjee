// app/admin/(protected)/posts/PostThumbnailUploader.tsx
//
// Dedicated thumbnail picker for a post — used exclusively by the post
// card on the homepage feed and other index views (see
// components/posts/PostsFeed.tsx), independent of the post's attached
// media below. Same immediate-upload pattern as SiteImageUploader.

"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/utils/supabase/client";
import { POST_BUCKET } from "@/types/domain";
import DropzoneUpload from "@/components/admin/DropzoneUpload";
import { Loader2, Trash2 } from "lucide-react";
import { removePostThumbnail, updatePostThumbnail } from "./actions";

const MAX_BYTES = 10 * 1024 * 1024;

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9.-]/g, "_").toLowerCase();
}

export default function PostThumbnailUploader({
  postId,
  currentUrl,
}: {
  postId: string;
  currentUrl: string | null;
}) {
  const supabase = createClient();
  const [url, setUrl] = useState(currentUrl);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleFiles(files: File[]) {
    const file = files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`File is too large (max ${Math.round(MAX_BYTES / 1024 / 1024)}MB).`);
      return;
    }

    setError(null);
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);
    setUploading(true);

    const path = `${postId}/thumbnail-${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(POST_BUCKET)
      .upload(path, file, { cacheControl: "2592000" /* 30 days */, upsert: false });

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      URL.revokeObjectURL(preview);
      setLocalPreview(null);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(POST_BUCKET).getPublicUrl(path);

    try {
      await updatePostThumbnail(postId, { storage_path: path, public_url: publicUrl });
      setUrl(publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
      await supabase.storage.from(POST_BUCKET).remove([path]);
    } finally {
      setUploading(false);
      URL.revokeObjectURL(preview);
      setLocalPreview(null);
    }
  }

  function handleRemove() {
    if (!confirm("Remove the current thumbnail?")) return;
    startTransition(async () => {
      try {
        await removePostThumbnail(postId);
        setUrl(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove.");
      }
    });
  }

  const displayUrl = localPreview ?? url;

  return (
    <div>
      <p className="text-sm font-semibold text-navy-900 mb-1">Thumbnail Image</p>
      <p className="text-xs text-ink-400 mb-4">
        Used only for this post&rsquo;s card on the homepage feed and index listings. Falls back
        to the first attached image below when not set.
      </p>

      <div className="flex items-start gap-5">
        <div className="shrink-0 overflow-hidden bg-paper-100 border border-line flex items-center justify-center w-24 aspect-video rounded-md">
          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[10px] text-ink-400 text-center px-1">No thumbnail</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <DropzoneUpload
            accept="image/*"
            disabled={uploading}
            label={uploading ? "Uploading…" : "Drag & drop an image, or click to browse"}
            onFiles={handleFiles}
          />

          <div className="flex items-center justify-between mt-3">
            {uploading && (
              <p className="text-xs text-saffron-600 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…
              </p>
            )}

            {url && !uploading && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-rust hover:text-rust/80 disabled:opacity-60 ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove
              </button>
            )}
          </div>

          {error && (
            <p className="text-xs text-rust mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
