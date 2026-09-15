// app/admin/(protected)/settings/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Rows3 } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
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
import OrganizationsManager from "./OrganizationsManager";
import ThemeColorForm from "./ThemeColorForm";
import CtaButtonsManager from "./CtaButtonsManager";
import BrandingTextForm from "./BrandingTextForm";
import SeoSnippetForm from "./SeoSnippetForm";
import FooterBlocksManager from "./FooterBlocksManager";
import SocialLinksManager from "./SocialLinksManager";
import HeaderNavigationManager from "./HeaderNavigationManager";
import NotableWorksLimitControl from "./NotableWorksLimitControl";
import UsersManager from "./UsersManager";
import SettingsTabs from "./SettingsTabs";
import { SETTINGS_TABS, DEFAULT_SETTINGS_TAB, isSettingsTabId } from "@/lib/settings-nav";
import type { Profile } from "@/types/domain";

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

  // Auth check and profile lookup are wrapped: a transient failure here
  // is not "signed out" and shouldn't be presented as such, but it also
  // must never crash this page via an unhandled rejection — fall
  // through to the same explicit error message either way.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  let viewerProfile: { is_admin: boolean } | null = null;
  let authFailed = false;

  try {
    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser();
    user = fetchedUser;

    if (user) {
      const { data } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
      viewerProfile = data;
    }
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
      supabase.from("organizations").select("*").order("display_order", { ascending: true }),
      supabase.from("cta_buttons").select("*").order("display_order", { ascending: true }),
      supabase
        .from("footer_blocks")
        .select("*, footer_links(*)")
        .order("display_order", { ascending: true })
        .order("display_order", { foreignTable: "footer_links", ascending: true }),
      supabase.from("social_links").select("*").order("display_order", { ascending: true }),
      supabase.from("nav_links").select("*").order("display_order", { ascending: true }),
      supabase.from("header_actions").select("*").order("display_order", { ascending: true }),
      supabase.from("profiles").select("*").order("created_at", { ascending: true }),
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
