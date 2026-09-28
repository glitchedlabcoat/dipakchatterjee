// app/(site)/privacy/page.tsx
//
// Privacy notice + copyright takedown contact. Every statement here is
// meant to describe what the code actually does, so keep it in step
// with the code it describes:
//   - complaint fields/retention -> app/(site)/complaints/actions.ts,
//     lib/complaints-cleanup.ts (retention days come live from
//     site_settings.complaint_expiration_days, same default of 7)
//   - IP used only for the in-memory rate limit -> lib/rate-limit.ts
//   - embeds load automatically, no consent step (the click-to-load
//     gate was removed 2026-09-28) -> components/posts/PostEmbed.tsx
//   - no first-party public-site cookies/analytics -> proxy.ts only
//     touches auth cookies under /admin
//
// Not legal advice and not reviewed by a lawyer: have it checked
// before relying on it (India's DPDP Act 2023 is the most likely
// applicable regime). The takedown contact reuses the office email from
// Settings rather than a placeholder address, so it's never a dead
// inbox; swap in a dedicated address there if one is set up.

import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getSiteSettings } from "@/lib/queries/settings";
import type { SiteSettings } from "@/types/domain";

export const metadata: Metadata = {
  title: "Privacy & Copyright",
  description: "How this site handles complaint submissions, third-party content, and copyright notices.",
  alternates: { canonical: "/privacy" },
};

const DEFAULT_CONTACT_EMAIL = "dipak.chatterjee304@gmail.com";
const DEFAULT_RETENTION_DAYS = 7;
const LAST_UPDATED = "28 September 2026";

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-xl text-navy-900 mb-3">{title}</h2>
      <div className="space-y-3 text-ink-600 leading-relaxed">{children}</div>
    </section>
  );
}

export default async function PrivacyPage() {
  const settings = (await getSiteSettings()) as Pick<
    SiteSettings,
    "office_email" | "complaint_expiration_days" | "footer_copyright_name"
  > | null;
  const contactEmail = settings?.office_email || DEFAULT_CONTACT_EMAIL;
  const retentionDays = settings?.complaint_expiration_days ?? DEFAULT_RETENTION_DAYS;
  const ownerName = settings?.footer_copyright_name || "Dipak Chatterjee";
  const mailto = (
    <a href={`mailto:${contactEmail}`} className="text-[var(--theme-primary)] font-medium">
      {contactEmail}
    </a>
  );

  return (
    <main className="bg-paper-100 min-h-screen transition-colors">
      <div className="max-w-3xl mx-auto px-5 md:px-8 py-12 md:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-navy-900 mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <h1 className="font-display text-3xl md:text-4xl text-navy-900 leading-tight">Privacy &amp; Copyright</h1>
        <p className="mt-3 text-sm text-ink-400">Last updated {LAST_UPDATED}</p>

        <div className="mt-10 space-y-10">
          <Section title="Who runs this site">
            <p>
              This site is the official portfolio and citizen-service portal of {ownerName}. Questions
              about this notice or your information can be sent to {mailto}.
            </p>
          </Section>

          <Section title="Browsing the site">
            <p>
              This site itself sets no cookies on its public pages and uses no analytics, advertising or
              session-recording tools. Our hosting and storage providers keep standard technical logs
              (such as IP address and time of request) to operate and secure the service. Posts that
              show content from other platforms are the one exception — see below.
            </p>
          </Section>

          <Section id="complaints" title="When you submit a complaint">
            <p>The complaint form collects only:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>the description you write (required);</li>
              <li>your phone number, if you choose to give it;</li>
              <li>any photos or video you choose to attach.</li>
            </ul>
            <p>
              We use this only to look into and respond to your complaint. It is visible only to
              authorised staff of the office and is never sold or used for marketing.
            </p>
            <p>
              Your IP address is checked briefly in server memory to block spam (a limit on how many
              complaints one connection can send per hour). It is not saved with your complaint.
            </p>
            <p>
              Complaints and their attachments are <strong>permanently deleted {retentionDays} days</strong>{" "}
              after submission. They are stored with our service providers: Supabase (database),
              Cloudflare R2 (attachments) and Render (hosting).
            </p>
          </Section>

          <Section id="third-party-content" title="Videos and posts from other platforms">
            <p>
              Some posts show a video or post from YouTube, Facebook or Instagram directly on the page.
              When you open one of those posts, your browser connects to that platform (Google or Meta)
              to display it, so the platform receives your IP address and may set its own cookies under
              its own privacy policy. Other pages of this site don&apos;t load this content. You can
              limit it with your browser&apos;s cookie and tracking settings.
            </p>
          </Section>

          <Section id="children" title="Children">
            <p>
              The complaint form is intended for people aged 18 or older. If a complaint concerns a
              child, a parent or guardian should submit it on their behalf.
            </p>
          </Section>

          <Section id="your-rights" title="Your choices">
            <p>
              To see, correct or delete a complaint before it is automatically deleted, email {mailto}{" "}
              with your reference number.
            </p>
          </Section>

          <Section id="copyright" title="Copyright and takedown requests">
            <p>
              If you believe material on this site infringes your copyright or other rights, email{" "}
              {mailto} with the subject line &ldquo;Copyright notice&rdquo; and include:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>a description of the work you believe is being infringed;</li>
              <li>the link to the page on this site where the material appears;</li>
              <li>your name, postal address, phone number and email address;</li>
              <li>
                a statement that you believe in good faith that the use is not authorised by you, your
                agent or the law;
              </li>
              <li>
                a statement that the information in your notice is accurate and that you are the rights
                holder or authorised to act for them;
              </li>
              <li>your physical or electronic signature.</li>
            </ul>
            <p>We review every notice and remove or disable material where the claim is valid.</p>
          </Section>
        </div>
      </div>
    </main>
  );
}
