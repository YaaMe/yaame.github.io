/**
 * Shipped migrations are history: a database that ran one keeps its shape, so
 * its text may never change. New migrations are appended after them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { migrate, schemaBootstrapStatements } from "../src/integrations/activitypub/store/schema.ts";

// sha256 of each shipped version's statements, as JSON, in order.
const SHIPPED = [
  "f5c46064be0b12489dde632ccf631bfe2316bf0a2f396d8e06958f324101dc3f",
  "764ce91d9c152e4ce4deb7e413fac57535380d877436e3808fa7b16dc813fd8c",
  "b94634f2663d141c76bfeabb6e476374db9e3efc886c47e51e7b328d70f0bf48",
  "4f1f38b124099efa0a9fdcaa69b67097eb8df43903f324101c7c6dc070cb5f6a",
  "ef9971c0a20034abe278f12c01810423542afa40629111bb7b8e856dd872f762",
  "5c8b4c5feedf604fb5eb10058870035985deaaa9e2ab88631c84ed8b6bbc04ee",
  "aa1004cd02f7b5c84e49a7dad58a1a11847f37f9b3db8b9f5a9643151adc048c",
  "51776d0bfbe527e1eed97f25a438931c0a0fc32ecc2e5441497ea309e2a80bd7",
  "890dd8b62bd48769aedc977e39ea2cfc450cb76820f54d89fafe3590f483876e",
];

const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const MIGRATIONS_TABLE = 'CREATE TABLE IF NOT EXISTS "migrations" ("version" INTEGER PRIMARY KEY, "applied_at" TEXT NOT NULL)';
const versionRow = (version) => new RegExp(`^INSERT INTO "migrations" \\("version", "applied_at"\\) VALUES \\(${version}, '\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z'\\)$`);

// What migrate() applies to an empty database, one batch per version.
async function appliedFromEmpty() {
  const created = [];
  const batches = [];
  await migrate({
    run: async (query) => { created.push(query.queryChunks.map((chunk) => chunk.value).flat().join("")); },
    all: async () => [{ version: null }],
    atomic: async (statements) => { batches.push(statements); },
  });
  return { created, batches };
}

test("every shipped migration keeps its exact text, in its place", async () => {
  const { created, batches } = await appliedFromEmpty();
  assert.deepEqual(created, [MIGRATIONS_TABLE]);
  assert.ok(batches.length >= SHIPPED.length);
  batches.forEach((batch, version) => assert.match(batch[0], versionRow(version)));
  assert.deepEqual(batches.slice(0, SHIPPED.length).map((batch) => sha256(batch.slice(1))), SHIPPED);
});

test("the bootstrap creates the migrations table, applies every migration in order and records each version", async () => {
  const { batches } = await appliedFromEmpty();
  const bootstrap = schemaBootstrapStatements();
  const migrations = batches.flatMap((batch) => batch.slice(1));
  assert.equal(bootstrap[0], MIGRATIONS_TABLE);
  assert.deepEqual(bootstrap.slice(1, 1 + migrations.length), migrations);
  const recorded = bootstrap.slice(1 + migrations.length);
  assert.equal(recorded.length, batches.length);
  const appliedAt = recorded[0].match(/'([^']+)'\)$/)[1];
  recorded.forEach((statement, version) =>
    assert.equal(statement, `INSERT OR IGNORE INTO "migrations" ("version", "applied_at") VALUES (${version}, '${appliedAt}')`));
});
