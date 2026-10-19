import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  exportSqlRecovery, importSqlRecovery, sqlSnapshotStatements, sqlInsertStatements, sqlClearStatements, sqlUserSchemaStatement,
} from "../scripts/recovery-sql.mjs";
import { InMemoryRecoveryFacility, exportRecovery, importRecovery } from "../src/lib/recovery.ts";
import { planRecoveryImport } from "../scripts/recovery-plan.mjs";
import { storedComment } from "./fixtures/interactions.mjs";

const register = {
  "visitor-identities": {
    recovery: "keep",
    layers: [
      { git: "messages.json", format: "json" },
      { sql: "renamed_messages", columns: { id: "message_id", source: "message_source", identifier: "message_identifier", name: "message_text" } },
    ],
  },
  temporary: { recovery: "reset", layers: [{ sql: "temporary", columns: { id: "id" } }] },
  credential: { recovery: "owner-held", layers: [{ external: true }] },
};

const identities = ["one", "two"].map((name) => {
  const comment = storedComment(name);
  return { id: comment.authorId, source: comment.source, identifier: comment.identifier, name: name === "one" ? "你好" : null };
}).sort((left, right) => left.id.localeCompare(right.id));

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
    "visitor-identities": { recovery: "keep", layers: [{ sql: 'a "table', columns: { id: "row id", source: "source", identifier: "identifier", enabled: "is_active", name: 'a "column' } }] },
    untouched: { recovery: "reset", layers: [{ sql: "untouched", columns: { id: "id" } }] },
  };
  const database = new DatabaseSync(":memory:");
  try {
    database.exec('CREATE TABLE "a ""table" ("row id" TEXT, source TEXT, identifier TEXT, is_active INTEGER, "a ""column" TEXT); CREATE TABLE untouched (id INTEGER); INSERT INTO untouched VALUES (9)');
    const rows = [{ ...identities[0], name: "'); DROP TABLE untouched; --", enabled: true }, { ...identities[1], name: null, enabled: false }];
    const plan = { writes: [{ action: "insert", kind: "visitor-identities", layer: 0, rows }] };
    for (const { sql, parameters } of sqlInsertStatements(selected, plan)) database.prepare(sql).run(...parameters);
    const snapshot = sqlSnapshotStatements(selected).map(({ kind, layer, sql, parameters }) => ({
      kind, layer, rows: database.prepare(sql).all(...parameters).map((row) => ({ ...row })),
    }));
    assert.deepEqual(snapshot, [{ kind: "visitor-identities", layer: 0, rows: [
      { ...rows[0], enabled: 1 }, { ...rows[1], enabled: 0 },
    ] }]);
    assert.throws(() => sqlInsertStatements(selected, { writes: [{ ...plan.writes[0], kind: "untouched" }] }), /unknown layer or action/);
    for (const { sql, parameters } of sqlClearStatements(selected)) database.prepare(sql).run(...parameters);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "a ""table"').get().count, 0);
    assert.equal(database.prepare("SELECT id FROM untouched").get().id, 9);
  } finally {
    database.close();
  }
});

test("SQL recovery inserts identities before comments and clears them in reverse for either input order", () => {
  const comment = storedComment("sql-order");
  const author = { id: comment.authorId, source: comment.source, identifier: comment.identifier, name: null };
  const entries = [
    ["visitor-identities", { recovery: "keep", layers: [{ sql: "visitor_identities", columns: { id: "id" } }] }],
    ["comments", { recovery: "keep", layers: [{ sql: "comments", columns: { id: "id", authorId: "author_id" } }] }],
  ];
  const writes = [
    { action: "insert", kind: "visitor-identities", layer: 0, rows: [author] },
    { action: "insert", kind: "comments", layer: 0, rows: [comment] },
  ];
  for (const entryOrder of [entries, [...entries].reverse()]) {
    for (const writeOrder of [writes, [...writes].reverse()]) {
      const selected = Object.fromEntries(entryOrder);
      const plan = { writes: structuredClone(writeOrder) };
      const database = new DatabaseSync(":memory:");
      try {
        database.exec("PRAGMA foreign_keys = ON; CREATE TABLE visitor_identities (id TEXT PRIMARY KEY); CREATE TABLE comments (id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES visitor_identities(id))");
        const inserts = sqlInsertStatements(selected, plan);
        assert.deepEqual(inserts.map(({ kind }) => kind), ["visitor-identities", "comments"]);
        assert.deepEqual(plan.writes, writeOrder);
        for (const { sql, parameters } of inserts) database.prepare(sql).run(...parameters);
        assert.equal(database.prepare("SELECT author_id FROM comments").get().author_id, author.id);
        const clears = sqlClearStatements(selected);
        assert.deepEqual(clears.map(({ kind }) => kind), ["comments", "visitor-identities"]);
        for (const { sql, parameters } of clears) database.prepare(sql).run(...parameters);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM comments").get().count, 0);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM visitor_identities").get().count, 0);
      } finally {
        database.close();
      }
    }
  }
});

