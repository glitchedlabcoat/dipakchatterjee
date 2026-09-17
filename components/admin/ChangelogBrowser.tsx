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
import { Calendar, ChevronDown, PlusCircle, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
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

const CHANGE_TYPE_ICON: Record<ChangelogChangeType, typeof PlusCircle> = {
  added: PlusCircle,
  changed: RefreshCw,
  fixed: Wrench,
  security: ShieldCheck,
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

  const summaryPoints = Array.isArray(selectedEntry.simple.summary)
    ? selectedEntry.simple.summary
    : [selectedEntry.simple.summary];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      <nav
        className="bg-white border border-line rounded-2xl overflow-hidden self-start shadow-sm"
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
                className="w-full flex items-center justify-between gap-2 px-4 py-3.5 text-left text-sm font-semibold text-navy-900 hover:bg-paper-100 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-ink-400 shrink-0" />
                  {formatDate(date)}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {versions.length > 1 && (
                    <span className="text-[10px] font-semibold text-ink-400 bg-paper-100 rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                      {versions.length}
                    </span>
                  )}
                  <ChevronDown
                    className={`w-4 h-4 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </span>
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
                        className={`w-full text-left pl-[1.15rem] pr-4 py-2 text-sm font-mono border-l-2 transition-colors ${
                          active
                            ? "border-saffron bg-saffron/10 text-saffron-600 font-semibold"
                            : "border-transparent text-ink-600 hover:bg-paper-100 hover:border-line"
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
        <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center rounded-full bg-navy-900 text-white text-xs font-mono font-semibold px-2.5 py-1">
                {selectedEntry.version}
              </span>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                {formatDate(selectedEntry.date)}
              </p>
            </div>
            <h2 className="font-display text-xl md:text-2xl text-navy-900 mt-2">{selectedEntry.title}</h2>
          </div>

          <div className="flex gap-1 border border-line rounded-full p-1 bg-paper-100 shadow-sm">
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
          <div className="bg-white border border-line rounded-2xl p-6 shadow-sm">
            <div className="space-y-3">
              {summaryPoints.map((point, i) => (
                <p key={i} className="text-sm text-ink-600 leading-relaxed">
                  {point}
                </p>
              ))}
            </div>
            {selectedEntry.simple.tutorial && selectedEntry.simple.tutorial.length > 0 && (
              <div className="mt-6 pt-6 border-t border-line">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-3">How to use it</p>
                <ol className="space-y-2.5">
                  {selectedEntry.simple.tutorial.map((step, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-ink-600 leading-relaxed">
                      <span className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-navy-900/10 text-navy-900 text-xs font-semibold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white border border-line rounded-2xl p-6 shadow-sm">
            {selectedEntry.advanced.rootCause && (
              <div className="mb-6 rounded-lg border-l-4 border-navy-900 bg-navy-900/[0.04] px-4 py-3.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-navy-900/70 mb-1.5">Root cause</p>
                <p className="text-sm text-ink-600 leading-relaxed">{selectedEntry.advanced.rootCause}</p>
              </div>
            )}

            <div className="space-y-3">
              {selectedEntry.advanced.changes.map((change, i) => {
                const Icon = CHANGE_TYPE_ICON[change.type];
                return (
                  <div
                    key={i}
                    className="rounded-lg border border-line/70 p-4 hover:border-line hover:bg-paper-100/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded text-xs font-semibold ${CHANGE_TYPE_STYLE[change.type]}`}
                      >
                        <Icon className="w-3 h-3" />
                        {CHANGE_TYPE_LABEL[change.type]}
                      </span>
                      <p className="text-sm text-ink-600 leading-relaxed flex-1">{change.text}</p>
                    </div>
                    {change.files && change.files.length > 0 && (
                      <div className="mt-3 pl-1 flex flex-wrap gap-1.5">
                        {change.files.map((file) => (
                          <code
                            key={file}
                            className="text-[11px] bg-paper-100 text-ink-600 px-1.5 py-0.5 rounded font-mono border border-line/60"
                          >
                            {file}
                          </code>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
