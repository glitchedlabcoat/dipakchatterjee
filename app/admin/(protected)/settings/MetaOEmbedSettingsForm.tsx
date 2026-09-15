// app/admin/(protected)/settings/MetaOEmbedSettingsForm.tsx
//
// "Official Meta oEmbed API Settings" card: App ID / App Secret used to
// authenticate against Meta's Graph API oEmbed endpoints, a walkthrough
// for a non-technical admin to go get them, and a "Test Connection"
// button that checks whatever's currently in the fields (not
// necessarily saved yet) against Meta's API. See
// app/admin/(protected)/settings/integration-actions.ts for why these
// live in their own table instead of site_settings, and lib/embed.ts /
// components/posts/PostEmbed.tsx for how embeds actually render on the
// public site today — that rendering path doesn't change based on
// whether credentials are configured here.

"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, ExternalLink, Loader2, Save, XCircle } from "lucide-react";
import { updateMetaCredentials, testMetaConnection, type MetaConnectionTestResult } from "./integration-actions";
import PasswordInput from "@/components/admin/PasswordInput";
import { useUnsavedChangesWarning } from "@/lib/useUnsavedChangesWarning";

const schema = z.object({
  meta_app_id: z.string().trim().max(60).optional(),
  meta_app_secret: z.string().trim().max(120).optional(),
});

type FormValues = z.infer<typeof schema>;

const WALKTHROUGH_STEPS = [
  <>
    Navigate to{" "}
    <a
      href="https://developers.facebook.com"
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-saffron-600 hover:underline"
    >
      developers.facebook.com
    </a>{" "}
    and log in with the Dipak Chatterjee administrator account.
  </>,
  <>
    Click <strong>&ldquo;Create App&rdquo;</strong> &rarr; select <strong>&ldquo;Other&rdquo;</strong> &rarr; select{" "}
    <strong>&ldquo;Business&rdquo;</strong>.
  </>,
  <>
    Under Dashboard, locate <strong>&ldquo;App ID&rdquo;</strong> and <strong>&ldquo;App Secret&rdquo;</strong> (or
    generate a Client Token via App Settings &rarr; Advanced).
  </>,
  <>Paste the credentials into the fields below and click Save.</>,
];

export default function MetaOEmbedSettingsForm({ appId, appSecret }: { appId: string; appSecret: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [testResult, setTestResult] = useState<MetaConnectionTestResult | null>(null);
  const [isTesting, startTest] = useTransition();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { meta_app_id: appId, meta_app_secret: appSecret },
  });

  useUnsavedChangesWarning(isDirty);

  const watchedAppId = useWatch({ control, name: "meta_app_id" }) ?? "";
  const watchedAppSecret = useWatch({ control, name: "meta_app_secret" }) ?? "";

  function submit(values: FormValues) {
    setServerError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateMetaCredentials({
          meta_app_id: values.meta_app_id ?? "",
          meta_app_secret: values.meta_app_secret ?? "",
        });
        setSaved(true);
        reset(values);
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function handleTestConnection() {
    setTestResult(null);
    startTest(async () => {
      const result = await testMetaConnection({ meta_app_id: watchedAppId, meta_app_secret: watchedAppSecret });
      setTestResult(result);
    });
  }

  return (
    <div className="bg-white border border-line rounded-xl p-6 md:p-8">
      <p className="text-sm font-semibold text-navy-900 mb-1">Official Meta oEmbed API Settings</p>
      <p className="text-xs text-ink-400 mb-5">
        Credentials used to authenticate Facebook/Instagram embed requests against Meta&apos;s Graph API. Never
        shown on the public site — only used server-side.
      </p>

      <div className="rounded-md border border-line bg-paper-100 p-4 mb-5">
        <p className="text-xs font-semibold text-navy-900 mb-2">How to get these credentials</p>
        <ol className="space-y-1.5 text-xs text-ink-600 list-decimal list-inside">
          {WALKTHROUGH_STEPS.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div>
          <label htmlFor="meta_app_id" className="block text-sm font-medium text-navy-900 mb-1.5">
            App ID
          </label>
          <input
            id="meta_app_id"
            type="text"
            {...register("meta_app_id")}
            placeholder="1234567890123456"
            className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink focus:border-saffron focus:outline-none"
          />
          {errors.meta_app_id && <p className="text-xs text-rust mt-1.5">{errors.meta_app_id.message}</p>}
        </div>

        <div>
          <PasswordInput
            label="App Secret"
            value={watchedAppSecret}
            onChange={(value) => setValue("meta_app_secret", value, { shouldDirty: true })}
            placeholder="Paste your App Secret"
            required={false}
          />
          {errors.meta_app_secret && <p className="text-xs text-rust mt-1.5">{errors.meta_app_secret.message}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className="inline-flex items-center gap-2 disabled:opacity-60 text-navy-900 font-semibold px-4 py-2.5 rounded-md border border-line bg-white hover:border-saffron transition-colors text-sm"
          >
            {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            {isTesting ? "Testing…" : "Test Connection"}
          </button>

          {testResult && !isTesting && (
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full ${
                testResult.ok ? "bg-forest-100 text-forest" : "bg-rust/10 text-rust"
              }`}
            >
              {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {testResult.message}
            </span>
          )}
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
