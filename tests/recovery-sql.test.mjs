import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  exportSqlRecovery, importSqlRecovery, sqlSnapshotStatements, sqlInsertStatements, sqlClearStatements, sqlUserSchemaStatement,
} from "../scripts/recovery-sql.mjs";
import { InMemoryRecoveryFacility, exportRecovery, importRecovery } from "../src/lib/recovery.ts";
import { planRecoveryImport } from "../scripts/recovery-plan.mjs";

const register = {
  messages: {
    recovery: "keep",
    layers: [
      { git: "messages.json", format: "json" },
      { sql: "renamed_messages", columns: { id: "message_id", text: "message_text" } },
    ],
  },
  temporary: { recovery: "reset", layers: [{ sql: "temporary", columns: { id: "id" } }] },
  credential: { recovery: "owner-held", layers: [{ external: true }] },
};

test("user-schema queries exclude only the target's internal prefixes and exact names", () => {
  const database = new DatabaseSync(":memory:");
  const query = (options) => {
    const { sql, parameters } = sqlUserSchemaStatement(options);
    return Boolean(database.prepare(sql).get(...parameters));
  };
  const exclusions = { excludedPrefixes: ["sqlite_", "_cf_"], excludedNames: ["d1_migrations"] };
  try {
    database.exec("CREATE TABLE _cf_KV (key TEXT); CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT)");
    assert.equal(query(), true);
    assert.equal(query(exclusions), false);
    database.exec("CREATE TABLE d1_migrations_backup (id INTEGER)");
    assert.equal(query(exclusions), true);
    assert.equal(query({ excludedPrefixes: [...exclusions.excludedPrefixes, "d1_migrations"] }), false);
    database.exec("CREATE TABLE sqliteXowned (id INTEGER)");
    assert.equal(query({ excludedPrefixes: [...exclusions.excludedPrefixes, "d1_migrations"] }), true);
  } finally {
    database.close();
  }
});

test("host-free SQL statements bind values, map columns, and leave unselected tables intact", () => {
  const selected = {
    messages: { recovery: "keep", layers: [{ sql: 'a "table', columns: { id: "row id", enabled: "is_active", text: 'a "column' } }] },
    untouched: { recovery: "reset", layers: [{ sql: "untouched", columns: { id: "id" } }] },
  };
  const database = new DatabaseSync(":memory:");
  try {
    database.exec('CREATE TABLE "a ""table" ("row id" INTEGER, is_active INTEGER, "a ""column" TEXT); CREATE TABLE untouched (id INTEGER); INSERT INTO untouched VALUES (9)');
    const rows = [{ text: "'); DROP TABLE untouched; --", enabled: true, id: 7 }, { id: 8, enabled: false, text: null }];
    const plan = { writes: [{ action: "insert", kind: "messages", layer: 0, rows }] };
    for (const { sql, parameters } of sqlInsertStatements(selected, plan)) database.prepare(sql).run(...parameters);
    const snapshot = sqlSnapshotStatements(selected).map(({ kind, layer, sql, parameters }) => ({
      kind, layer, rows: database.prepare(sql).all(...parameters).map((row) => ({ ...row })),
    }));
    assert.deepEqual(snapshot, [{ kind: "messages", layer: 0, rows: [
      { id: 7, enabled: 1, text: "'); DROP TABLE untouched; --" }, { id: 8, enabled: 0, text: null },
    ] }]);
    assert.throws(() => sqlInsertStatements(selected, { writes: [{ ...plan.writes[0], kind: "untouched" }] }), /unknown layer or action/);
    for (const { sql, parameters } of sqlClearStatements(selected)) database.prepare(sql).run(...parameters);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "a ""table"').get().count, 0);
    assert.equal(database.prepare("SELECT id FROM untouched").get().id, 9);
  } finally {
    database.close();
  }
});

test("SQL recovery uses logical columns and round-trips through the reference facility", async () => {
  const snapshot = [{ kind: "messages", layer: 1, rows: [{ id: 2, text: null }, { id: 1, text: "你好" }] }];
  const document = await exportSqlRecovery({ register, snapshot });
  assert.deepEqual(document.entries.messages.records, [
    { layer: 1, records: [{ id: 1, text: "你好" }, { id: 2, text: null }] },
  ]);
  assert.deepEqual(document.gitBase, [{ kind: "messages", layer: 0 }]);
  assert.deepEqual(document.ownerHeld, ["credential"]);
  assert.deepEqual(document.leftOut, [{ kind: "temporary", recovery: "reset", reason: "reset on restore" }]);
  const reference = new InMemoryRecoveryFacility();
  await importRecovery({ register, document, facilities: { sql: reference } });
  assert.deepEqual(reference.snapshot()["messages\u00001"], [
    { message_id: 1, message_text: "你好" }, { message_id: 2, message_text: null },
  ]);
  const fromReference = await exportRecovery({ register, facilities: { sql: reference } });
  assert.deepEqual(fromReference, document);
  const plan = await importSqlRecovery({ register, document: fromReference, existing: false });
  assert.deepEqual(plan.imported, ["messages"]);
  assert.deepEqual(plan.writes, [
    { action: "insert", kind: "messages", layer: 1, rows: document.entries.messages.records[0].records },
  ]);
  assert.deepEqual(await exportSqlRecovery({ register, snapshot: plan.writes }), document);
});

test("the shared planner refuses non-empty stores and validates later layers before planning either facility", async () => {
  for (const kind of ["sql", "records"]) {
    const layer = kind === "sql" ? { sql: "items", columns: { id: "item_id" } } : { records: "items", format: "json" };
    const selected = {
      first: { recovery: "keep", layers: [layer] },
      last: { recovery: "keep", layers: [layer] },
    };
    const document = await exportRecovery({ register: selected, facilities: { [kind]: { export: () => [] } } });
    let planned = 0;
    const facility = () => { planned++; return []; };
    await assert.rejects(planRecoveryImport({ register: selected, document, kind, facility }), /existing must be a boolean/);
    await assert.rejects(planRecoveryImport({ register: selected, document, kind, facility, existing: true }), /non-empty store/);
    const invalidVersion = { ...document, version: 99 };
    await assert.rejects(planRecoveryImport({ register: selected, document: invalidVersion, kind, facility, existing: false }),
      (error) => error.code === "UNKNOWN_RECOVERY_VERSION");
    document.entries.last.records[0].records = [{ unexpected: "field" }];
    await assert.rejects(planRecoveryImport({ register: selected, document, kind, facility, existing: false }),
      (error) => error.code === "INVALID_RECOVERY_RECORDS");
    assert.equal(planned, 0);
  }
});

test("SQL exports refuse missing, duplicated or malformed selected layers", async () => {
  const snapshot = { kind: "messages", layer: 1, rows: [] };
  for (const invalid of [[], [snapshot, snapshot], [{ ...snapshot, layer: 0 }]]) {
    await assert.rejects(exportSqlRecovery({ register, snapshot: invalid }), /cover every selected layer exactly once/);
  }
  await assert.rejects(exportSqlRecovery({ register, snapshot: [{ ...snapshot, rows: [{ message_id: 1, text: "bad" }] }] }),
    (error) => error.code === "RECOVERY_EXPORT_FAILED" && /logical SQL column names/.test(error.failures[0].reason));
});
