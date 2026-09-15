// app/(site)/page.tsx
//
// Public homepage. Hero copy, hero image, and CTA buttons come from
// site_settings/cta_buttons (editable at /admin/settings -> Hero & Bio),
// falling back to the original static index.html copy when unset. The
// hero and its bio/CTAs always render first — everything after it
// (Organizations, the posts feed, and every Feature section) renders in
// the order and visibility chosen in Settings -> Homepage Sections (see
// lib/homepage-layout.ts), so an admin can show/hide and reorder them
// without a code change.
//
// The hero itself renders twice: a `md:hidden` mobile-only version
// (heading overlaid on the image, body copy/CTAs live below it in
// normal flow so nothing overlaps or blocks taps) and a `hidden
// md:block` desktop version (components/DesktopHero.tsx) with the
// side-by-side layout, plus client state so the portrait resizes in
// sync with the bio's Read More/Read Less.
//
// "Submit a complaint" only ever appears once per viewport — in the
// header nav (and its mobile drawer) — so it isn't duplicated beside the
// hero CTA buttons.
//
// Phases is unified into the same Modular Sections list as Image
// Gallery features (managed from /admin/features) and renders
// interleaved with them here — each phase gets its own key in
// sectionOrder (phase:<id>, alongside feature:<id>) so its position
// among Organizations/Features/Posts follows the exact order chosen in
// that unified admin list (see lib/homepage-layout.ts).

import { createPublicClient } from "@/utils/supabase/public";
import { PUBLIC_CACHE_TAG, TAG_SECTIONS, createTrackedCache } from "@/lib/cache";
import { getSiteSettings } from "@/lib/queries/settings";
import { getPostsList } from "@/lib/queries/posts";
import type { CtaButton, FeatureWithMedia, Organization, Phase, SiteSettings } from "@/types/domain";
import FeatureSection from "@/components/features/FeatureSection";
import PostsFeed from "@/components/posts/PostsFeed";
import PhaseEntry from "@/components/phases/PhaseEntry";
import OrganizationsSection from "@/components/OrganizationsSection";
import CtaButtonGroup from "@/components/CtaButtonGroup";
import RevealOnScroll from "@/components/RevealOnScroll";
import ExpandableBio from "@/components/ExpandableBio";
import DesktopHero from "@/components/DesktopHero";
import {
  computeHomepageOrder,
  featureIdFromKey,
  phaseIdFromKey,
  ORGANIZATIONS_SECTION_KEY,
  POSTS_SECTION_KEY,
} from "@/lib/homepage-layout";

const FALLBACK_HEADLINE = "A life spent teaching, organising, and showing up when it matters.";
const FALLBACK_BODY =
  "Dipak Chatterjee has spent over two decades as a schoolteacher and headmaster in Chanchal, North Malda, alongside a parallel life of community organising. This is his record of work, and a direct line for anyone who needs help.";

// DO NOT REMOVE. This page has no dynamic segment, and app/(site)/layout.tsx
// now also forces dynamic for the same reason (see the comment there for
// the full story, including the CI build break this caused in 889408d) —
// but this export is kept here too as a belt-and-suspenders guard in case
// this page is ever moved out from under that layout. `dynamic` only
// controls route/HTML caching, not the `unstable_cache` fetch below.
export const dynamic = "force-dynamic";

// Features/Phases/Organizations/CTA buttons — the homepage's
// "sections" content, tagged TAG_SECTIONS. Settings and the posts feed
// come from their own shared, separately-tagged caches below (see
// lib/queries/settings.ts and lib/queries/posts.ts) so an admin save to
// any one of settings/posts/sections only busts that one's cache entry,
// not the other two. See app/(site)/layout.tsx and lib/cache.ts for why
// this is cached at the data-fetch layer (unstable_cache) rather than
// via page-level ISR.
const getHomepageSections = createTrackedCache(
  "/:sections",
  async () => {
    const supabase = createPublicClient();

    const [{ data: features }, { data: phases }, { data: organizations }, { data: ctaButtons }] = await Promise.all([
      supabase
        .from("features")
        .select("*, feature_media(*)")
        .eq("is_published", true)
        .order("display_order", { ascending: true })
        .order("display_order", { foreignTable: "feature_media", ascending: true }),
      supabase
        .from("phases")
        .select("*")
        .eq("is_published", true)
        .order("sort_order", { ascending: true }),
      supabase.from("organizations").select("*").order("display_order", { ascending: true }),
      supabase.from("cta_buttons").select("*").order("display_order", { ascending: true }),
    ]);

    return { features, phases, organizations, ctaButtons };
  },
  ["homepage-sections"],
  { revalidate: 60, tags: [TAG_SECTIONS, PUBLIC_CACHE_TAG] }
);

