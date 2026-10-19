import test from "node:test";
import assert from "node:assert/strict";
import { storedComment } from "./fixtures/interactions.mjs";

import {
  RECOVERY_FORMAT,
  RECOVERY_FORMAT_VERSION,
  InMemoryRecoveryFacility,
  exportRecovery,
  isRecordKeyPattern,
  recordKeyMatches,
  recordKeyPlaceholders,
  quoteSqlIdentifier,
  importRecovery,
  registerForLayerKinds,
  selectRecovery,
} from "../src/lib/recovery.ts";

test("record placeholder names and matching share the named-placeholder grammar", () => {
  assert.deepEqual(recordKeyPlaceholders("ap:{owner_id}:{Item2}:{owner_id}:{bad-name}:{0bad}"), ["owner_id", "Item2", "owner_id"]);
  assert.deepEqual(recordKeyPlaceholders("literal.{bad-name}"), []);
  assert.equal(recordKeyMatches("a.[b]+\\/{id}:{part_2}", "a.[b]+\\/你好:tail"), true);
  assert.equal(recordKeyMatches("a.[b]+\\/{id}:{part_2}", "axb/你好:tail"), false);
  assert.equal(recordKeyMatches("key:{id}", "key:"), false);
  assert.equal(recordKeyMatches("literal.{bad-name}", "literal.{bad-name}"), true);
  assert.equal(isRecordKeyPattern("{0bad}"), false);
});

test("SQL identifiers preserve literal names and reject names SQLite cannot quote", () => {
  assert.equal(quoteSqlIdentifier('a "quoted" table'), '"a ""quoted"" table"');
  assert.equal(quoteSqlIdentifier("普通_column"), '"普通_column"');
  for (const invalid of ["", "with\u0000nul", null, 3]) {
    assert.throws(() => quoteSqlIdentifier(invalid), (error) => error.code === "INVALID_RECOVERY_REGISTER");
  }
});

const register = {
  kept: {
    layers: [{ memory: "kept" }],
    writeBack: [],
    origin: "owner",
    recovery: "keep",
    purposes: ["content"],
    description: "kept records",
  },
  rebuilt: {
    layers: [{ memory: "rebuilt" }],
    writeBack: [],
    origin: "system",
    recovery: "rebuild",
    purposes: ["content"],
    description: "rebuilt records",
  },
  reset: {
    layers: [{ memory: "reset" }],
    writeBack: [],
    origin: "owner",
    recovery: "reset",
    purposes: ["content"],
    description: "reset records",
  },
  ephemeral: {
    layers: [{ memory: "ephemeral" }],
    writeBack: [],
    origin: "system",
    recovery: "ephemeral",
    purposes: ["content"],
    description: "ephemeral records",
  },
  absent: {
    layers: [{ memory: "absent" }],
    writeBack: [],
    origin: "system",
    recovery: "none",
    purposes: ["content"],
    description: "not recovered",
  },
  secret: {
    layers: [{ external: true }],
    writeBack: [],
    origin: "owner",
    recovery: "owner-held",
    purposes: ["auth"],
    description: "owner-held item",
  },
};

test("selection keeps entries, explains excluded recovery, and names owner-held items", () => {
  const selected = selectRecovery(register);

  assert.deepEqual(selected.keep.map(({ kind }) => kind), ["kept"]);
  assert.deepEqual(selected.leftOut, [
    { kind: "rebuilt", recovery: "rebuild", reason: "rebuild on restore" },
    { kind: "reset", recovery: "reset", reason: "reset on restore" },
    { kind: "ephemeral", recovery: "ephemeral", reason: "ephemeral on restore" },
    { kind: "absent", recovery: "none", reason: "not part of recovery" },
  ]);
  assert.deepEqual(selected.ownerHeld, ["secret"]);
});

test("layer-kind registration keeps only the requested facility family and git base", () => {
  const scoped = registerForLayerKinds({
    records: {
      ...register.kept,
      layers: [{ records: "records:key" }, { git: "records-base" }],
    },
    sql: {
      ...register.kept,
      layers: [{ sql: "sql" }],
    },
    mixed: {
      ...register.kept,
      layers: [{ records: "records:key" }, { sql: "sql" }],
    },
    secret: register.secret,
  }, ["records"]);

  assert.deepEqual(Object.keys(scoped), ["records", "secret"]);
  assert.equal(isRecordKeyPattern("auth:session:{id}"), true);
  assert.equal(isRecordKeyPattern("ap:followers"), false);
});

test("the in-memory facility round-trips the versioned recovery document", async () => {
  const sourceFacility = new InMemoryRecoveryFacility({
    kept: [{ id: "one", value: 1 }, { id: "two", value: 2 }],
  });
  const exported = await exportRecovery({ register, facilities: { memory: sourceFacility } });

  assert.equal(exported.format, RECOVERY_FORMAT);
  assert.equal(exported.version, RECOVERY_FORMAT_VERSION);
  assert.deepEqual(Object.keys(exported.entries), ["kept"]);
  assert.deepEqual(exported.gitBase, []);
  assert.deepEqual(exported.ownerHeld, ["secret"]);
  assert.deepEqual(exported.leftOut, [
    { kind: "rebuilt", recovery: "rebuild", reason: "rebuild on restore" },
    { kind: "reset", recovery: "reset", reason: "reset on restore" },
    { kind: "ephemeral", recovery: "ephemeral", reason: "ephemeral on restore" },
    { kind: "absent", recovery: "none", reason: "not part of recovery" },
  ]);
  assert.deepEqual(exported.entries.kept.records, [
    { layer: 0, records: [{ id: "one", value: 1 }, { id: "two", value: 2 }] },
  ]);

  const targetFacility = new InMemoryRecoveryFacility();
  await importRecovery({ document: exported, register, facilities: { memory: targetFacility } });
  assert.deepEqual(
    await exportRecovery({ register, facilities: { memory: targetFacility } }),
    exported,
  );
});

