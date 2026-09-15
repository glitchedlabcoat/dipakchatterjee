// components/complaints/ComplaintMediaPicker.tsx
//
// Replaces ComplaintForm's old "stage locally, upload on submit through
// a Server Action" flow. Now every file is compressed client-side and
// streamed straight to Cloudflare R2 via a presigned PUT the moment
// it's picked (see app/api/complaints/upload-url/route.ts) — by the
// time the citizen hits Submit, the bytes are already in R2 and the
// form only needs to send the resulting {key, kind} pairs (see
// ComplaintForm's submit()). Zero video/image data ever touches the
// Next.js server itself.
//
// Known limitation: an abandoned form (files uploaded, never submitted)
// leaves orphaned objects in R2 — there's no complaint row yet at
// upload time, so retention cleanup (lib/complaint-storage-delete.ts)
// has nothing to key off until a submission actually happens. The clean
// fix is an R2 Object Lifecycle rule (Cloudflare dashboard) expiring
// anything under the r2-media/ prefix after ~24h; not something this
// app's code can configure for you.

"use client";

import { useEffect, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { FileVideo, Loader2, X } from "lucide-react";
import DropzoneUpload from "@/components/admin/DropzoneUpload";
import { prepareComplaintVideo, VIDEO_FAST_TRACK_MAX_BYTES } from "@/lib/video-transcode";

const MAX_IMAGES = 5;
const MAX_VIDEOS = 1;
const MAX_COMBINED_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_COMPRESSION_OPTIONS = {
  maxSizeMB: 0.8,
  maxWidthOrHeight: 1920,
  initialQuality: 0.85,
  fileType: "image/webp",
  useWebWorker: true,
};

export type StagedMedia = { key: string; kind: "image" | "video" };

type StagedItem = {
  id: string;
  kind: "image" | "video";
  previewUrl: string;
  status: "compressing" | "uploading" | "done" | "error";
  key?: string;
  bytes: number;
  errorMessage?: string;
};

async function requestUploadUrl(
  draftId: string,
  kind: "image" | "video",
  file: File
): Promise<{ key: string; uploadUrl: string }> {
  const res = await fetch("/api/complaints/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      draftId,
      kind,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not prepare upload.");
  return data;
}

async function putToR2(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error("Upload to storage failed.");
}

export default function ComplaintMediaPicker({
  draftId,
  onChange,
}: {
  draftId: string;
  onChange: (media: StagedMedia[], isBusy: boolean) => void;
}) {
  const [items, setItems] = useState<StagedItem[]>([]);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  function emitChange(next: StagedItem[]) {
    const isBusy = next.some((i) => i.status === "compressing" || i.status === "uploading");
    onChange(
      next.filter((i): i is StagedItem & { key: string } => i.status === "done" && !!i.key).map((i) => ({
        key: i.key,
        kind: i.kind,
      })),
      isBusy
    );
  }

  function addItem(item: StagedItem) {
    setItems((prev) => {
      const next = [...prev, item];
      emitChange(next);
      return next;
    });
  }

  function updateItem(id: string, patch: Partial<StagedItem>) {
    setItems((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, ...patch } : i));
      emitChange(next);
      return next;
    });
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((i) => i.id !== id);
      emitChange(next);
      return next;
    });
  }

  async function uploadItem(id: string, kind: "image" | "video", file: File) {
    updateItem(id, { status: "uploading" });
    try {
      const { key, uploadUrl } = await requestUploadUrl(draftId, kind, file);
      await putToR2(uploadUrl, file);
      updateItem(id, { status: "done", key });
    } catch (err) {
      updateItem(id, {
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }

  async function handleImages(files: File[]) {
    setPickerError(null);
    const current = itemsRef.current;
    const currentImages = current.filter((i) => i.kind === "image");
    const currentImageBytes = currentImages.reduce((sum, i) => sum + i.bytes, 0);
    const room = MAX_IMAGES - currentImages.length;

    if (room <= 0) {
      setPickerError(`You can attach up to ${MAX_IMAGES} photos.`);
      return;
    }

    let runningBytes = currentImageBytes;
    for (const file of files.slice(0, room)) {
      if (!file.type.startsWith("image/")) {
        setPickerError("Only image files are supported here.");
        continue;
      }

      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      addItem({ id, kind: "image", previewUrl, status: "compressing", bytes: 0 });

      let compressed: File;
      try {
        compressed = await imageCompression(file, IMAGE_COMPRESSION_OPTIONS);
      } catch (err) {
        console.error("[ComplaintMediaPicker] image compression failed:", err);
        updateItem(id, { status: "error", errorMessage: "Could not process this image." });
        continue;
      }

      if (runningBytes + compressed.size > MAX_COMBINED_IMAGE_BYTES) {
        setPickerError("Combined photo size limit reached (5 MB). Remove a photo to add another.");
        updateItem(id, { status: "error", errorMessage: "Over the combined size limit." });
        continue;
      }
      runningBytes += compressed.size;

      setItems((prev) => {
        const next = prev.map((i) => (i.id === id ? { ...i, bytes: compressed.size } : i));
        return next;
      });

      void uploadItem(id, "image", compressed);
    }
  }

  async function handleVideo(files: File[]) {
    setPickerError(null);
    const current = itemsRef.current;
    if (current.filter((i) => i.kind === "video").length >= MAX_VIDEOS) {
      setPickerError("Only one video clip can be attached.");
      return;
    }

    const file = files[0];
    if (!file || !file.type.startsWith("video/")) {
      setPickerError("Only video files are supported here.");
      return;
    }

    const id = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    addItem({ id, kind: "video", previewUrl, status: "compressing", bytes: file.size });

    const prepared = await prepareComplaintVideo(file);
    if ("error" in prepared) {
      updateItem(id, { status: "error", errorMessage: prepared.error });
      return;
    }

    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, bytes: prepared.file.size } : i)));
    void uploadItem(id, "video", prepared.file);
  }

  const imageCount = items.filter((i) => i.kind === "image").length;
  const videoCount = items.filter((i) => i.kind === "video").length;

  return (
    <div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <DropzoneUpload
            accept="image/*"
            multiple
            disabled={imageCount >= MAX_IMAGES}
            label={`Photos (up to ${MAX_IMAGES}, 5MB combined)`}
            onFiles={handleImages}
          />
        </div>
        <div>
          <DropzoneUpload
            accept="video/*"
            disabled={videoCount >= MAX_VIDEOS}
            label="One video clip, up to 60 seconds"
            onFiles={handleVideo}
          />
        </div>
      </div>

      {pickerError && <p className="text-xs text-rust mt-2">{pickerError}</p>}

      {items.length > 0 && (
        <ul className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="relative aspect-square rounded-md overflow-hidden border border-line bg-paper-100"
            >
              {item.kind === "video" ? (
                <div className="relative w-full h-full">
                  <video src={item.previewUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-navy-900/20">
                    <FileVideo className="w-5 h-5 text-white drop-shadow" />
                  </div>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
              )}

              {(item.status === "compressing" || item.status === "uploading") && (
                <div className="absolute inset-0 flex items-center justify-center bg-navy-900/50">
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                </div>
              )}

              {item.status === "error" && (
                <div className="absolute inset-0 flex items-center justify-center bg-rust/80 p-1">
                  <p className="text-[10px] text-white text-center leading-tight">{item.errorMessage}</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => removeItem(item.id)}
                aria-label="Remove file"
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-navy-900/80 text-white flex items-center justify-center touch-manipulation"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-ink-400 mt-2">
        Photos are compressed automatically. Videos under {VIDEO_FAST_TRACK_MAX_BYTES / 1024 / 1024}MB upload
        as-is; larger ones (up to 60s) are compressed in your browser first.
      </p>
    </div>
  );
}
