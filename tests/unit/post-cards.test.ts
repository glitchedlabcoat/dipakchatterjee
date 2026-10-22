// lib/post-cards.ts, the public archive's "View More": bounded page
// parsing, the slim card payload, duplicate-free appending, and the
// button's state machine (loading, error and retry, end of the archive).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PostWithMedia } from "@/types/domain";

const {
  ARCHIVE_MAX_PAGE,
  ARCHIVE_PAGE_SIZE,
  appendUnique,
  archivePageHref,
  archiveReducer,
  initArchiveState,
  parseArchivePage,
  parsePostsPage,
  parseStrictArchivePage,
  publicPostHref,
  toPostCardData,
  toPostsPage,
} = await import("@/lib/post-cards");

function post(id: string, overrides: Partial<PostWithMedia> = {}): PostWithMedia {
  return {
    id,
    title: `শিরোনাম ${id}`,
    body: "দীপক চট্টোপাধ্যায়ের উদ্যোগে চাঁচলে সচেতনতামূলক প্রচার অভিযান।",
    created_at: "2021-06-10T03:51:00Z",
    created_by: null,
    is_pinned: false,
    is_published: true,
    links: [{ url: "https://www.facebook.com/x", type: "embed" }],
    published_at: "2021-06-10T03:51:00Z",
    show_published_time: true,
    slideshow_interval: 3,
    thumbnail_path: null,
    thumbnail_url: null,
    updated_at: "2021-06-10T03:51:00Z",
    post_media: [],
    ...overrides,
  } as PostWithMedia;
}

const card = (id: string) => ({ id, title: id, excerpt: null, dateLabel: "June 10, 2021", image: null });

test("page parsers are bounded: the page never goes past ARCHIVE_MAX_PAGE, and the API rejects junk", () => {
  assert.equal(parseArchivePage(undefined), 1);
  assert.equal(parseArchivePage("3"), 3);
  assert.equal(parseArchivePage("0"), 1);
  assert.equal(parseArchivePage("-4"), 1);
  assert.equal(parseArchivePage("abc"), 1);
  assert.equal(parseArchivePage("999999"), ARCHIVE_MAX_PAGE);

  assert.equal(parseStrictArchivePage(null), 1);
  assert.equal(parseStrictArchivePage("2"), 2);
  assert.equal(parseStrictArchivePage(String(ARCHIVE_MAX_PAGE)), ARCHIVE_MAX_PAGE);
  for (const bad of ["0", "-1", "1.5", "2abc", " 2", "1e3", "01", String(ARCHIVE_MAX_PAGE + 1), "99999"]) {
    assert.equal(parseStrictArchivePage(bad), null, bad);
  }
});

test("archive links and public post links", () => {
  assert.equal(archivePageHref(1), "/notable-works");
  assert.equal(archivePageHref(4), "/notable-works?page=4");
  assert.equal(publicPostHref({ id: "abc", is_published: true }), "/posts/abc");
  assert.equal(publicPostHref({ id: "abc", is_published: false }), null, "drafts have no public page");
});

test("a card carries only what the card shows: Bengali text intact, no media list or links", () => {
  const long = "অ".repeat(200);
  const c = toPostCardData(
    post("p1", {
      body: long,
      post_media: [
        { id: "m1", kind: "video", public_url: "https://media.example/v.mp4" },
        { id: "m2", kind: "image", public_url: "https://media.example/i.jpg" },
      ] as PostWithMedia["post_media"],
    })
  );
  assert.deepEqual(Object.keys(c).sort(), ["dateLabel", "excerpt", "id", "image", "title"]);
  assert.equal(c.title, "শিরোনাম p1");
  assert.equal(c.excerpt, `${"অ".repeat(140)}…`);
  assert.deepEqual(c.image, { kind: "video", src: "https://media.example/v.mp4" });
  assert.match(c.dateLabel, /2021/);

  const withThumb = toPostCardData(post("p2", { thumbnail_url: "https://media.example/t.jpg" }));
  assert.deepEqual(withThumb.image, { kind: "image", src: "https://media.example/t.jpg" }, "the thumbnail wins");
  assert.equal(toPostCardData(post("p3", { body: null })).excerpt, null);
  assert.equal(toPostCardData(post("p4")).image, null);
});

