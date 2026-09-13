// app/admin/(protected)/egress/page.tsx
//
// Egress & Cache Efficiency Monitor. Reads the cache_metrics table (see
// supabase/migrations/20260925000000_cache_metrics.sql), populated by
// record_cache_event() calls fired from lib/cache.ts on every public
// page's cache hit/miss. Deliberately has no unstable_cache of its own —
// every other admin page in this dashboard reads live via the
// cookie-based server client, and this one is no different: an admin
// checking bandwidth numbers should always see the latest write.
//
// "Bytes saved" per hit is an estimate, not a measurement: it reuses the
// payload size recorded the last time that route's cache was actually a
// miss (see lib/cache.ts's createTrackedCache), on the assumption that a
// hit would have cost the same Postgres round-trip a miss just did. That
// assumption can drift slightly right after content changes size, but
// it's the only baseline available without re-fetching on every hit,
// which would defeat the point of caching in the first place.

import type { Metadata } from "next";
import Link from "next/link";
import { Gauge } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import type { CacheMetric } from "@/types/domain";

export const metadata: Metadata = {
  title: "Egress Monitor - Dashboard | Dipak Chatterjee",
};

type RangeId = "today" | "7d" | "30d";

const RANGES: { id: RangeId; label: string; days: number }[] = [
  { id: "today", label: "Today", days: 0 },
  { id: "7d", label: "Last 7 Days", days: 6 },
  { id: "30d", label: "Last 30 Days", days: 29 },
];

function parseRange(value: string | undefined): RangeId {
  return value === "today" || value === "7d" || value === "30d" ? value : "7d";
}

// IST, not UTC — every other admin timestamp in this dashboard renders
// in Asia/Kolkata (see app/admin/(protected)/logs/page.tsx), and
// cache_metrics.date is a plain DATE column with no timezone of its own,
// so the boundary used to compute "today"/"last 7 days" should match
// what the admin actually means by "today".
function istDateString(daysAgo: number) {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  istNow.setDate(istNow.getDate() - daysAgo);
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

interface RouteStats {
  route: string;
  hits: number;
  misses: number;
  bytesSaved: number;
  bytesSpent: number;
}

export default async function EgressMonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range = parseRange(rangeParam);
  const activeRange = RANGES.find((r) => r.id === range)!;
  const startDate = istDateString(activeRange.days);

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("cache_metrics")
    .select("*")
    .gte("date", startDate)
    .order("route", { ascending: true });

  const metricRows = (rows as CacheMetric[]) ?? [];

  const byRoute = new Map<string, RouteStats>();
  for (const row of metricRows) {
    const existing = byRoute.get(row.route);
    if (existing) {
      existing.hits += row.hits;
      existing.misses += row.misses;
      existing.bytesSaved += Number(row.estimated_bytes_saved);
      existing.bytesSpent += Number(row.estimated_bytes_spent);
    } else {
      byRoute.set(row.route, {
        route: row.route,
        hits: row.hits,
        misses: row.misses,
        bytesSaved: Number(row.estimated_bytes_saved),
        bytesSpent: Number(row.estimated_bytes_spent),
      });
    }
  }

  const routeStats = Array.from(byRoute.values()).sort((a, b) => b.hits + b.misses - (a.hits + a.misses));

  const totalSaved = routeStats.reduce((sum, r) => sum + r.bytesSaved, 0);
  const totalSpent = routeStats.reduce((sum, r) => sum + r.bytesSpent, 0);
  const baseline = totalSaved + totalSpent;
  const reductionRate = baseline > 0 ? (totalSaved / baseline) * 100 : 0;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Gauge className="w-5 h-5 text-saffron-600" />
        <p className="text-sm font-semibold text-saffron-600">Egress Monitor</p>
      </div>
      <h1 className="font-display text-3xl text-navy-900 mb-1.5">Egress &amp; cache efficiency</h1>
      <p className="text-sm text-ink-600 mb-6">
        How much Supabase bandwidth caching is actually saving, based on real hit/miss counts recorded by every
        public page.
      </p>

      <div className="flex gap-1 border-b border-line mb-8">
        {RANGES.map((r) => (
          <Link
            key={r.id}
            href={`/admin/egress?range=${r.id}`}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              r.id === range
                ? "border-saffron text-navy-900"
                : "border-transparent text-ink-400 hover:text-ink-600"
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {baseline === 0 ? (
        <div className="border border-dashed border-line rounded-lg p-10 text-center text-sm text-ink-400 mb-8">
          No cache activity recorded for this period yet.
        </div>
      ) : (
        <>
          <div className="bg-navy-900 rounded-xl px-8 py-8 mb-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-paper-100/60 mb-2">
              Reduction Rate
            </p>
            <p className="font-display text-5xl text-white">{reductionRate.toFixed(1)}%</p>
            <p className="text-sm text-paper-100/70 mt-2">Egress Saved ({activeRange.label.toLowerCase()})</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white border border-line rounded-xl p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-2">
                Without Cache (Baseline)
              </p>
              <p className="font-display text-2xl text-navy-900">{formatBytes(baseline)}</p>
              <p className="text-xs text-ink-400 mt-1">Projected bandwidth if every request hit Postgres</p>
            </div>

            <div className="bg-white border border-line rounded-xl p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-2">
                With Cache (Actual DB Egress)
              </p>
              <p className="font-display text-2xl text-navy-900">{formatBytes(totalSpent)}</p>
              <p className="text-xs text-ink-400 mt-1">Bytes actually transferred from Postgres</p>
            </div>

            <div className="bg-forest-100 border border-forest/30 rounded-xl p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-forest mb-2">Net Bandwidth Saved</p>
              <p className="font-display text-2xl text-forest">{formatBytes(totalSaved)}</p>
              <p className="text-xs text-forest/80 mt-1">
                {formatBytes(totalSaved)} saved out of {formatBytes(baseline)} requested
              </p>
            </div>
          </div>

          <div className="bg-white border border-line rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper-100 text-left">
                    <th className="px-4 py-3 font-semibold text-ink-600">Route</th>
                    <th className="px-4 py-3 font-semibold text-ink-600">Total Requests</th>
                    <th className="px-4 py-3 font-semibold text-ink-600">Cache Hits</th>
                    <th className="px-4 py-3 font-semibold text-ink-600">Cache Misses</th>
                    <th className="px-4 py-3 font-semibold text-ink-600">Hit Ratio</th>
                    <th className="px-4 py-3 font-semibold text-ink-600">Bandwidth Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {routeStats.map((r) => {
                    const total = r.hits + r.misses;
                    const hitRatio = total > 0 ? (r.hits / total) * 100 : 0;
                    return (
                      <tr key={r.route} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 font-mono text-xs text-navy-900">{r.route}</td>
                        <td className="px-4 py-3 text-ink-600">{total.toLocaleString()}</td>
                        <td className="px-4 py-3 text-ink-600">{r.hits.toLocaleString()}</td>
                        <td className="px-4 py-3 text-ink-600">{r.misses.toLocaleString()}</td>
                        <td className="px-4 py-3 text-ink-600">{hitRatio.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-ink-600">{formatBytes(r.bytesSaved)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
