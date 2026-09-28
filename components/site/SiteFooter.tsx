// components/site/SiteFooter.tsx
//
// Brand column + copyright bar are dashboard-editable text (Settings ->
// Header & footer branding), each falling back to the original static
// copy when unset. Everything else — the remaining columns — comes from
// the modular footer builder (Settings -> Footer builder): an ordered
// list of blocks, each Custom Content (free-form title/body), Quick
// Links (admin-defined nav links), or Follow (the social links managed
// in Settings -> Social media & Follow). No fixed column count: the
// grid always wraps, so any number of blocks lays out cleanly on both
// desktop and mobile.
//
// The Privacy & Copyright link in the bottom bar is fixed, not a footer
// block: the privacy notice and takedown contact must stay reachable
// even if every dashboard-managed block is removed.

import Link from "next/link";
import { Mail } from "lucide-react";
import SocialIcon from "@/components/SocialIcon";
import AnchorAwareLink from "./AnchorAwareLink";
import { SOCIAL_PLATFORM_LABELS, type FooterBlockWithLinks, type SocialLink } from "@/types/domain";

const DEFAULT_NAME = "Dipak Chatterjee";
const DEFAULT_TAGLINE = "Social worker, educationist, and community leader based in Chanchal, North Malda.";
const DEFAULT_NOTE = "This is an official citizen-service portal.";

function FooterBlockColumn({ block, socialLinks }: { block: FooterBlockWithLinks; socialLinks: SocialLink[] }) {
  if (block.type === "custom_content") {
    if (!block.title && !block.body) return null;
    return (
      <div>
        {block.title && <p className="text-white font-semibold text-sm mb-4">{block.title}</p>}
        {block.body && <p className="text-sm whitespace-pre-line leading-relaxed">{block.body}</p>}
      </div>
    );
  }

  if (block.type === "quick_links") {
    if (block.footer_links.length === 0) return null;
    return (
      <div>
        {block.title && <p className="text-white font-semibold text-sm mb-4">{block.title}</p>}
        <ul className="text-sm space-y-2">
          {block.footer_links.map((link) => (
            <li key={link.id}>
              <AnchorAwareLink href={link.url} className="hover:text-white">
                {link.label}
              </AnchorAwareLink>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.type === "follow") {
    if (socialLinks.length === 0) return null;
    return (
      <div>
        {block.title && <p className="text-white font-semibold text-sm mb-4">{block.title}</p>}
        <div className="flex flex-wrap gap-3">
          {socialLinks.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.label || SOCIAL_PLATFORM_LABELS[link.platform] || link.platform}
              className="w-9 h-9 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/10 touch-manipulation"
            >
              <SocialIcon platform={link.platform} className="w-4 h-4" />
            </a>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export default function SiteFooter({
  tagline,
  copyrightName,
  note,
  contactEmail,
  blocks,
  socialLinks,
}: {
  tagline?: string | null;
  copyrightName?: string | null;
  note?: string | null;
  contactEmail?: string | null;
  blocks: FooterBlockWithLinks[];
  socialLinks: SocialLink[];
}) {
  return (
    <footer id="contact" className="bg-[var(--theme-secondary)] text-paper-100/80 pt-16 pb-8">
      <div className="max-w-6xl mx-auto px-5 md:px-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
        <div>
          <p className="font-display text-xl text-white mb-3">{copyrightName || DEFAULT_NAME}</p>
          <p className="text-sm leading-relaxed">{tagline || DEFAULT_TAGLINE}</p>
          {contactEmail && (
            <a
              href={`mailto:${contactEmail}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm hover:text-white"
            >
              <Mail className="w-3.5 h-3.5" />
              {contactEmail}
            </a>
          )}
        </div>

        {blocks.map((block) => (
          <FooterBlockColumn key={block.id} block={block} socialLinks={socialLinks} />
        ))}
      </div>

      <div className="max-w-6xl mx-auto px-5 md:px-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row gap-3 justify-between text-xs text-paper-100/50">
        <p>
          &copy; {new Date().getFullYear()} {copyrightName || DEFAULT_NAME}. All rights reserved.
        </p>
        <p>
          {note || DEFAULT_NOTE}{" "}
          <Link href="/privacy" className="underline hover:text-white">
            Privacy &amp; Copyright
          </Link>
        </p>
      </div>
    </footer>
  );
}
