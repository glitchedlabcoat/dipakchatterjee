// app/admin/(protected)/posts/PostForm.tsx
"use client";

import { useState, useTransition } from "react";
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, Loader2, Plus, Save, Trash2 } from "lucide-react";
import type { Post, PostLink } from "@/types/domain";
import type { PostFormInput } from "./actions";
import { useUnsavedChangesWarning } from "@/lib/useUnsavedChangesWarning";
import { getEmbedInfo } from "@/lib/embed";

// Deliberately just "non-empty", not a strict URL() format check: an
// embed/button link should persist whatever the admin typed even if
// it's unverified or turns out broken — no blocking pre-validation.
const linkSchema = z.object({
  id: z.string(),
  url: z.string().trim().min(1, "URL is required"),
  type: z.enum(["button", "embed"]),
  label: z.string().trim().max(80).optional(),
});

// Empty is always valid (falls back to the DB's own `default now()` —
// see actions.ts); a non-empty value must actually parse, so a
// devtools-edited/extension-injected value can't reach the server
// action and throw "RangeError: Invalid time value" there instead of
// failing here with a normal form error.
const isEmptyOrParseableDate = (value: string | undefined) => !value || !Number.isNaN(new Date(value).getTime());

const postSchema = z.object({
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().max(20000).optional(),
  published_at: z.string().optional().refine(isEmptyOrParseableDate, "Enter a valid date and time."),
  published_date: z.string().optional().refine(isEmptyOrParseableDate, "Enter a valid date."),
  show_published_time: z.boolean(),
  is_published: z.boolean(),
  links: z.array(linkSchema).max(10),
  // Registered with { valueAsNumber: true } below, so RHF already hands
  // this a number — no z.coerce needed (and z.coerce's input/output
  // type split trips up zodResolver's inference with useForm here).
  slideshow_interval: z.number().min(0).max(10),
});

type PostFormValues = z.infer<typeof postSchema>;

/** "YYYY-MM-DDTHH:mm" in the browser's local time, for a datetime-local input's value/default. */
function toLocalDatetimeInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** "YYYY-MM-DD" in the browser's local time, for a date-only input's value/default. */
function toLocalDateInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function newLinkId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `link-${Date.now()}`;
}

// One link row, as its own component (not inlined in the parent's
// .map()) specifically so it can call useWatch for just this row's own
// url/type — calling a hook conditionally inside a .map() callback in
// the parent would violate the rules of hooks the moment a link is
// added or removed (a changing number of hook calls between renders).
// Each LinkRow instance's own hook calls stay stable across renders
// regardless of how many total rows exist.
function LinkRow({
  index,
  control,
  register,
  errors,
  remove,
  setValue,
}: {
  index: number;
  control: Control<PostFormValues>;
  register: UseFormRegister<PostFormValues>;
  errors: FieldErrors<PostFormValues>;
  remove: (index: number) => void;
  setValue: UseFormSetValue<PostFormValues>;
}) {
  const url = useWatch({ control, name: `links.${index}.url` as const });
  const type = useWatch({ control, name: `links.${index}.type` as const });

  const embedInfo = type === "embed" ? getEmbedInfo(url) : null;
  const showEmbedWarning = type === "embed" && Boolean(url?.trim()) && !embedInfo;
  const showMetaGuidance = embedInfo?.provider === "facebook" || embedInfo?.provider === "instagram";

  return (
    <li className="rounded-md border border-line bg-paper-100 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[200px]">
          <input
            {...register(`links.${index}.url` as const)}
            placeholder="https://..."
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-saffron focus:outline-none"
          />
          {errors.links?.[index]?.url && (
            <p className="text-xs text-rust mt-1">{errors.links[index]?.url?.message}</p>
          )}
        </div>

        <select
          {...register(`links.${index}.type` as const)}
          className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-saffron focus:outline-none"
        >
          <option value="embed">Embed</option>
          <option value="button">Button</option>
        </select>

        {type === "button" && (
          <input
            {...register(`links.${index}.label` as const)}
            placeholder="View on Facebook"
            className="w-40 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-saffron focus:outline-none"
          />
        )}

        <button
          type="button"
          onClick={() => remove(index)}
          aria-label="Remove link"
          className="shrink-0 w-9 h-9 rounded-md border border-line bg-white flex items-center justify-center text-ink-600 hover:border-rust hover:text-rust"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {showEmbedWarning && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-saffron-100 bg-saffron-100/70 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs text-saffron-600">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            This link cannot be embedded directly. We recommend switching to &ldquo;Button&rdquo; mode.
          </span>
          <button
            type="button"
            onClick={() => setValue(`links.${index}.type` as const, "button", { shouldDirty: true })}
            className="shrink-0 text-xs font-semibold text-saffron-600 underline hover:no-underline"
          >
            Switch to Button
          </button>
        </div>
      )}

      {showMetaGuidance && (
        <p className="mt-2 text-xs text-ink-400">
          Note: Meta embeds require the source post/reel to be set to &ldquo;Public&rdquo; 🌐 on
          Facebook/Instagram.
        </p>
      )}
    </li>
  );
}

