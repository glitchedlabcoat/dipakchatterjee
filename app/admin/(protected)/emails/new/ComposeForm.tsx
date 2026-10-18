// app/admin/(protected)/emails/new/ComposeForm.tsx
//
// The composer. Save draft writes to the database (the URL then carries
// ?draft=<id>, so a reload resumes it); Send goes through the server,
// which validates everything again and reports "sent" only once Resend
// accepted the message. One composition = one email: the requestId (or
// the draft) is the server's duplicate guard, so a double-click or a
// retried request can't send twice.
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Send, Trash2 } from "lucide-react";
import { MAX_BODY, MAX_SUBJECT, MAX_TO_FIELD } from "@/lib/email/mailbox";
import { moveToTrash, saveDraft, sendComposedEmail } from "../actions";

export type ComposeInitial = {
  draftId: string;
  requestId: string | null;
  to: string;
  subject: string;
  body: string;
  updatedAt: string;
};

type Busy = "save" | "send" | "discard" | null;

export default function ComposeForm({
  initial,
  canSend,
  canSave,
}: {
  initial: ComposeInitial | null;
  canSend: boolean;
  canSave: boolean;
}) {
  const router = useRouter();
  const [requestId, setRequestId] = useState(() => initial?.requestId ?? crypto.randomUUID());
  const [draftId, setDraftId] = useState<string | null>(initial?.draftId ?? null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initial?.updatedAt ?? null);
  const [to, setTo] = useState(initial?.to ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [, startTransition] = useTransition();

  // Leaving with unsaved changes asks first (reload, close, typed URL).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function edit<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
      setSavedAt(null);
    };
  }

  function run(kind: Exclude<Busy, null>, task: () => Promise<void>) {
    setError(null);
    setBusy(kind);
    startTransition(async () => {
      try {
        await task();
      } finally {
        setBusy(null);
      }
    });
  }

  function save() {
    run("save", async () => {
      const result = await saveDraft({ draftId, requestId, expectedUpdatedAt: updatedAt, to, subject, body });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraftId(result.draftId);
      setUpdatedAt(result.updatedAt);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }));
      window.history.replaceState(null, "", `/admin/emails/new?draft=${result.draftId}`);
    });
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    run("send", async () => {
      const result = await sendComposedEmail({ requestId, draftId, expectedUpdatedAt: updatedAt, to, subject, body });
      if (!result.ok) {
        setError(result.error);
        if ("queuedId" in result && result.queuedId) {
          // It's in the Outbox now (Resend refused it). Keep the text so it
          // can be fixed, but as a new message, never the same one again.
          setDraftId(null);
          setUpdatedAt(null);
          setRequestId(crypto.randomUUID());
          setDirty(true);
          window.history.replaceState(null, "", "/admin/emails/new");
        }
        return;
      }
      setDirty(false);
      router.push(`/admin/emails/message/${result.id}`);
    });
  }

  function discard() {
    if (!draftId) {
      setTo("");
      setSubject("");
      setBody("");
      setDirty(false);
      return;
    }
    if (!window.confirm("Move this draft to Trashed? You can restore it from Trashed.")) return;
    run("discard", async () => {
      const result = await moveToTrash({ id: draftId, type: "message" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDirty(false);
      router.push("/admin/emails/drafts");
    });
  }

  const inputClass =
    "w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink placeholder:text-ink-400 focus:border-saffron focus:outline-none";
  const isBusy = busy !== null;

  return (
    <form onSubmit={send} className="space-y-5" noValidate>
      <div>
        <label htmlFor="compose-to" className="block text-sm font-medium text-navy-900 mb-1.5">
          To
        </label>
        <input
          id="compose-to"
          type="text"
          inputMode="email"
          autoComplete="off"
          maxLength={MAX_TO_FIELD}
          value={to}
          onChange={(e) => edit(setTo)(e.target.value)}
          placeholder="name@example.com, another@example.com"
          aria-describedby="compose-to-help"
          className={inputClass}
        />
        <p id="compose-to-help" className="text-xs text-ink-400 mt-1.5">
          Up to 10 addresses, separated by commas. Every recipient sees the others.
        </p>
      </div>

      <div>
        <label htmlFor="compose-subject" className="block text-sm font-medium text-navy-900 mb-1.5">
          Subject
        </label>
        <input
          id="compose-subject"
          type="text"
          maxLength={MAX_SUBJECT}
          value={subject}
          onChange={(e) => edit(setSubject)(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="compose-body" className="block text-sm font-medium text-navy-900 mb-1.5">
          Message
        </label>
        <textarea
          id="compose-body"
          rows={12}
          maxLength={MAX_BODY}
          value={body}
          onChange={(e) => edit(setBody)(e.target.value)}
          aria-describedby="compose-body-help"
          className={`${inputClass} resize-y`}
        />
        <p id="compose-body-help" className="text-xs text-ink-400 mt-1.5">
          Plain text. Blank lines start new paragraphs. {body.length.toLocaleString("en-IN")} /{" "}
          {MAX_BODY.toLocaleString("en-IN")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isBusy || !canSend}
          className="inline-flex items-center gap-2 bg-saffron hover:bg-saffron-600 disabled:opacity-60 text-white font-semibold px-5 py-3 rounded-md transition-colors"
        >
          {busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {busy === "send" ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isBusy || !canSave}
          className="inline-flex items-center gap-2 border border-line hover:border-navy-900/40 text-sm font-semibold text-navy-900 px-4 py-3 rounded-md disabled:opacity-60"
        >
          {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {busy === "save" ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={discard}
          disabled={isBusy}
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink-600 hover:text-rust px-2 py-3 disabled:opacity-60"
        >
          {busy === "discard" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          {draftId ? "Discard draft" : "Clear"}
        </button>
        <span className="text-xs text-ink-400" role="status" aria-live="polite">
          {savedAt ? `Draft saved at ${savedAt}.` : dirty ? "Unsaved changes." : draftId ? "Draft saved." : ""}
        </span>
      </div>

      {error && (
        <p className="text-sm text-rust" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
