/**
 * Regression for #75: followers were one KV list, read, changed and written
 * back, so two Follows processed close together kept only one of them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../src/services/interactions/schema.ts";
import { listFollowers, removeFollower, removeFollowersAtInbox, upsertFollower } from "../src/persistence/interactions/follower-rows.ts";
import { SOURCES, identityId } from "../src/models/interactions/key-scheme.ts";
import { storedFollower } from "./fixtures/interactions.mjs";
import { testDatabase } from "./fixtures/databases.mjs";

const ids = async (rows) => (await rows("SELECT identifier FROM followers ORDER BY identifier")).map((row) => row.identifier);
const AP = SOURCES.activitypub;
// A source with no delivery addresses, standing in for a future one such as a GitHub subscriber.
const subscriber = (id, extra = {}) => storedFollower("unused", { source: SOURCES.github, identifier: id, inbox: null, sharedInbox: null, followId: null, ...extra });

for (const host of ["node", "d1"]) {
  test(`${host}: two concurrent Follows from different actors both remain`, async (context) => {
    const { database, concurrent, rows } = await testDatabase(context, host);
    await migrate(database);
    const one = storedFollower("one");
    const two = storedFollower("two");
    assert.deepEqual(await Promise.all([upsertFollower(database, one), upsertFollower(concurrent, two)]), [true, true]);
    assert.deepEqual(await ids(rows), [one.identifier, two.identifier]);
    assert.deepEqual((await rows("SELECT id FROM visitor_identities ORDER BY id")).map((row) => row.id), [one.id, two.id].sort());
  });

  test(`${host}: a repeated Follow updates the inbox without a second row`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const first = storedFollower("mover");
    assert.equal(await upsertFollower(database, first), true);
    const moved = storedFollower("mover", {
      inbox: "https://example.test/users/mover/new-inbox",
      sharedInbox: null,
      followId: "https://example.test/follows/mover-again",
      followedAt: "2026-10-12T00:00:00Z",
    });
    assert.equal(await upsertFollower(database, moved), true);
    const saved = await rows("SELECT * FROM followers");
    assert.deepEqual(saved.map((row) => ({ ...row })), [{
      id: first.id,
      source: AP,
      identifier: first.identifier,
      inbox: moved.inbox,
      shared_inbox: null,
      follow_id: moved.followId,
      followed_at: first.followedAt,
    }]);
    assert.equal((await rows("SELECT * FROM visitor_identities")).length, 1);
  });

  test(`${host}: an Undo removes only the signer's row`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const leaving = storedFollower("leaving");
    const staying = storedFollower("staying");
    for (const follower of [leaving, staying]) await upsertFollower(database, follower);
    assert.equal(await removeFollower(database, AP, leaving.identifier), true);
    assert.equal(await removeFollower(database, AP, leaving.identifier), false);
    assert.equal(await removeFollower(database, AP, "https://example.test/users/nobody"), false);
    assert.deepEqual(await ids(rows), [staying.identifier]);
    assert.equal((await rows("SELECT * FROM visitor_identities")).length, 2);
  });

  test(`${host}: a written-off inbox removes only the followers the delivery named`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const gone = storedFollower("gone");
    const neighbour = storedFollower("neighbour");
    // Publishes the same inbox as its own; it was not a recipient of the failed delivery.
    const copier = storedFollower("copier", { inbox: gone.inbox });
    const moved = storedFollower("moved", { inbox: "https://example.test/users/moved/new-inbox" });
    for (const follower of [gone, neighbour, copier, moved]) await upsertFollower(database, follower);
    assert.deepEqual(await removeFollowersAtInbox(database, AP, [gone.identifier], gone.sharedInbox), []);
    assert.deepEqual(await removeFollowersAtInbox(database, SOURCES.github, [gone.identifier], gone.inbox), []);
    assert.deepEqual(await removeFollowersAtInbox(database, AP, [moved.identifier], "https://example.test/users/moved/inbox"), []);
    assert.deepEqual(await removeFollowersAtInbox(database, AP, [], gone.inbox), []);
    assert.deepEqual(await removeFollowersAtInbox(database, AP, ["not a url", gone.identifier], gone.inbox), [gone.identifier]);
    assert.deepEqual(await ids(rows), [copier.identifier, moved.identifier, neighbour.identifier]);
  });

  test(`${host}: a write-off naming more followers than one statement can bind removes them all`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const shared = "https://example.test/relay/inbox";
    const named = Array.from({ length: 250 }, (_, index) => storedFollower(`many-${index}`, { inbox: shared }));
    const kept = storedFollower("kept", { inbox: shared });
    for (const follower of [...named, kept]) await upsertFollower(database, follower);
    const removed = await removeFollowersAtInbox(database, AP, named.map(({ identifier }) => identifier), shared);
    assert.deepEqual(removed.sort(), named.map(({ identifier }) => identifier).sort());
    assert.deepEqual(await ids(rows), [kept.identifier]);
  });

  test(`${host}: a follower and its identity are written together or not at all`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const atomic = database.atomic;
    database.atomic = (statements) => atomic([statements[0], "SELECT json('injected failure')", ...statements.slice(1)]);
    await assert.rejects(upsertFollower(database, storedFollower("half")), /malformed JSON/);
    assert.equal((await rows("SELECT * FROM visitor_identities")).length, 0);
    assert.equal((await rows("SELECT * FROM followers")).length, 0);
    database.atomic = atomic;
    assert.equal(await upsertFollower(database, storedFollower("whole", { identifier: "https://example.test/users/o'brien" })), true);
    assert.deepEqual((await rows("SELECT identifier FROM followers")).map(({ identifier }) => identifier), ["https://example.test/users/o'brien"]);
  });

  test(`${host}: followers are listed per source, newest first with the id as tie-breaker`, async (context) => {
    const { database } = await testDatabase(context, host);
    await migrate(database);
    const old = storedFollower("old", { followedAt: "2026-10-01T00:00:00Z" });
    const tiedA = storedFollower("tied-a", { followedAt: "2026-10-05T00:00:00Z" });
    const tiedB = storedFollower("tied-b", { followedAt: "2026-10-05T00:00:00Z" });
    const other = subscriber("123", { followedAt: "2026-10-09T00:00:00Z" });
    for (const follower of [old, tiedB, tiedA, other]) assert.equal(await upsertFollower(database, follower), true);
    const tied = [tiedA, tiedB].sort((left, right) => left.id > right.id ? -1 : 1);
    assert.deepEqual((await listFollowers(database, AP)).map(({ identifier }) => identifier), [...tied, old].map(({ identifier }) => identifier));
    assert.deepEqual(await listFollowers(database, AP).then((list) => list[2]), {
      identifier: old.identifier, inbox: old.inbox, sharedInbox: old.sharedInbox,
    });
    assert.deepEqual(await listFollowers(database, SOURCES.github), [{ identifier: "123", inbox: null, sharedInbox: null }]);
  });

  test(`${host}: a follower whose stored inputs disagree is refused without writing`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const valid = storedFollower("valid");
    for (const invalid of [
      { ...valid, id: storedFollower("other").id },
      { ...valid, identifier: storedFollower("other").identifier },
      { ...valid, id: identityId(AP, "HTTPS://EXAMPLE.TEST:443/users/valid"), identifier: "HTTPS://EXAMPLE.TEST:443/users/valid" },
      { ...valid, identifier: "ftp://example.test/users/valid" },
      { ...valid, source: "mastodon" },
      { ...valid, source: SOURCES.github },
      subscriber("123", { inbox: "https://example.test/inbox" }),
      subscriber("123", { sharedInbox: "https://example.test/inbox" }),
      subscriber("123", { followId: "https://example.test/follows/1" }),
      { ...subscriber("123"), identifier: "not-a-number" },
      { ...valid, inbox: "ftp://example.test/users/valid/inbox" },
      { ...valid, inbox: null },
      { ...valid, sharedInbox: "not a url" },
      { ...valid, followId: "not a url" },
      { ...valid, followedAt: "2026-10-10" },
    ]) {
      assert.equal(await upsertFollower(database, invalid), false, JSON.stringify(invalid));
    }
    assert.equal((await rows("SELECT * FROM followers")).length, 0);
    assert.equal((await rows("SELECT * FROM visitor_identities")).length, 0);
    assert.equal(await upsertFollower(database, { ...valid, sharedInbox: null, followId: null }), true);
    assert.equal(await upsertFollower(database, subscriber("00123")), true);
    assert.deepEqual((await rows("SELECT source, identifier, inbox FROM followers WHERE source = 'github'")).map((row) => ({ ...row })), [
      { source: SOURCES.github, identifier: "00123", inbox: null },
    ]);
  });
}
