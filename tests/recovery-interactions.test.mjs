import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import registerData from "../src/data.config.json" with { type: "json" };
import { exportSqlRecovery, importSqlRecovery, sqlInsertStatements, validateSqlPlan } from "../scripts/recovery-sql.mjs";
import { writeSqlPlan } from "../scripts/platform/node/sqlite.mjs";
import { importRecovery, InMemoryRecoveryFacility } from "../src/lib/recovery.ts";
import { migrate } from "../src/integrations/activitypub/store/schema.ts";
import { database } from "../src/platform/node/database.ts";
import { storedComment } from "./fixtures/interactions.mjs";
import { commentId } from "../src/lib/interactions/key-scheme.ts";
import { validateInteractionRows } from "../src/lib/interactions/records.ts";

const register = { "visitor-identities": registerData["visitor-identities"], comments: registerData.comments };
const comment = storedComment("recovery");
const author = { id: comment.authorId, source: comment.source, identifier: comment.identifier, name: "Cached name" };

async function exported() {
  return exportSqlRecovery({ register, snapshot: [
    { kind: "visitor-identities", layer: 0, rows: [author] },
    { kind: "comments", layer: 0, rows: [comment] },
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
    ["reactions", { activityId: "reaction-1", objectId: "object-1", actorId: "actor-1", kind: "Like", receivedAt: "2026-10-13", undoneAt: null }, "actorId"],
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

test("recovery version 1 is refused before any facility can write", async () => {
  const document = await exported();
  document.version = 1;
  let writes = 0;
  await assert.rejects(importRecovery({ register, document, facilities: { sql: { import() { writes++; } } } }), /unsupported recovery format version: 1; expected 2.*Older exports/);
  assert.equal(writes, 0);
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
      assert.equal(client.prepare("SELECT COUNT(*) AS count FROM visitor_identities").get().count, 0);
    } finally {
      client.close();
    }
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
