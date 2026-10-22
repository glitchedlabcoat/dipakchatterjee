// GET /api/posts (app/api/posts/route.ts), the "View More" endpoint, and
// lib/queries/posts.ts's getPostsList underneath it: fixed batch size,
// bounded page, published posts only, a stable order, and failures that
// are reported instead of cached or shown as "no more posts".
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { mockModule } from "@/tests/unit/helpers/mock-module";

type Call = [string, ...unknown[]];
let calls: Call[] = [];
let result: { data: unknown; count: number | null; error: { code?: string; message: string } | null };

// Records every builder call and resolves with `result` when awaited.
function recordingQuery(): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  for (const name of ["from", "select", "eq", "order", "range", "limit", "or"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    };
  }
  return builder;
}

mockModule("@/utils/supabase/public", { createPublicClient: () => recordingQuery() });
// Outside Next there's no incremental cache; the wrappers just call through.
mockModule("@/lib/cache", {
  PUBLIC_CACHE_TAG: "public-content",
  PUBLIC_REVALIDATE_SECONDS: 600,
  TAG_POSTS_LIST: "posts-list",
  TAG_POST_ITEM: (id: string) => `post-${id}`,
  createTrackedCache: (_route: string, fn: unknown) => fn,
  trackedCacheRead: (_route: string, fn: () => unknown) => fn(),
});

const { GET } = await import("@/app/api/posts/route");
const { getPostsList, getPostsListOrEmpty } = await import("@/lib/queries/posts");

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `পোস্ট ${id}`,
    body: "চাঁচলের বারোগাছিয়ায় বেহাল রাস্তা ও জলমগ্নতার প্রতিবাদ",
    published_at: "2016-03-01T10:00:00Z",
    show_published_time: false,
    thumbnail_url: null,
    links: [{ url: "https://www.facebook.com/secret-draft-link", type: "button" }],
    post_media: [{ id: "m", kind: "image", public_url: "https://media.example/a.jpg", storage_path: "posts/a.jpg" }],
    ...extra,
  };
}

function reset(data: unknown, count: number | null, error: { code?: string; message: string } | null = null) {
  calls = [];
  result = { data, count, error };
}

const get = (qs: string) => GET(new NextRequest(`https://janatardipak.com/api/posts${qs}`));

test("returns one fixed-size batch of published posts in a stable order", async () => {
  reset([row("a"), row("b")], 257);
  const res = await get("?page=3");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.page, 3);
  assert.equal(body.pageSize, 12);
  assert.equal(body.total, 257);
  assert.equal(body.hasMore, true);
  assert.deepEqual(
    body.posts.map((p: { id: string }) => p.id),
    ["a", "b"]
  );

  assert.deepEqual(
    calls.find((c) => c[0] === "eq"),
    ["eq", "is_published", true],
    "published posts only"
  );
  assert.deepEqual(
    calls.find((c) => c[0] === "range"),
    ["range", 24, 35],
    "page 3 of 12-post batches; the client can't choose the size"
  );
  assert.deepEqual(
    calls.filter((c) => c[0] === "order").map((c) => c[1]),
    ["is_pinned", "published_at", "created_at", "id", "display_order"],
    "id breaks ties, so batches can't overlap or skip"
  );
  assert.ok(!calls.some((c) => c[0] === "limit"));
});

test("the payload is card data only: no links, storage paths or media lists", async () => {
  reset([row("a")], 1);
  const text = await (await get("?page=1")).text();
  assert.ok(!text.includes("secret-draft-link"));
  assert.ok(!text.includes("storage_path"));
  assert.ok(!text.includes("post_media"));
  assert.ok(text.includes("পোস্ট a"), "Bengali survives the JSON round trip");
  const body = JSON.parse(text);
  assert.equal(body.hasMore, false, "the last batch says so");
});

test("rejects bad or unbounded page numbers without touching the database", async () => {
  for (const qs of ["?page=0", "?page=-1", "?page=abc", "?page=1001", "?page=1e3", "?page=99999999"]) {
    calls = [];
    const res = await get(qs);
    assert.equal(res.status, 400, qs);
    assert.equal(calls.length, 0, qs);
  }
  reset([], 0);
  assert.equal((await get("")).status, 200, "no page means page 1");
});

test("a database failure is a 503, not an empty 'end of the archive'", async () => {
  reset(null, null, { code: "57014", message: "canceling statement due to statement timeout" });
  const res = await get("?page=2");
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.deepEqual(body, { error: "Could not load posts" }, "no internal detail leaks");
});

test("a page past the end is an empty last batch (PGRST103), not an error", async () => {
  reset(null, null, { code: "PGRST103", message: "Requested range not satisfiable" });
  const res = await get("?page=40");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.posts, []);
  assert.equal(body.hasMore, false);
});

test("getPostsList throws on failure (so it isn't cached); getPostsListOrEmpty keeps pages rendering", async () => {
  reset(null, null, { message: "fetch failed" });
  await assert.rejects(() => getPostsList({ page: 1, pageSize: 6 }), /posts list: fetch failed/);
  const originalError = console.error;
  console.error = () => undefined;
  try {
    assert.deepEqual(await getPostsListOrEmpty({ page: 1, pageSize: 6 }), { posts: [], count: 0 });
  } finally {
    console.error = originalError;
  }
});
