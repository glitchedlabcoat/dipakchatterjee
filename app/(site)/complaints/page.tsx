// app/(site)/complaints/page.tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ComplaintForm from "@/components/complaints/ComplaintForm";
import { getSiteSettings } from "@/lib/queries/settings";
import type { SiteSettings } from "@/types/domain";

export const metadata = {
  title: "Submit a Complaint",
  description: "File a complaint with Dipak Chatterjee's office and get a reference number for follow-up.",
};

const DEFAULT_CONTACT_EMAIL = "dipak.chatterjee304@gmail.com";

export default async function ComplaintsPage() {
  // Shares the same TAG_SETTINGS-tagged cache entry as every other
  // public page's settings read (lib/queries/settings.ts) — this page
  // previously ran its own separate, uncached Supabase query through
  // the cookie-based server client on every request, bypassing the
  // cache-first architecture every other public page already uses.
  const settings = await getSiteSettings();
  const contactEmail = (settings as Pick<SiteSettings, "office_email"> | null)?.office_email || DEFAULT_CONTACT_EMAIL;

  return (
    <main className="bg-paper-100 min-h-screen transition-colors">
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-12 md:py-16 grid lg:grid-cols-[0.85fr_1.15fr] gap-10 md:gap-14">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-navy-900 mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>

          <p className="text-[var(--theme-primary)] font-semibold text-sm mb-3">Citizen Support</p>

          <h1 className="font-display text-3xl md:text-4xl text-navy-900 leading-tight">
            Tell us what&apos;s wrong. We&apos;ll try to help.
          </h1>

          <p className="mt-5 text-ink-600 leading-relaxed">
            Please describe your problem briefly. It is best to include your phone number so we
            can reach you quickly. You will receive a reference number after submitting&mdash;please
            save it to track your request.
          </p>

          <div className="mt-8 p-5 rounded-lg border border-line bg-white">
            <p className="text-sm text-ink-600">
              <span className="font-semibold text-navy-900">Urgent safety issue?</span>{" "}
              Mark it clearly in your description below, or email the office directly at{" "}
              <a href={`mailto:${contactEmail}`} className="text-[var(--theme-primary)] font-medium">
                {contactEmail}
              </a>
              .
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-white overflow-hidden">
          <div className="bg-[var(--theme-secondary)] px-6 md:px-8 py-5">
            <p className="text-white font-display text-lg">Complaint Form</p>
          </div>

          <div className="p-6 md:p-8">
            <ComplaintForm />
          </div>
        </div>
      </div>
    </main>
  );
}
