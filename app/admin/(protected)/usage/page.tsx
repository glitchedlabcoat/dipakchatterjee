// app/admin/(protected)/usage/page.tsx
//
// Replaces the old Egress Monitor (app/admin/(protected)/egress, now a
// redirect here) with a broader Usage Metrics dashboard: how much of
// each free tier this app is actually using, across both halves of its
// storage architecture — Supabase (Postgres, read via cache_metrics'
// existing hit/miss telemetry — see lib/cache.ts) and Cloudflare R2
// (object storage, read live via lib/r2-usage.ts).
//
// Two modes, chosen via ?mode=, the same URL-driven-state pattern the
// old egress page used for its date range tabs:
//   - simple (default): three plain-language cards for Dipak — storage
//     used, database bandwidth used, and free-tier headroom — plus a
//     health badge and an honest $0.00-or-real-number cost estimate.
//   - advanced: the old per-route hit/miss table (moved here, not
//     removed), a 12-month Supabase egress breakdown, live R2 bucket
//     size/object counts per bucket, and Class A/B operation counts IF
//     CLOUDFLARE_API_TOKEN is configured (see lib/cloudflare-analytics.ts)
//     — shown as "not connected" rather than a fabricated number
//     otherwise.

import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CheckCircle2, AlertTriangle } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { getR2UsageStats, R2_FREE_TIER, R2_PRICING, SUPABASE_FREE_EGRESS_GB } from "@/lib/r2-usage";
import { getR2OperationsSummary } from "@/lib/cloudflare-analytics";
import type { CacheMetric } from "@/types/domain";

export const metadata: Metadata = {
  title: "Usage Metrics - Dashboard | Dipak Chatterjee",
};

type Mode = "simple" | "advanced";

function parseMode(value: string | undefined): Mode {
  return value === "advanced" ? "advanced" : "simple";
}

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
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

function formatCurrency(usd: number) {
  return `$${usd.toFixed(usd > 0 && usd < 0.01 ? 4 : 2)}`;
}

export default async function UsageMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode: modeParam } = await searchParams;
  const mode = parseMode(modeParam);

  const supabase = await createClient();

  const [{ data: last30Rows }, r2Stats] = await Promise.all([
    supabase.from("cache_metrics").select("*").gte("date", istDateString(29)),
    getR2UsageStats(),
  ]);

  const metrics30d = (last30Rows as CacheMetric[]) ?? [];
  const supabaseEgressBytes30d = metrics30d.reduce((sum, r) => sum + Number(r.estimated_bytes_spent), 0);
  const supabaseEgressGB30d = supabaseEgressBytes30d / 1024 ** 3;

  const r2StorageBytes = r2Stats.media.bytes + (r2Stats.complaints?.bytes ?? 0);
  const r2ObjectCount = r2Stats.media.objectCount + (r2Stats.complaints?.objectCount ?? 0);
  const r2StorageGB = r2StorageBytes / 1024 ** 3;

  const storageHeadroomPct = Math.max(0, 100 - (r2StorageGB / R2_FREE_TIER.storageGB) * 100);
  const egressHeadroomPct = Math.max(0, 100 - (supabaseEgressGB30d / SUPABASE_FREE_EGRESS_GB) * 100);
  const withinFreeTier = r2StorageGB <= R2_FREE_TIER.storageGB && supabaseEgressGB30d <= SUPABASE_FREE_EGRESS_GB;

  const r2StorageOverageGB = Math.max(0, r2StorageGB - R2_FREE_TIER.storageGB);
  const r2StorageOverageCost = r2StorageOverageGB * R2_PRICING.storagePerGBMonth;
  const supabaseEgressOverGB = Math.max(0, supabaseEgressGB30d - SUPABASE_FREE_EGRESS_GB);

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Activity className="w-5 h-5 text-saffron-600" />
        <p className="text-sm font-semibold text-saffron-600">Usage Metrics</p>
      </div>
      <h1 className="font-display text-3xl text-navy-900 mb-1.5">Storage &amp; bandwidth usage</h1>
      <p className="text-sm text-ink-600 mb-6">
        How much of each free tier this site is actually using &mdash; Cloudflare R2 for media, Supabase for
        the database.
      </p>

      <div className="flex gap-1 border-b border-line mb-8">
        {(
          [
            { id: "simple" as const, label: "Simple" },
            { id: "advanced" as const, label: "Advanced" },
          ]
        ).map((m) => (
          <Link
            key={m.id}
            href={`/admin/usage?mode=${m.id}`}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              m.id === mode ? "border-saffron text-navy-900" : "border-transparent text-ink-400 hover:text-ink-600"
            }`}
          >
            {m.label}
          </Link>
        ))}
      </div>

      {mode === "simple" ? (
        <SimpleView
          r2StorageGB={r2StorageGB}
          r2ObjectCount={r2ObjectCount}
          supabaseEgressGB30d={supabaseEgressGB30d}
          storageHeadroomPct={storageHeadroomPct}
          egressHeadroomPct={egressHeadroomPct}
          withinFreeTier={withinFreeTier}
          r2StorageOverageCost={r2StorageOverageCost}
          supabaseEgressOverGB={supabaseEgressOverGB}
        />
      ) : (
        <AdvancedView supabase={supabase} r2Stats={r2Stats} />
      )}
    </div>
  );
}

function HealthBadge({ withinFreeTier }: { withinFreeTier: boolean }) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
        withinFreeTier ? "bg-forest-100 text-forest" : "bg-rust/10 text-rust"
      }`}
    >
      {withinFreeTier ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
      {withinFreeTier ? "100% Within Free Tier — No charges expected" : "Approaching or over a free tier limit"}
    </div>
  );
}

