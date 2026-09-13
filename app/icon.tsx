// app/icon.tsx
//
// Code-generated browser tab icon: bold "DC" mark, transparent
// background, brand saffron. Two sizes via generateImageMetadata so
// browsers/OS pick whichever fits (32px for tabs, 48px for higher-DPI
// bookmarks/shortcuts). public/favicon.ico is a static fallback with the
// same mark for the legacy same-origin `/favicon.ico` request browsers
// make regardless of the <link> tags this route produces.

import { ImageResponse } from "next/og";

export function generateImageMetadata() {
  return [
    { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
    { id: "48", size: { width: 48, height: 48 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const iconId = await id;
  const size = iconId === "48" ? 48 : 32;
  const fontSize = iconId === "48" ? 30 : 20;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <div
          style={{
            fontSize,
            fontWeight: 700,
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            color: "#C1832B",
            letterSpacing: "-2px",
          }}
        >
          DC
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}
