import test from "node:test";
import assert from "node:assert/strict";
import { migrate, schemaBootstrapStatements } from "../src/integrations/activitypub/store/schema.ts";
import { insertComment } from "../src/integrations/activitypub/store/write-comment.ts";
import { insertReaction } from "../src/integrations/activitypub/store/reaction-rows.ts";
import { upsertFollower } from "../src/integrations/activitypub/store/follower-rows.ts";
import { storedComment, storedFollower, storedReaction } from "./fixtures/interactions.mjs";
import { LATEST_MIGRATION, testDatabase } from "./fixtures/databases.mjs";

// Every migration through the reactions one: the migrations table, five single statements, nine, then six.
const SHIPPED = 1 + 5 + 9 + 6;

async function shippedDatabase(context, host) {
  const fixture = await testDatabase(context, host);
  for (const statement of schemaBootstrapStatements().slice(0, SHIPPED)) await fixture.execute(statement);
  for (let version = 0; version < 7; version++) await fixture.execute(`INSERT INTO migrations VALUES (${version}, 'before')`);
  await insertComment(fixture.database, storedComment("kept"));
  await insertReaction(fixture.database, storedReaction("kept"));
  return fixture;
}

for (const host of ["node", "d1"]) {
  test(`${host}: the shipped fixture has no followers or deliveries table yet`, async (context) => {
    const { rows } = await shippedDatabase(context, host);
    assert.deepEqual(await rows("SELECT name FROM sqlite_schema WHERE name IN ('followers', 'deliveries')"), []);
    assert.ok((await rows("PRAGMA table_info(reactions)")).some((column) => column.name === "id" && column.pk === 1));
  });

  test(`${host}: the appended migrations add empty followers and deliveries tables and leave every other row`, async (context) => {
    const { database, rows } = await shippedDatabase(context, host);
    const before = await Promise.all(["comments", "reactions", "visitor_identities"].map((table) => rows(`SELECT * FROM ${table}`)));
    assert.equal(await migrate(database), LATEST_MIGRATION - 6);
    assert.deepEqual(await rows("SELECT * FROM followers"), []);
    assert.deepEqual(await rows("SELECT * FROM deliveries"), []);
    assert.deepEqual(await Promise.all(["comments", "reactions", "visitor_identities"].map((table) => rows(`SELECT * FROM ${table}`))), before);
    const indexColumns = async (index) => (await rows(`PRAGMA index_info(${index})`)).map(({ name }) => name);
    assert.deepEqual(await indexColumns("followers_by_source"), ["source", "followed_at", "id"]);
    assert.deepEqual(await indexColumns("followers_by_inbox"), ["source", "inbox"]);
    assert.deepEqual(await indexColumns("deliveries_by_channel"), ["channel", "target"]);
    assert.equal(await upsertFollower(database, storedFollower("after")), true);
    assert.equal(await migrate(database), 0);
  });

  test(`${host}: followers and deliveries deliberately have no database foreign keys`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    assert.deepEqual(await rows("PRAGMA foreign_key_list(followers)"), []);
    assert.deepEqual(await rows("PRAGMA foreign_key_list(deliveries)"), []);
    // Owner decision: the federated-only columns are merely nullable. The rule
    // tying them to the source lives in the stored schema, not in the database.
    assert.deepEqual((await rows("SELECT sql FROM sqlite_schema WHERE name = 'followers'"))[0].sql.match(/\bCHECK\b/i), null);
  });
}
