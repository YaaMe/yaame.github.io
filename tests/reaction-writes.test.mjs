import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../src/services/interactions/schema.ts";
import { countReactions, insertReaction, withdrawReaction } from "../src/integrations/activitypub/store/reaction-rows.ts";
import { SOURCES, identityId, reactionId } from "../src/lib/interactions/key-scheme.ts";
import { storedReaction } from "./fixtures/interactions.mjs";
import { testDatabase } from "./fixtures/databases.mjs";

for (const host of ["node", "d1"]) {
  test(`${host}: a failed reaction insert leaves its identity for a later retry`, async (context) => {
    const { database, execute, rows } = await testDatabase(context, host);
    await migrate(database);
    const reaction = storedReaction("retry");
    await execute("CREATE TRIGGER refuse_reaction BEFORE INSERT ON reactions BEGIN SELECT RAISE(ABORT, 'injected reaction failure'); END");
    await assert.rejects(insertReaction(database, reaction), (error) => {
      assert.match(error.cause?.message ?? "", /injected reaction failure/);
      return true;
    });
    assert.deepEqual((await rows("SELECT id FROM visitor_identities")).map(({ id }) => id), [reaction.authorId]);
    assert.deepEqual(await rows("SELECT * FROM reactions"), []);
    await execute("DROP TRIGGER refuse_reaction");
    assert.equal(await insertReaction(database, reaction), true);
    assert.equal((await rows("SELECT * FROM visitor_identities")).length, 1);
    assert.deepEqual((await rows("SELECT id FROM reactions")).map(({ id }) => id), [reaction.id]);
  });

  test(`${host}: a redelivered or concurrently delivered reaction is stored and counted once`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const like = storedReaction("one");
    assert.deepEqual((await Promise.all([insertReaction(database, like), insertReaction(database, like)])).sort(), [false, true]);
    assert.equal(await insertReaction(database, { ...like, receivedAt: "2026-10-11T00:00:00Z" }), false);
    assert.equal((await rows("SELECT * FROM reactions")).length, 1);
    assert.equal((await rows("SELECT * FROM reactions"))[0].received_at, like.receivedAt);
    assert.equal((await rows("SELECT * FROM visitor_identities")).length, 1);
    assert.deepEqual(await countReactions(database, ["example"]), new Map([["example", { likes: 1, shares: 0 }]]));
  });

  test(`${host}: stored reactions keep their raw object URL and every id input`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const boost = storedReaction("raw", { kind: "Announce", objectId: "https://YAAME.dev:443/users/yaame/notes/example" });
    assert.equal(boost.target, "example");
    assert.equal(await insertReaction(database, boost), true);
    const [saved] = await rows("SELECT * FROM reactions");
    assert.deepEqual({ ...saved }, {
      id: boost.id, source: SOURCES.activitypub, identifier: boost.identifier, author_id: boost.authorId,
      activity_id: boost.activityId, object_id: boost.objectId, target: "example", kind: "Announce",
      received_at: boost.receivedAt, undone_at: null,
    });
    assert.deepEqual((await rows("SELECT * FROM visitor_identities")).map((row) => ({ ...row })), [{ id: boost.authorId, source: SOURCES.activitypub, identifier: boost.identifier, name: null }]);
  });

  test(`${host}: a reaction whose stored inputs disagree is refused without writing`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const like = storedReaction("valid");
    const other = storedReaction("other");
    for (const invalid of [
      { ...like, id: other.id },
      { ...like, id: reactionId({ ...like, activityId: "https://example.test/activity/elsewhere" }) },
      { ...like, authorId: other.authorId },
      { ...like, identifier: other.identifier },
      { ...like, activityId: "https://example.test/activity/elsewhere" },
      { ...like, activityId: "https://other.example/activity/valid", id: reactionId({ ...like, activityId: "https://other.example/activity/valid" }) },
      { ...like, activityId: "ftp://example.test/activity/valid" },
      { ...like, objectId: "ftp://yaame.dev/users/yaame/notes/example" },
      { ...like, target: "https://yaame.dev/users/yaame/notes/example" },
      { ...like, target: "" },
      { ...like, target: "other" },
      { ...like, objectId: "https://yaame.dev/users/yaame/notes/other" },
      { ...like, objectId: "https://elsewhere.example/users/yaame/notes/example" },
      { ...like, objectId: "http://yaame.dev/users/yaame/notes/example" },
      { ...like, objectId: "https://yaame.dev/users/yaame/notes/example?query" },
      { ...like, receivedAt: "yesterday" },
      { ...like, receivedAt: "2026-10-10" },
      { ...like, undoneAt: "not a time" },
      { ...like, kind: "Dislike" },
      { ...like, source: SOURCES.github, identifier: "123", authorId: identityId(SOURCES.github, "123") },
      storedReaction("valid", { identifier: "HTTPS://EXAMPLE.TEST:443/users/valid" }),
    ]) assert.equal(await insertReaction(database, invalid), false, JSON.stringify(invalid));
    assert.deepEqual(await rows("SELECT * FROM reactions"), []);
    assert.deepEqual(await rows("SELECT * FROM visitor_identities"), []);
  });

  test(`${host}: Undo withdraws exactly the reaction its signer names`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const mine = storedReaction("mine");
    const theirs = storedReaction("theirs");
    const myBoost = storedReaction("mine", { activityId: "https://example.test/activity/mine-boost", kind: "Announce" });
    for (const reaction of [mine, theirs, myBoost]) assert.equal(await insertReaction(database, reaction), true);
    const undo = (identifier, activityId) => withdrawReaction(database, { source: SOURCES.activitypub, identifier, activityId });

    assert.equal(await undo(theirs.identifier, mine.activityId), false);
    assert.equal(await undo("not a URL", mine.activityId), false);
    assert.equal(await undo(mine.identifier, "not a URL"), false);
    assert.equal((await rows("SELECT * FROM reactions WHERE undone_at IS NOT NULL")).length, 0);

    assert.equal(await undo(mine.identifier, "HTTPS://EXAMPLE.TEST:443/activity/mine"), true);
    assert.deepEqual((await rows("SELECT id FROM reactions WHERE undone_at IS NOT NULL")).map(({ id }) => id), [mine.id]);
    assert.equal(await undo(mine.identifier, mine.activityId), false);
    assert.deepEqual(await countReactions(database, ["example"]), new Map([["example", { likes: 1, shares: 1 }]]));
    assert.equal(await insertReaction(database, mine), false);
    assert.deepEqual((await countReactions(database, ["example"])).get("example"), { likes: 1, shares: 1 });
  });

  test(`${host}: a person counts once per kind and content however many reactions they hold`, async (context) => {
    const { database } = await testDatabase(context, host);
    await migrate(database);
    const first = storedReaction("twice");
    const second = storedReaction("twice", { activityId: "https://example.test/activity/twice-again" });
    const elsewhere = storedReaction("twice", { activityId: "https://example.test/activity/twice-elsewhere", target: "other" });
    for (const reaction of [first, second, elsewhere]) assert.equal(await insertReaction(database, reaction), true);
    assert.deepEqual(await countReactions(database, ["example", "other"]), new Map([
      ["example", { likes: 1, shares: 0 }],
      ["other", { likes: 1, shares: 0 }],
    ]));
    assert.equal(await withdrawReaction(database, { source: SOURCES.activitypub, identifier: first.identifier, activityId: first.activityId }), true);
    assert.deepEqual((await countReactions(database, ["example"])).get("example"), { likes: 1, shares: 0 });
    assert.equal(await withdrawReaction(database, { source: SOURCES.activitypub, identifier: second.identifier, activityId: second.activityId }), true);
    assert.deepEqual(await countReactions(database, ["example", "other"]), new Map([["other", { likes: 1, shares: 0 }]]));
  });

  test(`${host}: counts group by content identifier across more targets than one query may bind`, async (context) => {
    const { database } = await testDatabase(context, host);
    await migrate(database);
    const targets = Array.from({ length: 205 }, (_, i) => `post-${i}`);
    for (const i of [0, 99, 100, 204]) {
      await insertReaction(database, storedReaction(`like-${i}`, { target: targets[i] }));
      await insertReaction(database, storedReaction(`boost-${i}`, { target: targets[i], kind: "Announce" }));
    }
    await insertReaction(database, storedReaction("undone", { target: targets[0], undoneAt: "2026-10-11T00:00:00Z" }));
    const tally = await countReactions(database, targets);
    assert.deepEqual([...tally.keys()].sort(), [targets[0], targets[100], targets[204], targets[99]].sort());
    for (const target of tally.keys()) assert.deepEqual(tally.get(target), { likes: 1, shares: 1 });
    assert.deepEqual(await countReactions(database, []), new Map());
  });
}
