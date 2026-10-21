import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import registerData from "../src/config/data.config.json" with { type: "json" };
import { exportSqlRecovery, importSqlRecovery, sqlInsertStatements, validateSqlPlan } from "../scripts/recovery-sql.mjs";
import { writeSqlPlan } from "../scripts/platform/node/sqlite.mjs";
import { importRecovery, InMemoryRecoveryFacility } from "../src/lib/recovery.ts";
import { migrate } from "../src/services/interactions/schema.ts";
import { database } from "../src/platform/node/database.ts";
import { storedComment, storedDelivery, storedFollower, storedReaction } from "./fixtures/interactions.mjs";
import { CHANNELS, SOURCES, commentId, deliveryId, identityId, reactionId } from "../src/models/interactions/key-scheme.ts";
import { validateInteractionRows } from "../src/models/interactions/records.ts";

const register = {
  "visitor-identities": registerData["visitor-identities"], comments: registerData.comments, reactions: registerData.reactions, followers: registerData.followers, deliveries: registerData.deliveries,
};
const comment = storedComment("recovery");
const author = { id: comment.authorId, source: comment.source, identifier: comment.identifier, name: "Cached name" };
const reaction = storedReaction("recovery");
const follower = storedFollower("recovery-follower");
const followerIdentity = { id: follower.id, source: follower.source, identifier: follower.identifier, name: null };
const delivery = storedDelivery("recovered-post");

async function exported() {
  return exportSqlRecovery({ register, snapshot: [
    { kind: "visitor-identities", layer: 0, rows: [author, followerIdentity] },
    { kind: "comments", layer: 0, rows: [comment] },
    { kind: "reactions", layer: 0, rows: [reaction] },
    { kind: "followers", layer: 0, rows: [follower] },
    { kind: "deliveries", layer: 0, rows: [delivery] },
  ] });
}

test("interaction validation refuses kinds without a schema, including empty rows", () => {
  for (const kind of ["future-interaction", "constructor", "__proto__"]) {
    for (const rows of [[], [author]]) {
      assert.throws(() => validateInteractionRows(kind, rows), new Error(`No interaction schema for kind: ${kind}`));
    }
  }
});

test("registered reaction and migration rows require their stored fields", () => {
  for (const [kind, row, required] of [
    ...["identifier", "activityId", "objectId", "target", "kind"].map((field) => ["reactions", storedReaction("required"), field]),
    ["migrations", { version: 0, appliedAt: "2026-10-13" }, "appliedAt"],
  ]) {
    assert.doesNotThrow(() => validateInteractionRows(kind, [row]));
    const incomplete = { ...row };
    delete incomplete[required];
    assert.throws(() => validateInteractionRows(kind, [incomplete]), (error) => error.issues?.some(({ path }) => path[0] === 0 && path[1] === required));
  }
});

test("recovery refuses registered kinds without schemas before any facility writes", async () => {
  const kind = "future-interaction";
  const selected = { [kind]: { recovery: "keep", layers: [{ sql: "future_interactions", columns: { id: "id" } }] } };
  const document = { ...await exported(), entries: { [kind]: { records: [{ layer: 0, records: [] }] } } };
  let writes = 0;
  await assert.rejects(importRecovery({ register: selected, document, facilities: { sql: { import() { writes++; } } } }), /No interaction schema for kind: future-interaction/);
  assert.equal(writes, 0);
  assert.throws(() => sqlInsertStatements(selected, { writes: [{ action: "insert", kind, layer: 0, rows: [] }] }), /No interaction schema for kind: future-interaction/);
});

test("recovery versions 1 to 3 are refused before any facility can write", async () => {
  for (const version of [1, 2, 3]) {
    const document = await exported();
    document.version = version;
    let writes = 0;
    await assert.rejects(importRecovery({ register, document, facilities: { sql: { import() { writes++; } } } }), new RegExp(`unsupported recovery format version: ${version}; expected 4.*Older exports`));
    assert.equal(writes, 0);
  }
});

