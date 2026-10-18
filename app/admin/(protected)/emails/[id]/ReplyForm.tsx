// app/admin/(protected)/emails/[id]/ReplyForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Reply } from "lucide-react";
import { sendReply } from "../actions";

const MAX_BODY = 20_000;

export default function ReplyForm({ inboundId, to }: { inboundId: string; to: string }) {
  const router = useRouter();
  // One id per draft: a double-click resubmits the same id, which the
  // server recognises instead of sending twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await sendReply({ requestId, inboundId, body });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(
        result.status === "sent"
          ? { tone: "ok", text: `Reply accepted by Resend for ${result.to}.` }
          : { tone: "warn", text: result.note ?? "Your reply is in the Outbox and will be sent shortly." }
      );
      setBody("");
      setRequestId(crypto.randomUUID());
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-ink-400">
        To <span className="text-ink-600 break-all">{to}</span>, from the office sender set in Settings. Your reply is
        sent as plain text.
      </p>
      <label htmlFor="reply-body" className="sr-only">
        Reply
      </label>
      <textarea
        id="reply-body"
        rows={6}
        maxLength={MAX_BODY}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink focus:border-saffron focus:outline-none resize-y"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending || body.trim() === ""}
          className="inline-flex items-center gap-2 bg-saffron hover:bg-saffron-600 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-md transition-colors"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Reply className="w-4 h-4" />}
          {isPending ? "Sending…" : "Send reply"}
        </button>
        {done && !isPending && (
          <span className={`text-xs ${done.tone === "ok" ? "text-forest" : "text-saffron-600"}`} role="status">
            {done.text}
          </span>
        )}
      </div>
      {error && (
        <p className="text-sm text-rust" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
