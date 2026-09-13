// lib/truncate-title.ts
//
// Smart word-boundary truncation for browser tab titles. Post titles can
// run long (detailed Bengali news headlines), and a raw substring cut
// would slice mid-word — this backs off to the nearest preceding space
// instead, so the tab still reads as a clean phrase.

const DEFAULT_MAX_LENGTH = 50;

export function truncateTitle(title: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  const trimmed = title.trim();
  if (trimmed.length <= maxLength) return trimmed;

  const cut = trimmed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  // Only back off to the last space if that still leaves a reasonably
  // sized title — otherwise (one very long word) just hard-cut.
  const boundary = lastSpace > maxLength * 0.4 ? cut.slice(0, lastSpace) : cut;

  return `${boundary.trimEnd()}...`;
}
