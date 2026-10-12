import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeStates, main, rewrite } from "../scripts/tombstone.mjs";

const id = (name) => `https://example.test/${name}`;

function comment(name, extra = {}) {
  return {
    activityId: id(`activity/${name}`),
    objectId: id(`object/${name}`),
    rootId: id("root"),
    actorId: id("actor"),
    content: [[{ type: "text", text: name }]],
    published: "2026-10-10T00:00:00Z",
    replyToId: null,
    ...extra,
  };
}

test("withdrawals are computed from main and an injected open-PR state", () => {
  const withdrawn = [
    { activityId: id("activity/pending"), deletedAt: "2026-10-10T00:01:00Z" },
    { activityId: id("activity/proposed"), deletedAt: "2026-10-10T00:02:00Z" },
    { activityId: id("activity/tombstone"), deletedAt: "2026-10-10T00:03:00Z" },
    { activityId: id("activity/missing"), deletedAt: "2026-10-10T00:04:00Z" },
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
      checked.push(change.activityId);
      return change.activityId === id("activity/proposed");
    },
  });

  assert.deepEqual(
    result.states.map(({ activityId, state }) => [activityId, state]),
    [
      [id("activity/pending"), "pending"],
      [id("activity/proposed"), "proposed"],
      [id("activity/tombstone"), "written back"],
      [id("activity/missing"), "written back"],
    ],
  );
  assert.deepEqual(checked, [id("activity/pending"), id("activity/proposed")]);
  assert.equal(result.pending.length, 1);
  assert.deepEqual(result.writes.map(({ path }) => path), ["src/content/comments/posts/root.json"]);
  assert.equal(JSON.stringify(documents), before, "state computation does not store acknowledgement");
});

test("an injected open PR can make a withdrawal proposed without any stored acknowledgement", () => {
  const activityId = id("activity/proposed-only");
  const result = computeStates({
    withdrawn: [{ activityId, deletedAt: "2026-10-10T00:01:00Z" }],
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
  const proposedId = id("activity/proposed-regeneration");
  const pendingId = id("activity/pending-regeneration");
  const path = join(dir, "root.json");
  writeFileSync(path, `${JSON.stringify({
    comments: [comment("proposed-regeneration"), comment("pending-regeneration")],
  })}\n`);
  const rows = [
    { activity_id: proposedId, deleted_at: "2026-10-10T00:01:00Z" },
    { activity_id: pendingId, deleted_at: "2026-10-10T00:02:00Z" },
  ];

  const result = main({
    dir,
    rows,
    apply: true,
    pullRequestState: ({ activityId }) => activityId === proposedId,
  });

  assert.deepEqual(
    result.states.map(({ activityId, state }) => [activityId, state]),
    [[proposedId, "proposed"], [pendingId, "pending"]],
  );
  assert.equal(result.writes.length, 1);
  assert.equal(existsSync(path), false, "the regenerated branch carries both withdrawals");
});

test("rewrite reaches the tombstone fixed point after a withdrawn reply", () => {
  const parent = comment("parent");
  const reply = comment("reply", { replyToId: parent.objectId });
  const when = new Map([[reply.activityId, "2026-10-10T00:01:00Z"]]);

  assert.deepEqual(rewrite([parent, reply], when), [parent]);
});

test("main writes a pending change, then converges to written back", (t) => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-tombstone-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const activityId = id("activity/main");
  const path = join(dir, "root.json");
  writeFileSync(path, `${JSON.stringify({ comments: [comment("main")] })}\n`);
  const rows = [{ activity_id: activityId, deleted_at: "2026-10-10T00:01:00Z" }];

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
