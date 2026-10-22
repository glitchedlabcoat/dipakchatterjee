// app/api/posts/route.ts
//
// GET /api/posts?page=N: one batch of published posts for /notable-works'
// "View More" button (components/posts/NotableWorksArchive.tsx). Public
// and read-only by design: it returns exactly what /notable-works?page=N
// already renders, through the same cached, published-only read
// (lib/queries/posts.ts's getPostsList), so it exposes nothing new and
// costs at most one Supabase query per batch per cache window. The batch
// size is fixed here, never taken from the client, and the page number is
// bounded, so no request can ask for an unbounded slice of the archive.

import { NextResponse, type NextRequest } from "next/server";
import { getPostsList } from "@/lib/queries/posts";
import { ARCHIVE_PAGE_SIZE, parseStrictArchivePage, toPostsPage } from "@/lib/post-cards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const page = parseStrictArchivePage(request.nextUrl.searchParams.get("page"));
  if (page === null) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  }

  try {
    const list = await getPostsList({ page, pageSize: ARCHIVE_PAGE_SIZE });
    return NextResponse.json(toPostsPage(page, list));
  } catch (err) {
    console.error("[api/posts]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not load posts" }, { status: 503 });
  }
}
