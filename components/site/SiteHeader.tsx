// components/site/SiteHeader.tsx
//
// Sticky nav, adapted from the original static index.html header. Only the
// mobile menu toggle needs interactivity, so this is the one client
// component in the site shell.
//
// Both the primary nav row ("About", "Public Life", ...) and the action
// buttons/links (originally just a fixed "Submit a Complaint") are
// dashboard-managed (Settings -> Primary Nav Links / Header Actions):
// nav links have a label, a URL, and a visibility toggle; actions
// additionally have an icon, a style (solid/outline/text-link), a
// left/right position, and optional background/text color overrides.
// Both are filtered to only their visible rows here, so a hidden one
// disappears from the header without needing to be deleted. Nav links
// and most actions are desktop-inline / mobile-drawer-only (`lg:flex`
// vs `lg:hidden`), except the action whose url is "/complaints"
// ("Submit a Complaint") — that one stays pinned next to the hamburger
// on every breakpoint and is excluded from the drawer list, so it's
// never rendered twice at once.

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import SocialIcon from "@/components/SocialIcon";
import { HEADER_ACTION_ICON_LABELS, type HeaderAction, type NavLink } from "@/types/domain";

// Safety net, not the primary data source: only rendered if the
// dashboard-managed nav_links table comes back empty (e.g. its
// migration hasn't reached this database yet, or every row was
// deleted) — root-relative so these work identically whether clicked
// from the homepage or any other page, same as a real nav_links row.
const FALLBACK_NAV_LINKS: Pick<NavLink, "id" | "label" | "url" | "is_visible">[] = [
  { id: "fallback-about", label: "About", url: "/#about", is_visible: true },
  { id: "fallback-public-life", label: "Public Life", url: "/#public-life", is_visible: true },
  { id: "fallback-works", label: "Notable Works", url: "/#works", is_visible: true },
  { id: "fallback-contact", label: "Contact", url: "/#contact", is_visible: true },
];

const DEFAULT_NAME = "Dipak Chatterjee";
const DEFAULT_SUBTITLE = "Social Worker · Educationist";

// hover:brightness-90 (not a bg-color swap) so the darken-on-hover
// effect still works when an action has its own bg_color/text_color
// override (actionColorStyle sets those via inline `style`, which a
// Tailwind hover:bg-* class can never win against) — same mechanism
// CtaButtonGroup already uses for "Submit a Complaint"-style buttons.
const STYLE_CLASSES: Record<HeaderAction["style"], string> = {
  solid:
    "bg-[var(--theme-primary)] hover:brightness-90 text-white font-semibold px-4 py-2.5 rounded-md transition-[filter]",
  outline:
    "border border-[var(--theme-primary)] text-[var(--theme-primary)] hover:brightness-90 hover:bg-[var(--theme-primary)] hover:text-white font-semibold px-4 py-2.5 rounded-md transition-[filter,color,background-color]",
  link: "text-ink-600 hover:text-navy-900 font-medium",
};

const MOBILE_STYLE_CLASSES: Record<HeaderAction["style"], string> = {
  solid: "bg-[var(--theme-primary)] text-white font-semibold px-4 py-3 rounded-md text-center",
  outline: "border border-[var(--theme-primary)] text-[var(--theme-primary)] font-semibold px-4 py-3 rounded-md text-center",
  link: "text-ink-600 font-medium py-3 border-b border-line/70 last:border-b-0",
};

function ActionLabel({ action }: { action: HeaderAction }) {
  const iconOnly = action.icon !== "none" && !action.label;
  return (
    <>
      {action.icon !== "none" && <SocialIcon platform={action.icon} className="w-4 h-4" />}
      {!iconOnly && (action.label || "Link")}
    </>
  );
}

function actionAriaLabel(action: HeaderAction) {
  if (action.label) return undefined;
  if (action.icon !== "none") return `Follow on ${HEADER_ACTION_ICON_LABELS[action.icon]}`;
  return undefined;
}

/** Admin-picked overrides (Settings -> Header Actions) on top of the solid/outline/link style classes. */
function actionColorStyle(action: HeaderAction): React.CSSProperties | undefined {
  if (!action.bg_color && !action.text_color) return undefined;
  return {
    backgroundColor: action.bg_color || undefined,
    color: action.text_color || undefined,
    borderColor: action.bg_color || undefined,
  };
}

