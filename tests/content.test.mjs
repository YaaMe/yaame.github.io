import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { postCollectionSchema } from "../src/selectors/content/collections.ts";

async function contentGraph(options = {}, exports = "") {
  const bundle = await build({
    stdin: {
      contents: `
        export * as posts from "./src/selectors/posts.ts";
        export * as notes from "./src/selectors/notes.ts";
        export * as comments from "./src/selectors/interactions/promoted.ts";
        export { rssFeed } from "./src/selectors/feed.ts";
        export { siteShell, notFoundPage } from "./src/selectors/site.ts";
        ${exports}
      `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    ...options,
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
}

test("the consumer graph imports, but content reads and renders fail explicitly", async () => {
  const { posts, notes, comments } = await contentGraph({ tsconfig: resolve("worker/tsconfig.json") });
  assert.equal(posts.href({ id: "2023-07" }), "/posts/2023-07/");
  assert.equal(notes.noteHref({ year: "2026", id: "8nicubmr" }), "/notes/2026/#8nicubmr");
  for (const read of [
    posts.allPosts, posts.allTags, posts.novelEntries, posts.novel, posts.chapterCount,
    notes.allNotes, notes.noteYears, () => comments.commentsFor("2023-07"),
  ]) {
    await assert.rejects(read, { message: "Astro content reads are unavailable in the queue consumer" });
  }
  await assert.rejects(() => posts.content({ id: "2023-07", collection: "posts" }), {
    message: "Astro content rendering is unavailable in the queue consumer",
  });
});

test("post periods preserve prefix grouping, shape-only labels and publication fallbacks", async () => {
  const { posts } = await contentGraph({ tsconfig: resolve("worker/tsconfig.json") });
  const date = { y: "2026", mo: "02", d: "01", iso: "2026-02-01T00:00:00.000Z" };
  for (const [id, year, expected] of [
    ["2025-year", "2025", { label: "年结", datetime: "2025" }],
    ["2025-year-99", "2025", { label: "年结", datetime: "2025" }],
    ["2023-07", "2023", { label: "07 月", datetime: "2023-07" }],
    ["2024-02-29", "2024", { label: "02-29", datetime: "2024-02-29" }],
    ["2025-02-30", "2025", { label: "02-30", datetime: "2025-02-30" }],
    ["2025-99", "2025", { label: "99 月", datetime: "2025-99" }],
    ["2025-00-00", "2025", { label: "00-00", datetime: "2025-00-00" }],
    ["0099-01-01", "0099", { label: "01-01", datetime: "0099-01-01" }],
    ...["2025", "2025essay", "20250", "2025-7", "2025-07-extra", "2025-year.md"].map((id) => [
      id, "2025", { label: "02-01", datetime: date.iso },
    ]),
    ["essay", "2026", { label: "02-01", datetime: date.iso }],
    ["x2025-07", "2026", { label: "02-01", datetime: date.iso }],
  ]) {
    const post = { id, data: { date, tags: ["year", "month"] } };
    assert.equal(posts.periodYear(post), year, id);
    assert.deepEqual(posts.period(post), expected, id);
  }
});

test("a note and a post stamped in the same hour show the same site calendar date", async () => {
  const cases = [
    ["2025-12-31T15:05:00Z", "2025-12-31T15:55:00Z", { y: "2025", mo: "12", d: "31" }],
    ["2025-12-31T16:05:00Z", "2025-12-31T16:55:00Z", { y: "2026", mo: "01", d: "01" }],
    ["2024-02-28T16:05:00Z", "2024-02-28T16:55:00Z", { y: "2024", mo: "02", d: "29" }],
  ];
  const archive = {
    id: "2025",
    data: { notes: cases.map(([, published], index) => ({ id: `note0${index}`, published, content: "Note" })) },
  };
  const { notes } = await contentGraph({
    plugins: [{
      name: "calendar-date-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^virtual:astro$/ }, () => ({ path: "content", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
            export async function getCollection(name) {
              if (name !== "notes") throw new Error("Unexpected collection");
              return ${JSON.stringify([archive])};
            }
            export function render() { throw new Error("Unexpected render"); }
          `,
        }));
      },
    }],
  });
  const stream = await notes.allNotes();
  for (const [date, published, expected] of cases) {
    const post = postCollectionSchema.parse({ title: "Post", date });
    const note = stream.find((entry) => entry.published === published);
    assert.deepEqual({ y: post.date.y, mo: post.date.mo, d: post.date.d }, expected);
    assert.deepEqual(note.date, expected);
    assert.equal(note.year, "2025");
    assert.equal(notes.noteHref(note), `/notes/2025/#${note.id}`);
  }
});

test("content selectors preserve ordering, dates, URLs, render results and read counts", async () => {
  const { posts, notes, state } = await contentGraph({
    plugins: [{
      name: "content-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^virtual:astro$/ }, () => ({ path: "content", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
            export const state = {
              reads: [], rendered: [], error: null,
              result: { Content() {}, headings: [{ depth: 2, slug: "heading", text: "Heading" }], remarkPluginFrontmatter: { value: "kept" } },
              collections: {
                posts: [
                  { id: "2023-07", data: { date: { at: new Date("2023-08-01Z"), y: "2023", mo: "08", d: "01", iso: "2023-08-01T00:00:00.000Z" }, tags: ["month"] } },
                  { id: "2025-year", data: { date: { at: new Date("2026-02-01Z"), y: "2026", mo: "02", d: "01", iso: "2026-02-01T00:00:00.000Z" }, tags: ["year", "month"] } },
                ],
                komorebi: [{ id: "index" }, { id: "novel", body: "## 一\\nText\\n## 二十\\n## 3\\n## 三: title" }],
                notes: [
                  { id: "2025", data: { notes: [{ id: "abc123", published: "2025-12-31T16:30:00Z", content: "**Note**" }] } },
                  { id: "2026", data: { notes: [{ id: "def456", published: "2026-01-02T00:00:00Z", content: "Next" }] } },
                ],
              },
            };
            export async function getCollection(name) {
              state.reads.push(name);
              if (state.error) throw state.error;
              return structuredClone(state.collections[name]);
            }
            export async function render(entry) {
              state.rendered.push(entry);
              if (state.error) throw state.error;
              return state.result;
            }
          `,
        }));
      },
    }],
  }, 'export { state } from "virtual:astro";');

  assert.deepEqual(state.reads, []);
  const entries = await posts.allPosts();
  assert.deepEqual(entries.map((entry) => entry.id), ["2025-year", "2023-07"]);
  assert.equal(posts.href(entries[0]), "/posts/2025-year/");
  assert.equal(posts.periodYear(entries[0]), "2025");
  assert.deepEqual(posts.period(entries[0]), { label: "年结", datetime: "2025" });
  assert.deepEqual(posts.period(entries[1]), { label: "07 月", datetime: "2023-07" });
  assert.deepEqual(posts.period({ ...entries[1], id: "2021-10-18" }), { label: "10-18", datetime: "2021-10-18" });
  const essay = { ...entries[0], id: "essay" };
  assert.equal(posts.periodYear(essay), "2026");
  assert.deepEqual(posts.period(essay), { label: "02-01", datetime: "2026-02-01T00:00:00.000Z" });
  assert.equal(posts.PAGE_SIZE, 10);
  assert.deepEqual([posts.pages(0), posts.pages(10), posts.pages(11)], [1, 1, 2]);
  assert.deepEqual(posts.slice(Array.from({ length: 11 }, (_, index) => index), 2), [10]);
  assert.deepEqual(await posts.allTags(), ["month", "year"]);
  state.collections.posts = [state.collections.posts[0]];
  assert.deepEqual((await posts.allPosts()).map((entry) => entry.id), ["2023-07"]);
  assert.deepEqual(state.reads, ["posts", "posts", "posts"]);

  assert.deepEqual((await posts.novelEntries()).map((entry) => entry.id), ["index", "novel"]);
  const chapter = await posts.novel();
  assert.equal(chapter.id, "novel");
  assert.equal(await posts.chapterCount(), 2);
  assert.equal(await posts.content(entries[0]), state.result);
  assert.equal(await posts.content(chapter), state.result);
  assert.deepEqual(state.rendered, [entries[0], chapter]);
  state.collections.komorebi = [{ id: "index" }];
  assert.equal(await posts.novel(), undefined);
  assert.equal(await posts.chapterCount(), 0);
  assert.deepEqual(state.reads.slice(3), Array(5).fill("komorebi"));

  const stream = await notes.allNotes();
  assert.deepEqual(stream, [
    { id: "def456", published: "2026-01-02T00:00:00Z", content: "Next", year: "2026", date: { y: "2026", mo: "01", d: "02" } },
    { id: "abc123", published: "2025-12-31T16:30:00Z", content: "**Note**", year: "2025", date: { y: "2026", mo: "01", d: "01" } },
  ]);
  assert.equal(notes.noteHref(stream[1]), "/notes/2025/#abc123");
  assert.equal(notes.noteHtml(stream[1]), "<p><strong>Note</strong></p>\n");
  assert.deepEqual(await notes.noteYears(), ["2026", "2025"]);
  state.collections.notes = [];
  assert.deepEqual(await notes.allNotes(), []);
  assert.deepEqual(await notes.noteYears(), []);
  assert.deepEqual(state.reads.slice(8), Array(4).fill("notes"));

  state.error = new Error("Content unavailable");
  for (const read of [posts.allPosts, posts.novelEntries, notes.allNotes, notes.noteYears]) {
    await assert.rejects(read, (error) => error === state.error);
  }
  await assert.rejects(() => posts.content(entries[0]), (error) => error === state.error);
});


test("page projections preserve archive order, date labels, tag titles and pagination", async () => {
  const { posts, notes, siteShell, notFoundPage } = await contentGraph({ tsconfig: resolve("worker/tsconfig.json") });
  const date = { y: "2026", mo: "02", d: "01", iso: "2026-02-01T00:00:00.000Z" };
  const entries = ["2025-06-15", "2025-year", "2025-06", "2024-year"].map((id) => ({
    id, data: { title: id, description: id === "2025-year" ? "Year summary" : "", date, tags: ["summaries"] },
  }));
  const original = structuredClone(entries);
  const home = posts.homePage(entries);
  assert.deepEqual(home.years.map((group) => group.year), ["2025", "2024"]);
  assert.deepEqual(home.years[0].entries, [
    { href: "/posts/2025-year/", title: "Year summary", period: { label: "年结", datetime: "2025" } },
    { href: "/posts/2025-06/", title: "2025-06", period: { label: "06 月", datetime: "2025-06" } },
    { href: "/posts/2025-06-15/", title: "2025-06-15", period: { label: "06-15", datetime: "2025-06-15" } },
  ]);
  assert.deepEqual(entries, original);
  assert.deepEqual(posts.homePage([]).years, []);
  assert.deepEqual(posts.postDisplay(entries[1]), {
    id: "2025-year", href: "/posts/2025-year/", title: "2025-year", description: "Year summary",
    datetime: date.iso, date: "2026-02-01", tags: [{ href: "/tags/summaries/", label: "#summaries" }],
  });
  const many = Array.from({ length: 21 }, (_, index) => ({ ...entries[0], id: `post-${index}` }));
  assert.deepEqual(posts.tagArchive(many, "summaries"), { tagged: many, total: 3 });
  assert.deepEqual(posts.tagArchive(many, "gugu"), { tagged: [], total: 1 });
  const first = posts.tagPage("summaries", many, 1, 3);
  const second = posts.tagPage("summaries", many, 2, 3);
  assert.equal(first.title, "小结 · 标签");
  assert.equal(first.heading, "小结");
  assert.equal(second.title, "标签：summaries · 第 2 页");
  assert.equal(second.heading, "标签：summaries");
  assert.deepEqual(second.posts, many.slice(10, 20));
  assert.deepEqual(posts.postList(first.posts, 1, 3, first.base).pagination, {
    visible: true, previous: undefined, next: "/tags/summaries/page/2/", label: "1 / 3",
  });
  assert.deepEqual(posts.postList(second.posts, 2, 3, second.base).pagination, {
    visible: true, previous: "/tags/summaries/", next: "/tags/summaries/page/3/", label: "2 / 3",
  });
  assert.deepEqual(posts.postList([], 3, 3, first.base).pagination, {
    visible: true, previous: "/tags/summaries/page/2/", next: undefined, label: "3 / 3",
  });
  assert.equal(posts.postList([], 1, 1, first.base).pagination.visible, false);

  const note = { id: "abc123", year: "2025", published: "2025-12-31T16:30:00Z", date, content: "**Note**" };
  assert.deepEqual(notes.noteDisplay(note), {
    id: "abc123", href: "/notes/2025/#abc123", published: note.published, date: "2026-02-01", html: "<p><strong>Note</strong></p>\n",
  });
  const stream = [note, { ...note, id: "def456", year: "2026" }];
  assert.deepEqual(notes.noteYearPage(stream, "2025"), { title: "notes 2025", year: "2025", notes: [note], backHref: "/notes/" });
  assert.deepEqual(notes.notesForYear(stream, "missing"), []);
  assert.equal(notes.noteYearHref("2025"), "/notes/2025/");

  const shell = siteShell("/tags/summaries");
  assert.ok(shell.canonical.endsWith("/tags/summaries/"));
  assert.equal(siteShell("/tags/summaries/").canonical, shell.canonical);
  assert.equal(siteShell("/", "").description, "");
  assert.equal(siteShell("/", "A description").description, "A description");
  assert.equal(shell.fingerprint, "AD14 E098 99EC A2C4 0D51 8CCB 279F 27B4 6C46 47E3");
  assert.deepEqual(shell.nav.map((link) => link.href), ["/komorebi/", "/notes/"]);
  assert.equal(new URL(shell.other.href).pathname, "/tags/summaries");
  assert.equal(new URL(shell.other.href).host, shell.other.label);
  assert.equal(notFoundPage().title, "404 · Blogu");
  assert.equal(notFoundPage().nav[0].href, "/");
});

test("latest notes keep their window and archive links; RSS keeps publication order and dates", async () => {
  const { posts, notes, rssFeed, state } = await contentGraph({
    plugins: [{
      name: "page-projection-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^virtual:astro$/ }, () => ({ path: "content", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
            export const state = { reads: [], collections: { notes: [], posts: [] } };
            export async function getCollection(name) {
              state.reads.push(name);
              return state.collections[name];
            }
            export async function render(entry) { return { Content: entry.id }; }
          `,
        }));
      },
    }],
  }, 'export { state } from "virtual:astro";');
  const empty = await notes.latestNotesPage();
  assert.deepEqual({ empty: empty.empty, archived: empty.archived, notes: empty.notes, years: empty.years }, {
    empty: true, archived: false, notes: [], years: [],
  });
  const archive = { id: "2025", data: { notes: Array.from({ length: 21 }, (_, index) => ({
    id: `note${index}`, published: new Date(Date.UTC(2025, 11, 31, 16, index)).toISOString(), content: `Note ${index}`,
  })) } };
  state.collections.notes = [archive];
  const latest = await notes.latestNotesPage();
  assert.equal(latest.empty, false);
  assert.equal(latest.archived, true);
  assert.equal(latest.notes.length, 20);
  assert.equal(latest.notes[0].id, "note20");
  assert.equal(latest.notes.at(-1).id, "note1");
  assert.equal(notes.noteDisplay(latest.notes[0]).date, "2026-01-01");
  assert.deepEqual(latest.years, [{ label: "2025", href: "/notes/2025/" }]);
  archive.data.notes = archive.data.notes.slice(0, 20);
  assert.equal((await notes.latestNotesPage()).archived, false);
  state.collections.notes.push({ id: "2024", data: { notes: [] } });
  assert.equal((await notes.latestNotesPage()).archived, true);
  assert.deepEqual(state.reads, Array(8).fill("notes"));

  const entry = (id, date) => ({ id, data: { title: id, tags: ["month"], date: { at: new Date(date) } } });
  const older = entry("2025-01", "2025-02-01T00:00:00Z");
  const newer = entry("2025-02", "2025-03-01T00:00:00Z");
  state.collections.posts = [older, newer];
  const feed = await rssFeed();
  assert.deepEqual(feed, {
    title: "Blogu", description: "yaame 的随笔与故事", customData: "<language>zh-Hans</language>",
    items: [
      { title: "2025-02", pubDate: newer.data.date.at, link: "/posts/2025-02/", categories: ["month"] },
      { title: "2025-01", pubDate: older.data.date.at, link: "/posts/2025-01/", categories: ["month"] },
    ],
  });
  assert.deepEqual(state.reads.slice(8), ["posts"]);
  assert.deepEqual(await posts.chapterPage({ id: "novel", data: { title: "Story" } }), { title: "Story", Content: "novel" });
});
