import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeStates, rewrite } from "../src/services/interactions/tombstone.ts";
import { main } from "../scripts/tombstone.mjs";
import { writeDocument } from "../scripts/comments-store.mjs";
import { archivedComment as comment } from "./fixtures/interactions.mjs";

test("archive writes validate the collection before changing a file", (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-archive-collection-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "comments.json");
  writeDocument(path, { comments: [comment("valid")] });
  const saved = readFileSync(path, "utf8");
  assert.throws(() => writeDocument(path, { comments: new Set([comment("valid")]) }), /array/);
  assert.equal(readFileSync(path, "utf8"), saved);
});

test("archive rewriting preserves an existing tombstone's time and fields", () => {
  const parent = comment("parent", { content: undefined, deletedAt: "2026-10-09T00:00:00Z", retained: "value" });
  const reply = comment("reply", { replyTo: parent.id, inReplyTo: parent.objectId });
  const result = rewrite([parent, reply], new Map([[parent.id, "2026-10-10T00:00:00Z"]]));
  assert.equal(result[0], parent);
  assert.deepEqual(result, [parent, reply]);
});

test("withdrawals are computed from main and an injected open-PR state", () => {
  const withdrawn = [
    { id: comment("pending").id, deletedAt: "2026-10-10T00:01:00Z" },
    { id: comment("proposed").id, deletedAt: "2026-10-10T00:02:00Z" },
    { id: comment("tombstone").id, deletedAt: "2026-10-10T00:03:00Z" },
    { id: comment("missing").id, deletedAt: "2026-10-10T00:04:00Z" },
  ];
  const documents = [
    {
      path: "src/content/comments/posts/root.json",
      document: {
        comments: [
          comment("pending"),
          comment("proposed"),
          comment("tombstone", { content: undefined, deletedAt: "2026-10-10T00:03:00Z" }),
        ],
      },
    },
  ];
  const before = JSON.stringify(documents);
  const checked = [];
  const result = computeStates({
    withdrawn,
    documents,
    pullRequestState: (change) => {
      checked.push(change.id);
      return change.id === comment("proposed").id;
    },
  });

  assert.deepEqual(
    result.states.map(({ id, state }) => [id, state]),
    [
      [comment("pending").id, "pending"],
      [comment("proposed").id, "proposed"],
      [comment("tombstone").id, "written back"],
      [comment("missing").id, "written back"],
    ],
  );
  assert.deepEqual(checked, [comment("pending").id, comment("proposed").id]);
  assert.equal(result.pending.length, 1);
  assert.deepEqual(result.writes.map(({ path }) => path), ["src/content/comments/posts/root.json"]);
  assert.equal(JSON.stringify(documents), before, "state computation does not store acknowledgement");
});

test("an injected open PR can make a withdrawal proposed without any stored acknowledgement", () => {
  const id = comment("proposed-only").id;
  const result = computeStates({
    withdrawn: [{ id, deletedAt: "2026-10-10T00:01:00Z" }],
    documents: [{ path: "comments.json", document: { comments: [comment("proposed-only")] } }],
    pullRequestState: () => true,
  });

  assert.equal(result.states[0].state, "proposed");
  assert.equal(result.pending.length, 0);
  assert.equal(result.shouldWrite, false);
});

test("a pending withdrawal keeps proposed withdrawals in the regenerated write set", (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-tombstone-regeneration-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const proposedId = comment("proposed-regeneration").id;
  const pendingId = comment("pending-regeneration").id;
  const path = join(dir, "root.json");
  writeFileSync(path, `${JSON.stringify({
    comments: [comment("proposed-regeneration"), comment("pending-regeneration")],
  })}\n`);
  const rows = [
    { id: proposedId, deleted_at: "2026-10-10T00:01:00Z" },
    { id: pendingId, deleted_at: "2026-10-10T00:02:00Z" },
  ];

  const result = main({
    dir,
    rows,
    apply: true,
    pullRequestState: ({ id }) => id === proposedId,
  });

  assert.deepEqual(
    result.states.map(({ id, state }) => [id, state]),
    [[proposedId, "proposed"], [pendingId, "pending"]],
  );
  assert.equal(result.writes.length, 1);
  assert.equal(existsSync(path), false, "the regenerated branch carries both withdrawals");
});

