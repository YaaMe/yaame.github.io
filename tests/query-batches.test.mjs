/**
 * Where each reader splits a long id list. D1 refuses a statement binding more
 * than 100 parameters, and its free plan allows fifty queries per invocation,
 * so both the size of a batch and the number of queries are the contract.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../src/integrations/activitypub/store/schema.ts";
import { countReactions, insertReaction } from "../src/integrations/activitypub/store/reaction-rows.ts";
import { removeFollowersAtInbox, upsertFollower } from "../src/integrations/activitypub/store/follower-rows.ts";
import { queryBatches } from "../src/integrations/activitypub/store/query-batches.ts";
import { SOURCES } from "../src/lib/interactions/key-scheme.ts";
import { storedComment, storedFollower, storedReaction } from "./fixtures/interactions.mjs";
import { testDatabase } from "./fixtures/databases.mjs";
import { inboxHarness } from "./fixtures/inbox.mjs";

function queries(database, method) {
  const original = database[method];
  const counter = { calls: 0 };
  database[method] = (...args) => {
    counter.calls += 1;
    return original.apply(database, args);
  };
  return counter;
}

const names = (prefix, length) => Array.from({ length }, (_, index) => `${prefix}-${index}`);

test("a batch fills what the statement leaves of D1's hundred parameters, and a budget with no room is refused", () => {
  const values = names("value", 201);
  assert.deepEqual(queryBatches([], 0), []);
  assert.deepEqual(queryBatches(values, 0).map((batch) => batch.length), [100, 100, 1]);
  assert.deepEqual(queryBatches(values, 1).map((batch) => batch.length), [99, 99, 3]);
  assert.equal(queryBatches(values, 99).length, 201);
  assert.deepEqual(queryBatches(values, 2).flat(), values);
  for (const reserved of [100, 101, -1, 1.5, Number.NaN]) assert.throws(() => queryBatches(values, reserved), RangeError);
});

for (const host of ["node", "d1"]) {
  test(`${host}: reaction counts bind up to 100 targets per query`, async (context) => {
    const { database } = await testDatabase(context, host);
    await migrate(database);
    const targets = names("post", 101);
    for (const index of [0, 99, 100]) await insertReaction(database, storedReaction(`like-${index}`, { target: targets[index] }));
    const select = queries(database, "select");

    assert.deepEqual(await countReactions(database, []), new Map());
    assert.equal(select.calls, 0);
    assert.deepEqual([...(await countReactions(database, targets.slice(0, 100))).keys()].sort(), [targets[0], targets[99]].sort());
    assert.equal(select.calls, 1);
    assert.deepEqual([...(await countReactions(database, targets)).keys()].sort(), [targets[0], targets[99], targets[100]].sort());
    assert.equal(select.calls, 3);
  });

  test(`${host}: an inbox write-off binds up to 98 follower ids per statement beside the source and the inbox`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const shared = "https://example.test/relay/inbox";
    const named = names("batched", 99).map((name) => storedFollower(name, { inbox: shared }));
    for (const follower of named) await upsertFollower(database, follower);
    const remove = queries(database, "delete");

    assert.deepEqual(await removeFollowersAtInbox(database, SOURCES.activitypub, [], shared), []);
    assert.equal(remove.calls, 0);
    const first = named.slice(0, 98).map(({ identifier }) => identifier);
    assert.deepEqual((await removeFollowersAtInbox(database, SOURCES.activitypub, first, shared)).sort(), [...first].sort());
    assert.equal(remove.calls, 1);
    const all = named.map(({ identifier }) => identifier);
    assert.deepEqual(await removeFollowersAtInbox(database, SOURCES.activitypub, all, shared), [named[98].identifier]);
    assert.equal(remove.calls, 3);
    assert.equal((await rows("SELECT * FROM followers")).length, 0);
  });
}

test("node: reply counts bind up to 99 roots per query beside the source, withdrawals up to 100", async (t) => {
  const inbox = await inboxHarness(t);
  const roots = names("root", 101);
  for (const index of [0, 98, 99, 100]) {
    await inbox.insertComment(inbox.database, storedComment(`live-${index}`, { root: roots[index] }));
    await inbox.insertComment(inbox.database, storedComment(`gone-${index}`, { root: roots[index], deletedAt: "2026-10-19T00:00:00Z" }));
  }
  const select = queries(inbox.database, "select");
  const keys = async (map) => [...(await map).keys()].sort();

  assert.deepEqual(await inbox.replyCounts([]), new Map());
  assert.deepEqual(await inbox.withdrawnMany([]), new Map());
  assert.equal(select.calls, 0);

  assert.deepEqual(await keys(inbox.replyCounts(roots.slice(0, 99))), [roots[0], roots[98]].sort());
  assert.equal(select.calls, 1);
  assert.deepEqual(await keys(inbox.replyCounts(roots.slice(0, 100))), [roots[0], roots[98], roots[99]].sort());
  assert.equal(select.calls, 3);

  assert.deepEqual(await keys(inbox.withdrawnMany(roots.slice(0, 100))), [roots[0], roots[98], roots[99]].sort());
  assert.equal(select.calls, 4);
  const withdrawn = await inbox.withdrawnMany(roots);
  assert.deepEqual([...withdrawn.keys()].sort(), [roots[0], roots[98], roots[99], roots[100]].sort());
  assert.equal(select.calls, 6);
  for (const root of withdrawn.keys()) assert.equal(withdrawn.get(root).size, 1);
});
