// lib/post-date.ts
//
// Shared by the post detail page (and anywhere else that needs it): a
// post's published_at always carries a real time in Postgres, but the
// "Include Time" toggle in the post editor (posts.show_published_time)
// controls whether that time is actually shown to visitors.

export function formatPostDate(value: string, showTime: boolean): string {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(showTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}
