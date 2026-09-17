// app/layout.tsx
import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  // Set here (the true root layout) so every route — (site) and admin
  // alike — resolves relative URL-based metadata fields against this
  // single canonical origin, per Next's own guidance ("metadataBase is
  // typically set in root app/layout.js to apply ... across all
  // routes" — node_modules/next/dist/docs/.../generate-metadata.md).
  // Strictly the bare HTTPS apex domain: no `www.`, no trailing slash.
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
  },
  title: "Dipak Chatterjee — Social Worker, Educationist & Public Life",
  description:
    "Official portfolio of Dipak Chatterjee — social worker, educationist, and community leader in Chanchal, North Malda.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="antialiased bg-paper-100 text-ink font-sans">
        {children}
      </body>
    </html>
  );
}
