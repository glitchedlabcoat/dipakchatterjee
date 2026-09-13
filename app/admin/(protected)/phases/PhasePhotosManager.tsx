// app/admin/(protected)/phases/PhasePhotosManager.tsx
//
// Same drag/drop upload + reorder UX as components/admin/MediaManager,
// adapted for phases: photos live inline as a JSONB array on the
// phase row (see actions.ts) rather than rows in a foreign-keyed media
// table, so identity here is the storage `path`, not a database row id.

"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/utils/supabase/client";
import { PHASE_BUCKET, type PhasePhoto } from "@/types/domain";
import DropzoneUpload from "@/components/admin/DropzoneUpload";
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
import { AlertCircle, GripVertical, ImagePlus, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import {
  addPhasePhoto,
  deletePhasePhoto,
  reorderPhasePhotos,
  updatePhasePhotoCaption,
  updatePhasePhotoFact,
} from "./actions";

type PendingUpload = {
  localId: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "error";
  error?: string;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9.-]/g, "_").toLowerCase();
}

export default function PhasePhotosManager({ phaseId, photos }: { phaseId: string; photos: PhasePhoto[] }) {
  const supabase = createClient();
  const [items, setItems] = useState(photos);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleFiles(files: File[]) {
    const accepted: PendingUpload[] = [];

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        accepted.push({
          localId: crypto.randomUUID(),
          file,
          previewUrl: "",
          status: "error",
          error: "Only image files are supported.",
        });
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        accepted.push({
          localId: crypto.randomUUID(),
          file,
          previewUrl: "",
          status: "error",
          error: `File is too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB).`,
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
    const path = `${phaseId}/${crypto.randomUUID()}-${sanitizeFilename(entry.file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from(PHASE_BUCKET)
      .upload(path, entry.file, { cacheControl: "2592000" /* 30 days */, upsert: false });

    if (uploadError) {
      setPending((prev) =>
        prev.map((p) => (p.localId === entry.localId ? { ...p, status: "error", error: uploadError.message } : p))
      );
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(PHASE_BUCKET).getPublicUrl(path);

    try {
      await addPhasePhoto(phaseId, { url: publicUrl, path });
      setItems((prev) => [...prev, { url: publicUrl, path, caption: "", fact: "" }]);
      setPending((prev) => prev.filter((p) => p.localId !== entry.localId));
      URL.revokeObjectURL(entry.previewUrl);
    } catch (err) {
      setPending((prev) =>
        prev.map((p) =>
          p.localId === entry.localId
            ? { ...p, status: "error", error: err instanceof Error ? err.message : "Failed to save photo." }
            : p
        )
      );
      await supabase.storage.from(PHASE_BUCKET).remove([path]);
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

  function handleDelete(path: string) {
    const previous = items;
    setItems((prev) => prev.filter((p) => p.path !== path));

    startTransition(async () => {
      try {
        await deletePhasePhoto(phaseId, path);
      } catch (err) {
        setItems(previous);
        alert(err instanceof Error ? err.message : "Failed to delete photo.");
      }
    });
  }

  function handleCaptionSave(path: string, caption: string) {
    startTransition(async () => {
      try {
        await updatePhasePhotoCaption(phaseId, path, caption);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to save caption.");
      }
    });
  }

  function handleFactSave(path: string, fact: string) {
    startTransition(async () => {
      try {
        await updatePhasePhotoFact(phaseId, path, fact);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to save fact.");
      }
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const previous = items;
    const oldIndex = items.findIndex((p) => p.path === active.id);
    const newIndex = items.findIndex((p) => p.path === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);

    startTransition(async () => {
      try {
        await reorderPhasePhotos(phaseId, reordered.map((p) => p.path));
      } catch (err) {
        setItems(previous);
        alert(err instanceof Error ? err.message : "Failed to save the new order.");
      }
    });
  }

  return (
    <div>
      <p className="text-sm font-semibold text-navy-900 mb-3">Photos</p>

      <DropzoneUpload
        accept="image/*"
        multiple
        label="Drag & drop photos here, or click to browse"
        onFiles={handleFiles}
      />

      {pending.length > 0 && (
        <ul className="space-y-2 mt-3">
          {pending.map((entry) => (
            <li key={entry.localId} className="flex items-center gap-3 rounded-md border border-line bg-white p-2.5">
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
          No photos uploaded yet.
        </div>
      ) : items.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((p) => p.path)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2 mt-3">
              {items.map((item) => (
                <SortablePhotoRow
                  key={item.path}
                  item={item}
                  onDelete={() => handleDelete(item.path)}
                  disabled={isPending}
                  onCaptionSave={(caption) => handleCaptionSave(item.path, caption)}
                  onFactSave={(fact) => handleFactSave(item.path, fact)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : null}
    </div>
  );
}

function SortablePhotoRow({
  item,
  onDelete,
  disabled,
  onCaptionSave,
  onFactSave,
}: {
  item: PhasePhoto;
  onDelete: () => void;
  disabled: boolean;
  onCaptionSave: (caption: string) => void;
  onFactSave: (fact: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.path });
  const [caption, setCaption] = useState(item.caption ?? "");
  const [fact, setFact] = useState(item.fact ?? "");

  const style = { transform: CSS.Transform.toString(transform), transition };

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.url} alt="" className="w-full h-full object-cover" />
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => caption !== (item.caption ?? "") && onCaptionSave(caption)}
          placeholder="Caption"
          className="w-full rounded border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:border-saffron focus:outline-none"
        />
        <input
          value={fact}
          onChange={(e) => setFact(e.target.value)}
          onBlur={() => fact !== (item.fact ?? "") && onFactSave(fact)}
          placeholder="Fact / detail (shown on the Read More page)"
          className="w-full rounded border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:border-saffron focus:outline-none"
        />
      </div>

      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        aria-label="Delete photo"
        className="shrink-0 mt-1 text-ink-400 hover:text-rust disabled:opacity-60"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  );
}
