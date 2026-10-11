import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { comments, promotedComments } from "../src/data.config.generated.mjs";
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
