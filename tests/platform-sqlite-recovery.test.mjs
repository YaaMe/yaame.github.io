import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { database as nodeDatabase } from "../src/platform/node/database.ts";
import { seedComment, seedDelivery, seedFollower, seedReaction, storedComment } from "./fixtures/interactions.mjs";
import { migrate } from "../src/integrations/activitypub/store/schema.ts";
import { comments } from "../src/config/data.config.generated.mjs";
import registerData from "../src/config/data.config.json" with { type: "json" };
import { InMemoryRecoveryFacility, exportRecovery, importRecovery, registerForLayerKinds } from "../src/lib/recovery.ts";
import { readSqlSnapshot, writeSqlPlan } from "../scripts/platform/node/sqlite.mjs";
import { exportSqlRecovery, importSqlRecovery } from "../scripts/recovery-sql.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const register = registerForLayerKinds(registerData, ["sql"]);

function run(name, args, database, extraEnv = {}) {
  return spawnSync("bash", [`scripts/platform/node/${name}.sh`, "--facility", "sqlite", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, AP_DB_URL: database, AP_DATA_DIR: `${database}.records`, ...extraEnv },
  });
}

async function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "blogu-56-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "source.sqlite");
  const target = join(directory, "target.sqlite");
  const input = join(directory, "recovery.json");
  const database = new DatabaseSync(source);
  try {
    await migrate(nodeDatabase(database));
    seedReaction(database, "reaction-z");
    seedReaction(database, "reaction-a", { kind: "Announce", target: "other", undoneAt: "2026-10-13T00:00:00Z" });
    seedComment(database, "one", { content: "你好 'quoted'" });
    seedFollower(database, "follower-one");
    seedDelivery(database, "delivered-post");
  } finally {
    database.close();
  }
  return { directory, source, target, input };
}

test("SQLite entry points round-trip via the reference facility without changing the source", async (context) => {
  const { directory, source, target, input } = await fixture(context);
  const sourceBefore = readFileSync(source);
  const exported = run("export", ["--file", input], source);
  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(existsSync(input), false);
  const document = JSON.parse(exported.stdout);
  assert.deepEqual(Object.keys(document.entries), ["followers", "deliveries", "reactions", "migrations", "comments", "visitor-identities"]);
  assert.equal(document.entries.comments.records[0].records[0].content, "你好 'quoted'");
  assert.equal(document.entries.comments.records[0].records[0].replyTo, null);
  const reference = new InMemoryRecoveryFacility();
  await importRecovery({ register, document, facilities: { sql: reference } });
  const fromReference = await exportRecovery({ register, facilities: { sql: reference } });
  assert.deepEqual(fromReference, document);
  writeFileSync(input, `${JSON.stringify(fromReference)}\n`);

  const preview = run("import", ["--file", input], target);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(existsSync(target), false);
  assert.equal(JSON.parse(preview.stdout).writes.length, 6);
  const sentinel = join(directory, "unrelated.json");
  writeFileSync(sentinel, "keep me");
  const imported = run("import", ["--apply", "--file", input], target);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout).applied, true);
  const restored = run("export", [], target);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(restored.stdout, exported.stdout);
  assert.deepEqual(readFileSync(source), sourceBefore);
  assert.equal(readFileSync(sentinel, "utf8"), "keep me");
  const database = new DatabaseSync(target);
  try {
    assert.equal(await migrate(nodeDatabase(database)), 0);
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.throws(() => database.exec(`INSERT INTO ${comments.table} SELECT * FROM ${comments.table}`), /UNIQUE constraint failed/);
  } finally {
    database.close();
  }
});

