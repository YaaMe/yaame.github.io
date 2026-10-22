import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  actorName,
  computeStates,
  promotedComment,
  validatePromotedComment,
} from "../src/services/interactions/promote.ts";
import { main } from "../scripts/promote.mjs";
import { byFollowing } from "../scripts/promote-filter.mjs";
import { toContent } from "../src/services/interactions/promote-text.ts";
import { commentSchema } from "../src/models/content/comments.ts";
import { httpUrl } from "../src/models/interactions/records.ts";
import { archivedComment as comment, physicalComment } from "./fixtures/interactions.mjs";

test("conversion keeps its link predicate separate from later model validation", () => {
  for (const [href, accepted] of [
    ["https://example.test/reference", true],
    ["http:x", false],
    ["https:/x", false],
  ]) {
    const content = toContent(`<p><a href=" ${href} ">reference</a></p>`);
    assert.deepEqual(content, [[{ type: "link", href, label: "reference" }]]);
    assert.equal(httpUrl.safeParse(href).success, accepted, href);
    assert.equal(commentSchema.safeParse(comment("link-policy", { content })).success, accepted, href);
    assert.equal(validatePromotedComment(comment("link-policy", { content })).ok, accepted, href);
  }
  assert.deepEqual(toContent('<a href="javascript:alert(1)">reference</a>'), [[{ type: "text", text: "reference" }]]);
});

test("actor names use an HTTP(S) URL without following redirects", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return Response.json({ name: " Friend " });
  });

  assert.equal(await actorName("https://mastodon.social/users/friend"), "Friend");
  assert.equal(await actorName("http://example.test/users/friend"), "Friend");
  assert.deepEqual(requests.map(({ url }) => url), [
    "https://mastodon.social/users/friend",
    "http://example.test/users/friend",
  ]);
  for (const { options } of requests) {
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.accept, "application/activity+json");
  }
});

test("actor names require an HTTP(S) URL before fetching", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => Response.json({ name: "Friend" }));

  assert.equal(await actorName("ftp://example.test/users/friend"), undefined);
  assert.equal(await actorName("not a URL"), undefined);
  assert.equal(request.mock.callCount(), 0);
});

test("actor names stay absent when a redirect is refused", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (options.redirect === "error") throw new TypeError("redirect refused");
    return Response.json({ name: "Friend" });
  });

  assert.equal(await actorName("https://mastodon.social/users/friend"), undefined);
  assert.equal(request.mock.callCount(), 1);
});

test("byFollowing selects followed actors and leaves other replies out", () => {
  const filter = byFollowing({ follow: ["alice@example.test"] });
  assert.deepEqual(
    filter([
      comment("alice"),
      comment("bob"),
      comment("alice", { author: { ...comment("alice").author, source: "github" } }),
    ]).map(({ id }) => id),
    [comment("alice").id],
  );
});

test("promotion computes pending, proposed and written-back states", () => {
  const selected = [comment("pending"), comment("proposed"), comment("written")];
  const documents = [{ path: "comments.json", document: { comments: [selected[2]] } }];
  const result = computeStates({
    selected,
    documents,
    fileForComment: () => "comments.json",
    pullRequestState: ({ id }) => id === comment("proposed").id,
  });
  assert.deepEqual(
    result.states.map(({ id, state }) => [id, state]),
    [
      [comment("pending").id, "pending"],
      [comment("proposed").id, "proposed"],
      [comment("written").id, "written back"],
    ],
  );
  assert.equal(result.pending.length, 1);
  assert.equal(result.writes.length, 1);
  assert.deepEqual(new Set(result.writes[0].after.comments.map(({ id }) => id)), new Set(selected.map(({ id }) => id)));
});

test("promotion regenerates an open proposal when its entry is no longer selected", async () => {
  const stale = comment("stale");
  const result = await main({
    rows: [physicalComment("stale")],
    filter: () => [],
    documents: [],
    pullRequestDocuments: [{ path: "comments.json", document: { comments: [stale] } }],
    fileForComment: () => "comments.json",
    nameOf: async () => undefined,
  });
  assert.equal(result.staleProposal, true);
  assert.equal(result.shouldWrite, true);
});

test("promotion keeps a stale open proposal writable when the inbox is empty", async () => {
  const stale = comment("stale");
  const result = await main({
    rows: [],
    documents: [],
    pullRequestDocuments: [{ path: "comments.json", document: { comments: [stale] } }],
    fileForComment: () => "comments.json",
  });
  assert.equal(result.staleProposal, true);
  assert.equal(result.shouldWrite, true);
});

