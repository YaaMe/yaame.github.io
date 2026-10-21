/**
 * Regression for #76: the whole pending batch was recorded as delivered before
 * any of it was sent, so a send that threw left a post recorded and never sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../src/services/interactions/schema.ts";
import { enqueuedTargets } from "../src/integrations/activitypub/store/delivery-rows.ts";
import { deliverPending } from "../src/integrations/activitypub/delivery.ts";
import { CHANNELS, deliveryId } from "../src/lib/interactions/key-scheme.ts";

const AP = CHANNELS.activitypub;
import { testDatabase } from "./fixtures/databases.mjs";

const item = (target) => ({ target, activity: { id: `https://yaame.dev/users/yaame/notes/${target}#create` } });

// Records each send, and fails the ones named, as an enqueue that throws would.
function sender(failing = new Set()) {
  const sent = [];
  return {
    sent,
    send: async (activity) => {
      const target = activity.id.split("/").pop().replace("#create", "");
      if (failing.has(target)) throw new Error(`queue refused ${target}`);
      sent.push(target);
    },
  };
}

for (const host of ["node", "d1"]) {
  test(`${host}: the first run marks every existing post without sending any`, async (context) => {
    const { database, rows } = await testDatabase(context, host);
    await migrate(database);
    const first = sender();
    await deliverPending(database, AP, ["old-a", "old-b"].map(item), first.send);
    assert.deepEqual(first.sent, []);
    assert.deepEqual([...await enqueuedTargets(database, AP)].sort(), ["old-a", "old-b"]);
    assert.deepEqual((await rows("SELECT id FROM deliveries ORDER BY target")).map(({ id }) => id), [deliveryId(AP, "old-a"), deliveryId(AP, "old-b")]);

    const next = sender();
    await deliverPending(database, AP, ["new", "old-a", "old-b"].map(item), next.send);
    assert.deepEqual(next.sent, ["new"]);
  });

  test(`${host}: a failed enqueue leaves its post pending and the next run sends it once`, async (context) => {
    const { database } = await testDatabase(context, host);
    await migrate(database);
    await deliverPending(database, AP, [item("existing")], sender().send);

    const failing = sender(new Set(["second"]));
    const outcome = await deliverPending(database, AP, ["first", "second", "third", "existing"].map(item), failing.send);
    assert.deepEqual(failing.sent, ["first", "third"]);
    assert.deepEqual(outcome.failed.map(({ target }) => target), ["second"]);
    assert.match(String(outcome.failed[0].error), /queue refused second/);
    assert.deepEqual([...await enqueuedTargets(database, AP)].sort(), ["existing", "first", "third"]);

    const retry = sender();
    await deliverPending(database, AP, ["first", "second", "third", "existing"].map(item), retry.send);
    assert.deepEqual(retry.sent, ["second"]);

    const settled = sender();
    await deliverPending(database, AP, ["first", "second", "third", "existing"].map(item), settled.send);
    assert.deepEqual(settled.sent, []);
  });

  test(`${host}: a post is marked only once its own enqueue has resolved`, async (context) => {
    const { database } = await testDatabase(context, host);
    await migrate(database);
    await deliverPending(database, AP, [item("existing")], sender().send);
    const seenDuringSend = [];
    await deliverPending(database, AP, ["one", "two"].map(item), async () => {
      seenDuringSend.push([...await enqueuedTargets(database, AP)].sort());
    });
    assert.deepEqual(seenDuringSend, [["existing"], ["existing", "one"]]);
  });

  test(`${host}: a post whose id cannot be marked is never sent and later posts still go`, async (context) => {
    const { database } = await testDatabase(context, host);
    await migrate(database);
    await deliverPending(database, AP, [item("existing")], sender().send, new Set());
    const sent = [];
    const send = async (activity) => { sent.push(activity.id); };
    const posts = [
      { target: "2023/nested", activity: { id: "nested" } },
      { target: "later", activity: { id: "later" } },
    ];
    for (let run = 0; run < 3; run++) {
      const outcome = await deliverPending(database, AP, posts, send, new Set());
      assert.deepEqual(outcome.refused, ["2023/nested"]);
    }
    assert.deepEqual(sent, ["later"]);
    assert.deepEqual([...await enqueuedTargets(database, AP)].sort(), ["existing", "later"]);
  });

  test(`${host}: a post whose mark keeps failing is sent once, later posts still go, and the mark is retried`, async (context) => {
    const { database } = await testDatabase(context, host);
    await migrate(database);
    await deliverPending(database, AP, [item("existing")], sender().send, new Set());
    const atomic = database.atomic;
    database.atomic = (statements) => statements.some((statement) => statement.includes("'stuck'"))
      ? Promise.reject(new Error("mark refused")) : atomic(statements);
    const heldBack = new Set();
    const runs = [];
    for (let run = 0; run < 3; run++) {
      const each = sender();
      const outcome = await deliverPending(database, AP, ["stuck", "after"].map(item), each.send, heldBack);
      runs.push(each.sent);
      assert.deepEqual(outcome.unmarked.map(({ target }) => target), ["stuck"]);
    }
    assert.deepEqual(runs, [["stuck", "after"], [], []]);

    database.atomic = atomic;
    const settled = sender();
    const outcome = await deliverPending(database, AP, ["stuck", "after"].map(item), settled.send, heldBack);
    assert.deepEqual([settled.sent, outcome.unmarked], [[], []]);
    assert.deepEqual([...await enqueuedTargets(database, AP)].sort(), ["after", "existing", "stuck"]);
    assert.equal(heldBack.size, 0);
  });

  test(`${host}: each channel keeps its own marks and its own first run`, async (context) => {
    const { database, execute } = await testDatabase(context, host);
    await migrate(database);
    // A row of a channel this build does not know yet, written as a later one would.
    await execute(`INSERT INTO deliveries (id, channel, target, enqueued_at) VALUES ('${deliveryId(AP, "x")}', 'newsletter', 'old', '2026-10-10T00:00:00Z')`);
    const first = sender();
    assert.equal((await deliverPending(database, AP, ["old", "older"].map(item), first.send)).firstRun, true);
    assert.deepEqual(first.sent, []);
    assert.deepEqual([...await enqueuedTargets(database, AP)].sort(), ["old", "older"]);
    assert.throws(() => deliveryId("newsletter", "old"), /unknown delivery channel/);
    assert.notEqual(deliveryId(AP, "old"), deliveryId(AP, "older"));
  });

  test(`${host}: a first-run mark that fails partway leaves nothing marked, so the next run is a first run again`, async (context) => {
    const { database } = await testDatabase(context, host);
    await migrate(database);
    const targets = Array.from({ length: 150 }, (_, index) => `post-${index}`);
    const atomic = database.atomic;
    let calls = 0;
    // Past the 40th row, beyond the 33 rows one bound statement can carry.
    database.atomic = (statements) => {
      calls++;
      return atomic(statements.flatMap((statement, index) => index === 40 ? [statement, "SELECT json('injected failure')"] : [statement]));
    };
    await assert.rejects(deliverPending(database, AP, targets.map(item), sender().send), /malformed JSON/);
    assert.equal(calls, 1);
    assert.equal((await enqueuedTargets(database, AP)).size, 0);

    database.atomic = atomic;
    const retry = sender();
    assert.equal((await deliverPending(database, AP, targets.map(item), retry.send)).firstRun, true);
    assert.deepEqual(retry.sent, []);
    assert.equal((await enqueuedTargets(database, AP)).size, 150);
  });

  test(`${host}: a first run over more posts than one statement can bind marks them all`, async (context) => {
    const { database } = await testDatabase(context, host);
    await migrate(database);
    const targets = Array.from({ length: 150 }, (_, index) => `post-${index}`);
    await deliverPending(database, AP, targets.map(item), sender().send);
    assert.equal((await enqueuedTargets(database, AP)).size, 150);
  });
}
