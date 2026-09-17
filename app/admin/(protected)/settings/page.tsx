// app/admin/(protected)/settings/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Rows3 } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { getAuthedUser, getViewerProfile } from "@/lib/admin-auth";
import type {
  CtaButton,
  FooterBlockWithLinks,
  HeaderAction,
  NavLink,
  Organization,
  SiteSettings,
  SocialLink,
} from "@/types/domain";
import SiteImageUploader from "./SiteImageUploader";
import LandingForm from "./LandingForm";
import ThemeColorForm from "./ThemeColorForm";
import BrandingTextForm from "./BrandingTextForm";
import SeoSnippetForm from "./SeoSnippetForm";
import NotableWorksLimitControl from "./NotableWorksLimitControl";
import SettingsTabs from "./SettingsTabs";
import { SETTINGS_TABS, DEFAULT_SETTINGS_TAB, isSettingsTabId } from "@/lib/settings-nav";
import type { Profile } from "@/types/domain";

// Each of these mounts its own @dnd-kit sortable board — code-split so
// the /admin/settings route's client bundle only pays for whichever
// tab is actually active, not all six every time (dnd-kit + every
// manager component otherwise all ship in one chunk regardless of
// which single panel SettingsTabs ends up rendering).
const OrganizationsManager = dynamic(() => import("./OrganizationsManager"));
const CtaButtonsManager = dynamic(() => import("./CtaButtonsManager"));
const FooterBlocksManager = dynamic(() => import("./FooterBlocksManager"));
const SocialLinksManager = dynamic(() => import("./SocialLinksManager"));
const HeaderNavigationManager = dynamic(() => import("./HeaderNavigationManager"));
const UsersManager = dynamic(() => import("./UsersManager"));

type SettingsSearchParams = { tab?: string };

function resolveTab(tab: string | undefined) {
  return isSettingsTabId(tab) ? tab : DEFAULT_SETTINGS_TAB;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}): Promise<Metadata> {
  const { tab } = await searchParams;
  const active = resolveTab(tab);
  const titleLabel = SETTINGS_TABS.find((t) => t.id === active)?.titleLabel ?? "Settings";

  return { title: `${titleLabel} - Dashboard | Dipak Chatterjee` };
}