test("SQL recovery uses logical columns and round-trips through the reference facility", async () => {
  const snapshot = [{ kind: "visitor-identities", layer: 1, rows: [...identities].reverse() }];
  const document = await exportSqlRecovery({ register, snapshot });
  assert.deepEqual(document.entries["visitor-identities"].records, [
    { layer: 1, records: identities },
  ]);
  assert.deepEqual(document.gitBase, [{ kind: "visitor-identities", layer: 0 }]);
  assert.deepEqual(document.ownerHeld, ["credential"]);
  assert.deepEqual(document.leftOut, [{ kind: "temporary", recovery: "reset", reason: "reset on restore" }]);
  const reference = new InMemoryRecoveryFacility();
  await importRecovery({ register, document, facilities: { sql: reference } });
  assert.deepEqual(reference.snapshot()["visitor-identities\u00001"], identities.map((identity) => ({
    message_id: identity.id, message_source: identity.source, message_identifier: identity.identifier, message_text: identity.name,
  })));
  const fromReference = await exportRecovery({ register, facilities: { sql: reference } });
  assert.deepEqual(fromReference, document);
  const plan = await importSqlRecovery({ register, document: fromReference, existing: false });
  assert.deepEqual(plan.imported, ["visitor-identities"]);
  assert.deepEqual(plan.writes, [
    { action: "insert", kind: "visitor-identities", layer: 1, rows: document.entries["visitor-identities"].records[0].records },
  ]);
  assert.deepEqual(await exportSqlRecovery({ register, snapshot: plan.writes }), document);
});

test("the shared planner refuses non-empty stores and validates later layers before planning either facility", async () => {
  for (const kind of ["sql", "records"]) {
    const layer = kind === "sql" ? { sql: "items", columns: { id: "item_id" } } : { records: "items", format: "json" };
    const selected = {
      comments: { recovery: "keep", layers: [layer] },
      "visitor-identities": { recovery: "keep", layers: [layer] },
    };
    const document = await exportRecovery({ register: selected, facilities: { [kind]: { export: () => [] } } });
    let planned = 0;
    const facility = () => { planned++; return []; };
    await assert.rejects(planRecoveryImport({ register: selected, document, kind, facility }), /existing must be a boolean/);
    await assert.rejects(planRecoveryImport({ register: selected, document, kind, facility, existing: true }), /non-empty store/);
    const invalidVersion = { ...document, version: 99 };
    await assert.rejects(planRecoveryImport({ register: selected, document: invalidVersion, kind, facility, existing: false }),
      (error) => error.code === "UNKNOWN_RECOVERY_VERSION");
    document.entries["visitor-identities"].records[0].records = [{ unexpected: "field" }];
    await assert.rejects(planRecoveryImport({ register: selected, document, kind, facility, existing: false }),
      (error) => error.code === "INVALID_RECOVERY_RECORDS");
    assert.equal(planned, 0);
  }
});

test("SQL exports refuse missing, duplicated or malformed selected layers", async () => {
  const snapshot = { kind: "visitor-identities", layer: 1, rows: [] };
  for (const invalid of [[], [snapshot, snapshot], [{ ...snapshot, layer: 0 }]]) {
    await assert.rejects(exportSqlRecovery({ register, snapshot: invalid }), /cover every selected layer exactly once/);
  }
  await assert.rejects(exportSqlRecovery({ register, snapshot: [{ ...snapshot, rows: [{ message_id: 1, text: "bad" }] }] }),
    (error) => error.code === "RECOVERY_EXPORT_FAILED" && /logical SQL column names/.test(error.failures[0].reason));
});
