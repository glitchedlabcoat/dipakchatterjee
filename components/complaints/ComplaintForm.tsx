// components/complaints/ComplaintForm.tsx
//
// Exactly three fields: Description, Phone Number, and an optional
// Media Upload. Unlike before, attachments are no longer staged as raw
// Files and uploaded on submit through a Server Action — each one is
// compressed and streamed straight to Cloudflare R2 the moment it's
// picked (see ComplaintMediaPicker), so by the time this form submits
// it only needs to send the resulting {key, kind} pairs, not any file
// bytes (see app/(site)/complaints/actions.ts).

"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Loader2, Send } from "lucide-react";
import ComplaintMediaPicker, { type StagedMedia } from "@/components/complaints/ComplaintMediaPicker";
import { submitComplaint } from "@/app/(site)/complaints/actions";
import { formatReferenceNumber } from "@/lib/reference";

const formSchema = z.object({
  description: z.string().trim().min(20, "Please describe the issue in at least 20 characters.").max(5000),
  contact_phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || v.length >= 6, "Please enter a valid phone number, or leave this blank."),
});

type FormValues = z.infer<typeof formSchema>;

export default function ComplaintForm() {
  const [draftId] = useState(() => crypto.randomUUID());
  const [media, setMedia] = useState<StagedMedia[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<{ referenceId: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { description: "", contact_phone: "" },
  });

  function submit(values: FormValues) {
    setServerError(null);
    startTransition(async () => {
      const res = await submitComplaint({
        description: values.description,
        contact_phone: values.contact_phone,
        media,
      });

      if (!res.success) {
        setServerError(res.error);
        return;
      }

      setMedia([]);
      setResult({ referenceId: res.referenceId });
      reset();
    });
  }

  if (result) {
    return (
      <div className="text-center py-10">
        <div className="w-14 h-14 rounded-full bg-forest-100 text-forest flex items-center justify-center mx-auto mb-5">
          <Check className="w-7 h-7" />
        </div>
        <h3 className="font-display text-xl text-navy-900 mb-2">Your complaint has been logged</h3>
        <p className="text-sm text-ink-600 max-w-sm mx-auto mb-1">
          Reference number
        </p>
        <p className="font-display text-2xl text-navy-900 tracking-wide">
          {formatReferenceNumber(result.referenceId)}
        </p>
        <p className="text-sm text-ink-600 max-w-sm mx-auto mt-3">
          Please keep this number for any follow-up.
        </p>
        <button
          type="button"
          onClick={() => setResult(null)}
          className="mt-6 text-sm font-semibold text-[var(--theme-primary)] hover:opacity-80"
        >
          Submit another complaint
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5">
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-navy-900 mb-1.5">
          Description <span className="text-rust">*</span>
        </label>
        <textarea
          id="description"
          rows={6}
          {...register("description")}
          placeholder="Describe the issue: what happened, when, where, and who else is affected."
          className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink placeholder:text-ink-400 focus:border-[var(--theme-primary)] focus:outline-none resize-y"
        />
        {errors.description && (
          <p className="text-xs text-rust mt-1.5">{errors.description.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="contact_phone" className="block text-sm font-medium text-navy-900 mb-1.5">
          Phone Number <span className="text-ink-400 font-normal">(optional)</span>
        </label>
        <input
          id="contact_phone"
          type="tel"
          {...register("contact_phone")}
          placeholder="10-digit mobile number"
          className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink placeholder:text-ink-400 focus:border-[var(--theme-primary)] focus:outline-none"
        />
        {errors.contact_phone && (
          <p className="text-xs text-rust mt-1.5">{errors.contact_phone.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-navy-900 mb-1.5">
          Media Upload <span className="text-ink-400 font-normal">(optional)</span>
        </label>

        <ComplaintMediaPicker draftId={draftId} onChange={(next, busy) => { setMedia(next); setMediaBusy(busy); }} />
      </div>

      {serverError && (
        <p className="text-sm text-rust" role="alert">
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || mediaBusy}
        className="w-full bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-hover)] disabled:opacity-60 text-white font-semibold py-3.5 rounded-md transition-colors flex items-center justify-center gap-2"
      >
        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {isPending ? "Submitting…" : mediaBusy ? "Waiting for uploads…" : "Submit Complaint"}
      </button>

      <p className="text-xs text-ink-400 text-center leading-relaxed">
        By submitting, you agree that your details are shared with our office for the sole
        purpose of resolving this issue.
      </p>
    </form>
  );
}