test("SQLite help and invalid flags never open a database", async (context) => {
  const { directory, target } = await fixture(context);
  const before = readdirSync(directory);
  for (const name of ["export", "import"]) {
    const help = run(name, ["--help"], join(target, "missing-parent", "database"));
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /AP_DB_URL/);
    assert.equal(help.stderr, "");
    for (const args of [["--apply", "--dry-run"], ["--facility", "other"], ["--file"], ["--facility"], ["--unknown"]]) {
      const result = run(name, args, target);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stdout, "");
    }
  }
  const missingFile = run("import", [], target);
  assert.equal(missingFile.status, 2, missingFile.stderr);
  assert.match(missingFile.stderr, /requires --file/);
  assert.deepEqual(readdirSync(directory), before);
});

test("SQLite import rejects malformed later payloads and constraint failures without filesystem writes", async (context) => {
  const { directory, source, target, input } = await fixture(context);
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  const original = JSON.parse(exported.stdout);
  const cases = [
    [(document) => { document.version = 99; }, /unsupported recovery format version/],
    [(document) => { document.version = 1; }, /Older exports cannot be imported/],
    [(document) => { delete document.entries.comments; }, /do not match the register selection/],
    [(document) => { delete document.entries.comments.records[0].records[0].content; }, /logical SQL column names/],
    [(document) => { document.entries.comments.records[0].records[0].content = {}; }, /JSON scalar/],
    [(document) => { document.entries.comments.records[0].records[0].content = null; }, /expected string/],
    [(document) => { document.entries.comments.records[0].records[0].activityId = 42; }, /expected string/],
    [(document) => { document.entries.comments.records[0].records[0].content = false; }, /expected string/],
    [(document) => { document.entries.comments.records[0].records[0].objectId += "changed"; }, /inputs do not compute/],
    [(document) => { document.entries["visitor-identities"].records[0].records[0].identifier += "changed"; }, /inputs do not compute/],
    [(document) => {
      const rows = document.entries.comments.records[0].records;
      rows.push({ ...rows[0] });
    }, /UNIQUE constraint failed/],
  ];
  for (const [change, expected] of cases) {
    const document = structuredClone(original);
    change(document);
    writeFileSync(input, JSON.stringify(document));
    for (const flags of [[], ["--apply"]]) {
      const before = readdirSync(directory);
      const result = run("import", [...flags, "--file", input], target);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(target), false);
      assert.deepEqual(readdirSync(directory), before);
    }
  }
});

test("SQLite import refuses even an unrelated empty table and leaves existing bytes intact", async (context) => {
  const { source, target, input } = await fixture(context);
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  writeFileSync(input, exported.stdout);
  const database = new DatabaseSync(target);
  database.exec("CREATE TABLE sqliteXowned (id INTEGER PRIMARY KEY)");
  database.close();
  for (const destination of [target, source]) {
    const before = readFileSync(destination);
    const result = run("import", ["--apply", "--file", input], destination);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-empty store/);
    assert.deepEqual(readFileSync(destination), before);
  }
});

test("SQLite import accepts a schema-less file and refuses missing parents and sidecars", async (context) => {
  const { directory, source, target, input } = await fixture(context);
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  writeFileSync(input, exported.stdout);
  const database = new DatabaseSync(target);
  database.exec("VACUUM");
  database.close();
  const before = readFileSync(target);
  const preview = run("import", ["--file", input], target);
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(readFileSync(target), before);
  const missing = run("import", ["--apply", "--file", input], join(directory, "missing", "database"));
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /AP_DB_URL parent does not exist/);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    writeFileSync(`${target}${suffix}`, "keep sidecar");
    const refused = run("import", ["--apply", "--file", input], target);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /sidecar present/);
    assert.equal(readFileSync(`${target}${suffix}`, "utf8"), "keep sidecar");
    assert.deepEqual(readFileSync(target), before);
    rmSync(`${target}${suffix}`);
  }
  const imported = run("import", ["--apply", "--file", input], target);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(run("export", [], target).stdout, exported.stdout);
});

