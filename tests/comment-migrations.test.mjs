import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, schemaBootstrapStatements } from "../src/services/interactions/schema.ts";
import { insertComment } from "../src/persistence/interactions/write-comment.ts";
import { insertReaction } from "../src/persistence/interactions/reaction-rows.ts";
import { storedComment, storedReaction } from "./fixtures/interactions.mjs";
import { LATEST_MIGRATION, testDatabase } from "./fixtures/databases.mjs";

// The legacy fixture records versions 0 to 4; everything from the comments migration on is still to run.
const REMAINING = LATEST_MIGRATION - 4;

const oldRow = `INSERT INTO comments VALUES ('https://test.example/create', 'https://test.example/note', 'https://yaame.dev/users/yaame/notes/example', NULL, 'https://test.example/actor', '', '2026-09-18', '2026-09-18', '2026-09-18', NULL)`;
const approvedSnapshot = {
  activity_id: "https://activitypub.academy/users/banules_kuraks/statuses/117290977176624180/activity",
  object_id: "https://activitypub.academy/users/banules_kuraks/statuses/117290977176624180",
  actor_id: "https://activitypub.academy/users/banules_kuraks",
  published: "2026-09-18T07:57:59Z",
  deleted_at: "2026-09-18T09:25:26.283Z",
};
const approvedRow = `INSERT INTO comments VALUES ('${approvedSnapshot.activity_id}', '${approvedSnapshot.object_id}', 'https://yaame.dev/users/yaame/notes/example', NULL, '${approvedSnapshot.actor_id}', '', '${approvedSnapshot.published}', '2026-09-18', '${approvedSnapshot.deleted_at}', NULL)`;

async function legacyDatabase(context, host) {
  const fixture = await testDatabase(context, host);
  for (const statement of schemaBootstrapStatements().slice(0, 6)) await fixture.execute(statement);
  for (let version = 0; version < 5; version++) await fixture.execute(`INSERT INTO migrations VALUES (${version}, 'before')`);
  for (const [activity, kind, receivedAt, undoneAt] of [
    ["https://activitypub.academy/users/banules_kuraks/statuses/117291094176571436/activity", "Announce", "2026-09-18T08:27:52.904Z", "2026-09-18T08:27:53.251Z"],
    ["https://activitypub.academy/users/banules_kuraks#likes/1690", "Like", "2026-09-18T08:27:53.059Z", "2026-09-18T08:27:59.604Z"],
  ]) {
    await fixture.execute(`INSERT INTO reactions VALUES ('${activity}', 'https://yaame.dev/users/yaame/notes/2025-year', 'https://activitypub.academy/users/banules_kuraks', '${kind}', '${receivedAt}', '${undoneAt}')`);
  }
  return fixture;
}

