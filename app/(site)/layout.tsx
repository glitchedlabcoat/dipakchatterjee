// app/(site)/layout.tsx
//
// Wraps every public page (homepage, /posts/[id], /complaints, ...) with
// the shared header/footer and the dynamic theme CSS variables. Route
// group — adds no URL segment. Deliberately excludes /admin/*, which has
// its own layout, chrome, and fixed branding.
//
// Data comes through getSiteChrome() below — an `unstable_cache`-wrapped
// read using the cookie-free public client (see utils/supabase/public.ts
// and lib/cache.ts for why: this site can't use page-level ISR since
// proxy.ts's per-request CSP nonce forces every route dynamic, so
// caching happens at the data-fetch layer instead). Cached for 60s,
// busted instantly by revalidatePublicPages() from any Settings save.

import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/utils/supabase/public";
import { PUBLIC_CACHE_TAG } from "@/lib/cache";
import type { FooterBlockWithLinks, HeaderAction, NavLink, SiteSettings, SocialLink } from "@/types/domain";
import { darken } from "@/lib/color";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

const getSiteChrome = unstable_cache(
  async () => {
    const supabase = createPublicClient();

    const [{ data: settings }, { data: footerBlocks }, { data: socialLinks }, { data: navLinks }, { data: headerActions }] =
      await Promise.all([
        supabase
          .from("site_settings")
          .select(
            "avatar_url, theme_primary_color, theme_secondary_color, header_name, header_subtitle, footer_tagline, footer_copyright_name, footer_note, office_email"
          )
          .eq("id", "default")
          .single(),
        supabase
          .from("footer_blocks")
          .select("*, footer_links(*)")
          .order("display_order", { ascending: true })
          .order("display_order", { foreignTable: "footer_links", ascending: true }),
        supabase.from("social_links").select("*").order("display_order", { ascending: true }),
        // Visibility is filtered client-side in SiteHeader (`!== false`),
        // not with `.eq("is_visible", true)` here: that keeps this query
        // resilient if the is_visible column/nav_links table itself isn't
        // live yet on this database (a plain `select("*")` degrades to
        // omitting the column rather than erroring on an unknown one).
        supabase.from("nav_links").select("*").order("display_order", { ascending: true }),
        supabase.from("header_actions").select("*").order("display_order", { ascending: true }),
      ]);

    return { settings, footerBlocks, socialLinks, navLinks, headerActions };
  },
  ["site-chrome"],
  { revalidate: 60, tags: [PUBLIC_CACHE_TAG] }
);

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { settings, footerBlocks, socialLinks, navLinks, headerActions } = await getSiteChrome();

  const s = settings as Pick<
    SiteSettings,
    | "avatar_url"
    | "theme_primary_color"
    | "theme_secondary_color"
    | "header_name"
    | "header_subtitle"
    | "footer_tagline"
    | "footer_copyright_name"
    | "footer_note"
    | "office_email"
  > | null;

  const primary = s?.theme_primary_color || "#C1832B";
  const secondary = s?.theme_secondary_color || "#151F33";

  return (
    <div
      className="min-h-screen transition-colors"
      style={
        {
          "--theme-primary": primary,
          "--theme-primary-hover": darken(primary, 0.15),
          "--theme-secondary": secondary,
          "--theme-secondary-hover": darken(secondary, 0.15),
        } as React.CSSProperties
      }
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-navy-900 focus:text-white focus:px-4 focus:py-2 focus:rounded z-50"
      >
        Skip to content
      </a>

      <SiteHeader
        avatarUrl={s?.avatar_url}
        name={s?.header_name}
        subtitle={s?.header_subtitle}
        navLinks={(navLinks as NavLink[]) ?? []}
        actions={(headerActions as HeaderAction[]) ?? []}
      />
      {children}
      <SiteFooter
        tagline={s?.footer_tagline}
        copyrightName={s?.footer_copyright_name}
        note={s?.footer_note}
        contactEmail={s?.office_email}
        blocks={(footerBlocks as FooterBlockWithLinks[]) ?? []}
        socialLinks={(socialLinks as SocialLink[]) ?? []}
      />
    </div>
  );
}
