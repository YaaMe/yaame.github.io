import test from "node:test";
import assert from "node:assert/strict";
import * as posts from "../src/services/authoring/posts.ts";

test("post preparation owns calendar acceptance and frontmatter keeps shape acceptance", () => {
  assert.equal(typeof posts.preparePost, "function");
  assert.equal(posts.preparePost("2025-99", new Date("2026-01-01T00:00:00Z")), null);
  const result = posts.prepareFrontmatter("---\ntitle: Odd\n---\nBody\n", "2025-99");
  assert.equal(result.status, "ready");
  assert.equal(result.missingTags, false);
  assert.equal(result.document, '---\ntitle: Odd\ndescription: "Body"\ntags:\n  - summaries\n  - month\n---\nBody\n');
});

import { spawnSync } from "node:child_process";
import { readTags, validTagInput, prepareTagAddition, tagUsage } from "../src/services/authoring/tags.ts";
import { takenNoteIds, newNoteId, prepareNote, appendNote, noteSource, parseNoteDraft, checkNoteConversion } from "../src/services/authoring/notes.ts";
import { prepareFollowIntent } from "../src/services/authoring/following.ts";

const registry = 'export const TAGS = {\n  reading: "读书",\n} as const;\n';

test("tag modes keep their slug and duplicate differences until B6", () => {
  assert.deepEqual(readTags(registry), [{ slug: "reading", label: "读书" }]);
  for (const slug of ["9tag", "Upper", "_tag"]) {
    assert.equal(validTagInput(slug, "标签", "interactive"), true);
    assert.equal(validTagInput(slug, "标签", "dedicated"), false);
  }
  for (const mode of ["interactive", "dedicated"]) {
    for (const [slug, label] of [["", "Label"], ["hyphen-tag", "Label"], ["reading", ""]]) {
      assert.equal(prepareTagAddition(registry, slug, label, mode).status, "invalid");
    }
  }
  assert.equal(prepareTagAddition(registry, "reading", "再次", "dedicated").status, "duplicate");
  assert.equal(prepareTagAddition(registry, "reading", "再次", "interactive").document,
    'export const TAGS = {\n  reading: "读书",\n  reading: "再次",\n} as const;\n');
  assert.equal(prepareTagAddition(registry, "travel", '带"引号', "dedicated").document,
    'export const TAGS = {\n  reading: "读书",\n  travel: "带"引号",\n} as const;\n');
  assert.equal(prepareTagAddition("no terminator", "travel", "旅行", "dedicated").document, "no terminator");
  assert.equal(prepareTagAddition('  reading: dynamicLabel,', "reading", "读书", "dedicated").status, "duplicate");
});

test("tag usage excludes other fields and reports unknown tags", () => {
  const { used, orphan } = tagUsage([
    "---\ntags:\n  - reading\n  - missing\nother:\n  - decoy\n---\n",
    "---\ntags:\n  - reading\n---\n",
  ], readTags(registry));
  assert.deepEqual([...used], [["reading", 2], ["missing", 1]]);
  assert.deepEqual(orphan, ["missing"]);
});

test("note identity retries collisions from every archive without changing the snapshots", () => {
  const documents = [{ notes: [{ id: "aaaaaaaa" }] }, { notes: [{ id: "bbbbbbbb" }] }];
  const before = structuredClone(documents);
  let draws = 0;
  const id = newNoteId(takenNoteIds(documents), () => Math.floor(draws++ / 8) / 30);
  assert.equal(id, "cccccccc");
  assert.equal(draws, 24);
  assert.deepEqual(documents, before);
});

test("notes normalize UTC seconds and keep the UTC archive year", () => {
  const { year, note } = prepareNote("Body", new Date("2025-01-01T00:30:00.987+08:00"), () => "abcdefgh");
  assert.equal(year, 2024);
  assert.deepEqual(note, { id: "abcdefgh", published: "2024-12-31T16:30:00Z", content: "Body" });
  const original = '{"extra":42,"notes":[{"id":"later","published":"2025-01-01T00:00:00Z","content":"Later"}]}';
  const result = JSON.parse(appendNote(original, note));
  assert.equal(result.extra, 42);
  assert.deepEqual(result.notes.map((n) => n.id), ["abcdefgh", "later"]);
});

test("draft parsing keeps dropped metadata and calls the clock only for an undated draft", () => {
  const result = parseNoteDraft("---\ntitle: 'Title'\ndate: '2025-01-01T00:30:00+08:00'\ntags:\n - reading\n - travel\npinned: false\n---\n\nBody\n", () => assert.fail("dated draft must not read clock"));
  assert.equal(result.status, "ready");
  assert.equal(result.when.toISOString(), "2024-12-31T16:30:00.000Z");
  assert.equal(result.title, "'Title'");
  assert.deepEqual(result.tags, ["reading", "travel"]);
  assert.equal(result.pinned, true);
  assert.equal(result.body, "Body");
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(parseNoteDraft("Body", () => now).when, now);
  assert.equal(parseNoteDraft("---\ntitle: open", () => now).status, "open-frontmatter");
  assert.equal(parseNoteDraft(" ", () => now).status, "empty");
  assert.deepEqual(parseNoteDraft("---\ndate: bad\n---\nBody", () => now), { status: "invalid-date", written: "bad" });
});

