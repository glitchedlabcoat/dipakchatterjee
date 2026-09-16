// components/admin/AdminSidebar.tsx
//
// Desktop: persistent fixed sidebar, exactly as before.
// Mobile/narrow: hidden off-canvas by default, slides in as a drawer
// over a dimmed backdrop when the header's hamburger button (see
// SidebarToggleButton) opens it. Tapping a nav link, the close button,
// or the backdrop all dismiss it.

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  X,
  Activity,
  ChevronDown,
  ExternalLink,
  History,
  Image as ImageIcon,
  LayoutDashboard,
  Layers,
  MessageSquareWarning,
  Rows3,
  Rss,
} from "lucide-react";
import SignOutButton from "@/components/admin/SignOutButton";
import { useMobileSidebar } from "@/components/admin/MobileSidebarContext";
import { useAdminNavPending } from "@/components/admin/AdminNavPendingContext";
import { SETTINGS_TABS, DEFAULT_SETTINGS_TAB, settingsTabHref } from "@/lib/settings-nav";

// A modified click (open in new tab/window, or anything but a plain
// left click) must fall through to the browser's native <a> behavior —
// only a plain click gets intercepted for the instant-pending/disabled
// treatment below.
function isPlainLeftClick(e: React.MouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

// Split around the Settings accordion (rendered separately below, in
// this same spot) rather than one flat list, since Settings alone needs
// expand/collapse + sub-route state that a plain Link doesn't.
const NAV_LINKS_BEFORE_SETTINGS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/features", label: "Features", icon: Layers },
  { href: "/admin/arrangement", label: "Arrangement", icon: Rows3 },
  { href: "/admin/posts", label: "Posts", icon: Rss },
  { href: "/admin/complaints", label: "Complaints", icon: MessageSquareWarning },
  { href: "/admin/usage", label: "Usage Metrics", icon: Activity },
];

const NAV_LINKS_AFTER_SETTINGS = [{ href: "/admin/logs", label: "Activity Logs", icon: History }];

export default function AdminSidebar({
  brandName,
  brandSubtitle,
  userLabel,
}: {
  brandName: string;
  brandSubtitle: string;
  userLabel: string;
}) {
  const { isOpen, close } = useMobileSidebar();
  const { isPending, navigate } = useAdminNavPending();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isSettingsRoute = pathname === "/admin/settings";
  const activeSettingsTab = searchParams.get("tab") ?? DEFAULT_SETTINGS_TAB;

  // Auto-expands whenever the current route lands inside Settings (direct
  // link, refresh, or navigating in from elsewhere); staying collapsible
  // by hand afterwards so it doesn't fight a deliberate collapse while
  // already there. Adjusted during render (React's recommended pattern
  // for state that depends on a changed prop) rather than in an effect,
  // which would cost an extra, avoidable render pass.
  const [settingsOpen, setSettingsOpen] = useState(isSettingsRoute);
  const [prevIsSettingsRoute, setPrevIsSettingsRoute] = useState(isSettingsRoute);
  if (isSettingsRoute !== prevIsSettingsRoute) {
    setPrevIsSettingsRoute(isSettingsRoute);
    if (isSettingsRoute) setSettingsOpen(true);
  }

  // Intercepts a plain click to route it through useTransition (see
  // AdminNavPendingContext) instead of a bare <Link> navigation, so
  // isPending covers the whole nav and every other link can disable
  // itself the instant one is clicked — pointer-events-none is the
  // primary guard against a rage-click pile-up, the isPending check
  // below is a second line of defense for a non-pointer activation
  // (e.g. Enter on a focused link) that pointer-events can't catch.
  function handleNavClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    close();
    if (!isPlainLeftClick(e)) return;
    e.preventDefault();
    if (isPending) return;
    navigate(href);
  }

  function renderLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof LayoutDashboard }) {
    return (
      <Link
        key={href}
        href={href}
        onClick={(e) => handleNavClick(e, href)}
        aria-disabled={isPending}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-paper-100/80 hover:bg-white/10 hover:text-white transition-colors ${
          isPending ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <Icon className="w-4 h-4" />
        {label}
      </Link>
    );
  }

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-navy-900 text-paper-100 flex flex-col transition-transform duration-300 ease-in-out md:static md:h-full md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="shrink-0 px-6 py-6 border-b border-white/10 flex items-start justify-between">
          <div>
            <p className="font-display text-lg text-white">{brandName}</p>
            <p className="text-xs text-paper-100/60 mt-1">{brandSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close navigation menu"
            className="md:hidden -mt-1 -mr-2 p-2 rounded-md text-paper-100/80 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-5 space-y-1">
          {NAV_LINKS_BEFORE_SETTINGS.map(renderLink)}

          <div>
            <button
              type="button"
              onClick={() => setSettingsOpen((prev) => !prev)}
              aria-expanded={settingsOpen}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                isSettingsRoute
                  ? "bg-white/10 text-white"
                  : "text-paper-100/80 hover:bg-white/10 hover:text-white"
              }`}
            >
              <ImageIcon className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-left">Settings</span>
              <ChevronDown
                className={`w-4 h-4 shrink-0 transition-transform ${settingsOpen ? "rotate-180" : ""}`}
              />
            </button>

            {settingsOpen && (
              <div className="mt-1 ml-4 pl-3 border-l border-white/10 space-y-0.5">
                {SETTINGS_TABS.map((tab) => {
                  const active = isSettingsRoute && activeSettingsTab === tab.id;
                  return (
                    <Link
                      key={tab.id}
                      href={settingsTabHref(tab.id)}
                      onClick={(e) => handleNavClick(e, settingsTabHref(tab.id))}
                      aria-current={active ? "page" : undefined}
                      aria-disabled={isPending}
                      className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                        active
                          ? "bg-saffron/15 text-saffron font-medium"
                          : "text-paper-100/70 hover:bg-white/10 hover:text-white"
                      } ${isPending ? "pointer-events-none opacity-50" : ""}`}
                    >
                      {tab.navLabel}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {NAV_LINKS_AFTER_SETTINGS.map(renderLink)}
        </nav>

        <div className="shrink-0 px-3 py-5 border-t border-white/10 space-y-3">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-saffron hover:bg-white/10 hover:text-saffron/90 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            View Live Site
          </a>

          <div>
            <p className="px-3 text-xs text-paper-100/50 mb-2 truncate">{userLabel}</p>
            <SignOutButton />
          </div>
        </div>
      </aside>
    </>
  );
}
