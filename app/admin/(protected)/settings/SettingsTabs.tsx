// app/admin/(protected)/settings/SettingsTabs.tsx
//
// Picks which of the Settings page's category panels to render. Each
// panel's contents are rendered server-side in page.tsx and handed down
// as plain ReactNode props (composition pattern) — this component only
// owns which one is currently active, and takes that from the URL
// (?tab=...) via page.tsx rather than owning any client-side state
// itself, since navigation now happens through the sidebar's Settings
// sub-menu (see components/admin/AdminSidebar.tsx and
// lib/settings-nav.ts) instead of an in-page tab bar.

import type { ReactNode } from "react";
import type { SettingsTabId } from "@/lib/settings-nav";

export default function SettingsTabs({
  active,
  general,
  sections,
  header,
  hero,
  media,
  users,
}: { active: SettingsTabId } & Record<SettingsTabId, ReactNode>) {
  const panels: Record<SettingsTabId, ReactNode> = { general, sections, header, hero, media, users };

  return <div className="space-y-6">{panels[active]}</div>;
}
