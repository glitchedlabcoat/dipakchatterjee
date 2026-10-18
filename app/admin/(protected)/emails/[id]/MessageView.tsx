// app/admin/(protected)/emails/[id]/MessageView.tsx
//
// Text/HTML toggle for a received message, plus read state. Opening an
// unread message marks it read once; "Mark as unread" puts it back.
// The HTML document arrives already sanitized and is rendered in an
// iframe sandbox with no allow-scripts and no allow-same-origin: no
// script can run and the frame can't touch this page, its cookies or
// its storage. Only allow-popups, so a link the admin deliberately
// clicks opens in a new tab (each carries rel="noopener noreferrer").

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailOpen } from "lucide-react";
import { setInboundRead } from "../actions";

export default function MessageView({
  id,
  isRead,
  text,
  htmlDocument,
  blockedImages,
  bodyStatus,
  bodyError,
  truncated,
}: {
  id: string;
  isRead: boolean;
  text: string | null;
  htmlDocument: string | null;
  blockedImages: number;
  bodyStatus: string;
  bodyError: string | null;
  truncated: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"text" | "html">("text");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const markedRef = useRef(false);

  useEffect(() => {
    if (isRead || markedRef.current) return;
    markedRef.current = true;
    setInboundRead({ id, isRead: true }).catch(() => undefined);
  }, [id, isRead]);

  function markUnread() {
    setError(null);
    startTransition(async () => {
      const result = await setInboundRead({ id, isRead: false });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/admin/emails");
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex gap-1.5" role="tablist" aria-label="Message format">
          <button
            type="button"
            role="tab"
            aria-selected={view === "text"}
            onClick={() => setView("text")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md border ${
              view === "text" ? "border-navy-900 bg-navy-900 text-white" : "border-line text-ink-600"
            }`}
          >
            Plain text
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "html"}
            disabled={!htmlDocument}
            onClick={() => setView("html")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md border disabled:opacity-40 ${
              view === "html" ? "border-navy-900 bg-navy-900 text-white" : "border-line text-ink-600"
            }`}
          >
            Formatted (safe view)
          </button>
        </div>
        <button
          type="button"
          onClick={markUnread}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-600 border border-line rounded-md px-2.5 py-1.5 hover:border-navy-900/40 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MailOpen className="w-3.5 h-3.5" />}
          Mark as unread
        </button>
      </div>

      {error && (
        <p className="text-sm text-rust mb-2" role="alert">
          {error}
        </p>
      )}

      {bodyStatus === "pending" && !text && !htmlDocument ? (
        <p className="text-sm text-ink-400 border border-dashed border-line rounded-lg p-6">
          The message body is still being downloaded from Resend. Refresh in a minute.
        </p>
      ) : bodyStatus === "failed" && !text && !htmlDocument ? (
        <p className="text-sm text-rust border border-dashed border-rust/40 rounded-lg p-6">
          The message body couldn&apos;t be downloaded{bodyError ? `: ${bodyError}` : "."}
        </p>
      ) : view === "html" && htmlDocument ? (
        <div>
          {blockedImages > 0 && (
            <p className="text-xs text-ink-400 mb-2">
              {blockedImages} remote image{blockedImages === 1 ? " was" : "s were"} removed (they can be used to track
              when a message is opened).
            </p>
          )}
          <iframe
            title="Message content"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={htmlDocument}
            className="w-full h-[32rem] rounded-lg border border-line bg-white"
          />
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-ink leading-relaxed border border-line rounded-lg p-4 bg-paper-100 max-h-[40rem] overflow-y-auto">
          {text?.trim() || "(This message has no text.)"}
        </pre>
      )}

      {truncated && (
        <p className="text-xs text-ink-400 mt-2">This message was very long and has been shortened. The full copy is in Resend.</p>
      )}
    </div>
  );
}
