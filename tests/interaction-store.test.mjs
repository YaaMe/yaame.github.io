/**
 * The interaction database is opened and migrated once per process. A failed
 * migration is not remembered, so the next request tries again.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { schemaBootstrapStatements } from "../src/services/interactions/schema.ts";
import { LATEST_MIGRATION } from "./fixtures/databases.mjs";
import { inboxHarness } from "./fixtures/inbox.mjs";

const unapproved = "INSERT INTO reactions VALUES ('https://remote.example/likes/1', 'https://yaame.dev/users/yaame/notes/example', 'https://remote.example/users/friend', 'Like', '2026-10-19T00:00:00Z', NULL)";

// Every migration before the guarded reactions rebuild, plus a row its guard refuses.
function refusedDatabase(context) {
  const directory = mkdtempSync(join(tmpdir(), "blogu-store-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "interactions.sqlite");
  const client = new DatabaseSync(file);
  try {
    for (const statement of schemaBootstrapStatements().slice(0, 1 + 5 + 9)) client.exec(statement);
    for (let version = 0; version < 6; version++) client.exec(`INSERT INTO migrations VALUES (${version}, 'before')`);
    client.exec(unapproved);
  } finally {
    client.close();
  }
  return file;
}

test("a failed migration is retried on the next call, and a finished one is shared", async (t) => {
  const file = refusedDatabase(t);
  const inbox = await inboxHarness(t, { databaseUrl: file, openStore: false });

  const failed = inbox.store();
  assert.equal(inbox.store(), failed);
  await assert.rejects(failed, /reactions_drop_requires_approved_snapshot/);

  const retried = inbox.store();
  assert.notEqual(retried, failed);
  await assert.rejects(retried, /reactions_drop_requires_approved_snapshot/);

  const repair = new DatabaseSync(file);
  try {
    repair.exec("DELETE FROM reactions");
  } finally {
    repair.close();
  }

  const opened = inbox.store();
  const database = await opened;
  assert.equal(database, inbox.platform.db);
  assert.equal(inbox.store(), opened);
  const versions = await database.$client.prepare("SELECT version FROM migrations ORDER BY version").all();
  assert.deepEqual(versions.map(({ version }) => version), Array.from({ length: LATEST_MIGRATION + 1 }, (_, version) => version));
});
