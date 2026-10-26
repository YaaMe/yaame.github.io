import test from "node:test";
import assert from "node:assert/strict";
import { inboxHarness } from "./fixtures/inbox.mjs";
import { seedFollower } from "./fixtures/interactions.mjs";
import { departures } from "../src/config/data.config.generated.mjs";
import { WorkersMessageQueue } from "@fedify/cfworkers";

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
  let failedRecords = 0;
  let pruneError = false;
  let expectedDelivery = prepared;
  const queue = { async processMessage(value) {
    events.push("process");
    if (processError) throw new Error("prepare failed");
    // Fedify's WorkersMessageQueue returns no message while the ordering lock is held.
    return ready ? { message: value === body ? prepared : value, shouldProcess: true } : { shouldProcess: false };
  } };
  app.platform.queue = queue;
  t.mock.method(app.federation, "processQueuedTask", async (data, value) => {
    assert.equal(data, undefined);
    assert.equal(value, expectedDelivery);
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
    records.set(key, structuredClone(value));
  });
  const insert = app.database.insert.bind(app.database);
  t.mock.method(app.database, "insert", (table) => {
    if (table === app.failures) {
      events.push("record");
      if (failedRecords-- > 0) throw new Error("record failed");
    }
    return insert(table);
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
  const neighbour = {
    id: "00000000-0000-5000-8000-000000000000", kind: "delivery", subject: "https://elsewhere.test/inbox",
    at: "2026-10-01T00:00:00.000Z", data: JSON.stringify({ retained: true }),
  };
  const reset = async () => {
    ready = true;
    processError = deliveryError = pruneError = false;
    failedRecords = 0;
    expectedDelivery = prepared;
    await app.database.delete(app.followers);
    seedFollower(app.database.$client, "dead");
    seedFollower(app.database.$client, "neighbour", { inbox });
    records.clear();
    await app.database.delete(app.failures);
    await app.database.insert(app.failures).values(neighbour);
    events.length = 0;
  };
  const message = (attempts, value = body) => ({
    body: value, attempts,
    ack: () => events.push("ack"),
    retry: ({ delaySeconds }) => events.push(`retry:${delaySeconds}`),
  });
  const batch = (...messages) => ({ queue: "test-ap-delivery", messages });
  const run = (attempts, value = body) => app.consumer.queue(batch(message(attempts, value)));
  const remaining = async () => (await app.database.select().from(app.followers)).map((row) => row.identifier).sort();
  const expectedFailure = (reason, attempt, activity = prepared.activity) => ({
    version: 1, inbox, activityId: activity.id, attempt, reason,
  });
  const stored = async () => (await app.database.select().from(app.failures))
    .filter(({ id }) => id !== neighbour.id)
    .map((row) => ({ ...row, data: JSON.parse(row.data) }));
  const failure = async () => {
    const rows = await stored();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "delivery");
    assert.equal(new Date(rows[0].at).toISOString(), rows[0].at);
    assert.deepEqual((await app.database.select().from(app.failures)).find(({ id }) => id === neighbour.id), neighbour,
      "a write leaves other failure rows as they were");
    return rows[0].data;
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
      assert.deepEqual(events, ["process", "deliver", "record",
        "prune", `get:${departures.key}`, `put:${departures.key}`, "ack"]);
      assert.deepEqual(await failure(), expectedFailure("delivery-exhausted", attempts));
      assert.deepEqual(await remaining(), ["https://example.test/users/neighbour"]);
    });
  }

  await t.test("never-ready exhaustion records and acknowledges without delivery or pruning", async () => {
    await reset();
    ready = false;
    await run(7);
    assert.deepEqual(events, ["process", "record", "ack"]);
    assert.deepEqual(await failure(), expectedFailure("never-ready", 7, body.activity));
    assert.equal((await remaining()).length, 2);
  });

  await t.test("a preparation error retains the original body for retry and write-off", async () => {
    await reset();
    processError = true;
    await run(1);
    assert.deepEqual(events, ["process", "retry:5"]);
    events.length = 0;
    await run(7);
    assert.deepEqual(await failure(), expectedFailure("delivery-exhausted", 7, body.activity));
    assert.equal(events[0], "process");
    assert.equal(events.at(-1), "ack");
    assert.ok(!events.includes("deliver"));
  });

  await t.test("a failure without an inbox is recorded with a null inbox and does not prune", async () => {
    await reset();
    processError = true;
    await run(7, { type: "outbox", actorIds: "invalid", activity: {} });
    assert.deepEqual(events, ["process", "record", "ack"]);
    assert.deepEqual(await failure(), { version: 1, inbox: null, activityId: null, attempt: 7, reason: "delivery-exhausted" });
    assert.equal((await remaining()).length, 2);
  });

  await t.test("the record strips URL credentials, query and fragment, and pruning still uses the stored inbox", async () => {
    await reset();
    const secretInbox = "https://user:pw@example.test/users/dead/inbox?token=private#frag";
    await app.database.delete(app.followers);
    seedFollower(app.database.$client, "dead", { inbox: secretInbox });
    seedFollower(app.database.$client, "neighbour");
    processError = true;
    await run(7, { ...body, inbox: secretInbox });
    assert.deepEqual(await failure(), expectedFailure("delivery-exhausted", 7, body.activity));
    assert.doesNotMatch(JSON.stringify(await stored()), /pw|private|frag/);
    assert.deepEqual(await remaining(), ["https://example.test/users/neighbour"]);
  });

  await t.test("a refused failure record prevents pruning and acknowledgement and aborts the batch", async () => {
    await reset();
    deliveryError = true;
    failedRecords = 1;
    await assert.rejects(app.consumer.queue(batch(message(7), message(1))), /record failed/);
    assert.deepEqual(events, ["process", "deliver", "record"]);
    assert.equal((await remaining()).length, 2);
  });

  await t.test("a pruning failure propagates after the record and leaves the message unacknowledged", async () => {
    await reset();
    deliveryError = pruneError = true;
    await assert.rejects(run(7), /prune failed/);
    assert.deepEqual(events, ["process", "deliver", "record", "prune"]);
    assert.deepEqual(await failure(), expectedFailure("delivery-exhausted", 7));
  });

  await t.test("a refused never-ready record preserves followers and leaves the batch unacknowledged (#98)", async () => {
    await reset();
    ready = false;
    failedRecords = 1;
    await assert.rejects(app.consumer.queue(batch(message(7), message(1))), /record failed/);
    assert.deepEqual(events, ["process", "record"]);
    assert.deepEqual(await remaining(), [actor, "https://example.test/users/neighbour"]);
    assert.deepEqual(await stored(), []);

    events.length = 0;
    await run(8);
    assert.deepEqual(events, ["process", "record", "ack"]);
    assert.deepEqual(await failure(), expectedFailure("never-ready", 8, body.activity));
    assert.deepEqual(await remaining(), [actor, "https://example.test/users/neighbour"]);
  });

  await t.test("#107: a message blocked by its ordering lock takes the not-ready path and names its inbox", async () => {
    for (const value of [body, { __fedify_ordering_key__: "same-inbox", __fedify_payload__: body }]) {
      await reset();
      ready = false;
      console.warn.mock.resetCalls();
      console.error.mock.resetCalls();
      await run(1, value);
      assert.deepEqual(events, ["process", "retry:5"]);
      const warnings = console.warn.mock.calls.map(({ arguments: args }) => args);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0][0], "not ready");
      assert.equal(warnings[0][1].inbox, inbox);
      assert.equal(warnings[0][1].activity, body.activity.id);
      assert.equal(console.error.mock.calls.length, 0);
    }
  });

  await t.test("a retry leaves later messages in the batch eligible for processing", async () => {
    await reset();
    ready = false;
    await app.consumer.queue(batch(message(1), message(2)));
    assert.deepEqual(events, ["process", "retry:5", "process", "retry:15"]);
  });

  await t.test("#103: a rejected lock delete preserves settlement, later messages and the original error", async () => {
    const locks = new Map();
    app.platform.queue = new WorkersMessageQueue({}, { orderingKv: {
      get: async (key) => locks.get(key) ?? null,
      put: async (key, value) => locks.set(key, value),
      delete: async () => { events.push("release"); throw new Error("private release credential"); },
    } });
    const wrapped = (key) => ({ __fedify_ordering_key__: key, __fedify_payload__: prepared });
    const deliver = app.federation.processQueuedTask;
    app.federation.processQueuedTask = async (...args) => {
      try { return await deliver(...args); }
      finally { deliveryError = false; }
    };
    try {
      for (const outcome of ["delivered", "retry", "written off", "record failed", "prune failed"]) {
        await reset();
        locks.clear();
        console.error.mock.resetCalls();
        deliveryError = outcome !== "delivered";
        failedRecords = outcome === "record failed" ? 1 : 0;
        pruneError = outcome === "prune failed";
        const pending = app.consumer.queue(batch(
          message(outcome === "retry" ? 1 : 7, wrapped("first")), message(1, wrapped("next")),
        ));
        if (outcome.endsWith("failed")) {
          await assert.rejects(pending, new RegExp(outcome));
          assert.equal(events.filter((event) => event === "deliver").length, 1);
          assert.ok(!events.includes("ack"));
        } else {
          await pending;
          assert.deepEqual(events.slice(-4), ["release", "deliver", "ack", "release"]);
          assert.equal(events.filter((event) => event === "ack").length, outcome === "retry" ? 1 : 2);
          if (outcome === "retry") assert.ok(events.includes("retry:5"));
        }
        const errors = console.error.mock.calls.map(({ arguments: args }) => args)
          .filter(([line]) => line === "ordering lock release failed");
        assert.deepEqual(errors, Array.from({ length: outcome.endsWith("failed") ? 1 : 2 }, () => ["ordering lock release failed"]));
        assert.doesNotMatch(JSON.stringify(console.error.mock.calls), /private release credential/);
      }
    } finally {
      app.platform.queue = queue;
      app.federation.processQueuedTask = deliver;
    }
  });

  await t.test("#103: a settled message releases its key before the next message, without KV expiry", async () => {
    await reset();
    const locks = new Map();
    const released = [];
    app.platform.queue = new WorkersMessageQueue({}, { orderingKv: {
      get: async (key) => locks.get(key) ?? null,
      put: async (key, value) => locks.set(key, value),
      delete: async (key) => { released.push(key); locks.delete(key); events.push("release"); },
    } });
    const wrapped = { __fedify_ordering_key__: "same-inbox", __fedify_payload__: prepared };
    for (const outcome of ["delivered", "retry", "written off", "record failed", "prune failed"]) {
      await reset();
      deliveryError = outcome !== "delivered";
      failedRecords = outcome === "record failed" ? 1 : 0;
      pruneError = outcome === "prune failed";
      const attempt = outcome === "retry" ? 1 : 7;
      let settle;
      let started;
      const handling = new Promise((resolve) => { settle = resolve; });
      const entered = new Promise((resolve) => { started = resolve; });
      const deliver = app.federation.processQueuedTask;
      app.federation.processQueuedTask = async (...args) => {
        started();
        await handling;
        return deliver(...args);
      };
      const pending = run(attempt, wrapped);
      await entered;
      assert.equal(locks.size, 1, "the lock stays held while delivery is pending");
      const count = released.length;
      if (outcome === "delivered") {
        await run(1, wrapped);
        assert.equal(events.at(-1), "retry:5", "a concurrent message waits for the owner");
        assert.equal(locks.size, 1);
        assert.equal(released.length, count, "a waiting message cannot release another message's lock");
      }
      settle();
      if (outcome.endsWith("failed")) await assert.rejects(pending, new RegExp(outcome));
      else await pending;
      app.federation.processQueuedTask = deliver;
      assert.equal(locks.size, 0, outcome);
      assert.equal(released.length, count + 1, "release exactly once after settlement");
      assert.equal(events.at(-1), "release", "release follows retry, record, prune and acknowledgement");
      deliveryError = pruneError = false;
      expectedDelivery = { ...prepared, activity: { id: "https://yaame.dev/activities/next" } };
      events.length = 0;
      await run(1, { ...wrapped, __fedify_payload__: expectedDelivery });
      assert.deepEqual(events, ["deliver", "ack", "release"], "the next message delivers without retry or expiry");
    }
    app.platform.queue = queue;
  });
});
