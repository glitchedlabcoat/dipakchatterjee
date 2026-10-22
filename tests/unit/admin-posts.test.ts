// lib/queries/admin-posts.ts, the admin Posts tab: every post reachable
// through pages (the old .limit(200) stopped at the 200th, hiding the
// oldest), a title/body search that keeps Bengali words whole and can't
// inject PostgREST filter syntax, and search + pages working together.
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  ADMIN_POSTS_PAGE_SIZE,
  adminPostsHref,
  adminPostsPageCount,
  cleanPostSearch,
  countAdminPosts,
  fetchAdminPosts,
  pageWindow,
  parseAdminPostsPage,
} = await import("@/lib/queries/admin-posts");

type Call = [string, ...unknown[]];

// A stand-in for the Supabase client: records the builder calls and
// answers like PostgREST would for a table of `rows` (newest first).
function fakeClient(rows: { id: string; title: string; body: string }[], opts: { error?: { code?: string; message: string } } = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      calls.push(["from", table]);
      let from = 0;
      let to = Number.POSITIVE_INFINITY;
      let needle: string | null = null;
      let head = false;
      const builder: Record<string, unknown> = {
        select: (cols: string, options?: { count?: string; head?: boolean }) => {
          calls.push(["select", cols, options]);
          head = Boolean(options?.head);
          return builder;
        },
        order: (...args: unknown[]) => (calls.push(["order", ...args]), builder),
        limit: (...args: unknown[]) => (calls.push(["limit", ...args]), builder),
        range: (a: number, b: number) => {
          calls.push(["range", a, b]);
          from = a;
          to = b;
          return builder;
        },
        or: (filter: string) => {
          calls.push(["or", filter]);
          needle = /^title\.ilike\.\*(.*)\*,body\.ilike\.\*\1\*$/.exec(filter)?.[1] ?? "<unparsed>";
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (opts.error) return Promise.resolve({ data: null, count: null, error: opts.error }).then(resolve);
          const matching = needle === null ? rows : rows.filter((r) => r.title.includes(needle!) || r.body.includes(needle!));
          if (head) return Promise.resolve({ data: null, count: matching.length, error: null }).then(resolve);
          if (from > 0 && from >= matching.length) {
            return Promise.resolve({ data: null, count: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } }).then(resolve);
          }
          return Promise.resolve({ data: matching.slice(from, to + 1), count: matching.length, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

// 257 posts, like production on 2026-10-22: the newest in 2026, the
// oldest in 2015 (the archive's oldest is 4 May 2015).
const archive = Array.from({ length: 257 }, (_, i) => ({
  id: `post-${String(i).padStart(3, "0")}`,
  title: i === 256 ? "প্রথম পোস্ট ২০১৫" : i === 199 ? "বীরসা মুন্ডার বলিদান দিবসে শ্রদ্ধা জ্ঞাপন" : `পোস্ট ${i}`,
  body: i % 50 === 0 ? "দীপক চট্টোপাধ্যায় চাঁচলে" : "সাধারণ খবর",
  published_at: new Date(Date.UTC(2026, 0, 1) - i * 15 * 86_400_000).toISOString(),
}));

test("regression: posts past the 200th are reachable (the old cap hid the oldest 57)", async () => {
  const { client, calls } = fakeClient(archive);
  const pages = adminPostsPageCount(257);
  assert.equal(pages, 11);

  const seen = new Set<string>();
  for (let page = 1; page <= pages; page++) {
    const r = await fetchAdminPosts(client as never, { q: "", page });
    assert.equal(r.error, null);
    assert.equal(r.total, 257);
    r.posts.forEach((p) => seen.add(p.id));
  }
  assert.equal(seen.size, 257, "every post appears exactly once across the pages");
  assert.ok(seen.has("post-256"), "the oldest post (2015) is listed");
  assert.ok(!calls.some((c) => c[0] === "limit"), "no fixed cap");

  const last = await fetchAdminPosts(client as never, { q: "", page: 11 });
  assert.equal(last.posts.length, 7);
  assert.equal(last.posts.at(-1)!.title, "প্রথম পোস্ট ২০১৫");
});

test("one bounded page per request, ordered like the public archive with an id tie-breaker", async () => {
  const { client, calls } = fakeClient(archive);
  await fetchAdminPosts(client as never, { q: "", page: 9 });
  assert.deepEqual(
    calls.find((c) => c[0] === "range"),
    ["range", 200, 224]
  );
  assert.deepEqual(calls.find((c) => c[0] === "select")?.[2], { count: "exact" });
  assert.deepEqual(
    calls.filter((c) => c[0] === "order").map((c) => [c[1], (c[2] as { ascending: boolean }).ascending]),
    [
      ["is_pinned", false],
      ["published_at", false],
      ["created_at", false],
      ["id", false],
    ]
  );
  assert.ok(!calls.some((c) => c[0] === "or"), "no filter without a search");
});

test("search matches title or body and pages through the matches", async () => {
  const { client, calls } = fakeClient(archive);
  const r = await fetchAdminPosts(client as never, { q: "দীপক চট্টোপাধ্যায়", page: 1 });
  assert.deepEqual(
    calls.find((c) => c[0] === "or"),
    ["or", "title.ilike.*দীপক চট্টোপাধ্যায়*,body.ilike.*দীপক চট্টোপাধ্যায়*"]
  );
  assert.equal(r.total, 6, "posts 0, 50, 100, 150, 200, 250");
  assert.ok(r.posts.every((p) => p.body!.includes("দীপক")));

  const byTitle = await fetchAdminPosts(client as never, { q: "বীরসা মুন্ডার", page: 1 });
  assert.deepEqual(
    byTitle.posts.map((p) => p.id),
    ["post-199"]
  );

  const many = await fetchAdminPosts(client as never, { q: "পোস্ট", page: 2 });
  assert.equal(many.total, 256);
  assert.equal(many.posts.length, ADMIN_POSTS_PAGE_SIZE);
  assert.equal(many.posts[0].title, "পোস্ট 25", "page 2 of the matches, not of all posts");
});

test("a page past the end is flagged so the page can redirect to the last one", async () => {
  const { client } = fakeClient(archive);
  const r = await fetchAdminPosts(client as never, { q: "দীপক চট্টোপাধ্যায়", page: 3 });
  assert.equal(r.outOfRange, true);
  assert.equal(await countAdminPosts(client as never, "দীপক চট্টোপাধ্যায়"), 6);
  assert.equal(adminPostsPageCount(6), 1);
  assert.equal(adminPostsPageCount(0), 1);
});

test("other errors are reported, never shown as an empty archive", async () => {
  const { client } = fakeClient(archive, { error: { code: "42501", message: "permission denied for table posts" } });
  const r = await fetchAdminPosts(client as never, { q: "", page: 1 });
  assert.equal(r.outOfRange, false);
  assert.equal(r.error, "permission denied for table posts");
  assert.deepEqual(r.posts, []);
});

test("cleanPostSearch keeps Bengali words whole (vowel signs, virama, chandrabindu, ZWJ)", () => {
  for (const word of ["নেশামুক্ত", "চাঁচলের", "চট্টোপাধ্যায়", "প্রতিবাদ", "র‍্যালি", "২০২১", "Chanchal 2016"]) {
    assert.equal(cleanPostSearch(word), word, word);
  }
  assert.equal(cleanPostSearch("  দীপক   চট্টোপাধ্যায়  "), "দীপক চট্টোপাধ্যায়");
  assert.equal(cleanPostSearch(undefined), "");
  assert.equal(cleanPostSearch("   "), "");
});

test("cleanPostSearch can't inject PostgREST filter syntax or wildcards", () => {
  assert.equal(cleanPostSearch("x*,is_published.eq.false"), "x is published eq false");
  assert.equal(cleanPostSearch("a),or(title.neq.(b"), "a or title neq b");
  assert.equal(cleanPostSearch('"quoted" 100% _under_ back\\slash :colon'), "quoted 100 under back slash colon");
  for (const ch of [",", ".", ":", "(", ")", "*", "%", "_", '"', "\\", "'", "\n"]) {
    assert.ok(!cleanPostSearch(`a${ch}b`).includes(ch), JSON.stringify(ch));
  }
  assert.equal(cleanPostSearch("অ".repeat(200)).length, 80, "bounded length");
});

test("page numbers and links: a new search starts at page 1, pages keep the search", () => {
  assert.equal(parseAdminPostsPage(undefined), 1);
  assert.equal(parseAdminPostsPage("7"), 7);
  assert.equal(parseAdminPostsPage("0"), 1);
  assert.equal(parseAdminPostsPage("junk"), 1);
  assert.equal(parseAdminPostsPage("5000"), 1000);

  assert.equal(adminPostsHref({ q: "", page: 1 }), "/admin/posts");
  assert.equal(adminPostsHref({ q: "", page: 3 }), "/admin/posts?page=3");
  assert.equal(adminPostsHref({ q: "দীপক", page: 1 }), `/admin/posts?q=${encodeURIComponent("দীপক")}`);
  assert.equal(adminPostsHref({ q: "a b", page: 2 }), "/admin/posts?q=a+b&page=2");
});

test("pageWindow shows first, last and neighbours, with gaps only where pages are skipped", () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(1, 2), [1, 2]);
  assert.deepEqual(pageWindow(1, 11), [1, 2, null, 11]);
  assert.deepEqual(pageWindow(4, 11), [1, 2, 3, 4, 5, null, 11], "a one-page gap shows the page");
  assert.deepEqual(pageWindow(6, 11), [1, null, 5, 6, 7, null, 11]);
  assert.deepEqual(pageWindow(11, 11), [1, null, 10, 11]);
});
