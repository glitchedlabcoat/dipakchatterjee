// app/admin/(protected)/settings/OrganizationsManager.tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { createClient } from "@/utils/supabase/client";
import { SITE_BUCKET, type Organization } from "@/types/domain";
import DropzoneUpload from "@/components/admin/DropzoneUpload";
import DndListSkeleton from "@/components/admin/DndListSkeleton";
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
import { GripVertical, Loader2, Save, Trash2, UploadCloud } from "lucide-react";
import {
  createOrganization,
  deleteOrganization,
  reorderOrganizations,
  replaceOrganizationLogo,
  updateOrgMaxPerRow,
  updateOrganization,
} from "./actions";
import { useUnsavedChangesWarning } from "@/lib/useUnsavedChangesWarning";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_ROW_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9.-]/g, "_").toLowerCase();
}

function MaxPerRowControl({ initialValue }: { initialValue: number }) {
  const [value, setValue] = useState(initialValue);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(next: number) {
    setValue(next);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        await updateOrgMaxPerRow(next);
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  return (
    <div className="flex items-center gap-3 mb-5 p-3 rounded-md border border-line bg-paper-100">
      <label htmlFor="org-max-per-row" className="text-sm font-medium text-navy-900 shrink-0">
        Max items per row before wrap (desktop)
      </label>
      <select
        id="org-max-per-row"
        value={value}
        onChange={(e) => save(Number(e.target.value))}
        disabled={isPending}
        className="rounded border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:border-saffron focus:outline-none disabled:opacity-60"
      >
        {MAX_PER_ROW_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      {isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-saffron-600" />
      ) : (
        <Save className="w-3.5 h-3.5 text-ink-300" />
      )}
      {saved && !isPending && <span className="text-xs text-forest">Saved.</span>}
      {error && (
        <span className="text-xs text-rust" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export default function OrganizationsManager({
  organizations,
  orgMaxPerRow,
}: {
  organizations: Organization[];
  orgMaxPerRow: number;
}) {
  const [items, setItems] = useState(organizations);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // See SocialLinksManager for why both an explicit DndContext `id` and
  // a mount-gate are used together to fully eliminate the
  // aria-describedby hydration mismatch.
  const mounted = useHydrated();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((o) => o.id === active.id);
    const newIndex = items.findIndex((o) => o.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);
    setError(null);

    startTransition(async () => {
      try {
        await reorderOrganizations(reordered.map((o) => o.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save the new order.");
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Remove this organization's logo from the homepage?")) return;
    const prev = items;
    setItems((cur) => cur.filter((o) => o.id !== id));
    setError(null);
    startTransition(async () => {
      try {
        await deleteOrganization(id);
      } catch (err) {
        setItems(prev);
        setError(err instanceof Error ? err.message : "Failed to delete.");
      }
    });
  }

  function handleAdded(org: Organization) {
    setItems((prev) => [...prev, org]);
  }

  return (
    <div className="bg-white border border-line rounded-xl p-6 md:p-8">
      <p className="text-sm font-semibold text-navy-900 mb-1">Affiliated Organizations</p>
      <p className="text-xs text-ink-400 mb-5">
        Shown in the &ldquo;Organizations Worked With&rdquo; homepage section (its position among
        other sections is set in Homepage Sections above). Drag to reorder. Designation and
        Organization name are both required; the link is optional.
      </p>

      <MaxPerRowControl initialValue={orgMaxPerRow} />

      {error && (
        <p className="text-xs text-rust mb-3" role="alert">
          {error}
        </p>
      )}

      {items.length > 0 && !mounted && <DndListSkeleton count={items.length} rowHeight={64} />}

      {items.length > 0 && mounted && (
        <DndContext id="organizations-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2 mb-5">
              {items.map((org) => (
                <SortableOrgRow
                  key={org.id}
                  org={org}
                  disabled={isPending}
                  onDelete={() => handleDelete(org.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <AddOrganizationForm onAdded={handleAdded} />
    </div>
  );
}

function SortableOrgRow({
  org,
  disabled,
  onDelete,
}: {
  org: Organization;
  disabled: boolean;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: org.id,
  });
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(org.name);
  const [designation, setDesignation] = useState(org.designation ?? "");
  const [url, setUrl] = useState(org.external_url ?? "");
  const [logoUrl, setLogoUrl] = useState(org.logo_url);
  const [replacing, setReplacing] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useUnsavedChangesWarning(
    name !== org.name || designation !== (org.designation ?? "") || url !== (org.external_url ?? "")
  );

  const style = { transform: CSS.Transform.toString(transform), transition };

  async function handleReplaceLogo(file: File) {
    if (!file.type.startsWith("image/")) return;
    setReplacing(true);
    const path = `logos/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(SITE_BUCKET)
      .upload(path, file, { cacheControl: "2592000" /* 30 days */, upsert: false });

    if (uploadError) {
      alert(uploadError.message);
      setReplacing(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(SITE_BUCKET).getPublicUrl(path);

    try {
      await replaceOrganizationLogo(org.id, { logo_url: publicUrl, logo_path: path });
      setLogoUrl(publicUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save logo.");
      await supabase.storage.from(SITE_BUCKET).remove([path]);
    } finally {
      setReplacing(false);
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-md border border-line bg-white p-2.5 ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="shrink-0 text-ink-400 hover:text-ink cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={replacing}
        aria-label="Replace logo"
        className="shrink-0 w-12 h-12 rounded bg-paper-100 border border-line flex items-center justify-center overflow-hidden relative group"
      >
        {replacing ? (
          <Loader2 className="w-4 h-4 animate-spin text-saffron-600" />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="" className="w-full h-full object-contain p-1" />
            <span className="absolute inset-0 bg-navy-900/0 group-hover:bg-navy-900/50 transition-colors flex items-center justify-center">
              <UploadCloud className="w-3.5 h-3.5 text-white opacity-0 group-hover:opacity-100" />
            </span>
          </>
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleReplaceLogo(file);
        }}
      />

      <div className="flex-1 min-w-0 grid sm:grid-cols-2 gap-2">
        <div>
          <input
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            onBlur={() => {
              if (!designation.trim()) {
                setFieldError("Designation / role is required.");
                return;
              }
              setFieldError(null);
              if (designation !== (org.designation ?? "")) {
                startTransition(() => updateOrganization(org.id, { designation }));
              }
            }}
            required
            placeholder="Designation / role *"
            className="w-full rounded border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:border-saffron focus:outline-none"
          />
        </div>
        <div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (!name.trim()) {
                setFieldError("Organization name is required.");
                return;
              }
              setFieldError(null);
              if (name !== org.name) {
                startTransition(() => updateOrganization(org.id, { name }));
              }
            }}
            required
            placeholder="Organization name *"
            className="w-full rounded border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:border-saffron focus:outline-none"
          />
        </div>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() =>
            url !== (org.external_url ?? "") &&
            startTransition(() => updateOrganization(org.id, { external_url: url }))
          }
          placeholder="https:// (optional link)"
          className="sm:col-span-2 rounded border border-line bg-white px-2.5 py-1.5 text-xs text-ink-600 focus:border-saffron focus:outline-none"
        />
        {fieldError && <p className="sm:col-span-2 text-xs text-rust">{fieldError}</p>}
      </div>

      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        aria-label="Delete organization"
        className="shrink-0 text-ink-400 hover:text-rust disabled:opacity-60"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  );

  function startTransition(fn: () => Promise<void>) {
    fn().catch((err) => alert(err instanceof Error ? err.message : "Failed to save."));
  }
}

function AddOrganizationForm({ onAdded }: { onAdded: (org: Organization) => void }) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [pendingLogo, setPendingLogo] = useState<{
    file: File;
    previewUrl: string;
    publicUrl: string;
    path: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setUploading(true);
    const previewUrl = URL.createObjectURL(file);
    const path = `logos/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from(SITE_BUCKET)
      .upload(path, file, { cacheControl: "2592000" /* 30 days */, upsert: false });

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      URL.revokeObjectURL(previewUrl);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(SITE_BUCKET).getPublicUrl(path);

    setPendingLogo({ file, previewUrl, publicUrl, path });
    setUploading(false);
  }

  async function handleAdd() {
    if (!pendingLogo || !name.trim() || !designation.trim()) {
      setError("A logo, organization name, and designation / role are all required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const created = await createOrganization({
        name: name.trim(),
        logo_url: pendingLogo.publicUrl,
        logo_path: pendingLogo.path,
        external_url: externalUrl.trim(),
        designation: designation.trim(),
      });
      onAdded({
        id: created.id,
        name: name.trim(),
        logo_url: pendingLogo.publicUrl,
        logo_path: pendingLogo.path,
        external_url: externalUrl.trim() || null,
        designation: designation.trim() || null,
        display_order: created.display_order,
        created_at: created.created_at,
      });
      URL.revokeObjectURL(pendingLogo.previewUrl);
      setPendingLogo(null);
      setName("");
      setDesignation("");
      setExternalUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add organization.");
      await supabase.storage.from(SITE_BUCKET).remove([pendingLogo.path]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-line pt-5">
      <p className="text-xs font-semibold text-navy-900 mb-3">Add organization</p>

      <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start">
        {pendingLogo ? (
          <div className="w-16 h-16 rounded border border-line bg-paper-100 flex items-center justify-center overflow-hidden shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingLogo.previewUrl} alt="" className="w-full h-full object-contain p-1.5" />
          </div>
        ) : (
          <div className="w-40 sm:w-32">
            <DropzoneUpload
              accept="image/*"
              disabled={uploading}
              label={uploading ? "Uploading…" : "Logo"}
              onFiles={handleFiles}
            />
          </div>
        )}

        <div className="space-y-2.5">
          <input
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            required
            placeholder="Designation / role *"
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-saffron focus:outline-none"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Organization name *"
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-saffron focus:outline-none"
          />
          <input
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https:// (optional link)"
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-saffron focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!pendingLogo || !name.trim() || !designation.trim() || saving}
            className="inline-flex items-center gap-2 bg-navy-900 hover:bg-navy-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? "Adding…" : "Add organization"}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
