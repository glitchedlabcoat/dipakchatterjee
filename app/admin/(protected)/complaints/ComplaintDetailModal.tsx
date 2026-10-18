// app/admin/(protected)/complaints/ComplaintDetailModal.tsx
//
// Full-detail view for one complaint: description, phone, every media
// attachment (photos open in a lightbox, videos play inline), submitted
// timestamp, remaining expiry time, and the resolved/unresolved toggle.
//
// This only ever mounts in response to a click (see ComplaintList's
// `selectedId` state) — it's never part of the server-rendered HTML, so
// none of its time-based text needs the mounted-gate ComplaintList uses
// elsewhere; there's nothing for the client to hydrate here.

"use client";

import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clock, Copy, FileVideo, Mail, Phone, X } from "lucide-react";
import { formatTimeRemaining, getComplaintStatus } from "@/lib/complaint-status";
import { formatReferenceNumber } from "@/lib/reference";
import type { ComplaintMediaWithUrl } from "./ComplaintList";
import type { Complaint } from "@/types/domain";
import type { ComplaintResolutionStatus } from "./actions";

const DISPLAY_TIME_ZONE = "Asia/Kolkata";

const TIME_STATUS_STYLES: Record<string, string> = {
  new: "border-saffron text-saffron-600 bg-saffron-100",
  active: "border-forest text-forest bg-forest-100",
  expired: "border-line text-ink-400 bg-paper-100",
};

const TIME_STATUS_LABELS: Record<string, string> = {
  new: "New",
  active: "Active",
  expired: "Expired",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

type ComplaintRow = Complaint & { complaint_media: ComplaintMediaWithUrl[] };

export default function ComplaintDetailModal({
  complaint,
  onClose,
  onToggleStatus,
  isTogglingStatus,
}: {
  complaint: ComplaintRow;
  onClose: () => void;
  onToggleStatus: (next: ComplaintResolutionStatus) => void;
  isTogglingStatus: boolean;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const photos = complaint.complaint_media.filter((m) => m.kind === "image" && m.signedUrl);
  const timeStatus = getComplaintStatus(complaint);
  const isResolved = complaint.status === "resolved";

  function handleCopyReference() {
    navigator.clipboard.writeText(formatReferenceNumber(complaint.id)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (lightboxIndex !== null) setLightboxIndex(null);
        else onClose();
      }
      if (lightboxIndex !== null && photos.length > 1) {
        if (e.key === "ArrowRight") setLightboxIndex((i) => (i === null ? i : (i + 1) % photos.length));
        if (e.key === "ArrowLeft")
          setLightboxIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightboxIndex, photos.length, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-navy-900/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-line px-5 md:px-6 py-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-display text-lg text-navy-900">{complaint.title || "Complaint"}</h2>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${TIME_STATUS_STYLES[timeStatus]}`}
            >
              {TIME_STATUS_LABELS[timeStatus]}
            </span>
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

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-ink-400 hover:text-ink hover:bg-paper-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 md:p-6 space-y-5">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Reference</p>
            <span className="text-sm font-mono font-semibold text-navy-900">
              {formatReferenceNumber(complaint.id)}
            </span>
            <button
              type="button"
              onClick={handleCopyReference}
              aria-label="Copy reference number"
              title="Copy reference number"
              className="text-ink-400 hover:text-saffron-600"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-forest" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Description</p>
            <p className="text-sm text-ink-600 leading-relaxed whitespace-pre-wrap">{complaint.description}</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm text-ink-600">
            <p className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-ink-400 shrink-0" />
              {complaint.contact_phone ? (
                <a href={`tel:${complaint.contact_phone}`} className="hover:text-saffron-600 font-medium">
                  {complaint.contact_phone}
                </a>
              ) : (
                <span className="text-ink-400 italic">Not provided</span>
              )}
            </p>
            <p className="flex items-center gap-2 min-w-0">
              <Mail className="w-4 h-4 text-ink-400 shrink-0" />
              {complaint.contact_email ? (
                <a href={`mailto:${complaint.contact_email}`} className="hover:text-saffron-600 font-medium break-all">
                  {complaint.contact_email}
                </a>
              ) : (
                <span className="text-ink-400 italic">No email</span>
              )}
            </p>
            <p className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-ink-400 shrink-0" />
              {formatTimeRemaining(complaint.expires_at)}
            </p>
            <p className="sm:col-span-2 text-xs text-ink-400">
              Submitted {formatDateTime(complaint.created_at)}
            </p>
          </div>

          {complaint.complaint_media.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">
                Media attachments
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {complaint.complaint_media.map((m) => {
                  if (!m.signedUrl) {
                    return (
                      <div
                        key={m.id}
                        className="aspect-square rounded-md border border-line bg-paper-100 flex items-center justify-center"
                      >
                        <FileVideo className="w-6 h-6 text-ink-400" />
                      </div>
                    );
                  }

                  if (m.kind === "video") {
                    return (
                      <video
                        key={m.id}
                        src={m.signedUrl}
                        controls
                        controlsList="nodownload"
                        className="aspect-square w-full rounded-md object-cover bg-navy-900"
                      />
                    );
                  }

                  const photoIndex = photos.findIndex((p) => p.id === m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setLightboxIndex(photoIndex)}
                      className="aspect-square rounded-md overflow-hidden border border-line touch-manipulation"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.signedUrl} alt="" className="w-full h-full object-cover" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="border-t border-line pt-4">
            <button
              type="button"
              onClick={() => onToggleStatus(isResolved ? "unresolved" : "resolved")}
              disabled={isTogglingStatus}
              className={`inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-md transition-colors disabled:opacity-60 ${
                isResolved
                  ? "border border-line text-ink-600 hover:border-rust hover:text-rust"
                  : "bg-forest hover:brightness-95 text-white"
              }`}
            >
              {isResolved ? "Mark as Unresolved" : "Mark as Resolved"}
            </button>
          </div>
        </div>
      </div>

      {lightboxIndex !== null && photos[lightboxIndex]?.signedUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            aria-label="Close preview"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center touch-manipulation"
          >
            <X className="w-5 h-5" />
          </button>

          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
                }}
                aria-label="Previous photo"
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center touch-manipulation"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => (i === null ? i : (i + 1) % photos.length));
                }}
                aria-label="Next photo"
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center touch-manipulation"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[lightboxIndex].signedUrl ?? undefined}
            alt=""
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