for (const host of ["node", "d1"]) {
  test(`${host}: comment references deliberately have no database foreign keys`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    assert.deepEqual(await rows("PRAGMA foreign_key_list(comments)"), []);
  });

  test(`${host}: a populated bootstrap database needs no further migration`, async (context) => {
    const { database, execute, rows } = await testDatabase(context, host);
    for (const statement of schemaBootstrapStatements()) await execute(statement);
    await insertComment(database, storedComment("restored"));
    await insertReaction(database, storedReaction("restored"));
    const commentsBefore = await rows("SELECT * FROM comments");
    const identitiesBefore = await rows("SELECT * FROM visitor_identities");
    const reactionsBefore = await rows("SELECT * FROM reactions");
    assert.equal(await migrate(database), 0);
    assert.deepEqual((await rows("SELECT version FROM migrations ORDER BY version")).map(({ version }) => version), Array.from({ length: LATEST_MIGRATION + 1 }, (_, version) => version));
    assert.deepEqual(await rows("SELECT * FROM comments"), commentsBefore);
    assert.deepEqual(await rows("SELECT * FROM visitor_identities"), identitiesBefore);
    assert.deepEqual(await rows("SELECT * FROM reactions"), reactionsBefore);
    assert.equal(await migrate(database), 0);
  });

  test(`${host}: the appended migration accepts the approved row alone`, async (context) => {
    const { database, execute, rows } = await legacyDatabase(context, host);
    await execute(approvedRow);
    assert.equal(await migrate(database), REMAINING);
    assert.deepEqual(await rows("SELECT * FROM comments"), []);
    assert.ok((await rows("PRAGMA table_info(comments)")).some((column) => column.name === "id" && column.pk === 1));
    assert.equal((await rows("SELECT MAX(version) AS version FROM migrations"))[0].version, LATEST_MIGRATION);
    assert.equal(await migrate(database), 0);
  });

  test(`${host}: the appended migration refuses every unapproved row and rolls back`, async (context) => {
    const { database, execute, rows } = await legacyDatabase(context, host);
    const snapshots = [
      ["an unrelated withdrawn row", [oldRow]],
      ["an unrelated live row", [oldRow.replace("'2026-09-18', NULL)", "NULL, NULL)")]],
      ["the approved row plus another row", [approvedRow, oldRow]],
      ...Object.entries(approvedSnapshot).map(([column, value]) => [
        `a different ${column}`, [approvedRow.replace(`'${value}'`, `'${value}-different'`)],
      ]),
      ...["activity_id", "deleted_at"].map((column) => [
        `a null ${column}`, [approvedRow.replace(`'${approvedSnapshot[column]}'`, "NULL")],
      ]),
    ];
    for (const [name, statements] of snapshots) {
      await context.test(name, async () => {
        for (const statement of statements) await execute(statement);
        const before = await rows("SELECT * FROM comments");
        const reactions = await rows("SELECT * FROM reactions");
        await assert.rejects(migrate(database), /comments_drop_requires_approved_snapshot/);
        assert.deepEqual(await rows("SELECT * FROM comments"), before);
        assert.deepEqual(await rows("SELECT * FROM reactions"), reactions);
        assert.equal((await rows("SELECT MAX(version) AS version FROM migrations"))[0].version, 4);
        assert.equal((await rows("SELECT name FROM sqlite_schema WHERE name IN ('visitor_identities', 'comments_drop_guard')")).length, 0);
        await execute("DELETE FROM comments");
      });
    }
    assert.equal(await migrate(database), REMAINING);
    assert.ok((await rows("PRAGMA table_info(comments)")).some((column) => column.name === "id" && column.pk === 1));
    assert.equal(await migrate(database), 0);
  });

  test(`${host}: failure after DROP restores the old table and migration marker`, async (context) => {
    const { database, execute, rows } = await legacyDatabase(context, host);
    await execute(approvedRow);
    const before = await rows("SELECT * FROM comments");
    const atomic = database.atomic;
    database.atomic = (statements) => atomic(statements.flatMap((statement) => statement === "DROP TABLE comments"
      ? [statement, "SELECT json('injected failure')"] : [statement]));
    await assert.rejects(migrate(database), /malformed JSON/);
    assert.deepEqual(await rows("SELECT * FROM comments"), before);
    assert.ok((await rows("PRAGMA table_info(comments)")).some((column) => column.name === "activity_id" && column.pk === 1));
    assert.equal((await rows("SELECT MAX(version) AS version FROM migrations"))[0].version, 4);
    assert.equal((await rows("SELECT name FROM sqlite_schema WHERE name IN ('visitor_identities', 'comments_drop_guard')")).length, 0);
    database.atomic = atomic;
    assert.equal(await migrate(database), REMAINING);
  });

  test(`${host}: a stale concurrent migration cannot drop a newly received comment`, async (context) => {
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
    const comment = storedComment("between-migrations");
    await insertComment(database, comment);
    secondGate.resolve();
    assert.equal(await second, 0);
    assert.equal((await rows("SELECT id FROM comments"))[0].id, comment.id);
  });

  test(`${host}: a concurrent legacy writer either prevents the drop or fails without losing a row`, async (context) => {
    const { database, execute, rows, client, file } = await legacyDatabase(context, host);
    if (host === "node") {
      const writer = new DatabaseSync(file);
      context.after(() => writer.close());
      const original = client.exec.bind(client);
      let attempted = false;
      context.mock.method(client, "exec", (statement) => {
        if (statement === "DROP TABLE comments") {
          attempted = true;
          assert.throws(() => writer.exec(oldRow), /database is locked/);
        }
        return original(statement);
      });
      await migrate(database);
      assert.equal(attempted, true);
    } else {
      const outcomes = await Promise.allSettled([migrate(database), execute(oldRow)]);
      assert.ok(outcomes.some((outcome) => outcome.status === "rejected"));
      if (outcomes[1].status === "fulfilled") {
        assert.equal(outcomes[0].status, "rejected");
        assert.equal((await rows("SELECT * FROM comments"))[0].activity_id, "https://test.example/create");
        assert.equal((await rows("SELECT MAX(version) AS version FROM migrations"))[0].version, 4);
      } else {
        assert.equal((await rows("SELECT * FROM comments")).length, 0);
      }
    }
  });
}
