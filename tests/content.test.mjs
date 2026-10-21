import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function contentGraph(options = {}, exports = "") {
  const bundle = await build({
    stdin: {
      contents: `
        export * as posts from "./src/lib/posts.ts";
        export * as notes from "./src/lib/notes.ts";
        export * as comments from "./src/lib/interactions/comments.ts";
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
    posts.allPosts, posts.allTags, posts.komorebi, posts.novel, posts.chapterCount,
    notes.allNotes, notes.noteYears, () => comments.commentsFor("2023-07"),
  ]) {
    await assert.rejects(read, { message: "Astro content reads are unavailable in the queue consumer" });
  }
  await assert.rejects(() => posts.content({ id: "2023-07", collection: "posts" }), {
    message: "Astro content rendering is unavailable in the queue consumer",
  });
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

  assert.deepEqual((await posts.komorebi()).map((entry) => entry.id), ["index", "novel"]);
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
  for (const read of [posts.allPosts, posts.komorebi, notes.allNotes, notes.noteYears]) {
    await assert.rejects(read, (error) => error === state.error);
  }
  await assert.rejects(() => posts.content(entries[0]), (error) => error === state.error);
});
