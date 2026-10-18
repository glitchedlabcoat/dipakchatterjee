// app/admin/(protected)/emails/TrashButton.tsx
//
// "Move to Trashed" / "Restore" for one message (sent, draft or received).
// Soft delete only: the server keeps the row and can restore it. The
// server re-checks everything (who may, and that the message isn't still
// being sent), so this button is a convenience, not the rule.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { moveToTrash, restoreFromTrash } from "./actions";

export default function TrashButton({
  id,
  type,
  trashed,
  afterHref,
  compact = false,
}: {
  id: string;
  type: "message" | "inbound";
  trashed: boolean;
  /** Where to go after the move; stays on the page (refresh) when omitted. */
  afterHref?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const result = trashed ? await restoreFromTrash({ id, type }) : await moveToTrash({ id, type });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (afterHref) router.push(afterHref);
      else router.refresh();
    });
  }

  const Icon = isPending ? Loader2 : trashed ? RotateCcw : Trash2;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className={`inline-flex items-center gap-1.5 font-semibold text-ink-600 border border-line rounded-md hover:border-navy-900/40 disabled:opacity-60 ${
          compact ? "text-xs px-2.5 py-1.5" : "text-sm px-3 py-2"
        }`}
      >
        <Icon className={`${compact ? "w-3.5 h-3.5" : "w-4 h-4"} ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
        {trashed ? "Restore" : "Move to Trashed"}
      </button>
      {error && (
        <span className="text-xs text-rust" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
