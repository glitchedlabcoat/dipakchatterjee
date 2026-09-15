// app/admin/(protected)/settings/SeoSnippetForm.tsx
//
// Google Search Snippet Editor: the one place that owns site_title (the
// browser tab <title>, the search result's bolded title, AND what the
// task/spec calls "Search Title" — same field, one source of truth
// rather than a second, redundant column), meta_description ("Search
// Description"), and search_tags ("Search Tags & Keywords"). All three
// feed app/(site)/layout.tsx's generateMetadata (title/description/
// keywords/OpenGraph/JSON-LD) on save — see that file and lib/cache.ts
// for why the public site sees the change immediately via
// revalidatePublicPages()/revalidateTag(TAG_SETTINGS).

"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, Save, X } from "lucide-react";
import { updateSeoSettings } from "./actions";
import { useUnsavedChangesWarning } from "@/lib/useUnsavedChangesWarning";

const DEFAULT_SITE_TITLE = "Janatar Dipak";
const SITE_URL = "https://janatardipak.com";
const TITLE_RECOMMENDED_MAX = 60;
const DESCRIPTION_RECOMMENDED_MIN = 140;
const DESCRIPTION_RECOMMENDED_MAX = 160;
const MAX_TAGS = 20;

const schema = z.object({
  site_title: z.string().trim().min(1, "Search title can't be blank.").max(80),
  meta_description: z.string().trim().max(320, "Keep it under 320 characters.").optional(),
  search_tags: z.array(z.string().trim().min(1)).max(MAX_TAGS),
});

type FormValues = z.infer<typeof schema>;

function TitleCounterHint({ length }: { length: number }) {
  const overLimit = length > TITLE_RECOMMENDED_MAX;
  const color = length === 0 ? "text-ink-400" : overLimit ? "text-rust" : "text-forest";

  return (
    <span className={`text-xs font-medium ${color}`}>
      {length} characters <span className="text-ink-400 font-normal">(recommended up to {TITLE_RECOMMENDED_MAX})</span>
    </span>
  );
}

function DescriptionCounterHint({ length }: { length: number }) {
  const inRange = length >= DESCRIPTION_RECOMMENDED_MIN && length <= DESCRIPTION_RECOMMENDED_MAX;
  const color = length === 0 ? "text-ink-400" : inRange ? "text-forest" : "text-rust";

  return (
    <span className={`text-xs font-medium ${color}`}>
      {length} characters{" "}
      <span className="text-ink-400 font-normal">
        (recommended {DESCRIPTION_RECOMMENDED_MIN}&ndash;{DESCRIPTION_RECOMMENDED_MAX})
      </span>
    </span>
  );
}

export default function SeoSnippetForm({
  siteTitle,
  metaDescription,
  searchTags,
}: {
  siteTitle: string;
  metaDescription: string;
  searchTags: string[];
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [tagDraft, setTagDraft] = useState("");

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      site_title: siteTitle || DEFAULT_SITE_TITLE,
      meta_description: metaDescription,
      search_tags: searchTags,
    },
  });

  useUnsavedChangesWarning(isDirty);

  const watchedTitle = useWatch({ control, name: "site_title" }) || DEFAULT_SITE_TITLE;
  const watchedDescription = useWatch({ control, name: "meta_description" }) ?? "";
  const watchedTags = useWatch({ control, name: "search_tags" }) ?? [];

  function addTag() {
    const value = tagDraft.trim();
    if (!value || watchedTags.length >= MAX_TAGS) return;
    if (watchedTags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setTagDraft("");
      return;
    }
    setValue("search_tags", [...watchedTags, value], { shouldDirty: true });
    setTagDraft("");
  }

  function removeTag(tag: string) {
    setValue(
      "search_tags",
      watchedTags.filter((t) => t !== tag),
      { shouldDirty: true }
    );
  }

  function submit(values: FormValues) {
    setServerError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateSeoSettings({
          site_title: values.site_title,
          meta_description: values.meta_description ?? "",
          search_tags: values.search_tags,
        });
        setSaved(true);
        reset(values);
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="bg-white border border-line rounded-xl p-6 md:p-8">
      <p className="text-sm font-semibold text-navy-900 mb-1">Google Search Snippet</p>
      <p className="text-xs text-ink-400 mb-5">
        The title, description, and keywords shown for this site in Google search results — and in
        every browser tab. Updates apply across the public site immediately, no redeploy needed.
      </p>

      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="site_title" className="block text-sm font-medium text-navy-900">
              Search title
            </label>
            <TitleCounterHint length={watchedTitle.length} />
          </div>
          <input
            id="site_title"
            type="text"
            {...register("site_title")}
            placeholder={DEFAULT_SITE_TITLE}
            className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink focus:border-saffron focus:outline-none"
          />
          {errors.site_title && <p className="text-xs text-rust mt-1.5">{errors.site_title.message}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="meta_description" className="block text-sm font-medium text-navy-900">
              Search description
            </label>
            <DescriptionCounterHint length={watchedDescription.length} />
          </div>
          <textarea
            id="meta_description"
            rows={3}
            {...register("meta_description")}
            placeholder="A short summary shown under the title in search results..."
            className="w-full rounded-md border border-line bg-white px-4 py-3 text-sm text-ink focus:border-saffron focus:outline-none resize-y"
          />
          {errors.meta_description && (
            <p className="text-xs text-rust mt-1.5">{errors.meta_description.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="search_tag_input" className="block text-sm font-medium text-navy-900 mb-1.5">
            Search tags &amp; keywords
          </label>
          <p className="text-xs text-ink-400 mb-2">
            Alternate names and terms people might search for. Fed into this site&apos;s metadata
            keywords and structured data.
          </p>

          {watchedTags.length > 0 && (
            <ul className="flex flex-wrap gap-2 mb-2.5">
              {watchedTags.map((tag) => (
                <li
                  key={tag}
                  className="inline-flex items-center gap-1.5 rounded-full bg-saffron-100 text-saffron-600 text-xs font-medium pl-3 pr-1.5 py-1"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove tag "${tag}"`}
                    className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-saffron-600/20"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <input
              id="search_tag_input"
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="Add a tag or keyword…"
              disabled={watchedTags.length >= MAX_TAGS}
              className="flex-1 rounded-md border border-line bg-white px-4 py-2.5 text-sm text-ink focus:border-saffron focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={addTag}
              disabled={!tagDraft.trim() || watchedTags.length >= MAX_TAGS}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-saffron-600 hover:text-saffron disabled:opacity-40 px-3"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
          {errors.search_tags && <p className="text-xs text-rust mt-1.5">{errors.search_tags.message}</p>}
        </div>

        {/* Live Google Search Snippet preview */}
        <div>
          <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">Live Preview</p>
          <div className="rounded-lg border border-line bg-white p-4 max-w-xl font-sans">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-navy-900 text-white text-[10px] font-bold shrink-0">
                DC
              </span>
              <div className="min-w-0">
                <p className="text-sm text-[#202124] leading-tight truncate">janatardipak.com</p>
                <p className="text-xs text-[#5f6368] leading-tight truncate">{SITE_URL}</p>
              </div>
            </div>
            <p className="mt-1 text-[#1a0dab] text-xl leading-snug truncate">{watchedTitle}</p>
            <p className="mt-0.5 text-sm text-[#4d5156] leading-snug line-clamp-2">
              {watchedDescription ||
                "Add a search description above to see how it will look in Google search results."}
            </p>
          </div>
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
