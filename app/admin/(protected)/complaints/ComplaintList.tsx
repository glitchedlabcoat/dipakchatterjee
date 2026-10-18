// app/admin/(protected)/complaints/ComplaintList.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { Check, Clock, Copy, FileVideo, Phone, Trash2 } from "lucide-react";
import type { Complaint, ComplaintMedia } from "@/types/domain";
import { formatTimeRemaining, getComplaintStatus } from "@/lib/complaint-status";
import { formatReferenceNumber } from "@/lib/reference";
import { deleteComplaint, updateComplaintStatus, type ComplaintResolutionStatus } from "./actions";
import ComplaintDetailModal from "./ComplaintDetailModal";

// formatDate is given a fixed `timeZone` so it's a pure function of its
// input — otherwise it silently depends on the server process's local
// timezone (often UTC) vs. the visitor's browser timezone, producing a
// different string on every load and a guaranteed hydration mismatch.
const DISPLAY_TIME_ZONE = "Asia/Kolkata";

export type ComplaintMediaWithUrl = ComplaintMedia & { signedUrl: string | null };
type ComplaintRow = Complaint & { complaint_media: ComplaintMediaWithUrl[] };

const STATUS_STYLES: Record<string, string> = {
  new: "border-saffron text-saffron-600 bg-saffron-100",
  active: "border-forest text-forest bg-forest-100",
  expired: "border-line text-ink-400 bg-paper-100",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  active: "Active",
  expired: "Expired",
};

const RESOLUTION_FILTERS: { value: "all" | ComplaintResolutionStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unresolved", label: "Unresolved" },
  { value: "resolved", label: "Resolved" },
];

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

