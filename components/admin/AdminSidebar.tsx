// components/admin/AdminSidebar.tsx
//
// Desktop: persistent fixed sidebar, exactly as before.
// Mobile/narrow: hidden off-canvas by default, slides in as a drawer
// over a dimmed backdrop when the header's hamburger button (see
// SidebarToggleButton) opens it. Tapping a nav link, the close button,
// or the backdrop all dismiss it.

"use client";

import Link from "next/link";
import { X, ExternalLink, Gauge, History, Image as ImageIcon, LayoutDashboard, Layers, MessageSquareWarning, Rows3, Rss } from "lucide-react";
import SignOutButton from "@/components/admin/SignOutButton";
import { useMobileSidebar } from "@/components/admin/MobileSidebarContext";

const NAV_LINKS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/features", label: "Features", icon: Layers },
  { href: "/admin/arrangement", label: "Arrangement", icon: Rows3 },
  { href: "/admin/posts", label: "Posts", icon: Rss },
  { href: "/admin/complaints", label: "Complaints", icon: MessageSquareWarning },
  { href: "/admin/egress", label: "Egress Monitor", icon: Gauge },
  { href: "/admin/settings", label: "Settings", icon: ImageIcon },
  { href: "/admin/logs", label: "Activity Logs", icon: History },
];

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
        className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-navy-900 text-paper-100 flex flex-col transition-transform duration-300 ease-in-out md:static md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-6 py-6 border-b border-white/10 flex items-start justify-between">
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

        <nav className="flex-1 px-3 py-5 space-y-1">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={close}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-paper-100/80 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-5 border-t border-white/10 space-y-3">
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