test("every recovery write entrance verifies both kinds' stored id inputs before writing", async () => {
  for (const [kind, field, value] of [
    ["comments", "identifier", "https://example.test/users/another"],
    ["comments", "objectId", "https://example.test/object/another"],
    ["comments", "activityId", "https://other.example/activity"],
    ["comments", "id", storedComment("other").id],
    ["comments", "id", commentId({ ...comment, objectId: comment.activityId })],
    ["comments", "authorId", storedComment("other").authorId],
    ["comments", "objectId", "https://other.example/note"],
    ["visitor-identities", "identifier", "https://example.test/users/another"],
    ["visitor-identities", "id", storedComment("other").authorId],
    ["reactions", "identifier", "https://example.test/users/another"],
    ["reactions", "activityId", "https://example.test/activity/another"],
    ["reactions", "id", storedReaction("other").id],
    ["reactions", "id", reactionId({ ...reaction, activityId: "https://example.test/activity/another" })],
    ["reactions", "authorId", storedReaction("other").authorId],
    ["followers", "identifier", "https://example.test/users/another"],
    ["followers", "source", SOURCES.github],
    ["followers", "id", storedFollower("other").id],
    ["deliveries", "target", "another-post"],
    ["deliveries", "id", deliveryId(CHANNELS.activitypub, "another-post")],
  ]) {
    const document = await exported();
    const validPlan = await importSqlRecovery({ register, document, existing: false });
    document.entries[kind].records[0].records[0][field] = value;
    let writes = 0;
    await assert.rejects(importRecovery({ register, document, facilities: { sql: { import() { writes++; } } } }), /inputs do not compute|signing actor's origin/);
    assert.equal(writes, 0);
    await assert.rejects(importSqlRecovery({ register, document, existing: false }));
    const plan = structuredClone(validPlan);
    plan.writes.find((write) => write.kind === kind).rows[0][field] = value;
    await assert.rejects(validateSqlPlan(register, plan));
    assert.throws(() => sqlInsertStatements(register, plan));
    const memory = new InMemoryRecoveryFacility();
    assert.throws(() => memory.import({ kind, layer: register[kind].layers[0], layerIndex: 0, records: document.entries[kind].records[0].records }));
    assert.deepEqual(memory.snapshot(), {});
    const client = new DatabaseSync(":memory:");
    try {
      await migrate(database(client));
      assert.throws(() => writeSqlPlan(client, plan, register));
      assert.equal(client.prepare("SELECT COUNT(*) AS count FROM comments").get().count, 0);
      assert.equal(client.prepare("SELECT COUNT(*) AS count FROM reactions").get().count, 0);
      assert.equal(client.prepare("SELECT COUNT(*) AS count FROM visitor_identities").get().count, 0);
      assert.equal(client.prepare("SELECT COUNT(*) AS count FROM followers").get().count, 0);
      assert.equal(client.prepare("SELECT COUNT(*) AS count FROM deliveries").get().count, 0);
    } finally {
      client.close();
    }
  }
});

test("recovery restores a follower with its identity on the node target", async () => {
  const plan = await importSqlRecovery({ register, document: await exported(), existing: false });
  const client = new DatabaseSync(":memory:");
  try {
    await migrate(database(client));
    writeSqlPlan(client, plan, register);
    const saved = client.prepare("SELECT * FROM followers").get();
    assert.deepEqual({ ...saved }, {
      id: follower.id, source: follower.source, identifier: follower.identifier, inbox: follower.inbox, shared_inbox: follower.sharedInbox,
      follow_id: follower.followId, followed_at: follower.followedAt,
    });
    assert.equal(client.prepare("SELECT COUNT(*) AS count FROM visitor_identities WHERE id = ?").get(identityId(follower.source, follower.identifier)).count, 1);
  } finally {
    client.close();
  }
});

test("recovery preserves a Note id when its stored Create attribute changes", async () => {
  const document = await exported();
  const restored = document.entries.comments.records[0].records[0];
  restored.activityId = "https://example.test/activity/rewrapped";
  const memory = new InMemoryRecoveryFacility();
  await importRecovery({ register, document, facilities: { sql: memory } });
  const plan = await importSqlRecovery({ register, document, existing: false });
  await validateSqlPlan(register, plan);
  const client = new DatabaseSync(":memory:");
  try {
    await migrate(database(client));
    writeSqlPlan(client, plan, register);
    const saved = client.prepare("SELECT id, object_id, activity_id, author_id FROM comments").get();
    assert.equal(saved.id, comment.id);
    assert.equal(saved.object_id, comment.objectId);
    assert.equal(saved.activity_id, restored.activityId);
    assert.equal(client.prepare("SELECT id FROM visitor_identities").get().id, saved.author_id);
  } finally {
    client.close();
  }
});

test("recovery refuses a reaction whose activity is on another origin than its signer", async () => {
  const document = await exported();
  const activityId = "https://other.example/activity/recovery";
  Object.assign(document.entries.reactions.records[0].records[0], { activityId, id: reactionId({ ...reaction, activityId }) });
  await assert.rejects(importRecovery({ register, document, facilities: { sql: new InMemoryRecoveryFacility() } }), /signing actor's origin/);
});

test("recovery restores a reaction with its identity on the node target", async () => {
  const plan = await importSqlRecovery({ register, document: await exported(), existing: false });
  const client = new DatabaseSync(":memory:");
  try {
    await migrate(database(client));
    writeSqlPlan(client, plan, register);
    const saved = client.prepare("SELECT id, author_id, object_id, target FROM reactions").get();
    assert.deepEqual({ ...saved }, { id: reaction.id, author_id: reaction.authorId, object_id: reaction.objectId, target: reaction.target });
    assert.equal(client.prepare("SELECT COUNT(*) AS count FROM visitor_identities WHERE id = ?").get(reaction.authorId).count, 1);
  } finally {
    client.close();
  }
});

test("recovery refuses what the inbox would not have stored", async () => {
  const github = storedComment("github-raw", {
    source: "github", identifier: "00123", activityId: null, objectId: null, inReplyTo: null,
    submissionId: "93dd7f06-26c1-4c35-9a73-79df6ec41607",
  });
  assert.doesNotThrow(() => validateInteractionRows("comments", [github]));
  for (const [kind, row, message] of [
    ["reactions", { ...reaction, target: "other" }, /target must be the content/],
    ["reactions", storedReaction("recovery", { objectId: "https://elsewhere.example/users/yaame/notes/example" }), /target must be the content/],
    ["reactions", storedReaction("recovery", { identifier: "HTTPS://EXAMPLE.TEST:443/users/recovery" }), /stored normalised/],
    ["reactions", { ...reaction, receivedAt: "2026-10-10" }, /datetime/i],
    ["followers", storedFollower("recovery-follower", { identifier: "HTTPS://EXAMPLE.TEST:443/users/recovery-follower" }), /stored normalised/],
    ["followers", { ...follower, inbox: null }, /federated follower requires its inbox/],
    ["followers", storedFollower("subscriber", { source: SOURCES.github, identifier: "123", sharedInbox: null, followId: null }), /only a federated follower/],
    ["deliveries", { ...delivery, channel: "newsletter" }, /"path": \[\s*0,\s*"channel"\s*\]/],
    ["followers", { ...follower, inbox: "ftp://example.test/inbox" }, /url|protocol/i],
    ["followers", { ...follower, followedAt: "2026-10-10" }, /datetime/i],
    ["deliveries", storedDelivery("https://yaame.dev/users/yaame/notes/recovered-post"), /invalid string|regex|pattern/i],
    ["deliveries", { ...delivery, enqueuedAt: "today" }, /datetime/i],
    ["reactions", { ...reaction, undoneAt: "later" }, /datetime/i],
    ["comments", { ...comment, root: "other" }, /must have that content as its root/],
    ["comments", storedComment("recovery", { inReplyTo: "https://elsewhere.example/users/yaame/notes/example" }), /must have that content as its root/],
    ["comments", storedComment("recovery", { identifier: "HTTPS://EXAMPLE.TEST:443/users/recovery" }), /stored normalised/],
    ["comments", { ...comment, receivedAt: "yesterday" }, /datetime/i],
    ["comments", { ...comment, published: "2026-10-10" }, /datetime/i],
    ["comments", { ...comment, deletedAt: "now" }, /datetime/i],
    ["visitor-identities", { ...author, identifier: "HTTPS://EXAMPLE.TEST:443/users/recovery", id: storedComment("recovery", { identifier: "HTTPS://EXAMPLE.TEST:443/users/recovery" }).authorId }, /stored normalised/],
  ]) {
    assert.throws(() => validateInteractionRows(kind, [row]), message, `${kind}: ${message}`);
    const document = await exported();
    document.entries[kind].records[0].records[0] = row;
    let writes = 0;
    await assert.rejects(importRecovery({ register, document, facilities: { sql: { import() { writes++; } } } }), message);
    assert.equal(writes, 0);
  }
  const reply = storedComment("reply", { root: "other", replyTo: storedComment("parent").id, inReplyTo: "https://example.test/object/parent" });
  assert.doesNotThrow(() => validateInteractionRows("comments", [reply]));
});

test("every recovery entrance refuses a reference to a row the document does not hold", async () => {
  const parent = storedComment("parent");
  const reply = storedComment("reply", { replyTo: parent.id, inReplyTo: parent.objectId });
  const parentAuthor = { id: parent.authorId, source: parent.source, identifier: parent.identifier, name: null };
  const replyAuthor = { id: reply.authorId, source: reply.source, identifier: reply.identifier, name: null };
  const like = storedReaction("liker");
  const liker = { id: like.authorId, source: like.source, identifier: like.identifier, name: null };
  const threaded = () => exportSqlRecovery({ register, snapshot: [
    { kind: "visitor-identities", layer: 0, rows: [author, parentAuthor, replyAuthor, liker, followerIdentity] },
    { kind: "comments", layer: 0, rows: [comment, parent, reply] },
    { kind: "reactions", layer: 0, rows: [like] },
    { kind: "followers", layer: 0, rows: [follower] },
    { kind: "deliveries", layer: 0, rows: [delivery] },
  ] });
  const complete = await threaded();
  await importRecovery({ register, document: complete, facilities: { sql: new InMemoryRecoveryFacility() } });
  assert.ok(sqlInsertStatements(register, await importSqlRecovery({ register, document: complete, existing: false })).length > 0);

  for (const [name, change, message] of [
    ["visitor identities emptied", (document) => { document.entries["visitor-identities"].records[0].records = []; }, /reactions .* names author|comments .* names author/],
    ["only the reaction's author removed", (document) => {
      const records = document.entries["visitor-identities"].records[0];
      records.records = records.records.filter(({ id }) => id !== like.authorId);
    }, /reactions .* names author/],
    ["only the follower's identity removed", (document) => {
      const records = document.entries["visitor-identities"].records[0];
      records.records = records.records.filter(({ id }) => id !== follower.id);
    }, /followers .* is not among the visitor identities/],
    ["the parent comment removed", (document) => {
      const records = document.entries.comments.records[0];
      records.records = records.records.filter(({ id }) => id !== parent.id);
    }, /replies to .*, which is not among the comments/],
  ]) {
    const document = await threaded();
    change(document);
    let writes = 0;
    await assert.rejects(importRecovery({ register, document, facilities: { sql: { import() { writes++; } } } }), message, name);
    assert.equal(writes, 0, name);
    const memory = new InMemoryRecoveryFacility();
    await assert.rejects(importRecovery({ register, document, facilities: { sql: memory } }), message, name);
    assert.deepEqual(memory.snapshot(), {}, name);
    await assert.rejects(importSqlRecovery({ register, document, existing: false }), message, name);

    const plan = structuredClone(await importSqlRecovery({ register, document: complete, existing: false }));
    const planned = (kind) => plan.writes.find((write) => write.kind === kind);
    for (const kind of ["visitor-identities", "comments"]) {
      planned(kind).rows = document.entries[kind].records[0].records;
    }
    await assert.rejects(validateSqlPlan(register, plan), message, name);
    assert.throws(() => sqlInsertStatements(register, plan), message, name);
    const client = new DatabaseSync(":memory:");
    try {
      await migrate(database(client));
      assert.throws(() => writeSqlPlan(client, plan, register), message, name);
      for (const table of ["visitor_identities", "comments", "reactions", "followers"]) {
        assert.equal(client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, `${name}: ${table}`);
      }
    } finally {
      client.close();
    }
  }
});