export default function PostForm({
  post,
  onSubmit,
}: {
  post?: Post;
  onSubmit: (input: PostFormInput) => Promise<void>;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<PostFormValues>({
    resolver: zodResolver(postSchema),
    defaultValues: {
      title: post?.title ?? "",
      body: post?.body ?? "",
      published_at: toLocalDatetimeInputValue(post ? new Date(post.published_at) : new Date()),
      published_date: toLocalDateInputValue(post ? new Date(post.published_at) : new Date()),
      show_published_time: post?.show_published_time ?? true,
      is_published: post?.is_published ?? false,
      links: ((post?.links as unknown as PostLink[]) ?? []).map((l) => ({ ...l, label: l.label ?? "" })),
      slideshow_interval: post?.slideshow_interval ?? 0,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "links" });

  useUnsavedChangesWarning(isDirty);

  const showPublishedTime = useWatch({ control, name: "show_published_time" });

  function submit(values: PostFormValues) {
    setServerError(null);
    startTransition(async () => {
      try {
        await onSubmit({
          title: values.title ?? "",
          body: values.body ?? "",
          published_at: values.show_published_time
            ? values.published_at ?? ""
            : values.published_date
              ? `${values.published_date}T00:00`
              : "",
          show_published_time: values.show_published_time,
          is_published: values.is_published,
          links: values.links.map((l) => ({ ...l, label: l.label || undefined })),
          slideshow_interval: values.slideshow_interval,
        });
        // Re-baselines the form on the just-saved values so isDirty
        // (and the unsaved-changes guard it drives) clears — without
        // this, a successful save would still read as "unsaved" until
        // the next full page load.
        reset(values);
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5">
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-navy-900 mb-1.5">
          Title
        </label>
        <input
          id="title"
          {...register("title")}
          placeholder="Optional headline"
          className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink focus:border-saffron focus:outline-none"
        />
        {errors.title && <p className="text-xs text-rust mt-1.5">{errors.title.message}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={showPublishedTime ? "published_at" : "published_date"} className="block text-sm font-medium text-navy-900">
            Publication date{showPublishedTime ? " & time" : ""}
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-ink-600">
            <input
              type="checkbox"
              {...register("show_published_time")}
              className="w-3.5 h-3.5 rounded border-line text-saffron focus:ring-saffron"
            />
            Include time
          </label>
        </div>

        {showPublishedTime ? (
          <input
            id="published_at"
            type="datetime-local"
            {...register("published_at")}
            className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink focus:border-saffron focus:outline-none"
          />
        ) : (
          <input
            id="published_date"
            type="date"
            {...register("published_date")}
            className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink focus:border-saffron focus:outline-none"
          />
        )}

        <p className="text-xs text-ink-400 mt-1.5">
          Backdate this to publish a historical update. Defaults to now if left blank. Uncheck
          &ldquo;Include time&rdquo; to show visitors just the date, e.g. &ldquo;December 30,
          2021&rdquo; instead of &ldquo;December 30, 2021 at 11:00 PM&rdquo;.
        </p>
        {errors.published_at && (
          <p className="text-xs text-rust mt-1.5">{errors.published_at.message}</p>
        )}
        {errors.published_date && (
          <p className="text-xs text-rust mt-1.5">{errors.published_date.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-navy-900 mb-1.5">Links</label>
        <p className="text-xs text-ink-400 mb-3">
          Add any number of links. <strong>Embed</strong> renders as a live embed beside the post
          text when the URL is a recognized YouTube, Instagram, or Facebook link. <strong>Button</strong>{" "}
          always renders as a plain call-to-action (e.g. &ldquo;View on Facebook&rdquo;) below the text.
        </p>

        {fields.length > 0 && (
          <ul className="space-y-2 mb-3">
            {fields.map((field, index) => (
              <LinkRow
                key={field.id}
                index={index}
                control={control}
                register={register}
                errors={errors}
                remove={remove}
                setValue={setValue}
              />
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => append({ id: newLinkId(), url: "", type: "embed", label: "" })}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-saffron-600 hover:text-saffron"
        >
          <Plus className="w-4 h-4" />
          Add Link
        </button>
      </div>

      <div>
        <label htmlFor="body" className="block text-sm font-medium text-navy-900 mb-1.5">
          Description
        </label>
        <textarea
          id="body"
          rows={6}
          {...register("body")}
          className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink focus:border-saffron focus:outline-none resize-y"
        />
        {errors.body && <p className="text-xs text-rust mt-1.5">{errors.body.message}</p>}
      </div>

      <div>
        <label htmlFor="slideshow_interval" className="block text-sm font-medium text-navy-900 mb-1.5">
          Slideshow interval (seconds)
        </label>
        <input
          id="slideshow_interval"
          type="number"
          min={0}
          max={10}
          step={0.1}
          {...register("slideshow_interval", { valueAsNumber: true })}
          className="w-32 rounded-md border border-line bg-white px-4 py-3 text-sm text-ink focus:border-saffron focus:outline-none"
        />
        <p className="text-xs text-ink-400 mt-1.5">
          How long each image shows before auto-advancing, when this post has multiple images
          (0-10 seconds, decimals like <strong>2.5</strong> allowed). Set to <strong>0</strong> to
          disable auto-advance entirely — visitors can still navigate manually with the
          arrows/dots.
        </p>
        {errors.slideshow_interval && (
          <p className="text-xs text-rust mt-1.5">{errors.slideshow_interval.message}</p>
        )}
      </div>

      <label className="flex items-center gap-2.5 text-sm text-navy-900 font-medium">
        <input
          type="checkbox"
          {...register("is_published")}
          className="w-4 h-4 rounded border-line text-saffron focus:ring-saffron"
        />
        Published (visible on the public site)
      </label>

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
      </div>
    </form>
  );
}