test("an unknown format version fails before any facility import", async () => {
  const calls = [];
  const facility = {
    export: () => [],
    import: () => calls.push("import"),
  };

  await assert.rejects(
    importRecovery({
      document: {
        format: RECOVERY_FORMAT,
        version: RECOVERY_FORMAT_VERSION + 1,
        entries: {},
        gitBase: [],
        leftOut: [],
        ownerHeld: [],
      },
      register,
      facilities: { memory: facility },
    }),
    (error) => error.code === "UNKNOWN_RECOVERY_VERSION",
  );
  assert.deepEqual(calls, []);
});

test("a facility failure is reported instead of silently dropping an entry", async () => {
  const facility = {
    export: () => { throw new Error("cannot read this store"); },
    import: () => {},
  };

  await assert.rejects(
    exportRecovery({ register, facilities: { memory: facility } }),
    (error) => error.code === "RECOVERY_EXPORT_FAILED"
      && error.failures[0].kind === "kept"
      && error.failures[0].layer === 0
      && error.failures[0].reason === "cannot read this store",
  );
});

test("missing import coverage is rejected before another facility writes", async () => {
  const twoLayerRegister = {
    kept: {
      ...register.kept,
      layers: [{ memory: "kept" }, { records: "kept-records", format: "json" }],
    },
  };
  const calls = [];
  const document = {
    format: RECOVERY_FORMAT,
    version: RECOVERY_FORMAT_VERSION,
    entries: {
      kept: { records: [{ layer: 0, records: [{ id: "one" }] }, { layer: 1, records: [] }] },
    },
    gitBase: [],
    leftOut: [],
    ownerHeld: [],
  };

  await assert.rejects(
    importRecovery({
      document,
      register: twoLayerRegister,
      facilities: {
        memory: { export: () => [], import: () => calls.push("memory") },
      },
    }),
    (error) => error.code === "RECOVERY_IMPORT_FAILED",
  );
  assert.deepEqual(calls, []);
});

test("SQL payloads use logical columns across facilities with different physical names", async () => {
  const comment = storedComment("recovery-columns");
  const identity = { id: comment.authorId, source: comment.source, identifier: comment.identifier, name: "hello" };
  const sourceRegister = {
    "visitor-identities": {
      layers: [{ sql: "events", columns: { id: "source_id", source: "source_source", identifier: "source_identifier", name: "source_body" } }],
      writeBack: [],
      origin: "owner",
      recovery: "keep",
      purposes: ["content"],
      description: "portable SQL rows",
    },
  };
  const targetRegister = {
    "visitor-identities": {
      ...sourceRegister["visitor-identities"],
      layers: [{ sql: "events", columns: { id: "target_id", source: "target_source", identifier: "target_identifier", name: "target_body" } }],
    },
  };
  const sourceFacility = new InMemoryRecoveryFacility({
    "visitor-identities": [{ source_id: identity.id, source_source: identity.source, source_identifier: identity.identifier, source_body: identity.name }],
  });
  const document = await exportRecovery({ register: sourceRegister, facilities: { sql: sourceFacility } });

  assert.deepEqual(document.entries["visitor-identities"].records, [
    { layer: 0, records: [identity] },
  ]);

  const targetFacility = new InMemoryRecoveryFacility();
  await importRecovery({ document, register: targetRegister, facilities: { sql: targetFacility } });
  assert.deepEqual(
    await exportRecovery({ register: targetRegister, facilities: { sql: targetFacility } }),
    document,
  );
  assert.deepEqual(targetFacility.snapshot()["visitor-identities\u00000"], [
    { target_id: identity.id, target_source: identity.source, target_identifier: identity.identifier, target_body: identity.name },
  ]);
});

test("invalid typed payloads are rejected before any facility writes", async () => {
  const comment = storedComment("invalid-sql-type");
  const sqlRegister = {
    "visitor-identities": {
      layers: [{ sql: "events", columns: { id: "event_id", source: "source", identifier: "identifier", name: "name" } }],
      writeBack: [],
      origin: "owner",
      recovery: "keep",
      purposes: ["content"],
      description: "portable SQL rows",
    },
  };
  const calls = [];
  const document = {
    format: RECOVERY_FORMAT,
    version: RECOVERY_FORMAT_VERSION,
    entries: {
      "visitor-identities": { records: [{ layer: 0, records: [{ id: { nested: true }, source: comment.source, identifier: comment.identifier, name: null }] }] },
    },
    gitBase: [],
    leftOut: [],
    ownerHeld: [],
  };

  await assert.rejects(
    importRecovery({
      document,
      register: sqlRegister,
      facilities: { sql: { export: () => [], import: () => calls.push("import") } },
    }),
    (error) => error.code === "INVALID_RECOVERY_RECORDS" && /must be a JSON scalar/.test(error.message),
  );
  assert.deepEqual(calls, []);
});
