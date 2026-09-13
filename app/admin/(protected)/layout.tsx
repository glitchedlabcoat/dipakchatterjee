// app/admin/(protected)/layout.tsx
//
// Lives inside the (protected) route group, so it ONLY wraps routes also
// inside that group — /admin, /admin/features, /admin/posts, etc. The
// parentheses mean "(protected)" adds no URL segment: this still serves
// at /admin, not /admin/protected.
//
// Critically, app/admin/login/page.tsx sits OUTSIDE this group (as a
// sibling folder), so it is never wrapped by this layout and can never
// be caught in a redirect loop with it.

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import SessionTimer from "@/components/admin/SessionTimer";
import AdminPresence from "@/components/admin/AdminPresence";
import AdminSidebar from "@/components/admin/AdminSidebar";
import SidebarToggleButton from "@/components/admin/SidebarToggleButton";
import { MobileSidebarProvider } from "@/components/admin/MobileSidebarContext";

const DEFAULT_BRAND_NAME = "Dipak Chatterjee";
const DEFAULT_BRAND_SUBTITLE = "Admin Dashboard";

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Both queries below are wrapped rather than left to reject
  // naturally: this layout wraps every /admin/* page, so an unhandled
  // rejection here (a transient auth/network drop, not a real "you're
  // not logged in") would surface as Next's generic error page instead
  // of the graceful "please sign in again" redirect this already has a
  // path for. Any failure is treated the same as "no session" —
  // fail-closed, never fail-open into showing the dashboard.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser();
    user = fetchedUser;
  } catch (err) {
    console.error("[AdminProtectedLayout] auth.getUser() failed:", err);
  }

  if (!user) {
    redirect("/admin/login");
  }

  let profile: { is_admin: boolean; full_name: string | null } | null = null;
  let settings: { header_name: string | null; header_subtitle: string | null } | null = null;
  try {
    const [{ data: profileData }, { data: settingsData }] = await Promise.all([
      supabase.from("profiles").select("is_admin, full_name").eq("id", user.id).single(),
      supabase.from("site_settings").select("header_name, header_subtitle").eq("id", "default").single(),
    ]);
    profile = profileData;
    settings = settingsData;
  } catch (err) {
    console.error("[AdminProtectedLayout] profile/settings fetch failed:", err);
  }

  // Any recognized profile (ADMIN or USER) may view the dashboard shell
  // — privileged mutations are gated separately, per-action, by
  // requireAdmin()/requireOwner() (see lib/admin-guard.ts). A row
  // missing entirely means this Supabase user has no profile at all
  // (or the fetch above failed), which shouldn't happen for a real,
  // reachable account.
  if (!profile) {
    redirect("/admin/login");
  }

  const brandName = settings?.header_name || DEFAULT_BRAND_NAME;
  const brandSubtitle = settings?.header_subtitle || DEFAULT_BRAND_SUBTITLE;

  return (
    <MobileSidebarProvider>
      {/* h-dvh (not h-screen/100vh) + overflow-hidden so the page itself
          never scrolls — scrolling instead happens independently inside
          the sidebar's nav (if it ever grows past viewport height) and
          inside main's content pane below, so the sidebar's bottom
          user/sign-out cluster and main's header bar both stay put
          regardless of how long a page's content (e.g. Settings) runs.
          dvh over 100vh/h-screen specifically for mobile Safari/Chrome:
          h-screen is measured with the browser's address bar retracted,
          so combined with overflow-hidden here it would push that much
          of the layout's bottom off-screen behind the (usually visible)
          toolbar with no page scroll left to reach it. dvh tracks the
          actual visible viewport as browser chrome shows/hides. */}
      <div className="h-dvh flex overflow-hidden">
        {/* app/globals.css hides Next.js's dev-mode floating indicator
            site-wide; this re-enables it, but only for as long as this
            admin layout is mounted (a plain <style> tag's rules apply to
            the whole document regardless of where the tag itself sits in
            the tree, so this has no effect on public pages). */}
        <style>{"nextjs-portal, [data-nextjs-toast] { display: block !important; }"}</style>

        <AdminSidebar
          brandName={brandName}
          brandSubtitle={brandSubtitle}
          userLabel={profile.full_name ?? user.email ?? "Unknown"}
        />

        <main className="w-full flex-1 min-w-0 bg-paper-100 h-full flex flex-col overflow-hidden">
          <header className="h-14 shrink-0 border-b border-line bg-white flex items-center justify-between px-4 md:px-6">
            <div className="flex items-center min-w-0">
              <SidebarToggleButton />
              <AdminPresence userId={user.id} email={user.email ?? profile.full_name ?? "Unknown"} name={profile.full_name} />
            </div>
            <SessionTimer />
          </header>
          <div className="flex-1 overflow-y-auto w-full max-w-5xl mx-auto px-4 md:px-6 py-10">{children}</div>
        </main>
      </div>
    </MobileSidebarProvider>
  );
}
