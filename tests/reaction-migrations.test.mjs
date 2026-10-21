import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, schemaBootstrapStatements } from "../src/services/interactions/schema.ts";
import { insertReaction } from "../src/integrations/activitypub/store/reaction-rows.ts";
import { insertComment } from "../src/integrations/activitypub/store/write-comment.ts";
import { storedComment, storedReaction } from "./fixtures/interactions.mjs";
import { LATEST_MIGRATION, testDatabase } from "./fixtures/databases.mjs";

const approved = [
  {
    activity_id: "https://activitypub.academy/users/banules_kuraks/statuses/117291094176571436/activity",
    actor_id: "https://activitypub.academy/users/banules_kuraks",
    object_id: "https://yaame.dev/users/yaame/notes/2025-year",
    kind: "Announce",
    received_at: "2026-09-18T08:27:52.904Z",
    undone_at: "2026-09-18T08:27:53.251Z",
  },
  {
    activity_id: "https://activitypub.academy/users/banules_kuraks#likes/1690",
    actor_id: "https://activitypub.academy/users/banules_kuraks",
    object_id: "https://yaame.dev/users/yaame/notes/2025-year",
    kind: "Like",
    received_at: "2026-09-18T08:27:53.059Z",
    undone_at: "2026-09-18T08:27:59.604Z",
  },
];
const sqlValue = (value) => value === null ? "NULL" : `'${value}'`;
const legacyRow = (row) => `INSERT INTO reactions (activity_id, object_id, actor_id, kind, received_at, undone_at) VALUES (${
  [row.activity_id, row.object_id, row.actor_id, row.kind, row.received_at, row.undone_at].map(sqlValue).join(", ")})`;
const approvedRows = approved.map(legacyRow);
const unrelatedRow = legacyRow({
  activity_id: "https://test.example/like", object_id: "https://yaame.dev/users/yaame/notes/example",
  actor_id: "https://test.example/actor", kind: "Like", received_at: "2026-09-18", undone_at: null,
});

// Every migration up to and including the comments one: the migrations table, five single statements, then nine.
const BEFORE_REACTIONS = 1 + 5 + 9;
// The legacy fixture records versions 0 to 5; everything from the reactions migration on is still to run.
const REMAINING = LATEST_MIGRATION - 5;

async function legacyDatabase(context, host) {
  const fixture = await testDatabase(context, host);
  for (const statement of schemaBootstrapStatements().slice(0, BEFORE_REACTIONS)) await fixture.execute(statement);
  for (let version = 0; version < 6; version++) await fixture.execute(`INSERT INTO migrations VALUES (${version}, 'before')`);
  await insertComment(fixture.database, storedComment("kept"));
  return fixture;
}

const hasNewKey = async (rows) => (await rows("PRAGMA table_info(reactions)")).some((column) => column.name === "id" && column.pk === 1);
const version = async (rows) => (await rows("SELECT MAX(version) AS version FROM migrations"))[0].version;

