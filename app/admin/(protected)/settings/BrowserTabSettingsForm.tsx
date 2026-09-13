// app/admin/(protected)/settings/BrowserTabSettingsForm.tsx
//
// Split out from BrandingTextForm on purpose: this drives the <title>
// template for the entire public site (app/(site)/layout.tsx's
// generateMetadata reads site_settings.site_title), not just visible
// header/footer copy, so it gets its own card rather than living beside
// unrelated branding fields.

"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Save } from "lucide-react";
import { updateSiteTitle } from "./actions";
import { useUnsavedChangesWarning } from "@/lib/useUnsavedChangesWarning";

const DEFAULT_SITE_TITLE = "Janatar Dipak";

const schema = z.object({
  site_title: z.string().trim().min(1, "Browser tab title can't be blank.").max(80),
});

type FormValues = z.infer<typeof schema>;

export default function BrowserTabSettingsForm({ siteTitle }: { siteTitle: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { site_title: siteTitle || DEFAULT_SITE_TITLE },
  });

  useUnsavedChangesWarning(isDirty);

  const watchedTitle = useWatch({ control, name: "site_title" }) || DEFAULT_SITE_TITLE;

  function submit(values: FormValues) {
    setServerError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateSiteTitle(values.site_title);
        setSaved(true);
        reset(values);
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="bg-white border border-line rounded-xl p-6 md:p-8">
      <p className="text-sm font-semibold text-navy-900 mb-1">Browser Tab Settings</p>
      <p className="text-xs text-ink-400 mb-5">
        The base title shown in browser tabs and search results. Every other page appends it
        automatically (e.g. &ldquo;Notable Works - {watchedTitle}&rdquo;), and the homepage shows it
        alone. Updates apply across the public site immediately, no redeploy needed.
      </p>

      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div>
          <label htmlFor="site_title" className="block text-sm font-medium text-navy-900 mb-1.5">
            Base title
          </label>
          <input
            id="site_title"
            type="text"
            {...register("site_title")}
            placeholder={DEFAULT_SITE_TITLE}
            className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink focus:border-saffron focus:outline-none"
          />
          {errors.site_title && <p className="text-xs text-rust mt-1.5">{errors.site_title.message}</p>}
        </div>

        {serverError && (
          <p className="text-sm text-rust" role="alert">
            {serverError}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className={`inline-flex items-center gap-2 disabled:opacity-60 text-white font-semibold px-5 py-3 rounded-md transition-colors ${
              isDirty
                ? "bg-rust hover:bg-rust/90 shadow-[0_0_0_3px_rgba(180,75,61,0.2)]"
                : "bg-saffron hover:bg-saffron-600"
            }`}
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isPending ? "Saving…" : isDirty ? "Save Changes" : "Save"}
          </button>
          {isDirty && !isPending && (
            <span className="text-xs font-medium text-rust">You have unsaved changes.</span>
          )}
          {saved && !isPending && !isDirty && <span className="text-xs text-forest">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
