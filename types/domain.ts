// types/domain.ts
//
// Convenience aliases over the generated Supabase types, plus the joined
// shapes used once a Feature/Post is fetched together with its media.

import type { Tables } from "@/types/database.types";

export type Feature = Tables<"features">;
export type FeatureMedia = Tables<"feature_media">;
export type Post = Tables<"posts">;
export type PostMedia = Tables<"post_media">;
export type Phase = Tables<"phases">;
export type Profile = Tables<"profiles">;
export type SiteSettings = Tables<"site_settings">;
export type Organization = Tables<"organizations">;
export type Complaint = Tables<"complaints">;
export type ComplaintMedia = Tables<"complaint_media">;
export type CtaButton = Tables<"cta_buttons">;
export type SocialLink = Tables<"social_links">;
export type FooterBlock = Tables<"footer_blocks">;
export type FooterLink = Tables<"footer_links">;
export type HeaderAction = Tables<"header_actions">;
export type NavLink = Tables<"nav_links">;
export type DashboardActivityLog = Tables<"dashboard_activity_logs">;
export type CacheMetric = Tables<"cache_metrics">;

export type FeatureType = Feature["type"];
export type MediaKind = FeatureMedia["kind"];

export type FeatureWithMedia = Feature & { feature_media: FeatureMedia[] };
export type PostWithMedia = Post & { post_media: PostMedia[] };
export type ComplaintWithMedia = Complaint & { complaint_media: ComplaintMedia[] };
export type FooterBlockWithLinks = FooterBlock & { footer_links: FooterLink[] };

export type FooterBlockType = FooterBlock["type"];

export const FOOTER_BLOCK_TYPE_LABELS: Record<FooterBlockType, string> = {
  custom_content: "Custom Content",
  quick_links: "Quick Links",
  follow: "Follow (social links)",
};

export const SOCIAL_PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "Twitter / X",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  other: "Other",
};

export type HeaderActionIcon = HeaderAction["icon"];
export type HeaderActionStyle = HeaderAction["style"];
export type HeaderActionPosition = HeaderAction["position"];

export const HEADER_ACTION_ICON_LABELS: Record<HeaderActionIcon, string> = {
  none: "No icon",
  facebook: "Facebook",
  instagram: "Instagram",
  twitter: "Twitter / X",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  other: "Other",
};

export const HEADER_ACTION_STYLE_LABELS: Record<HeaderActionStyle, string> = {
  solid: "Solid button",
  outline: "Outline button",
  link: "Text / icon link",
};

export const FEATURE_TYPE_LABELS: Record<FeatureType, string> = {
  about: "About",
  public_life_gallery: "Image Gallery",
  stats: "Stats Strip",
  custom_section: "Custom Section",
};

export const FEATURE_BUCKET = "feature-media";
export const POST_BUCKET = "post-media";
export const SITE_BUCKET = "site-media";
export const COMPLAINT_BUCKET = "complaint-media";
export const PHASE_BUCKET = "phase-media";

/** One entry of phases.photos (a JSONB array, not a foreign-keyed media table). `path` is an internal storage-bookkeeping detail (used to delete the file), not part of the public shape. `fact` is an optional extra detail shown only on the Phase's full "Read More" page, alongside `caption`. */
export type PhasePhoto = { url: string; path: string; caption?: string; fact?: string };

/**
 * One entry of posts.links (a JSONB array). "embed" is rendered as an
 * iframe beside the post text when its `url` matches a known provider
 * (see lib/embed.ts's getEmbedInfo) — otherwise it's silently ignored,
 * same as an unrecognized URL always was. "button" always renders as a
 * plain call-to-action, regardless of what its URL points to.
 */
export type PostLink = { id: string; url: string; type: "button" | "embed"; label?: string };
