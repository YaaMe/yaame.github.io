import test from "node:test";
import assert from "node:assert/strict";
import { deliveryFailureRow, storedFailureSchema } from "../src/models/interactions/failures.ts";
import { failureRows, upsertFailure } from "../src/persistence/interactions/failure-rows.ts";
import { migrate } from "../src/services/interactions/schema.ts";
import { testDatabase } from "./fixtures/databases.mjs";

// #104: a written-off delivery is one row in the generic failure table, written
// by an atomic upsert that keeps the latest observation. No read-modify-write.
const INBOX = "https://remote.test/users/a/inbox";
const row = (overrides = {}, at = "2026-10-24T12:00:00.000Z") => deliveryFailureRow({
  inbox: INBOX, activityId: "https://yaame.dev/activities/one", attempt: 7, reason: "delivery-exhausted",
  at: new Date(at), ...overrides,
});
const valid = (value) => storedFailureSchema.safeParse(value).success;

test("a delivery failure row keeps only sanitised fields, keyed by the sanitised inbox", () => {
  const value = row({
    inbox: "https://user:secret@remote.test/users/a/inbox?token=private#frag",
    activityId: "https://yaame.dev/activities/one?session=private#part",
  });
  assert.equal(value.kind, "delivery");
  assert.equal(value.subject, INBOX);
  assert.equal(value.at, "2026-10-24T12:00:00.000Z");
  assert.deepEqual(value.data, {
    version: 1, inbox: INBOX, activityId: "https://yaame.dev/activities/one", attempt: 7, reason: "delivery-exhausted",
  });
  assert.doesNotMatch(JSON.stringify(value), /secret|private|frag|part|user:/);
  assert.match(value.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(row({}, "2026-10-25T00:00:00.000Z").id, value.id, "the id follows the kind and subject, not the time");
  assert.notEqual(row({ inbox: "https://other.test/inbox" }).id, value.id);
  assert.ok(valid(value));
});

test("a value that is not an http(s) URL is stored as null, under the unknown subject", () => {
  for (const inbox of [undefined, "", "not a url", "javascript:alert(1)", "ftp://remote.test/inbox", 42,
    `https://remote.test/${"x".repeat(2100)}`]) {
    const value = row({ inbox, activityId: undefined, reason: "never-ready", attempt: 9 });
    assert.equal(value.data.inbox, null, String(inbox).slice(0, 40));
    assert.equal(value.data.activityId, null);
    assert.equal(value.subject, "(unknown)");
    assert.equal(value.data.reason, "never-ready");
    assert.ok(valid(value));
  }
});

test("the stored schema refuses every shape the JSON column must not hold", () => {
  const base = row();
  const refused = {
    "error text as the reason": { ...base, data: { ...base.data, reason: "Error: token=private" } },
    "an extra data field": { ...base, data: { ...base.data, error: "Error: connect ECONNREFUSED" } },
    "another data version": { ...base, data: { ...base.data, version: 2 } },
    "an unsanitised inbox": { ...base, subject: "https://u:p@remote.test/inbox", data: { ...base.data, inbox: "https://u:p@remote.test/inbox" } },
    "a query in the activity id": { ...base, data: { ...base.data, activityId: "https://remote.test/a?q=1" } },
    "a zero attempt": { ...base, data: { ...base.data, attempt: 0 } },
    "a subject that is not the inbox": { ...base, subject: "https://other.test/inbox", id: row({ inbox: "https://other.test/inbox" }).id },
    "an id that the kind and subject do not compute": { ...base, id: row({ inbox: "https://other.test/inbox" }).id },
    "an unknown kind": { ...base, kind: "mail" },
    "a time without milliseconds": { ...base, at: "2026-10-24T12:00:00Z" },
    "a time with an offset": { ...base, at: "2026-10-24T12:00:00.000+08:00" },
    "an extra column": { ...base, note: "x" },
  };
  for (const [name, value] of Object.entries(refused)) assert.equal(valid(value), false, name);
  assert.throws(() => row({ attempt: 0 }), /delivery failure/);
});

for (const host of ["node", "d1"]) {
  const migrated = async (context) => {
    const fixture = await testDatabase(context, host);
    await migrate(fixture.database);
    return fixture;
  };

  test(`${host}: two writes for one inbox keep the later observation, in either order`, async (context) => {
    const { database } = await migrated(context);
    const early = row({ attempt: 7 }, "2026-10-24T12:00:00.000Z");
    const late = row({ attempt: 8, reason: "never-ready" }, "2026-10-24T13:00:00.000Z");
    for (const order of [[early, late], [late, early]]) {
      for (const value of order) await upsertFailure(database, value);
      assert.deepEqual(await failureRows(database, "delivery"), [late]);
    }
    await upsertFailure(database, late);
    assert.deepEqual(await failureRows(database, "delivery"), [late], "a redelivered write changes nothing");
  });

  test(`${host}: concurrent writes for one inbox from two connections keep the later observation`, async (context) => {
    const { database, concurrent } = await migrated(context);
    const early = row({ attempt: 7 }, "2026-10-24T12:00:00.000Z");
    const late = row({ attempt: 8 }, "2026-10-24T13:00:00.000Z");
    await Promise.all([upsertFailure(database, late), upsertFailure(concurrent, early)]);
    await Promise.all([upsertFailure(database, early), upsertFailure(concurrent, late)]);
    assert.deepEqual(await failureRows(database, "delivery"), [late]);
  });

  test(`${host}: each inbox is its own row, and a write leaves the others untouched`, async (context) => {
    const { database } = await migrated(context);
    const other = row({ inbox: "https://other.test/inbox" }, "2026-10-01T00:00:00.000Z");
    const unknown = row({ inbox: null });
    await upsertFailure(database, other);
    await upsertFailure(database, row());
    await upsertFailure(database, unknown);
    const rows = await failureRows(database, "delivery");
    assert.deepEqual(rows.map(({ subject }) => subject).sort(), ["(unknown)", INBOX, "https://other.test/inbox"].sort());
    assert.deepEqual(rows.find(({ subject }) => subject === other.subject), other);
  });

  test(`${host}: an invalid row is refused before the write`, async (context) => {
    const { database, rows } = await migrated(context);
    const base = row();
    await assert.rejects(upsertFailure(database, { ...base, data: { ...base.data, reason: "Error: private" } }), /failure/);
    assert.deepEqual(await rows("SELECT * FROM failures"), []);
  });

  test(`${host}: the database refuses data that is not a JSON object, and a read refuses a stored shape its schema does not`, async (context) => {
    const { database, execute } = await migrated(context);
    const base = row();
    const insert = (data) => execute(`INSERT INTO failures (id, kind, subject, at, data) VALUES ('${base.id}', 'delivery', '${INBOX}', '${base.at}', '${data}')`);
    for (const data of ["not json", "[1]", "1"]) await assert.rejects(insert(data), /CHECK constraint failed/, data);
    await insert(JSON.stringify({ ...base.data, error: "private" }));
    await assert.rejects(failureRows(database, "delivery"), (error) => {
      assert.match(error.message, new RegExp(base.id));
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
  });
}