test("SQLite export refuses missing files and incomplete schemas without creating data", async (context) => {
  const { directory, target } = await fixture(context);
  const before = readdirSync(directory);
  const missing = run("export", [], target);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /AP_DB_URL does not exist/);
  assert.deepEqual(readdirSync(directory), before);
  const notFile = run("export", [], directory);
  assert.notEqual(notFile.status, 0);
  assert.match(notFile.stderr, /not a regular file/);
  const database = new DatabaseSync(target);
  database.exec("CREATE TABLE unrelated (id INTEGER)");
  database.close();
  const original = readFileSync(target);
  const incomplete = run("export", [], target);
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /no such table/);
  assert.equal(incomplete.stdout, "");
  assert.deepEqual(readFileSync(target), original);
});

test("SQLite crash tests observe only the old empty file or the complete restored database", async (context) => {
  const { directory, source, input } = await fixture(context);
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  writeFileSync(input, exported.stdout);
  for (const point of ["before", "after"]) {
    const target = join(directory, `${point}.sqlite`);
    writeFileSync(target, "");
    const crashed = run("import", ["--apply", "--file", input], target, { RECOVERY_TEST_KILL_AT_COMMIT: point });
    assert.ok(crashed.signal === "SIGKILL" || crashed.status === 137, crashed.stderr);
    if (point === "before") {
      assert.equal(readFileSync(target).length, 0);
      const retried = run("import", ["--apply", "--file", input], target);
      assert.equal(retried.status, 0, retried.stderr);
    }
    const restored = run("export", [], target);
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(restored.stdout, exported.stdout);
  }
});

test("SQLite readers and writers take physical identifiers from a relocated register", async (context) => {
  const { directory } = await fixture(context);
  const comment = storedComment("sqlite-columns");
  const identity = { id: comment.authorId, source: comment.source, identifier: comment.identifier, name: "'); DROP TABLE example; --" };
  const selected = {
    "visitor-identities": { recovery: "keep", layers: [{ sql: 'renamed "table', columns: { id: 'changed "key', source: "source", identifier: "identifier", name: "changed_value" } }] },
  };
  const source = new DatabaseSync(join(directory, "renamed-source.sqlite"));
  const target = new DatabaseSync(join(directory, "renamed-target.sqlite"));
  try {
    const schema = 'CREATE TABLE "renamed ""table" ("changed ""key" TEXT PRIMARY KEY, source TEXT, identifier TEXT, changed_value TEXT)';
    source.exec(schema);
    target.exec(schema);
    source.prepare('INSERT INTO "renamed ""table" VALUES (?, ?, ?, ?)').run(identity.id, identity.source, identity.identifier, identity.name);
    const document = await exportSqlRecovery({ register: selected, snapshot: readSqlSnapshot(source, selected) });
    assert.deepEqual(document.entries["visitor-identities"].records[0].records, [identity]);
    const plan = await importSqlRecovery({ register: selected, document, existing: false });
    writeSqlPlan(target, plan, selected);
    assert.deepEqual(target.prepare('SELECT * FROM "renamed ""table"').all().map((row) => ({ ...row })), [
      { 'changed "key': identity.id, source: identity.source, identifier: identity.identifier, changed_value: identity.name },
    ]);
  } finally {
    source.close();
    target.close();
  }
});

test("the Makefile selects SQLite and AP_DATA_DIR supplies the default database path", async (context) => {
  const { directory, source, input } = await fixture(context);
  const dataDir = join(directory, "default");
  mkdirSync(dataDir);
  writeFileSync(join(dataDir, "interactions.sqlite"), readFileSync(source));
  const result = spawnSync("make", ["--no-print-directory", "recovery-export", "DEPLOY_TARGET=node", "FACILITY=sqlite", "APPLY=1", `FILE=${input}`], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, AP_DB_URL: undefined, AP_DATA_DIR: dataDir },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, run("export", [], source).stdout);
  assert.equal(readFileSync(input, "utf8"), result.stdout);
});
