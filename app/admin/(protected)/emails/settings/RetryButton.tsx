// app/admin/(protected)/emails/settings/RetryButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { retryEmailMessage } from "../actions";

export default function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await retryEmailMessage({ id });
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={retry}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-600 border border-line rounded-md px-2.5 py-1.5 hover:border-navy-900/40 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
        Retry
      </button>
      {error && (
        <span className="text-xs text-rust" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
