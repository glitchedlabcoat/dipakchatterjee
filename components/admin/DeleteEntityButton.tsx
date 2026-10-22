// components/admin/DeleteEntityButton.tsx
//
// Confirm, call the bound delete Server Action, then leave the (now gone)
// edit page. Shared by the Feature and Post edit screens.

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

export default function DeleteEntityButton({
  label,
  confirmMessage,
  redirectTo,
  onDelete,
  className = "inline-flex items-center gap-2 text-sm font-semibold text-rust hover:text-rust/80 disabled:opacity-60",
}: {
  label: string;
  confirmMessage: string;
  redirectTo: string;
  onDelete: () => Promise<void>;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm(confirmMessage)) return;
    startTransition(async () => {
      await onDelete();
      router.push(redirectTo);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={className}
    >
      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
      {isPending ? "Deleting…" : label}
    </button>
  );
}
