import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  comments,
  followIntentLocation,
  komorebi,
  notes,
  posts,
  postsPinned,
  promotedComments,
} from "../src/data.config.generated.mjs";
import { dataConfigSchema } from "../src/data.config.ts";

function copyRegister() {
  return JSON.parse(readFileSync(new URL("../src/data.config.json", import.meta.url), "utf8"));
}

test("the register declares the comments stores and their layers", () => {
  assert.deepEqual(comments, {
    sql: "comments",
    table: '"comments"',
    columns: {
      activityId: "activity_id",
      objectId: "object_id",
      rootId: "root_id",
      replyToId: "reply_to_id",
      actorId: "actor_id",
      content: "content",
      published: "published",
      receivedAt: "received_at",
      deletedAt: "deleted_at",
      promotedAt: "promoted_at",
    },
    quotedColumns: {
      activityId: '"activity_id"',
      objectId: '"object_id"',
      rootId: '"root_id"',
      replyToId: '"reply_to_id"',
      actorId: '"actor_id"',
      content: '"content"',
      published: '"published"',
      receivedAt: '"received_at"',
      deletedAt: '"deleted_at"',
      promotedAt: '"promoted_at"',
    },
  });
  assert.deepEqual(promotedComments.glob, {
    base: "./src/content/comments",
    pattern: "{posts,notes}/*.json",
  });
  assert.equal(promotedComments.gitRoot, "src/content/comments");
  assert.equal(copyRegister()["promoted-comments"].writeBack[0], "promote");
  assert.equal(copyRegister()["promoted-comments"].writeBack[1], "tombstone");
});

test("the register resolves every git content location", () => {
  const register = copyRegister();
  for (const [kind, layer] of [
    ["posts", "src/content/posts/**/*.md"],
    ["notes", "src/content/notes/**/*.json"],
    ["komorebi", "src/content/komorebi/**/*.md"],
    ["follow-intent", "src/integrations/activitypub/following.json"],
  ]) {
    assert.equal(register[kind].layers[0].git, layer);
    assert.equal(register[kind].writeBack.length, 0);
    assert.equal(register[kind].origin, "owner");
    assert.equal(register[kind].recovery, "keep");
    assert.ok(register[kind].purposes.length > 0);
    assert.ok(register[kind].description);
  }
  assert.deepEqual(register["posts.pinned"].layers, [{ ref: "posts", fields: ["pinned"] }]);
  assert.deepEqual(posts.glob, { base: "./src/content/posts", pattern: "**/*.md" });
  assert.deepEqual(postsPinned.fields, ["pinned"]);
  assert.deepEqual(notes.glob, { base: "./src/content/notes", pattern: "**/*.json" });
  assert.deepEqual(komorebi.glob, { base: "./src/content/komorebi", pattern: "**/*.md" });
  assert.equal(followIntentLocation.file, "src/integrations/activitypub/following.json");
});

test("the register rejects values outside each declared enum", () => {
  for (const [field, value] of [
    ["origin", "strangers"],
    ["recovery", "archive"],
  ]) {
    const invalid = copyRegister();
    invalid.comments[field] = value;
    assert.equal(dataConfigSchema.safeParse(invalid).success, false, field);
  }

  const invalidPurpose = copyRegister();
  invalidPurpose.comments.purposes = ["runtime"];
  assert.equal(dataConfigSchema.safeParse(invalidPurpose).success, false, "purposes");

  const invalidWriteBack = copyRegister();
  invalidWriteBack["promoted-comments"].writeBack = ["deploy"];
  assert.equal(dataConfigSchema.safeParse(invalidWriteBack).success, false, "writeBack");

  const invalidList = copyRegister();
  invalidList.comments.list = "scan-comments";
  assert.equal(dataConfigSchema.safeParse(invalidList).success, false, "list");

  const missingColumn = copyRegister();
  delete missingColumn.comments.layers[0].columns.activityId;
  assert.equal(dataConfigSchema.safeParse(missingColumn).success, false, "comments.columns.activityId");
});
