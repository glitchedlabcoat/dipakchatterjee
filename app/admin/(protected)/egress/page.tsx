// app/admin/(protected)/egress/page.tsx
//
// Superseded by /admin/usage (see app/admin/(protected)/usage/page.tsx)
// — a broader Usage Metrics dashboard covering both Supabase egress
// (what this page used to show, now folded into its Advanced mode) and
// Cloudflare R2 storage. Kept as a redirect rather than deleted outright
// so any existing bookmark/link to /admin/egress still lands somewhere
// useful.

import { redirect } from "next/navigation";

export default function EgressMonitorRedirect() {
  redirect("/admin/usage");
}