export default function SiteHeader({
  avatarUrl,
  name,
  subtitle,
  navLinks = [],
  actions = [],
}: {
  avatarUrl?: string | null;
  name?: string | null;
  subtitle?: string | null;
  navLinks?: NavLink[];
  actions?: HeaderAction[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  // `!== false` (not `=== true`) so a row is treated as visible when
  // is_visible comes back `undefined` — the shape a plain `select("*")`
  // returns if that column's migration hasn't reached this database yet.
  const visibleNavLinksFromDb = navLinks.filter((l) => l.is_visible !== false);
  const visibleNavLinks = visibleNavLinksFromDb.length > 0 ? visibleNavLinksFromDb : FALLBACK_NAV_LINKS;
  const visibleActions = actions.filter((a) => a.is_visible !== false);
  const leftActions = visibleActions.filter((a) => a.position === "left");
  const rightActions = visibleActions.filter((a) => a.position === "right");
  // "/complaints" is this site's one fixed system route (not admin-
  // renamable), so it's a reliable way to single out "Submit a
  // Complaint" regardless of whatever label an admin gives it.
  const complaintActionId = visibleActions.find((a) => a.url === "/complaints")?.id;
  const drawerActions = visibleActions.filter((a) => a.id !== complaintActionId);

  // Shared by every nav link, action link, and the logo: on the
  // homepage, a same-page "/#section" link should smoothly scroll
  // instead of doing a full client-side nav to the same route; on any
  // other page, plain <a>/Link navigation to "/#section" already lands
  // correctly and Next.js scrolls to the target once the homepage
  // renders, so this only needs to intervene in the first case.
  function handleAnchorClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (pathname !== "/") return;
    if (href === "/") {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const hashIndex = href.indexOf("#");
    if (hashIndex === -1) return;
    const targetPath = href.slice(0, hashIndex) || "/";
    if (targetPath !== "/") return;
    e.preventDefault();
    document.getElementById(href.slice(hashIndex + 1))?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <header className="sticky top-0 z-40 bg-paper-100/95 backdrop-blur border-b border-line transition-colors">
      <nav className="relative z-10 max-w-6xl mx-auto px-5 md:px-8 h-16 md:h-20 flex items-center justify-between gap-3">
        <Link href="/" onClick={(e) => handleAnchorClick(e, "/")} className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 md:w-10 md:h-10 rounded-full overflow-hidden shrink-0 border border-line bg-[var(--theme-primary)]/10 flex items-center justify-center">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => {
                  // Broken/expired storage URL: fall back to the "DC"
                  // monogram instead of leaving a blank/broken circle.
                  e.currentTarget.style.display = "none";
                  e.currentTarget.nextElementSibling?.classList.remove("hidden");
                }}
              />
            ) : null}
            <span
              className={`font-display font-bold text-sm text-[var(--theme-primary)] ${avatarUrl ? "hidden" : ""}`}
            >
              DC
            </span>
          </span>

          <span className="leading-tight min-w-0">
            <span className="block font-display text-base md:text-lg text-navy-900 truncate">
              {name || DEFAULT_NAME}
            </span>
            {/* Mobile shows only the avatar + name — the subtitle (and
                any truncated "…" from it) is desktop-only, so the
                mobile header bar stays uncluttered. */}
            <span className="hidden md:block text-xs text-ink-400 tracking-wide truncate">
              {subtitle || DEFAULT_SUBTITLE}
            </span>
          </span>
        </Link>

        {leftActions.length > 0 && (
          <div className="flex items-center gap-3 text-sm shrink-0">
            {leftActions.map((action) => (
              <a
                key={action.id}
                href={action.url}
                target={action.url.startsWith("http") ? "_blank" : undefined}
                rel={action.url.startsWith("http") ? "noopener noreferrer" : undefined}
                aria-label={actionAriaLabel(action)}
                onClick={(e) => handleAnchorClick(e, action.url)}
                style={actionColorStyle(action)}
                className={`items-center gap-2 text-sm ${STYLE_CLASSES[action.style]} ${
                  action.id === complaintActionId ? "inline-flex" : "hidden lg:inline-flex"
                }`}
              >
                <ActionLabel action={action} />
              </a>
            ))}
          </div>
        )}

        <div className="hidden lg:flex items-center gap-8 text-sm text-ink-600 font-medium">
          {visibleNavLinks.map((link) => (
            <a
              key={link.id}
              href={link.url}
              onClick={(e) => handleAnchorClick(e, link.url)}
              className="hover:text-navy-900"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {rightActions.map((action) => (
            <a
              key={action.id}
              href={action.url}
              target={action.url.startsWith("http") ? "_blank" : undefined}
              rel={action.url.startsWith("http") ? "noopener noreferrer" : undefined}
              aria-label={actionAriaLabel(action)}
              onClick={(e) => handleAnchorClick(e, action.url)}
              style={actionColorStyle(action)}
              className={`items-center gap-2 text-sm ${STYLE_CLASSES[action.style]} ${
                action.id === complaintActionId ? "inline-flex" : "hidden lg:inline-flex"
              }`}
            >
              <ActionLabel action={action} />
            </a>
          ))}

          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="lg:hidden w-10 h-10 flex items-center justify-center rounded-md border border-line text-navy-900 touch-manipulation"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div
          id="mobile-menu"
          className="lg:hidden relative z-10 border-t border-line bg-paper-100 max-h-[calc(100vh-4rem)] overflow-y-auto"
        >
          <div className="px-5 py-4 flex flex-col gap-1 text-ink-600 font-medium">
            {visibleNavLinks.map((link) => (
              <a
                key={link.id}
                href={link.url}
                onClick={(e) => {
                  setMenuOpen(false);
                  handleAnchorClick(e, link.url);
                }}
                className="py-3 border-b border-line/70 last:border-b-0 touch-manipulation"
              >
                {link.label}
              </a>
            ))}
            {drawerActions.map((action) => (
              <a
                key={action.id}
                href={action.url}
                target={action.url.startsWith("http") ? "_blank" : undefined}
                rel={action.url.startsWith("http") ? "noopener noreferrer" : undefined}
                aria-label={actionAriaLabel(action)}
                onClick={(e) => {
                  setMenuOpen(false);
                  handleAnchorClick(e, action.url);
                }}
                style={actionColorStyle(action)}
                className={`mt-2 flex items-center justify-center gap-2 touch-manipulation ${MOBILE_STYLE_CLASSES[action.style]}`}
              >
                <ActionLabel action={action} />
              </a>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
