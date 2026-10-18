// components/complaints/ComplaintForm.tsx
//
// Fields: Description, Phone Number (optional), Email (optional; only
// used for a receipt with the reference number), and an optional Media
// Upload. Unlike before, attachments are no longer staged as raw
// Files and uploaded on submit through a Server Action — each one is
// compressed and streamed straight to Cloudflare R2 the moment it's
// picked (see ComplaintMediaPicker), so by the time this form submits
// it only needs to send the resulting {key, kind} pairs, not any file
// bytes (see app/(site)/complaints/actions.ts).

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Loader2, Send } from "lucide-react";
import ComplaintMediaPicker, { type StagedMedia } from "@/components/complaints/ComplaintMediaPicker";
import { submitComplaint } from "@/app/(site)/complaints/actions";
import { formatReferenceNumber } from "@/lib/reference";
import { isValidEmail, MAX_EMAIL_LENGTH, normalizeEmail } from "@/lib/email/address";

const formSchema = z.object({
  description: z.string().trim().min(20, "Please describe the issue in at least 20 characters.").max(5000),
  contact_phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || v.length >= 6, "Please enter a valid phone number, or leave this blank."),
  contact_email: z
    .string()
    .trim()
    .max(MAX_EMAIL_LENGTH, "That email address is too long.")
    .refine((v) => v === "" || isValidEmail(normalizeEmail(v)), "Please enter a valid email address, or leave this blank."),
  consent: z.boolean().refine((v) => v, "Please confirm this to submit your complaint."),
});

type FormValues = z.infer<typeof formSchema>;

export default function ComplaintForm() {
  const [draftId] = useState(() => crypto.randomUUID());
  const [media, setMedia] = useState<StagedMedia[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<{ referenceId: string; receiptQueued: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { description: "", contact_phone: "", contact_email: "", consent: false },
  });

  function submit(values: FormValues) {
    setServerError(null);
    startTransition(async () => {
      const res = await submitComplaint({
        description: values.description,
        contact_phone: values.contact_phone,
        contact_email: values.contact_email,
        consent: values.consent,
        draftId,
        media,
      });

      if (!res.success) {
        setServerError(res.error);
        if (res.fieldErrors?.contact_email) setError("contact_email", { message: res.fieldErrors.contact_email });
        return;
      }

      setMedia([]);
      setResult({ referenceId: res.referenceId, receiptQueued: res.receiptQueued });
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
        {result.receiptQueued && (
          <p className="text-sm text-ink-600 max-w-sm mx-auto mt-2">
            We&apos;re also emailing you a confirmation with this number. It can take a few minutes; check
            your spam folder if you don&apos;t see it.
          </p>
        )}
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
    // noValidate: the email input's native type="email" check would
    // otherwise pop a browser tooltip before the schema runs; this way
    // every field shows the same inline message.
    <form onSubmit={handleSubmit(submit)} noValidate className="space-y-5">
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
        <label htmlFor="contact_email" className="block text-sm font-medium text-navy-900 mb-1.5">
          Email <span className="text-ink-400 font-normal">(optional)</span>
        </label>
        <input
          id="contact_email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={MAX_EMAIL_LENGTH}
          {...register("contact_email")}
          placeholder="you@example.com"
          aria-describedby="contact_email_help"
          aria-invalid={errors.contact_email ? true : undefined}
          className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink placeholder:text-ink-400 focus:border-[var(--theme-primary)] focus:outline-none"
        />
        <p id="contact_email_help" className="text-xs text-ink-400 mt-1.5">
          If you add your email, we&apos;ll send you a confirmation with your reference number. The office
          may also use it to reply. You can leave it blank.
        </p>
        {errors.contact_email && (
          <p className="text-xs text-rust mt-1.5">{errors.contact_email.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-navy-900 mb-1.5">
          Media Upload <span className="text-ink-400 font-normal">(optional)</span>
        </label>

        <ComplaintMediaPicker draftId={draftId} onChange={(next, busy) => { setMedia(next); setMediaBusy(busy); }} />
      </div>

      <div>
        <label htmlFor="consent" className="flex items-start gap-2.5 text-sm text-ink-600 leading-relaxed">
          <input
            id="consent"
            type="checkbox"
            {...register("consent")}
            className="mt-1 shrink-0 rounded border-line"
          />
          <span>
            I have read the{" "}
            <Link href="/privacy" target="_blank" className="text-[var(--theme-primary)] font-medium underline">
              privacy notice
            </Link>{" "}
            and agree that my complaint, contact details and attachments are shared with the office
            only to resolve this issue. I am 18 or older, or I am a parent or guardian submitting on a
            minor&apos;s behalf. <span className="text-rust">*</span>
          </span>
        </label>
        {errors.consent && <p className="text-xs text-rust mt-1.5">{errors.consent.message}</p>}
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

    </form>
  );
}