function SettingsMessage({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold text-saffron-600 mb-2">Settings</p>
      <h1 className="font-display text-3xl text-navy-900 mb-4">{heading}</h1>
      <p className="text-sm text-ink-600">{body}</p>
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  const { tab } = await searchParams;
  const activeTab = resolveTab(tab);
  const activeMeta = SETTINGS_TABS.find((t) => t.id === activeTab)!;

  const supabase = await createClient();

  // getAuthedUser/getViewerProfile are react cache()-wrapped (see
  // lib/admin-auth.ts) — the (protected) layout already made both of
  // these calls this same request, so this reuses them instead of a
  // second/third round trip. Still wrapped: a transient failure here is
  // not "signed out" and shouldn't be presented as such, but it also
  // must never crash this page via an unhandled rejection — fall
  // through to the same explicit error message either way.
  let user: Awaited<ReturnType<typeof getAuthedUser>> = null;
  let viewerProfile: Profile | null = null;
  let authFailed = false;

  try {
    user = await getAuthedUser();
    if (user) viewerProfile = await getViewerProfile(user.id);
  } catch (err) {
    console.error("[SettingsPage] auth/profile lookup failed:", err);
    authFailed = true;
  }

  if (authFailed) {
    return (
      <SettingsMessage
        heading="Couldn't verify your session"
        body="Something went wrong checking your account. Please refresh the page — if this keeps happening, sign out and back in."
      />
    );
  }

  // Every recognized profile (ADMIN or USER) has full content/settings
  // access — the (protected) layout already redirects to /admin/login
  // if there's no profile at all, so this only needs to guard against
  // that same "no profile" edge case reaching this page directly.
  // Users & Access itself further restricts transfer/delete to the
  // ADMIN alone — see viewerIsOwner below and UsersManager.tsx.
  if (!viewerProfile) {
    return <SettingsMessage heading="Signed out" body="Please sign in to manage site settings." />;
  }

  // site_settings is fetched unconditionally (small, single-row, and
  // needed by nearly every tab for theme colors / hero-image URLs /
  // etc.) — everything else below is fetched ONLY for the tab actually
  // being viewed. This used to be one unconditional 9-query Promise.all
  // run on every load regardless of `?tab=`; SettingsTabs only ever
  // rendered one of those nine query results, so the other data was
  // real, wasted Supabase round trips on every single settings page view.
  const EMPTY = Promise.resolve({ data: [] });

  let settings, organizations, ctaButtons, footerBlocks, socialLinks, navLinks, headerActions, profiles;

  try {
    [
      { data: settings },
      { data: organizations },
      { data: ctaButtons },
      { data: footerBlocks },
      { data: socialLinks },
      { data: navLinks },
      { data: headerActions },
      { data: profiles },
    ] = await Promise.all([
      supabase.from("site_settings").select("*").eq("id", "default").single(),
      activeTab === "media"
        ? supabase.from("organizations").select("*").order("display_order", { ascending: true })
        : EMPTY,
      activeTab === "hero"
        ? supabase.from("cta_buttons").select("*").order("display_order", { ascending: true })
        : EMPTY,
      activeTab === "general"
        ? supabase
            .from("footer_blocks")
            .select("*, footer_links(*)")
            .order("display_order", { ascending: true })
            .order("display_order", { foreignTable: "footer_links", ascending: true })
        : EMPTY,
      activeTab === "general"
        ? supabase.from("social_links").select("*").order("display_order", { ascending: true })
        : EMPTY,
      activeTab === "header"
        ? supabase.from("nav_links").select("*").order("display_order", { ascending: true })
        : EMPTY,
      activeTab === "header"
        ? supabase.from("header_actions").select("*").order("display_order", { ascending: true })
        : EMPTY,
      activeTab === "users" ? supabase.from("profiles").select("*").order("created_at", { ascending: true }) : EMPTY,
    ]);
  } catch (err) {
    console.error("[SettingsPage] settings data load failed:", err);
    return (
      <SettingsMessage
        heading="Couldn't load settings"
        body="Something went wrong loading this page's data. Please refresh to try again."
      />
    );
  }

  const s = settings as SiteSettings | null;
  const themePrimary = s?.theme_primary_color || "#C1832B";
  const themeSecondary = s?.theme_secondary_color || "#151F33";

  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold text-saffron-600 mb-2">Settings</p>
      <h1 className="font-display text-3xl text-navy-900 mb-1">{activeMeta.heading}</h1>
      <p className="text-sm text-ink-600 mb-8">{activeMeta.description}</p>

      <SettingsTabs
        active={activeTab}
        general={
          <>
            <SeoSnippetForm
              siteTitle={s?.site_title ?? "Janatar Dipak"}
              metaDescription={s?.meta_description ?? ""}
              searchTags={s?.search_tags ?? []}
            />
            <BrandingTextForm settings={s} />
            <FooterBlocksManager blocks={(footerBlocks as FooterBlockWithLinks[]) ?? []} />
            <SocialLinksManager links={(socialLinks as SocialLink[]) ?? []} />
            <ThemeColorForm primaryColor={themePrimary} secondaryColor={themeSecondary} />
          </>
        }
        sections={
          <>
            <NotableWorksLimitControl limit={s?.notable_works_limit ?? 6} />
            <div className="bg-white border border-line rounded-xl p-6 md:p-8">
              <p className="text-sm font-semibold text-navy-900 mb-1">Homepage Arrangement</p>
              <p className="text-xs text-ink-400 mb-4">
                Reordering and showing/hiding homepage sections has moved to its own dedicated
                page, where Header/Hero/Footer are shown as fixed bookends around the sections you
                can move.
              </p>
              <Link
                href="/admin/arrangement"
                className="inline-flex items-center gap-2 text-sm font-semibold text-saffron-600 hover:text-saffron-700"
              >
                <Rows3 className="w-4 h-4" />
                Go to Arrangement
              </Link>
            </div>
          </>
        }
        header={
          <HeaderNavigationManager
            navLinks={(navLinks as NavLink[]) ?? []}
            headerActions={(headerActions as HeaderAction[]) ?? []}
            themePrimary={themePrimary}
          />
        }
        hero={
          <>
            <LandingForm settings={s} />
            <CtaButtonsManager buttons={(ctaButtons as CtaButton[]) ?? []} themePrimary={themePrimary} />
          </>
        }
        media={
          <>
            <SiteImageUploader
              kind="hero"
              label="Hero Image"
              helpText="Large portrait shown at the top of the homepage. Recommended: a 4:5 portrait photo."
              currentUrl={s?.hero_image_url ?? null}
              previewClassName="w-32 aspect-[4/5] rounded-lg"
            />

            <SiteImageUploader
              kind="avatar"
              label="Profile Avatar"
              helpText="Small circular photo shown in the site header next to the name."
              currentUrl={s?.avatar_url ?? null}
              previewClassName="w-16 h-16 rounded-full"
            />

            <OrganizationsManager
              organizations={(organizations as Organization[]) ?? []}
              orgMaxPerRow={s?.org_max_per_row ?? 6}
            />
          </>
        }
        users={
          <UsersManager
            users={(profiles as Profile[]) ?? []}
            viewerId={user!.id}
            viewerIsOwner={Boolean(viewerProfile.is_admin)}
          />
        }
      />
    </div>
  );
}