function SimpleView({
  r2StorageGB,
  r2ObjectCount,
  supabaseEgressGB30d,
  storageHeadroomPct,
  egressHeadroomPct,
  withinFreeTier,
  r2StorageOverageCost,
  supabaseEgressOverGB,
}: {
  r2StorageGB: number;
  r2ObjectCount: number;
  supabaseEgressGB30d: number;
  storageHeadroomPct: number;
  egressHeadroomPct: number;
  withinFreeTier: boolean;
  r2StorageOverageCost: number;
  supabaseEgressOverGB: number;
}) {
  return (
    <>
      <div className="bg-navy-900 rounded-xl px-8 py-8 mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-paper-100/60 mb-3">Status</p>
        <HealthBadge withinFreeTier={withinFreeTier} />
        <p className="text-sm text-paper-100/70 mt-4">
          Estimated cost this cycle:{" "}
          <span className="font-semibold text-white">
            {formatCurrency(r2StorageOverageCost)}
          </span>
          {supabaseEgressOverGB > 0 && (
            <span className="block text-xs text-paper-100/60 mt-1">
              Plus Supabase overage billing on {supabaseEgressOverGB.toFixed(2)} GB of database bandwidth beyond
              its free plan &mdash; check the Supabase dashboard for the exact rate on your plan.
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-line rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-2">Cloud Storage Used</p>
          <p className="font-display text-2xl text-navy-900">{r2StorageGB.toFixed(2)} GB</p>
          <p className="text-xs text-ink-400 mt-1">
            of {R2_FREE_TIER.storageGB} GB free &middot; {r2ObjectCount.toLocaleString()} files (Cloudflare R2)
          </p>
        </div>

        <div className="bg-white border border-line rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-2">
            Monthly Bandwidth Used
          </p>
          <p className="font-display text-2xl text-navy-900">{supabaseEgressGB30d.toFixed(2)} GB</p>
          <p className="text-xs text-ink-400 mt-1">
            of {SUPABASE_FREE_EGRESS_GB} GB free (Supabase database, last 30 days). Media bandwidth from R2 is
            never charged, by design.
          </p>
        </div>

        <div className="bg-forest-100 border border-forest/30 rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-forest mb-2">Free Tier Headroom</p>
          <p className="font-display text-2xl text-forest">
            {Math.min(storageHeadroomPct, egressHeadroomPct).toFixed(0)}%
          </p>
          <p className="text-xs text-forest/80 mt-1">
            Storage: {storageHeadroomPct.toFixed(0)}% remaining &middot; Bandwidth: {egressHeadroomPct.toFixed(0)}%
            remaining
          </p>
        </div>
      </div>
    </>
  );
}

async function AdvancedView({
  supabase,
  r2Stats,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  r2Stats: Awaited<ReturnType<typeof getR2UsageStats>>;
}) {
  const { data: yearRows } = await supabase
    .from("cache_metrics")
    .select("*")
    .gte("date", istDateString(364))
    .order("date", { ascending: true });

  const metricsYear = (yearRows as CacheMetric[]) ?? [];
  const byMonth = new Map<string, { hits: number; misses: number; bytesSpent: number; bytesSaved: number }>();
  for (const row of metricsYear) {
    const month = row.date.slice(0, 7); // "YYYY-MM"
    const existing = byMonth.get(month) ?? { hits: 0, misses: 0, bytesSpent: 0, bytesSaved: 0 };
    existing.hits += row.hits;
    existing.misses += row.misses;
    existing.bytesSpent += Number(row.estimated_bytes_spent);
    existing.bytesSaved += Number(row.estimated_bytes_saved);
    byMonth.set(month, existing);
  }
  const months = Array.from(byMonth.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  const maxMonthlyBytes = Math.max(1, ...months.map(([, m]) => m.bytesSpent));

  const mediaBucket = process.env.R2_BUCKET_NAME;
  const complaintBucket = process.env.R2_COMPLAINT_BUCKET_NAME;
  const [mediaOps, complaintOps] = await Promise.all([
    mediaBucket ? getR2OperationsSummary(mediaBucket, 30) : Promise.resolve(null),
    complaintBucket ? getR2OperationsSummary(complaintBucket, 30) : Promise.resolve(null),
  ]);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="bg-white border border-line rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-3">
            R2 &mdash; Admin Media Bucket
          </p>
          <div className="flex items-baseline gap-2">
            <p className="font-display text-xl text-navy-900">{formatBytes(r2Stats.media.bytes)}</p>
            <p className="text-xs text-ink-400">{r2Stats.media.objectCount.toLocaleString()} objects</p>
          </div>
          <OpsRow summary={mediaOps} />
        </div>

        <div className="bg-white border border-line rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-3">
            R2 &mdash; Complaint Attachments Bucket
          </p>
          {r2Stats.complaints ? (
            <>
              <div className="flex items-baseline gap-2">
                <p className="font-display text-xl text-navy-900">{formatBytes(r2Stats.complaints.bytes)}</p>
                <p className="text-xs text-ink-400">{r2Stats.complaints.objectCount.toLocaleString()} objects</p>
              </div>
              <OpsRow summary={complaintOps} />
            </>
          ) : (
            <p className="text-sm text-ink-400 italic">R2_COMPLAINT_BUCKET_NAME not configured yet.</p>
          )}
        </div>
      </div>

      <div className="bg-white border border-line rounded-xl p-5 mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-400 mb-1">
          Supabase Egress vs. R2 (Zero Egress)
        </p>
        <p className="text-sm text-ink-600">
          Supabase database reads cost bandwidth (tracked below); Cloudflare R2 charges $0 for egress no matter
          how much media is served &mdash; that delta is the whole reason media moved off Supabase Storage.
        </p>
      </div>

      <div className="bg-white border border-line rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-line">
          <p className="text-sm font-semibold text-navy-900">Supabase database bandwidth, by month</p>
          <p className="text-xs text-ink-400 mt-0.5">Up to the last 12 months, from cache_metrics.</p>
        </div>
        {months.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-400">No cache activity recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-paper-100 text-left">
                  <th className="px-4 py-3 font-semibold text-ink-600">Month</th>
                  <th className="px-4 py-3 font-semibold text-ink-600">Requests</th>
                  <th className="px-4 py-3 font-semibold text-ink-600">Hit Ratio</th>
                  <th className="px-4 py-3 font-semibold text-ink-600">Bandwidth Spent</th>
                  <th className="px-4 py-3 font-semibold text-ink-600 w-1/3">Relative</th>
                </tr>
              </thead>
              <tbody>
                {months.map(([month, m]) => {
                  const total = m.hits + m.misses;
                  const hitRatio = total > 0 ? (m.hits / total) * 100 : 0;
                  return (
                    <tr key={month} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-navy-900">{month}</td>
                      <td className="px-4 py-3 text-ink-600">{total.toLocaleString()}</td>
                      <td className="px-4 py-3 text-ink-600">{hitRatio.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-ink-600">{formatBytes(m.bytesSpent)}</td>
                      <td className="px-4 py-3">
                        <div className="h-2 bg-paper-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-saffron rounded-full"
                            style={{ width: `${(m.bytesSpent / maxMonthlyBytes) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function OpsRow({ summary }: { summary: { classAOps: number; classBOps: number } | null }) {
  if (!summary) {
    return (
      <p className="text-xs text-ink-400 italic mt-2">
        Class A/B operations not connected &mdash; add CLOUDFLARE_API_TOKEN to see this.
      </p>
    );
  }
  return (
    <p className="text-xs text-ink-400 mt-2">
      Last 30 days: {summary.classAOps.toLocaleString()} Class A (writes) &middot;{" "}
      {summary.classBOps.toLocaleString()} Class B (reads)
    </p>
  );
}