test("a batch knows whether more posts exist", () => {
  const twelve = Array.from({ length: ARCHIVE_PAGE_SIZE }, (_, i) => post(`p${i}`));
  assert.equal(toPostsPage(1, { posts: twelve, count: 257 }).hasMore, true);
  assert.equal(toPostsPage(21, { posts: twelve, count: 257 }).hasMore, true);
  assert.equal(toPostsPage(22, { posts: twelve.slice(0, 5), count: 257 }).hasMore, false, "257 = 21 x 12 + 5");
  assert.equal(toPostsPage(1, { posts: twelve, count: 12 }).hasMore, false);
  assert.equal(toPostsPage(1, { posts: [], count: 0 }).hasMore, false);
});

test("appendUnique skips posts already shown and keeps the order", () => {
  const shown = [card("a"), card("b"), card("c")];
  const next = appendUnique(shown, [card("c"), card("d"), card("d"), card("e")]);
  assert.deepEqual(
    next.map((p) => p.id),
    ["a", "b", "c", "d", "e"]
  );
  assert.equal(appendUnique(shown, [card("a")]), shown, "nothing new: same array");
});

test("parsePostsPage rejects responses that aren't a batch", () => {
  const ok = { posts: [card("a")], page: 2, pageSize: 12, total: 30, hasMore: true };
  assert.deepEqual(parsePostsPage(ok), ok);
  for (const bad of [null, {}, { error: "Could not load posts" }, { ...ok, posts: "x" }, { ...ok, hasMore: "yes" }, { ...ok, posts: [{ id: 1 }] }]) {
    assert.throws(() => parsePostsPage(bad), /Unexpected posts response/);
  }
});

test("View More: load, append without duplicates, fail, retry the same batch, then end", () => {
  const first = { posts: [card("a"), card("b")], page: 1, pageSize: 2, total: 5, hasMore: true };
  let s = initArchiveState(first);
  assert.equal(s.nextPage, 2);
  assert.equal(s.hasMore, true);

  s = archiveReducer(s, { type: "load" });
  assert.equal(s.status, "loading");
  // a post was published meanwhile, so batch 2 starts with "b" again
  s = archiveReducer(s, { type: "loaded", batch: { posts: [card("b"), card("c")], page: 2, pageSize: 2, total: 6, hasMore: true } });
  assert.deepEqual(
    s.posts.map((p) => p.id),
    ["a", "b", "c"]
  );
  assert.equal(s.nextPage, 3);
  assert.equal(s.total, 6);
  assert.equal(s.status, "idle");

  s = archiveReducer(archiveReducer(s, { type: "load" }), { type: "failed" });
  assert.equal(s.status, "error");
  assert.equal(s.nextPage, 3, "a retry asks for the batch that failed");
  assert.equal(s.posts.length, 3, "nothing already shown is lost");
  assert.equal(s.hasMore, true);

  s = archiveReducer(archiveReducer(s, { type: "load" }), {
    type: "loaded",
    batch: { posts: [card("d"), card("e"), card("f")], page: 3, pageSize: 2, total: 6, hasMore: false },
  });
  assert.equal(s.hasMore, false);
  assert.equal(s.posts.length, 6);
});

test("an empty batch ends the list even if the count promised more", () => {
  const s = archiveReducer(initArchiveState({ posts: [card("a")], page: 1, pageSize: 1, total: 3, hasMore: true }), {
    type: "loaded",
    batch: { posts: [], page: 2, pageSize: 1, total: 3, hasMore: true },
  });
  assert.equal(s.hasMore, false);
  assert.equal(initArchiveState({ posts: [], page: 1, pageSize: 12, total: 9, hasMore: true }).hasMore, false);
});
