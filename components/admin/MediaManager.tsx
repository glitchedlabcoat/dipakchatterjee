// components/admin/MediaManager.tsx
//
// Shared media gallery for a single Feature or Post. Files can be dropped
// or picked via DropzoneUpload; each one gets an instant local preview and
// an independent upload status while it streams to R2 (see
// lib/media-upload-client.ts), then a bound Server Action (addAction)
// persists the row. Reorder (drag) and delete work the same way. When
// `editableMeta` is set (features only — post_media has no
// title/caption columns), each item gets inline title/caption fields
// for the Public Life gallery carousel.
//
// Callers bind their entity id into the actions with Function.bind (see
// app/admin/(protected)/features/[id]/page.tsx for the pattern), so this
// component only ever deals with the common shape below.

"use client";

import { useState, useTransition } from "react";
import { uploadMediaFile, deleteUploadedMediaFile } from "@/lib/media-upload-client";
import type { MediaKind } from "@/types/domain";
import DropzoneUpload from "./DropzoneUpload";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, FileVideo, GripVertical, ImagePlus, Loader2, RotateCcw, Trash2, X } from "lucide-react";

export type MediaItem = {
  id: string;
  kind: MediaKind;
  public_url: string;
  storage_path: string;
  title?: string | null;
  caption?: string | null;
  display_order: number;
};

type PendingUpload = {
  localId: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "error";
  error?: string;
};

type MediaManagerProps = {
  /** R2 folder namespace this entity's media lives under — pass one of types/domain.ts's *_BUCKET constants (e.g. POST_BUCKET), same values as before this moved off Supabase Storage's per-feature buckets. */
  folder: string;
  entityId: string;
  media: MediaItem[];
  // Must resolve with the real database row id — MediaManager uses it
  // as the item's key/identity, so a delete or reorder that happens
  // right after upload (before any full page refresh) still targets
  // the actual row instead of a stand-in value like the storage path.
  addAction: (input: {
    kind: MediaKind;
    storage_path: string;
    public_url: string;
    caption?: string;
  }) => Promise<{ id: string }>;
  deleteAction: (mediaId: string) => Promise<void>;
  reorderAction: (orderedIds: string[]) => Promise<void>;
  editableMeta?: boolean;
  updateMetaAction?: (mediaId: string, input: { title?: string; caption?: string }) => Promise<void>;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9.-]/g, "_").toLowerCase();
}

