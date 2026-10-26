import test from "node:test";
import assert from "node:assert/strict";
import { migrate, migrationLedgerStatement } from "../src/services/interactions/schema.ts";
import { MIGRATIONS } from "../src/migrations/history.ts";
import { upsertFollower } from "../src/persistence/interactions/follower-rows.ts";
import { storedFollower } from "./fixtures/interactions.mjs";
import { LATEST_MIGRATION, testDatabase } from "./fixtures/databases.mjs";

// #104: the failure table is appended after the followers and deliveries migrations.
const BEFORE_FAILURES = 9;

async function shippedDatabase(context, host) {
  const fixture = await testDatabase(context, host);
  for (const statement of [migrationLedgerStatement(), ...MIGRATIONS.slice(0, BEFORE_FAILURES).flat()]) {
    await fixture.execute(statement);
  }
  for (let version = 0; version < BEFORE_FAILURES; version++) await fixture.execute(`INSERT INTO migrations VALUES (${version}, 'before')`);
  await upsertFollower(fixture.database, storedFollower("kept"));
  return fixture;
}

for (const host of ["node", "d1"]) {
  test(`${host}: the appended migration adds an empty failure table and leaves every other row`, async (context) => {
    const { database, rows } = await shippedDatabase(context, host);
    assert.deepEqual(await rows("SELECT name FROM sqlite_schema WHERE name = 'failures'"), []);
    const before = await rows("SELECT * FROM followers");
    assert.equal(await migrate(database), LATEST_MIGRATION - BEFORE_FAILURES + 1);
    assert.deepEqual(await rows("SELECT * FROM failures"), []);
    assert.deepEqual(await rows("SELECT * FROM followers"), before);
    const columns = (await rows("PRAGMA table_info(failures)")).map(({ name, pk, notnull }) => [name, pk, notnull]);
    assert.deepEqual(columns, [["id", 1, 1], ["kind", 0, 1], ["subject", 0, 1], ["at", 0, 1], ["data", 0, 1]]);
    const index = (await rows("PRAGMA index_list(failures)")).find(({ name }) => name === "failures_by_subject");
    assert.equal(index?.unique, 1);
    assert.deepEqual((await rows("PRAGMA index_info(failures_by_subject)")).map(({ name }) => name), ["kind", "subject"]);
    assert.deepEqual(await rows("PRAGMA foreign_key_list(failures)"), []);
    assert.equal(await migrate(database), 0);
  });
}