test("explicit paths preserve B4 conversion behavior", () => {
  assert.deepEqual(noteSource("2025-01", "posts/2025-01.md", false), { file: "posts/2025-01.md", slug: "2025-01" });
  assert.deepEqual(noteSource("posts/2025-01.md", "posts/posts/2025-01.md.md", true), { file: "posts/2025-01.md", slug: null });
});

test("publication probe uses the model URL and refuses failures even with force", async () => {
  const address = "https://probe.test/users/writer/notes/%E6%97%A5%E8%AE%B0";
  for (const [status, force, expected] of [
    [200, false, { status: "published", address }],
    [200, true, { status: "ready", live: true }],
    [404, false, { status: "ready", live: false }],
    [500, false, { status: "ready", live: false }],
  ]) {
    const result = await checkNoteConversion("日记", force, {
      hasComments: () => false,
      configuration: () => 'export const AP = { actorHost: "probe.test", user: "writer" };',
      request: async (url, options) => {
        assert.equal(url, address);
        assert.deepEqual(options, { headers: { accept: "application/activity+json" } });
        return new Response(null, { status });
      },
    });
    assert.deepEqual(result, expected);
  }
  assert.deepEqual(await checkNoteConversion("日记", true, {
    hasComments: () => false,
    configuration: () => 'actorHost: "probe.test", user: "writer"',
    request: async () => { throw new Error("offline"); },
  }), { status: "unreachable", address });
});

test("a malformed publication host returns unreachable even with force (#86)", async () => {
  for (const force of [false, true]) {
    let requests = 0;
    const result = await checkNoteConversion("2025-01", force, {
      hasComments: () => false,
      configuration: () => 'actorHost: "bad host", user: "writer"',
      request: async () => { requests++; return new Response(null, { status: 404 }); },
    });
    assert.deepEqual(result, {
      status: "unreachable", address: "https://bad host/users/writer/notes/2025-01",
    });
    assert.equal(requests, 0);
  }
});

test("comments refuse conversion before configuration or network access", async () => {
  const result = await checkNoteConversion("2025-01", true, {
    hasComments: () => true,
    configuration: () => assert.fail("comments must stop configuration reads"),
    request: () => assert.fail("comments must stop requests"),
  });
  assert.deepEqual(result, { status: "comments" });
  assert.deepEqual(await checkNoteConversion("2025-01", true, {
    hasComments: () => false, configuration: () => "invalid",
    request: () => assert.fail("invalid configuration must stop requests"),
  }), { status: "configuration" });
});

test("follow removal removes duplicate intents while preserving unrelated data", () => {
  const result = prepareFollowIntent('{"follow":["a@remote.test","keep@remote.test","a@remote.test"],"extra":42}', "a@remote.test", true);
  assert.deepEqual(JSON.parse(result.document), { follow: ["keep@remote.test"], extra: 42 });
});

test("every authoring entry imports under plain Node without virtual aliases", () => {
  const urls = ["posts", "tags", "notes", "following"].map((name) => new URL(`../src/services/authoring/${name}.ts`, import.meta.url).href);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await Promise.all(${JSON.stringify(urls)}.map(url => import(url)))`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("post defaults retain the local month and the fixed offset timestamp pending B7", () => {
  const now = new Date(2026, 0, 1, 8, 30, 40);
  assert.deepEqual(posts.preparePost(undefined, now), {
    spec: "2025-12", title: "2025-12", kind: "month", tags: ["summaries", "month"],
  });
  assert.equal(posts.preparePost("2025-year", now, "Chosen title").title, "Chosen title");
  assert.equal(posts.postStamp(now), "2026-01-01 08:30:40+08:00");
  assert.equal(posts.lastMonth(now), "2025-12");
  assert.equal(now.getFullYear(), 2026);
  assert.equal(now.getMonth(), 0);
});

test("pin replacement preserves every other byte and pin insertion follows the title", () => {
  const source = '---\ntitle: "A title"\npinned: false\ndate: 2025-01-01 00:00:00+08:00\n\ntags: [reading]\n---\nBody\n';
  assert.deepEqual(posts.pinPost(source, false), {
    status: "write", document: source.replace("pinned: false", "pinned: true"),
  });
  const unpinned = source.replace("pinned: false\n", "");
  assert.deepEqual(posts.pinPost(unpinned, false), {
    status: "write", document: source.replace("pinned: false", "pinned: true"),
  });
  assert.deepEqual(posts.pinPost(unpinned, true), { status: "unchanged" });
  assert.deepEqual(posts.pinPost("No frontmatter", false), { status: "no-frontmatter" });
});