export default function MediaManager({
  folder,
  entityId,
  media,
  addAction,
  deleteAction,
  reorderAction,
  editableMeta = false,
  updateMetaAction,
}: MediaManagerProps) {
  const [items, setItems] = useState(media);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleFiles(files: File[]) {
    const accepted: PendingUpload[] = [];

    for (const file of files) {
      const kind: MediaKind = file.type.startsWith("video/") ? "video" : "image";
      const isValidType = file.type.startsWith("image/") || file.type.startsWith("video/");
      const maxBytes = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

      if (!isValidType || file.size > maxBytes) {
        accepted.push({
          localId: crypto.randomUUID(),
          file,
          previewUrl: "",
          status: "error",
          error: !isValidType
            ? "Only image and video files are supported."
            : `File is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).`,
        });
        continue;
      }

      accepted.push({
        localId: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
      });
    }

    setPending((prev) => [...prev, ...accepted]);
    accepted.filter((a) => a.status === "uploading").forEach(uploadOne);
  }

  async function uploadOne(entry: PendingUpload) {
    const kind: MediaKind = entry.file.type.startsWith("video/") ? "video" : "image";
    const path = `${entityId}/${crypto.randomUUID()}-${sanitizeFilename(entry.file.name)}`;

    let uploaded: { path: string; public_url: string };
    try {
      uploaded = await uploadMediaFile(entry.file, folder, path);
    } catch (err) {
      setPending((prev) =>
        prev.map((p) =>
          p.localId === entry.localId
            ? { ...p, status: "error", error: err instanceof Error ? err.message : "Upload failed." }
            : p
        )
      );
      return;
    }

    try {
      const created = await addAction({ kind, storage_path: uploaded.path, public_url: uploaded.public_url });
      setItems((prev) => [
        ...prev,
        {
          id: created.id,
          kind,
          storage_path: uploaded.path,
          public_url: uploaded.public_url,
          title: null,
          caption: null,
          display_order: prev.length,
        },
      ]);
      setPending((prev) => prev.filter((p) => p.localId !== entry.localId));
      URL.revokeObjectURL(entry.previewUrl);
    } catch (err) {
      setPending((prev) =>
        prev.map((p) =>
          p.localId === entry.localId
            ? { ...p, status: "error", error: err instanceof Error ? err.message : "Failed to save media." }
            : p
        )
      );
      await deleteUploadedMediaFile(uploaded.path);
    }
  }

  function retryPending(entry: PendingUpload) {
    setPending((prev) =>
      prev.map((p) => (p.localId === entry.localId ? { ...p, status: "uploading", error: undefined } : p))
    );
    uploadOne(entry);
  }

  function dismissPending(localId: string) {
    setPending((prev) => {
      const entry = prev.find((p) => p.localId === localId);
      if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }

  function handleDelete(id: string) {
    const previous = items;
    setItems((prev) => prev.filter((m) => m.id !== id));

    startTransition(async () => {
      try {
        await deleteAction(id);
      } catch (err) {
        setItems(previous);
        alert(err instanceof Error ? err.message : "Failed to delete media.");
      }
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const previous = items;
    const oldIndex = items.findIndex((m) => m.id === active.id);
    const newIndex = items.findIndex((m) => m.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);

    startTransition(async () => {
      try {
        await reorderAction(reordered.map((m) => m.id));
      } catch (err) {
        setItems(previous);
        alert(err instanceof Error ? err.message : "Failed to save the new order.");
      }
    });
  }

  function handleMetaSave(id: string, input: { title?: string; caption?: string }) {
    if (!updateMetaAction) return;
    startTransition(async () => {
      try {
        await updateMetaAction(id, input);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  return (
    <div>
      <p className="text-sm font-semibold text-navy-900 mb-3">Media</p>

      <DropzoneUpload
        accept="image/*,video/*"
        multiple
        label="Drag & drop images or video here, or click to browse"
        onFiles={handleFiles}
      />

      {pending.length > 0 && (
        <ul className="space-y-2 mt-3">
          {pending.map((entry) => (
            <li
              key={entry.localId}
              className="flex items-center gap-3 rounded-md border border-line bg-white p-2.5"
            >
              <div className="w-14 h-14 shrink-0 rounded overflow-hidden bg-paper-100 border border-line flex items-center justify-center">
                {entry.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={entry.previewUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rust" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs text-ink-600 truncate">{entry.file.name}</p>
                {entry.status === "uploading" ? (
                  <p className="text-xs text-saffron-600 flex items-center gap-1.5 mt-0.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Uploading…
                  </p>
                ) : (
                  <p className="text-xs text-rust mt-0.5">{entry.error}</p>
                )}
              </div>

              {entry.status === "error" && (
                <>
                  <button
                    type="button"
                    onClick={() => retryPending(entry)}
                    aria-label="Retry upload"
                    className="shrink-0 text-ink-400 hover:text-saffron-600"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissPending(entry.localId)}
                    aria-label="Dismiss"
                    className="shrink-0 text-ink-400 hover:text-rust"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 && pending.length === 0 ? (
        <div className="border border-dashed border-line rounded-lg p-6 mt-3 text-center text-sm text-ink-400">
          <ImagePlus className="w-6 h-6 mx-auto mb-2 text-ink-400" />
          No media uploaded yet.
        </div>
      ) : items.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2 mt-3">
              {items.map((item) => (
                <SortableMediaRow
                  key={item.id}
                  item={item}
                  onDelete={() => handleDelete(item.id)}
                  disabled={isPending}
                  editableMeta={editableMeta}
                  onMetaSave={(input) => handleMetaSave(item.id, input)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : null}
    </div>
  );
}

function SortableMediaRow({
  item,
  onDelete,
  disabled,
  editableMeta,
  onMetaSave,
}: {
  item: MediaItem;
  onDelete: () => void;
  disabled: boolean;
  editableMeta: boolean;
  onMetaSave: (input: { title?: string; caption?: string }) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const [title, setTitle] = useState(item.title ?? "");
  const [caption, setCaption] = useState(item.caption ?? "");

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-3 rounded-md border border-line bg-white p-2.5 ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="shrink-0 mt-1 text-ink-400 hover:text-ink cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <div className="w-14 h-14 shrink-0 rounded overflow-hidden bg-paper-100 border border-line flex items-center justify-center">
        {item.kind === "video" ? (
          <FileVideo className="w-5 h-5 text-ink-400" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.public_url} alt="" className="w-full h-full object-cover" />
        )}
      </div>

      {editableMeta ? (
        <div className="flex-1 min-w-0 space-y-1.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== (item.title ?? "") && onMetaSave({ title })}
            placeholder="Title"
            className="w-full rounded border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:border-saffron focus:outline-none"
          />
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => caption !== (item.caption ?? "") && onMetaSave({ caption })}
            placeholder="Caption"
            className="w-full rounded border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:border-saffron focus:outline-none"
          />
        </div>
      ) : (
        <span className="flex-1 min-w-0 text-xs text-ink-600 truncate mt-1">{item.storage_path}</span>
      )}

      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        aria-label="Delete media"
        className="shrink-0 mt-1 text-ink-400 hover:text-rust disabled:opacity-60"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  );
}