export default function ComplaintList({
  complaints,
  initialSelectedId = null,
}: {
  complaints: ComplaintRow[];
  /** From ?complaint=<id> (links in notification emails). */
  initialSelectedId?: string | null;
}) {
  const [items, setItems] = useState(complaints);
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | ComplaintResolutionStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const linkedMissing = initialSelectedId !== null && !complaints.some((c) => c.id === initialSelectedId);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function handleCopyReference(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    navigator.clipboard.writeText(formatReferenceNumber(id)).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    });
  }

  // getComplaintStatus/formatTimeRemaining are relative-to-now and can
  // legitimately differ between the server's render time and the
  // client's hydration time (e.g. an hour/day boundary ticking over in
  // between) — a real, if narrow, hydration-mismatch source. Deferring
  // them behind a `mounted` flag guarantees the very first client render
  // matches the server-rendered HTML exactly; the live values then take
  // over immediately after mount, as a normal post-hydration update.
  const mounted = useHydrated();

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((c) => c.status === filter)),
    [items, filter]
  );

  const counts = useMemo(
    () => ({
      all: items.length,
      unresolved: items.filter((c) => c.status !== "resolved").length,
      resolved: items.filter((c) => c.status === "resolved").length,
    }),
    [items]
  );

  const selected = filtered.find((c) => c.id === selectedId) ?? null;

  function handleDelete(id: string) {
    if (!confirm("Permanently delete this complaint and its attached media? This cannot be undone.")) return;
    setItems((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
    startTransition(async () => {
      await deleteComplaint(id);
    });
  }

  function handleToggleStatus(id: string, next: ComplaintResolutionStatus) {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, status: next } : c)));
    setTogglingId(id);
    updateComplaintStatus(id, next)
      .catch((err) => alert(err instanceof Error ? err.message : "Failed to update status."))
      .finally(() => setTogglingId(null));
  }

  return (
    <div>
      {linkedMissing && (
        <p className="mb-4 rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink-600" role="status">
          The complaint from that link is no longer available. It may have expired or been deleted.
        </p>
      )}
      <div className="flex items-center gap-1.5 mb-4">
        {RESOLUTION_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${
              filter === f.value
                ? "border-navy-900 bg-navy-900 text-white"
                : "border-line text-ink-600 hover:border-navy-900/40"
            }`}
          >
            {f.label} <span className="opacity-70">({counts[f.value]})</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-line rounded-lg p-10 text-center text-sm text-ink-400">
          {items.length === 0 ? "No active complaints right now." : "No complaints match this filter."}
        </div>
      ) : (
        <ul className="space-y-4">
          {filtered.map((complaint) => {
            const status = mounted ? getComplaintStatus(complaint) : null;
            const isResolved = complaint.status === "resolved";
            return (
              <li
                key={complaint.id}
                onClick={() => setSelectedId(complaint.id)}
                className="bg-white border border-line rounded-xl p-5 md:p-6 cursor-pointer hover:border-navy-900/30 transition-colors"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display text-lg text-navy-900">{complaint.title || "Complaint"}</h3>
                      {status && (
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${STATUS_STYLES[status]}`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      )}
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                          isResolved
                            ? "border-forest text-forest bg-forest-100"
                            : "border-rust text-rust bg-rust/10"
                        }`}
                      >
                        {isResolved ? "Resolved" : "Unresolved"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-xs font-mono font-semibold text-ink-600">
                        {formatReferenceNumber(complaint.id)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleCopyReference(e, complaint.id)}
                        aria-label="Copy reference number"
                        title="Copy reference number"
                        className="text-ink-400 hover:text-saffron-600"
                      >
                        {copiedId === complaint.id ? (
                          <Check className="w-3.5 h-3.5 text-forest" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-ink-400 mt-1">Submitted {formatDate(complaint.created_at)}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleStatus(complaint.id, isResolved ? "unresolved" : "resolved");
                      }}
                      disabled={togglingId === complaint.id}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-600 border border-line rounded-md px-2.5 py-1.5 hover:border-forest hover:text-forest disabled:opacity-60"
                    >
                      {isResolved ? "Mark Unresolved" : "Mark Resolved"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(complaint.id);
                      }}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-rust border border-line rounded-md px-2.5 py-1.5 hover:border-rust disabled:opacity-60"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                </div>

                <p className="text-sm text-ink-600 leading-relaxed line-clamp-2">{complaint.description}</p>

                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm text-ink-600">
                  <p className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-ink-400 shrink-0" />
                    {complaint.contact_phone ? (
                      <a
                        href={`tel:${complaint.contact_phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-saffron-600"
                      >
                        {complaint.contact_phone}
                      </a>
                    ) : (
                      <span className="text-ink-400 italic">Not provided</span>
                    )}
                  </p>
                  <p className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-ink-400 shrink-0" />
                    {mounted ? formatTimeRemaining(complaint.expires_at) : "Calculating…"}
                  </p>
                </div>

                {complaint.complaint_media.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    {complaint.complaint_media.slice(0, 4).map((m) =>
                      m.signedUrl ? (
                        m.kind === "video" ? (
                          <div
                            key={m.id}
                            className="w-16 h-16 rounded-md bg-navy-900 border border-line flex items-center justify-center"
                          >
                            <FileVideo className="w-5 h-5 text-white/70" />
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={m.id}
                            src={m.signedUrl}
                            alt=""
                            className="w-16 h-16 rounded-md object-cover border border-line"
                          />
                        )
                      ) : (
                        <div
                          key={m.id}
                          className="w-16 h-16 rounded-md border border-line bg-paper-100 flex items-center justify-center"
                        >
                          <FileVideo className="w-5 h-5 text-ink-400" />
                        </div>
                      )
                    )}
                    {complaint.complaint_media.length > 4 && (
                      <div className="w-16 h-16 rounded-md border border-line bg-paper-100 flex items-center justify-center text-xs font-semibold text-ink-400">
                        +{complaint.complaint_media.length - 4}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <ComplaintDetailModal
          complaint={selected}
          onClose={() => setSelectedId(null)}
          onToggleStatus={(next) => handleToggleStatus(selected.id, next)}
          isTogglingStatus={togglingId === selected.id}
        />
      )}
    </div>
  );
}
