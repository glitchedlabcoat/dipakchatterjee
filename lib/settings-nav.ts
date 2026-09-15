// lib/settings-nav.ts
//
// Single source of truth for the Settings sub-navigation shown in
// components/admin/AdminSidebar.tsx and read back by
// app/admin/(protected)/settings/page.tsx (page header title/description,
// generateMetadata's <title>, and which panel SettingsTabs renders) — one
// list instead of three separately-maintained copies.

export const SETTINGS_TABS = [
  {
    id: "general",
    navLabel: "General Settings",
    titleLabel: "General Settings",
    heading: "General Settings",
    description:
      "Google search snippet, browser tab title, header & footer branding, social links, and theme colors for the public site.",
  },
  {
    id: "sections",
    navLabel: "Landing / Homepage Sections",
    titleLabel: "Homepage Sections",
    heading: "Landing / Homepage Sections",
    description: "How many works appear on the homepage feed, and the order of homepage sections.",
  },
  {
    id: "header",
    navLabel: "Header & Navigation",
    titleLabel: "Header & Navigation",
    heading: "Header & Navigation",
    description: "Navigation links and action buttons shown in the public site's header.",
  },
  {
    id: "hero",
    navLabel: "Hero & Bio",
    titleLabel: "Hero & Bio",
    heading: "Hero & Bio",
    description: "The homepage hero headline, bio copy, badge, and call-to-action buttons.",
  },
  {
    id: "media",
    navLabel: "Media & Display",
    titleLabel: "Media & Display",
    heading: "Media & Display",
    description: "Hero image, profile avatar, and affiliated organization logos shown on the public homepage.",
  },
  {
    id: "users",
    navLabel: "Users & Access",
    titleLabel: "Users",
    heading: "Users & Access",
    description: "Manage who can sign in to this dashboard.",
  },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "general";

export function isSettingsTabId(value: string | undefined | null): value is SettingsTabId {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}

export function settingsTabHref(id: SettingsTabId) {
  return id === DEFAULT_SETTINGS_TAB ? "/admin/settings" : `/admin/settings?tab=${id}`;
}
