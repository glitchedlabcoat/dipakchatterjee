// app/admin/(protected)/loading.tsx
//
// Wraps every page.tsx under (protected) in a Suspense boundary — it
// does NOT cover layout.tsx's own auth/profile fetch (Next never wraps
// a segment's own layout in its sibling loading.tsx, only the page and
// anything nested deeper), so AdminNavPendingContext's top progress bar
// is what covers that first stretch. This picks up from there: once the
// layout resolves, whatever the destination page's own data fetch is
// still doing streams in behind this generic skeleton instead of a
// blank pane. One shared skeleton, not per-route, since every admin
// page is the same shape (a heading block + a card/list stack).

export default function AdminLoading() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      <div className="h-3 w-20 bg-line rounded mb-3" />
      <div className="h-8 w-64 bg-line rounded mb-8" />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 bg-white border border-line rounded-xl" />
        ))}
      </div>
    </div>
  );
}
