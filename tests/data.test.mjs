import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  actorDigest,
  delivered,
  departures,
  deliveryFailures,
  followLedger,
  followers,
  following,
  noteDigests,
  sessions,
  comments,
  fedifyState,
  followIntentLocation,
  komorebi,
  migrations,
  notes,
  posts,
  postsPinned,
  promotedComments,
  queueOrdering,
  reactions,
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

test("the register resolves runtime keys, tables and patterns", () => {
  const register = copyRegister();
  const recordEntries = Object.entries(register).filter(([, entry]) =>
    entry.layers.some((layer) => Object.hasOwn(layer, "records")),
  );
  const keyedEntries = recordEntries.filter(([, entry]) =>
    typeof entry.layers.find((candidate) => Object.hasOwn(candidate, "records")).records === "string",
  );
  assert.equal(recordEntries.length, 10);
  assert.equal(keyedEntries.length, 9);
  for (const [kind, entry] of keyedEntries) {
    const layer = entry.layers.find((candidate) => Object.hasOwn(candidate, "records"));
    assert.ok(layer.records, kind);
    assert.ok(register[kind].purposes.length > 0, kind);
    assert.ok(register[kind].description, kind);
  }
  const sessionEntry = ["sessions", register.sessions];
  const sessionLayer = sessionEntry[1].layers.find((candidate) => Object.hasOwn(candidate, "records"));
  assert.equal(sessionLayer.records, "auth:session:{id}");
  assert.equal(sessionEntry[1].list, "never");
  assert.equal(register.migrations.layers[0].sql, "migrations");
  assert.equal(register.reactions.layers[0].sql, "reactions");

  const generatedKeys = [
    followers,
    following,
    followLedger,
    delivered,
    noteDigests,
    deliveryFailures,
    departures,
    actorDigest,
    sessions,
  ].map((value) => typeof value.key === "function" ? value.key("{id}") : value.key).sort();
  assert.deepEqual(
    generatedKeys,
    keyedEntries.map(([, entry]) => entry.layers.find((candidate) => Object.hasOwn(candidate, "records")).records).sort(),
  );
  assert.equal(sessions.key("abc"), sessionLayer.records.replace("{id}", "abc"));
  assert.equal(sessions.list, "never");
  assert.equal(reactions.table, '"reactions"');
  assert.equal(migrations.table, '"migrations"');
  assert.equal(fedifyState.memory, "fedify");
  assert.equal(Object.hasOwn(fedifyState, "records"), false);
  assert.equal(queueOrdering.records, true);
  assert.equal(queueOrdering.list, "never");
  assert.equal(Object.hasOwn(queueOrdering, "key"), false);
});

test("the register pins the ownership and recovery policy for every kind", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(copyRegister()).map(([kind, entry]) => [kind, [entry.origin, entry.recovery]])),
    {
      posts: ["owner", "keep"],
      "posts.pinned": ["owner", "keep"],
      notes: ["owner", "keep"],
      komorebi: ["owner", "keep"],
      "follow-intent": ["owner", "keep"],
      followers: ["others", "keep"],
      following: ["others", "keep"],
      "follow-ledger": ["owner", "keep"],
      delivered: ["owner", "keep"],
      "note-digests": ["owner", "keep"],
      "delivery-failures": ["owner", "reset"],
      departures: ["others", "reset"],
      "actor-digest": ["owner", "rebuild"],
      sessions: ["owner", "ephemeral"],
      "fedify-state": ["system", "ephemeral"],
      "queue-ordering": ["system", "reset"],
      reactions: ["others", "keep"],
      migrations: ["system", "keep"],
      comments: ["others", "keep"],
      "promoted-comments": ["others", "keep"],
    },
  );
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