for (const host of ["node", "d1"]) {
  test(`${host}: the legacy fixture stops exactly before the reactions migration`, async (context) => {
    const { rows } = await legacyDatabase(context, host);
    assert.ok((await rows("PRAGMA table_info(comments)")).some((column) => column.name === "id" && column.pk === 1));
    assert.ok((await rows("PRAGMA table_info(reactions)")).some((column) => column.name === "activity_id" && column.pk === 1));
  });

  test(`${host}: reactions deliberately have no database foreign keys`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    assert.deepEqual(await rows("PRAGMA foreign_key_list(reactions)"), []);
  });

  for (const [name, statements] of [["an empty table", []], ["exactly the two approved rows", approvedRows]]) {
    test(`${host}: the reactions migration accepts ${name}`, async (context) => {
      const { database, execute, rows } = await legacyDatabase(context, host);
      for (const statement of statements) await execute(statement);
      const comments = await rows("SELECT * FROM comments");
      assert.equal(await migrate(database), REMAINING);
      assert.deepEqual(await rows("SELECT * FROM reactions"), []);
      assert.ok(await hasNewKey(rows));
      assert.equal(await version(rows), LATEST_MIGRATION);
      assert.deepEqual(await rows("SELECT * FROM comments"), comments);
      assert.equal((await rows("SELECT name FROM sqlite_schema WHERE name = 'reactions_drop_guard'")).length, 0);
      assert.equal(await insertReaction(database, storedReaction("after")), true);
      assert.equal(await migrate(database), 0);
    });
  }

  test(`${host}: the reactions migration refuses every unapproved table and rolls back`, async (context) => {
    const { database, execute, rows } = await legacyDatabase(context, host);
    const snapshots = [
      ["an unrelated row", [unrelatedRow]],
      ["the approved Announce alone", [approvedRows[0]]],
      ["the approved Like alone", [approvedRows[1]]],
      ["both approved rows plus another", [...approvedRows, unrelatedRow]],
      ["the approved Announce twice", [approvedRows[0], approvedRows[0].replace("117291094176571436", "117291094176571437")]],
      ...approved.flatMap((row, index) => ["activity_id", "actor_id", "object_id", "kind", "received_at", "undone_at"].flatMap((column) => [
        [`row ${index + 1} with a different ${column}`, approved.map((each) => legacyRow(each === row ? { ...row, [column]: `${row[column]}-different` } : each))],
        ...(column === "undone_at" ? [[`row ${index + 1} not undone`, approved.map((each) => legacyRow(each === row ? { ...row, undone_at: null } : each))]] : []),
      ])),
      ...approved.map((row, index) => [`row ${index + 1} with its activity id normalised`, approved.map((each) => legacyRow(each === row ? { ...row, activity_id: row.activity_id.replace("https://activitypub.academy", "HTTPS://ACTIVITYPUB.ACADEMY:443") } : each))]),
      ["the Like without its fragment", approved.map((row) => legacyRow(row.kind === "Like" ? { ...row, activity_id: row.activity_id.replace("#likes/1690", "") } : row))],
      ["the two activity ids swapped", approved.map((row, index) => legacyRow({ ...row, activity_id: approved[1 - index].activity_id }))],
      ["the two kinds swapped", approved.map((row) => legacyRow({ ...row, kind: row.kind === "Like" ? "Announce" : "Like" }))],
    ];
    const comments = await rows("SELECT * FROM comments");
    for (const [name, statements] of snapshots) {
      await context.test(name, async () => {
        for (const statement of statements) await execute(statement);
        const before = await rows("SELECT * FROM reactions");
        await assert.rejects(migrate(database), /reactions_drop_requires_approved_snapshot/);
        assert.deepEqual(await rows("SELECT * FROM reactions"), before);
        assert.equal(await version(rows), 5);
        assert.equal((await rows("SELECT name FROM sqlite_schema WHERE name = 'reactions_drop_guard'")).length, 0);
        assert.deepEqual(await rows("SELECT * FROM comments"), comments);
        await execute("DELETE FROM reactions");
      });
    }
    assert.equal(await migrate(database), REMAINING);
    assert.ok(await hasNewKey(rows));
  });

  test(`${host}: failure after DROP restores the old reactions and migration marker`, async (context) => {
    const { database, execute, rows } = await legacyDatabase(context, host);
    for (const statement of approvedRows) await execute(statement);
    const before = await rows("SELECT * FROM reactions");
    const atomic = database.atomic;
    database.atomic = (statements) => atomic(statements.flatMap((statement) => statement === "DROP TABLE reactions"
      ? [statement, "SELECT json('injected failure')"] : [statement]));
    await assert.rejects(migrate(database), /malformed JSON/);
    assert.deepEqual(await rows("SELECT * FROM reactions"), before);
    assert.ok((await rows("PRAGMA table_info(reactions)")).some((column) => column.name === "activity_id" && column.pk === 1));
    assert.equal(await version(rows), 5);
    assert.equal((await rows("SELECT name FROM sqlite_schema WHERE name = 'reactions_drop_guard'")).length, 0);
    database.atomic = atomic;
    assert.equal(await migrate(database), REMAINING);
  });

  test(`${host}: a stale concurrent migration cannot drop a newly received reaction`, async (context) => {
    const { database, concurrent, rows } = await legacyDatabase(context, host);
    const firstGate = Promise.withResolvers();
    const secondGate = Promise.withResolvers();
    const bothReady = Promise.withResolvers();
    let attempts = 0;
    for (const [connection, gate] of [[database, firstGate], [concurrent, secondGate]]) {
      const atomic = connection.atomic;
      connection.atomic = async (statements) => {
        if (++attempts === 2) bothReady.resolve();
        await gate.promise;
        return atomic(statements);
      };
    }
    const first = migrate(database);
    const second = migrate(concurrent);
    await bothReady.promise;
    firstGate.resolve();
    assert.equal(await first, REMAINING);
    const reaction = storedReaction("between-migrations");
    assert.equal(await insertReaction(database, reaction), true);
    secondGate.resolve();
    assert.equal(await second, 0);
    assert.deepEqual((await rows("SELECT id FROM reactions")).map(({ id }) => id), [reaction.id]);
  });

  test(`${host}: a concurrent legacy writer either prevents the drop or fails without losing a row`, async (context) => {
    const { database, execute, rows, client, file } = await legacyDatabase(context, host);
    if (host === "node") {
      const writer = new DatabaseSync(file);
      context.after(() => writer.close());
      const original = client.exec.bind(client);
      let attempted = false;
      context.mock.method(client, "exec", (statement) => {
        if (statement === "DROP TABLE reactions") {
          attempted = true;
          assert.throws(() => writer.exec(unrelatedRow), /database is locked/);
        }
        return original(statement);
      });
      assert.equal(await migrate(database), REMAINING);
      assert.equal(attempted, true);
    } else {
      const outcomes = await Promise.allSettled([migrate(database), execute(unrelatedRow)]);
      assert.ok(outcomes.some((outcome) => outcome.status === "rejected"));
      if (outcomes[1].status === "fulfilled") {
        assert.equal(outcomes[0].status, "rejected");
        assert.equal((await rows("SELECT * FROM reactions"))[0].activity_id, "https://test.example/like");
        assert.equal(await version(rows), 5);
      } else {
        assert.equal((await rows("SELECT * FROM reactions")).length, 0);
      }
    }
  });
}
