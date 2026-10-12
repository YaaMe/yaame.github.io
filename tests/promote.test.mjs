import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  computeStates,
  main,
  promotedComment,
  validatePromotedComment,
} from "../scripts/promote.mjs";
import { byFollowing } from "../scripts/promote-filter.mjs";

const id = (name) => `https://example.test/${name}`;

function comment(name, extra = {}) {
  return {
    activityId: id(`activity/${name}`),
    objectId: id(`object/${name}`),
    rootId: id("root"),
    actorId: id(`users/${name}`),
    content: [[{ type: "text", text: name }]],
    published: "2026-10-10T00:00:00Z",
    replyToId: null,
    ...extra,
  };
}

test("byFollowing selects followed actors and leaves other replies out", () => {
  const filter = byFollowing({ follow: ["alice@example.test"] });
  assert.deepEqual(
    filter([
      comment("alice", { actorId: "https://example.test/users/alice" }),
      comment("bob", { actorId: "https://example.test/users/bob" }),
    ]).map(({ activityId }) => activityId),
    [id("activity/alice")],
  );
});

test("promotion computes pending, proposed and written-back states", () => {
  const selected = [comment("pending"), comment("proposed"), comment("written")];
  const documents = [{ path: "comments.json", document: { comments: [selected[2]] } }];
  const result = computeStates({
    selected,
    documents,
    fileForComment: () => "comments.json",
    pullRequestState: ({ activityId }) => activityId === id("activity/proposed"),
  });
  assert.deepEqual(
    result.states.map(({ activityId, state }) => [activityId, state]),
    [
      [id("activity/pending"), "pending"],
      [id("activity/proposed"), "proposed"],
      [id("activity/written"), "written back"],
    ],
  );
  assert.equal(result.pending.length, 1);
  assert.equal(result.writes.length, 1);
});

test("promotion regenerates an open proposal when its entry is no longer selected", async () => {
  const stale = comment("stale");
  const result = await main({
    rows: [{
      activity_id: stale.activityId,
      object_id: stale.objectId,
      root_id: stale.rootId,
      reply_to_id: stale.replyToId,
      actor_id: stale.actorId,
      content: "<p>stale</p>",
      published: stale.published,
    }],
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
    content: [[{ type: "link", href: "javascript:alert(1)", label: "x" }]],
  })).ok, false);
  assert.equal(validatePromotedComment(comment("valid")).ok, true);
});

test("promotion preview does not write selected comments", async (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-promote-preview-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = await main({
    dir,
    apply: false,
    rows: [{
      activity_id: id("activity/alice"),
      object_id: id("object/alice"),
      root_id: id("root"),
      reply_to_id: null,
      actor_id: id("users/alice"),
      content: "<p>hello</p>",
      published: "2026-10-10T00:00:00Z",
    }],
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
  const rows = [{
    activity_id: id("activity/alice"),
    object_id: id("object/alice"),
    root_id: id("root"),
    reply_to_id: null,
    actor_id: id("users/alice"),
    content: "<p>hello</p>",
    published: "2026-10-10T00:00:00Z",
  }];
  const options = {
    dir,
    rows,
    filter: byFollowing({ follow: ["alice@example.test"] }),
    fileForComment: () => path,
    nameOf: async () => "Alice",
  };
  const first = await main({ ...options, apply: true });
  assert.equal(first.states[0].state, "pending");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).comments.length, 1);
  const second = await main({ ...options, apply: true });
  assert.equal(second.states[0].state, "written back");
  assert.equal(second.writes.length, 0);
});

test("a bad selected comment is reported while valid comments are still proposed", async (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-promote-invalid-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rows = ["bad", "good"].map((name) => ({
    activity_id: id(`activity/${name}`),
    object_id: id(`object/${name}`),
    root_id: id("root"),
    reply_to_id: null,
    actor_id: id(`users/${name}`),
    content: name === "bad" ? `<p>${"x".repeat(10001)}</p>` : "<p>good</p>",
    published: "2026-10-10T00:00:00Z",
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
  assert.equal(result.pending.length, 1);
  assert.equal(JSON.parse(readFileSync(join(dir, "comments.json"), "utf8")).comments[0].activityId, id("activity/good"));
});

test("promotedComment keeps the structured conversion used by ADR 0015", () => {
  const result = promotedComment({
    activity_id: id("activity/one"),
    object_id: id("object/one"),
    root_id: id("root"),
    reply_to_id: null,
    actor_id: id("users/alice"),
    content: "<p>hello <a href=\"https://example.test/\">there</a></p>",
    published: "2026-10-10T00:00:00Z",
  });
  assert.equal(result.content[0][1].href, "https://example.test/");
});