export default async function HomePage() {
  const [settings, { features, phases, organizations, ctaButtons }] = await Promise.all([
    getSiteSettings(),
    getHomepageSections(),
  ]);
  const s = settings as SiteSettings | null;
  const { posts } = await getPostsList({ page: 1, pageSize: s?.notable_works_limit ?? 6 });

  const headline = s?.hero_headline || FALLBACK_HEADLINE;
  const body = s?.hero_body || FALLBACK_BODY;
  const themePrimary = s?.theme_primary_color || "#C1832B";
  // No fallback text here (unlike headline/body): a blank badge field
  // means "don't show the badge", not "show placeholder copy".
  const badgeSubtitle = s?.hero_badge_subtitle?.trim() || "";
  const badgeTitle = s?.hero_badge_title?.trim() || "";
  const orgMaxPerRow = s?.org_max_per_row ?? 6;
  const orgs = (organizations as Organization[]) ?? [];
  const ctas = (ctaButtons as CtaButton[]) ?? [];
  const featureList = (features as FeatureWithMedia[]) ?? [];
  const featureMap = new Map(featureList.map((f) => [f.id, f]));
  const phaseList = (phases as Phase[]) ?? [];
  const phaseMap = new Map(phaseList.map((p) => [p.id, p]));

  const sectionOrder = computeHomepageOrder(s?.homepage_layout, featureList, phaseList);

  return (
    <main id="main">
      {/* Mobile-only hero: ONLY the heading sits over the photo (with a
          gradient behind it for legibility). Body copy and CTAs live
          below it in normal document flow — never overlapping it, so
          nothing is ever visually blocked or untappable. */}
      <section className="md:hidden border-b border-line">
        <div className="relative w-full aspect-[4/5] overflow-hidden">
          {s?.hero_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.hero_image_url}
              alt="Portrait of Dipak Chatterjee"
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 w-full h-full bg-navy-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-navy-900 via-navy-900/30 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 px-5 pb-6">
            <h1 className="font-display text-4xl leading-[1.1] text-white">{headline}</h1>
          </div>
        </div>

        <div className="px-5 pt-6 pb-10 bg-paper-100">
          <ExpandableBio text={body} />

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <CtaButtonGroup buttons={ctas} themePrimary={themePrimary} />
          </div>
        </div>
      </section>

      {/* Desktop hero — same side-by-side layout, now a client component
          so the portrait can grow/shrink in sync with Read More/Read
          Less (see components/DesktopHero.tsx). */}
      <section className="hidden md:block ledger-lines border-b border-line">
        <DesktopHero
          headline={headline}
          body={body}
          ctas={ctas}
          themePrimary={themePrimary}
          heroImageUrl={s?.hero_image_url}
          badgeSubtitle={badgeSubtitle}
          badgeTitle={badgeTitle}
        />
      </section>

      {sectionOrder.map((key) => {
        if (key === ORGANIZATIONS_SECTION_KEY) {
          if (s?.show_organizations_section === false) return null;
          return <OrganizationsSection key={key} organizations={orgs} maxPerRow={orgMaxPerRow} />;
        }

        if (key === POSTS_SECTION_KEY) {
          if (s?.show_posts_feed_section === false) return null;
          return <PostsFeed key={key} posts={posts} />;
        }

        const featureId = featureIdFromKey(key);
        if (featureId) {
          const feature = featureMap.get(featureId);
          if (!feature) return null;
          return (
            <RevealOnScroll key={key}>
              <FeatureSection feature={feature} />
            </RevealOnScroll>
          );
        }

        const phaseId = phaseIdFromKey(key);
        if (phaseId) {
          const phase = phaseMap.get(phaseId);
          if (!phase) return null;
          return (
            <RevealOnScroll key={key}>
              <PhaseEntry phase={phase} />
            </RevealOnScroll>
          );
        }

        return null;
      })}
    </main>
  );
}