test("promotion validation rejects control characters, overlong content and bad links", () => {
  assert.equal(validatePromotedComment(comment("control", {
    content: [[{ type: "text", text: "bad\u0000text" }]],
  })).ok, false);
  assert.equal(validatePromotedComment(comment("long", {
    content: [[{ type: "text", text: "x".repeat(10001) }]],
  })).ok, false);
  assert.equal(validatePromotedComment(comment("link", {
    content: [[{ type: "link", href: "ftp://example.test/reference", label: "Reference" }]],
  })).ok, false);
  assert.equal(validatePromotedComment(comment("valid")).ok, true);
});

test("promotion preview does not write selected comments", async (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-promote-preview-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = await main({
    dir,
    apply: false,
    rows: [physicalComment("alice", { content: "<p>hello</p>" })],
    filter: byFollowing({ follow: ["alice@example.test"] }),
    fileForComment: () => join(dir, "comments.json"),
    nameOf: async () => "Alice",
  });
  assert.equal(result.pending.length, 1);
  assert.equal(existsSync(join(dir, "comments.json")), false);
});

test("promotion applies a pending addition and then reads it as written back", async (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-promote-converge-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "comments.json");
  const rows = [physicalComment("alice", { content: "<p>hello</p>" })];
  const options = {
    dir,
    rows,
    filter: byFollowing({ follow: ["alice@example.test"] }),
    fileForComment: () => path,
    nameOf: async () => "Alice",
  };
  const first = await main({ ...options, apply: true });
  assert.equal(first.states[0].state, "pending");
  const archived = JSON.parse(readFileSync(path, "utf8")).comments;
  assert.equal(archived.length, 1);
  assert.equal(archived[0].id, comment("alice").id);
  assert.deepEqual(archived[0].author, { ...comment("alice").author, name: "Alice" });
  assert.deepEqual(archived[0].content, [[{ type: "text", text: "hello" }]]);
  const second = await main({ ...options, apply: true });
  assert.equal(second.states[0].state, "written back");
  assert.equal(second.writes.length, 0);
});

test("a bad selected comment is reported while valid comments are still proposed", async (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-promote-invalid-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rows = ["bad", "good"].map((name) => physicalComment(name, {
    content: name === "bad" ? `<p>${"x".repeat(10001)}</p>` : "<p>good</p>",
  }));
  const result = await main({
    dir,
    apply: true,
    rows,
    filter: (thread) => thread,
    fileForComment: () => join(dir, "comments.json"),
    nameOf: async () => undefined,
  });
  assert.equal(result.invalid.length, 1);
  assert.equal(result.invalid[0].id, comment("bad").id);
  assert.match(result.invalid[0].reason, /content exceeds 10000 characters/);
  assert.equal(result.pending.length, 1);
  assert.equal(JSON.parse(readFileSync(join(dir, "comments.json"), "utf8")).comments[0].id, comment("good").id);
});

test("promotedComment keeps the structured conversion used by ADR 0015", () => {
  const result = promotedComment(physicalComment("one", {
    content: "<p>hello <a href=\"https://example.test/\">there</a></p>",
  }));
  assert.equal(result.content[0][1].href, "https://example.test/");
  assert.deepEqual(result.content, [[
    { type: "text", text: "hello " },
    { type: "link", href: "https://example.test/", label: "there" },
  ]]);
  assert.deepEqual(result.author, comment("one").author);
  assert.equal(validatePromotedComment(result).ok, true);
});

test("promotion refuses mismatched derived IDs while keeping valid additions", async (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-promote-derived-id-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wrongId = comment("another").id;
  const rewrappedActivity = "https://example.test/activity/rewrapped";
  const rows = [
    physicalComment("wrong-comment", { id: wrongId }),
    physicalComment("wrong-author", { authorId: comment("another").author.id }),
    { ...physicalComment("wrong-object"), object_id: "https://example.test/object/changed" },
    physicalComment("valid", { activityId: rewrappedActivity }),
  ];
  const result = await main({
    dir,
    apply: true,
    rows,
    filter: (thread) => thread,
    fileForComment: () => join(dir, "comments.json"),
    nameOf: async () => undefined,
  });
  assert.deepEqual(result.invalid.map(({ id }) => id), [wrongId, comment("wrong-author").id, comment("wrong-object").id]);
  assert.ok(result.invalid.every(({ reason }) => /inputs do not compute/.test(reason)));
  assert.deepEqual(result.pending.map(({ id }) => id), [comment("valid").id]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "comments.json"), "utf8")).comments, [comment("valid", { activityId: rewrappedActivity })]);
});
