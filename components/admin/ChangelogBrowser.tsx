// components/admin/ChangelogBrowser.tsx
//
// Client-side Date -> Version browser with an instant Simple/Advanced
// toggle. Unlike /admin/usage's Simple/Advanced toggle (a ?mode= link that
// re-renders server-side and even runs an Advanced-only Supabase query),
// this one is genuinely zero-refetch: every entry's simple AND advanced
// content is already in `entries` (a static array, passed once from the
// server component), so switching modes or selecting a different
// date/version is pure client state. Wrapped in useTransition anyway, per
// the ask for smooth switching if this list ever grows long.

"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import type { ChangelogChangeType, ChangelogEntry } from "@/lib/changelog-data";

type Mode = "simple" | "advanced";

const CHANGE_TYPE_LABEL: Record<ChangelogChangeType, string> = {
  added: "Added",
  changed: "Changed",
  fixed: "Fixed",
  security: "Security",
};

const CHANGE_TYPE_STYLE: Record<ChangelogChangeType, string> = {
  added: "bg-forest-100 text-forest",
  changed: "bg-saffron/15 text-saffron-600",
  fixed: "bg-rust/10 text-rust",
  security: "bg-navy-900/10 text-navy-900",
};

// Parsed as a plain local date, not new Date(dateStr) (which reads
// YYYY-MM-DD as UTC midnight and can render a day early in negative-UTC
// timezones) — the stored value is a calendar date, not an instant.
// entries come from a hand-authored data file (lib/changelog-data.ts),
// not a validated form — a future typo'd date (non-numeric, out of
// range) would otherwise make Intl.DateTimeFormat.format() throw
// "RangeError: Invalid time value" and take the whole page down with
// it, so an invalid result falls back to the raw string instead.
function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

export default function ChangelogBrowser({ entries }: { entries: ChangelogEntry[] }) {
  // entries is already newest-first; Map preserves insertion order, so
  // grouping here doesn't need a separate sort pass.
  const dateGroups = useMemo(() => {
    const map = new Map<string, ChangelogEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.date) ?? [];
      list.push(entry);
      map.set(entry.date, list);
    }
    return Array.from(map.entries());
  }, [entries]);

  const [selectedVersion, setSelectedVersion] = useState<string | undefined>(entries[0]?.version);
  const [expandedDate, setExpandedDate] = useState<string | undefined>(entries[0]?.date);
  const [mode, setMode] = useState<Mode>("simple");
  const [isPending, startTransition] = useTransition();

  const selectedEntry = entries.find((e) => e.version === selectedVersion) ?? entries[0];

  const selectVersion = useCallback((version: string, date: string) => {
    startTransition(() => {
      setSelectedVersion(version);
      setExpandedDate(date);
    });
  }, []);

  const toggleDate = useCallback((date: string) => {
    startTransition(() => {
      setExpandedDate((prev) => (prev === date ? undefined : date));
    });
  }, []);

  if (!selectedEntry) {
    return <p className="text-sm text-ink-400 italic">No changelog entries yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      <nav
        className="bg-white border border-line rounded-xl overflow-hidden self-start"
        aria-label="Changelog dates and versions"
      >
        {dateGroups.map(([date, versions]) => {
          const open = expandedDate === date;
          return (
            <div key={date} className="border-b border-line last:border-0">
              <button
                type="button"
                onClick={() => toggleDate(date)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-navy-900 hover:bg-paper-100 transition-colors"
              >
                <span>{formatDate(date)}</span>
                <ChevronDown
                  className={`w-4 h-4 shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>
              {open && (
                <div className="pb-2">
                  {versions.map((entry) => {
                    const active = entry.version === selectedVersion;
                    return (
                      <button
                        key={entry.version}
                        type="button"
                        onClick={() => selectVersion(entry.version, entry.date)}
                        aria-current={active ? "true" : undefined}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          active ? "bg-saffron/15 text-saffron-600 font-medium" : "text-ink-600 hover:bg-paper-100"
                        }`}
                      >
                        {entry.version}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className={`transition-opacity ${isPending ? "opacity-60" : ""}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              {formatDate(selectedEntry.date)}
            </p>
            <h2 className="font-display text-xl text-navy-900">
              {selectedEntry.version} &mdash; {selectedEntry.title}
            </h2>
          </div>

          <div className="flex gap-1 border border-line rounded-full p-1 bg-paper-100">
            {(["simple", "advanced"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => startTransition(() => setMode(m))}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  mode === m ? "bg-navy-900 text-white" : "text-ink-600 hover:text-navy-900"
                }`}
              >
                {m === "simple" ? "Simple" : "Advanced"}
              </button>
            ))}
          </div>
        </div>

        {mode === "simple" ? (
          <div className="bg-white border border-line rounded-xl p-6">
            <p className="text-sm text-ink-600 leading-relaxed">{selectedEntry.simple.summary}</p>
            {selectedEntry.simple.tutorial && selectedEntry.simple.tutorial.length > 0 && (
              <div className="mt-5 pt-5 border-t border-line">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-3">How to use it</p>
                <ol className="space-y-2 list-decimal list-inside text-sm text-ink-600">
                  {selectedEntry.simple.tutorial.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white border border-line rounded-xl p-6">
            {selectedEntry.advanced.rootCause && (
              <div className="mb-5 pb-5 border-b border-line">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-2">Root cause</p>
                <p className="text-sm text-ink-600 leading-relaxed">{selectedEntry.advanced.rootCause}</p>
              </div>
            )}

            <div className="space-y-3 mb-5">
              {selectedEntry.advanced.changes.map((change, i) => (
                <div key={i} className="flex gap-3">
                  <span
                    className={`shrink-0 h-fit px-2 py-0.5 rounded text-xs font-semibold ${CHANGE_TYPE_STYLE[change.type]}`}
                  >
                    {CHANGE_TYPE_LABEL[change.type]}
                  </span>
                  <p className="text-sm text-ink-600 leading-relaxed">{change.text}</p>
                </div>
              ))}
            </div>

            <div className="pt-5 border-t border-line">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-2">Files changed</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedEntry.advanced.filesChanged.map((file) => (
                  <code key={file} className="text-xs bg-paper-100 text-ink-600 px-2 py-1 rounded font-mono">
                    {file}
                  </code>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
