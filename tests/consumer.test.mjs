import test from "node:test";
import assert from "node:assert/strict";
import { inboxHarness } from "./fixtures/inbox.mjs";
import { seedFollower } from "./fixtures/interactions.mjs";
import { deliveryFailures, departures } from "../src/config/data.config.generated.mjs";

test("the consumer preserves transport retries, failure records and acknowledgements", async (t) => {
  const app = await inboxHarness(t, { consumer: true });
  assert.ok(!app.inputs.some((path) => /persistence\/content|selectors\/(posts|notes)|routes\/activitypub\/site/.test(path)));
  await assert.rejects(app.consumer.queue({ messages: [] }), /without a queue binding/);
  const events = [];
  const records = new Map();
  const actor = "https://example.test/users/dead";
  const inbox = `${actor}/inbox`;
  const body = { type: "outbox", inbox, actorIds: [actor, 17], activity: {
    id: "https://yaame.dev/activities/original", object: "https://yaame.dev/notes/original",
  } };
  const prepared = { ...body, activity: {
    id: "https://yaame.dev/activities/prepared", object: { id: "https://yaame.dev/notes/prepared" },
  } };
  let ready = true;
  let processError = false;
  let deliveryError = false;
  let failedWrites = 0;
  let pruneError = false;
  const queue = { async processMessage(value) {
    events.push("process");
    if (processError) throw new Error("prepare failed");
    return { message: value === body ? prepared : value, shouldProcess: ready };
  } };
  app.platform.queue = queue;
  t.mock.method(app.federation, "processQueuedTask", async (data, value) => {
    assert.equal(data, undefined);
    assert.equal(value, prepared);
    events.push("deliver");
    if (deliveryError) throw new Error("delivery failed");
  });
  t.mock.method(app.platform, "get", async (key) => {
    events.push(`get:${key}`);
    return structuredClone(records.get(key) ?? null);
  });
  t.mock.method(app.platform, "put", async (key, value) => {
    await Promise.resolve();
    events.push(`put:${key}`);
    if (key === deliveryFailures.key && failedWrites-- > 0) throw new Error("record failed");
    records.set(key, structuredClone(value));
  });
  const remove = app.database.delete.bind(app.database);
  t.mock.method(app.database, "delete", (table) => {
    if (table === app.followers) {
      events.push("prune");
      if (pruneError) throw new Error("prune failed");
    }
    return remove(table);
  });
  for (const level of ["log", "warn", "error"]) t.mock.method(console, level, () => {});
  const reset = async () => {
    ready = true;
    processError = deliveryError = pruneError = false;
    failedWrites = 0;
    await app.database.delete(app.followers);
    seedFollower(app.database.$client, "dead");
    seedFollower(app.database.$client, "neighbour", { inbox });
    records.clear();
    records.set(deliveryFailures.key, { "https://elsewhere.test/inbox": { retained: true } });
    events.length = 0;
  };
  const message = (attempts, value = body) => ({
    body: value, attempts,
    ack: () => events.push("ack"),
    retry: ({ delaySeconds }) => events.push(`retry:${delaySeconds}`),
  });
  const run = (attempts, value = body) => app.consumer.queue({ messages: [message(attempts, value)] });
  const remaining = async () => (await app.database.select().from(app.followers)).map((row) => row.identifier).sort();
  const expectedFailure = (reason, attempts, activity = prepared.activity) => ({
    type: "outbox", inbox, actorIds: [actor], activity: activity.id,
    object: typeof activity.object === "string" ? activity.object : activity.object.id,
    reason, attempts,
  });
  const failure = () => {
    const { at, ...value } = records.get(deliveryFailures.key)[inbox];
    assert.equal(new Date(at).toISOString(), at);
    assert.deepEqual(records.get(deliveryFailures.key)["https://elsewhere.test/inbox"], { retained: true });
    return value;
  };

  await t.test("successful delivery uses the prepared message and acknowledges afterwards", async () => {
    await reset();
    await run(1);
    assert.deepEqual(events, ["process", "deliver", "ack"]);
    assert.equal((await remaining()).length, 2);
  });

  for (const [attempts, delay] of [[1, 5], [2, 15], [3, 45], [4, 300], [5, 900], [6, 2400]]) {
    await t.test(`attempt ${attempts} retries delivery and readiness failures after ${delay} seconds`, async () => {
      for (const notReady of [false, true]) {
        await reset();
        ready = !notReady;
        deliveryError = !notReady;
        await run(attempts);
        assert.deepEqual(events, ["process", ...(notReady ? [] : ["deliver"]), `retry:${delay}`]);
        assert.equal((await remaining()).length, 2);
      }
    });
  }

  for (const attempts of [7, 8]) {
    await t.test(`attempt ${attempts} records an exhausted delivery before pruning and acknowledging`, async () => {
      await reset();
      deliveryError = true;
      await run(attempts);
      assert.deepEqual(events, ["process", "deliver", `get:${deliveryFailures.key}`, `put:${deliveryFailures.key}`,
        "prune", `get:${departures.key}`, `put:${departures.key}`, "ack"]);
      assert.deepEqual(failure(), expectedFailure("Error: delivery failed", attempts));
      assert.deepEqual(await remaining(), ["https://example.test/users/neighbour"]);
    });
  }

  await t.test("never-ready exhaustion records and acknowledges without delivery or pruning", async () => {
    await reset();
    ready = false;
    await run(7);
    assert.deepEqual(events, ["process", `get:${deliveryFailures.key}`, `put:${deliveryFailures.key}`, "ack"]);
    assert.deepEqual(failure(), expectedFailure("never ready", 7));
    assert.equal((await remaining()).length, 2);
  });

  await t.test("a preparation error retains the original body for retry and write-off", async () => {
    await reset();
    processError = true;
    await run(1);
    assert.deepEqual(events, ["process", "retry:5"]);
    events.length = 0;
    await run(7);
    assert.deepEqual(failure(), expectedFailure("Error: prepare failed", 7, body.activity));
    assert.equal(events[0], "process");
    assert.equal(events.at(-1), "ack");
    assert.ok(!events.includes("deliver"));
  });

  await t.test("a failure without an inbox uses the unknown key and does not prune", async () => {
    await reset();
    processError = true;
    await run(7, { type: "outbox", actorIds: "invalid", activity: {} });
    assert.deepEqual(events, ["process", `get:${deliveryFailures.key}`, `put:${deliveryFailures.key}`, "ack"]);
    const value = records.get(deliveryFailures.key)["(unknown)"];
    assert.deepEqual(value.actorIds, []);
    assert.equal(value.reason, "Error: prepare failed");
    assert.equal((await remaining()).length, 2);
  });

  await t.test("a failed checkpoint prevents pruning and acknowledgement and aborts the batch", async () => {
    await reset();
    deliveryError = true;
    failedWrites = 1;
    await assert.rejects(app.consumer.queue({ messages: [message(7), message(1)] }), /record failed/);
    assert.deepEqual(events, ["process", "deliver", `get:${deliveryFailures.key}`, `put:${deliveryFailures.key}`]);
    assert.equal((await remaining()).length, 2);
  });

  await t.test("a pruning failure propagates after the checkpoint and leaves the message unacknowledged", async () => {
    await reset();
    deliveryError = pruneError = true;
    await assert.rejects(run(7), /prune failed/);
    assert.deepEqual(events, ["process", "deliver", `get:${deliveryFailures.key}`, `put:${deliveryFailures.key}`, "prune"]);
    assert.deepEqual(failure(), expectedFailure("Error: delivery failed", 7));
  });

  await t.test("a failed never-ready checkpoint enters the existing delivery-failure catch", async () => {
    await reset();
    ready = false;
    failedWrites = 1;
    await run(7);
    assert.deepEqual(events, ["process", `get:${deliveryFailures.key}`, `put:${deliveryFailures.key}`,
      `get:${deliveryFailures.key}`, `put:${deliveryFailures.key}`, "prune", `get:${departures.key}`, `put:${departures.key}`, "ack"]);
    assert.deepEqual(failure(), expectedFailure("Error: record failed", 7));
  });

  await t.test("a retry leaves later messages in the batch eligible for processing", async () => {
    await reset();
    ready = false;
    await app.consumer.queue({ messages: [message(1), message(2)] });
    assert.deepEqual(events, ["process", "retry:5", "process", "retry:15"]);
  });
});