test("rewrite reaches the tombstone fixed point after a withdrawn reply", () => {
  const parent = comment("parent");
  const reply = comment("reply", { replyTo: parent.id, inReplyTo: parent.objectId });
  const when = new Map([[reply.id, "2026-10-10T00:01:00Z"]]);

  assert.deepEqual(rewrite([parent, reply], when), [parent]);
  when.set(parent.id, "2026-10-10T00:00:00Z");
  assert.deepEqual(rewrite([parent, reply], when), []);
});

test("main writes a pending change, then converges to written back", (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-tombstone-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const id = comment("main").id;
  const path = join(dir, "root.json");
  writeFileSync(path, `${JSON.stringify({ comments: [comment("main")] })}\n`);
  const rows = [{ id, deleted_at: "2026-10-10T00:01:00Z" }];

  const proposed = main({ dir, rows, apply: true, pullRequestState: () => true });
  assert.equal(proposed.states[0].state, "proposed");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).comments[0].content[0][0].text, "main");

  const pending = main({ dir, rows, apply: true, pullRequestState: () => false });
  assert.equal(pending.states[0].state, "pending");
  assert.equal(existsSync(path), false);

  const written = main({ dir, rows, apply: true, pullRequestState: () => false });
  assert.equal(written.states[0].state, "written back");
  assert.equal(existsSync(path), false);
});

test("a withdrawn parent keeps its identity and loses its structured content", () => {
  const parent = comment("parent");
  const reply = comment("reply", { replyTo: parent.id, inReplyTo: parent.objectId });
  const deletedAt = "2026-10-10T00:01:00Z";
  const result = rewrite([parent, reply], new Map([[parent.id, deletedAt]]));
  assert.equal(result.length, 2);
  assert.equal(result[0].id, parent.id);
  assert.deepEqual(result[0].author, parent.author);
  assert.equal(result[0].deletedAt, deletedAt);
  assert.equal("content" in result[0], false);
  assert.deepEqual(result[1], reply);
  assert.deepEqual(parent, comment("parent"));
});

test("archive writes refuse mismatched derived IDs before changing a file", (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-archive-derived-id-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "comments.json");
  const valid = comment("valid", { activityId: "https://example.test/activity/rewrapped" });
  writeDocument(path, { comments: [valid] });
  const saved = readFileSync(path, "utf8");
  for (const invalid of [
    comment("invalid", { id: comment("other").id }),
    comment("invalid", { objectId: "https://example.test/object/changed" }),
    comment("invalid", { author: { ...comment("invalid").author, id: comment("other").author.id } }),
  ]) {
    assert.throws(() => writeDocument(path, { comments: [valid, invalid] }), /inputs do not compute/);
    assert.equal(readFileSync(path, "utf8"), saved);
    const missing = join(dir, "missing.json");
    assert.throws(() => writeDocument(missing, { comments: [invalid] }), /inputs do not compute/);
    assert.equal(existsSync(missing), false);
  }
});

test("tombstone writes refuse an invalid parent ID and preserve the archive", (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-tombstone-derived-id-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "comments.json");
  const parent = comment("parent", { id: comment("other").id });
  const reply = comment("reply", { replyTo: parent.id, inReplyTo: parent.objectId });
  const saved = `${JSON.stringify({ comments: [parent, reply] })}\n`;
  writeFileSync(path, saved);
  assert.throws(() => main({
    dir,
    apply: true,
    rows: [{ id: parent.id, deletedAt: "2026-10-10T00:01:00Z" }],
  }), /inputs do not compute/);
  assert.equal(readFileSync(path, "utf8"), saved);
});
