// app/admin/(protected)/emails/settings/TestEmailButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { sendTestEmail } from "../actions";

export default function TestEmailButton() {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function send() {
    setMessage(null);
    startTransition(async () => {
      const result = await sendTestEmail();
      setMessage(result.ok ? { ok: true, text: `Test email accepted by Resend for ${result.to}.` } : { ok: false, text: result.error });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={send}
        disabled={isPending}
        className="inline-flex items-center gap-2 border border-line hover:border-navy-900/40 text-sm font-semibold text-navy-900 px-4 py-2 rounded-md disabled:opacity-60"
      >
        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Send a test email to myself
      </button>
      {message && (
        <span className={`text-xs ${message.ok ? "text-forest" : "text-rust"}`} role={message.ok ? "status" : "alert"}>
          {message.text}
        </span>
      )}
    </div>
  );
}
