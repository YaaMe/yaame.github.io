import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { database as nodeDatabase } from "../src/platform/node/database.ts";
import { seedComment, seedDelivery, seedFollower, seedReaction, storedComment } from "./fixtures/interactions.mjs";
import { migrate } from "../src/services/interactions/schema.ts";
import { LATEST_MIGRATION } from "./fixtures/databases.mjs";
import { comments, reactions } from "../src/config/data.config.generated.mjs";
import registerData from "../src/config/data.config.json" with { type: "json" };
import { InMemoryRecoveryFacility, exportRecovery, importRecovery, registerForLayerKinds } from "../src/services/recovery/index.ts";
import { d1StatementText } from "../src/platform/cloudflare/recovery.ts";
import { sqlInsertStatements, sqlSnapshotStatements } from "../src/services/recovery/sql.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const register = registerForLayerKinds(registerData, ["sql"]);

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "blogu-58-"));
  const npx = join(directory, "npx");
  copyFileSync(join(root, "tests/fixtures/d1-npx.mjs"), npx);
  chmodSync(npx, 0o755);
  const source = join(directory, "source.sqlite");
  const target = join(directory, "target.sqlite");
  for (const path of [source, target]) {
    const database = new DatabaseSync(path);
    try {
      database.exec("CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value TEXT); INSERT INTO _cf_KV VALUES ('internal', 'preserve'); CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT); INSERT INTO d1_migrations (name) VALUES ('internal')");
      if (path === source) {
        await migrate(nodeDatabase(database));
        seedReaction(database, "reaction-1");
        seedComment(database, "one", { content: "你好 'quoted'; -- ?" });
        seedFollower(database, "follower-one");
        seedDelivery(database, "delivered-post");
      }
    } finally {
      database.close();
    }
  }
  const calls = join(directory, "calls.jsonl");
  const input = join(directory, "recovery document.json");
  const run = (name, args, database = target, extraEnv = {}) => spawnSync("bash", [`scripts/platform/cloudflare/${name}.sh`, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      TMPDIR: directory,
      CF_D1_ID: "fixture-d1",
      CLOUDFLARE_ACCOUNT_ID: "fixture-account",
      CLOUDFLARE_API_TOKEN: "fixture-token-never-exported",
      FAKE_D1_DATABASE: database,
      FAKE_D1_CALLS: calls,
      ...extraEnv,
    },
  });
  return { directory, source, target, input, calls, run };
}

function recordedCalls(path) {
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
}

test("D1 entry points round-trip through fake Wrangler and the reference facility", async () => {
  const { source, target, input, run } = await fixture();
  const sourceBefore = readFileSync(source);
  const targetBefore = readFileSync(target);
  const exported = run("export", ["--file", input], source);
  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(existsSync(input), false);
  const document = JSON.parse(exported.stdout);
  assert.deepEqual(Object.keys(document.entries), ["followers", "deliveries", "reactions", "migrations", "comments", "visitor-identities"]);
  assert.equal(document.entries.comments.records[0].records[0].content, "你好 'quoted'; -- ?");
  assert.doesNotMatch(exported.stdout, /fixture-token|_cf_KV|d1_migrations/);
  const reference = new InMemoryRecoveryFacility();
  await importRecovery({ register, document, facilities: { sql: reference } });
  const fromReference = await exportRecovery({ register, facilities: { sql: reference } });
  assert.deepEqual(fromReference, document);
  writeFileSync(input, JSON.stringify(fromReference));
  const preview = run("import", ["--file", input]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).writes.length, 6);
  assert.deepEqual(readFileSync(target), targetBefore);
  const imported = run("import", ["--apply", "--file", input]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout).applied, true);
  const restored = run("export", [], target);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(restored.stdout, exported.stdout);
  assert.deepEqual(readFileSync(source), sourceBefore);
  const database = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(database.prepare("SELECT value FROM _cf_KV").get().value, "preserve");
    assert.equal(database.prepare("SELECT name FROM d1_migrations").get().name, "internal");
  } finally {
    database.close();
  }
});

test("D1 help and invalid flags do not read credentials or call Wrangler", async () => {
  const { calls, run } = await fixture();
  for (const name of ["export", "import"]) {
    const help = run(name, ["--help"], undefined, { CF_D1_ID: "", CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "" });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage:/);
    assert.match(help.stdout, /D1 (Read|Write)/);
    assert.equal(help.stderr, "");
    for (const args of [["--apply", "--dry-run"], ["--facility", "records"], ["--facility"], ["--file"], ["--file", "--apply"], ["--unknown"]]) {
      const invalid = run(name, args);
      assert.equal(invalid.status, 2, `${name} ${args}: ${invalid.stderr}`);
      assert.equal(invalid.stdout, "");
    }
  }
  const missingFile = run("import", []);
  assert.equal(missingFile.status, 2, missingFile.stderr);
  assert.match(missingFile.stderr, /requires --file/);
  const missingId = run("export", [], undefined, { CF_D1_ID: "" });
  assert.equal(missingId.status, 1, missingId.stderr);
  assert.match(missingId.stderr, /CF_D1_ID is required/);
  assert.deepEqual(recordedCalls(calls), []);
});

test("D1 validates malformed late payloads before sending any write", async () => {
  const { source, target, input, calls, run } = await fixture();
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  const original = JSON.parse(exported.stdout);
  const before = readFileSync(target);
  const cases = [
    [(document) => { document.version = 99; }, /unsupported recovery format version/],
    [(document) => { delete document.entries.comments; }, /register selection/],
    [(document) => { document.entries.comments.records[0].layer = 2; }, /invalid layer records/],
    [(document) => { delete document.entries.comments.records[0].records[0].content; }, /logical SQL column names/],
    [(document) => { document.entries.comments.records[0].records[0].content = {}; }, /JSON scalar/],
    [(document) => { document.version = 1; }, /Older exports cannot be imported/],
    [(document) => { document.entries.comments.records[0].records[0].content = null; }, /expected string/],
    [(document) => { document.entries.comments.records[0].records[0].objectId += "changed"; }, /inputs do not compute/],
    [(document) => { document.entries["visitor-identities"].records[0].records[0].identifier += "changed"; }, /inputs do not compute/],
  ];
  for (const [change, expected] of cases) {
    const document = structuredClone(original);
    change(document);
    writeFileSync(input, JSON.stringify(document));
    for (const mode of ["--dry-run", "--apply"]) {
      const rejected = run("import", [mode, "--file", input]);
      assert.equal(rejected.status, 1, rejected.stderr);
      assert.match(rejected.stderr, expected);
      assert.equal(rejected.stdout, "");
      assert.deepEqual(readFileSync(target), before);
    }
  }
  writeFileSync(input, "{invalid");
  const invalidJson = run("import", ["--apply", "--file", input]);
  assert.equal(invalidJson.status, 1, invalidJson.stderr);
  assert.equal(invalidJson.stdout, "");
  assert.deepEqual(readFileSync(target), before);
  assert.ok(recordedCalls(calls).every((call) => !call.importing));
});

test("D1 constraint failures roll back the whole fake import; preview does not claim to check them", async () => {
  const { source, target, input, calls, run } = await fixture();
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  const original = JSON.parse(exported.stdout);
  const before = readFileSync(target);
  for (const mutate of [
    (rows) => { rows.push({ ...rows[0] }); },
  ]) {
    const document = structuredClone(original);
    mutate(document.entries.comments.records[0].records);
    writeFileSync(input, JSON.stringify(document));
    const preview = run("import", ["--file", input]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.deepEqual(readFileSync(target), before);
    const rejected = run("import", ["--apply", "--file", input]);
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(rejected.stderr, /Wrangler D1 command failed/);
    assert.equal(rejected.stdout, "");
    assert.deepEqual(readFileSync(target), before);
  }
  assert.equal(recordedCalls(calls).filter((call) => call.importing).length, 1);
});

test("D1 refuses unrelated user schema even when it contains no rows", async () => {
  for (const table of ["unrelated", "_cfXusers", "d1_migrations_backup"]) {
    const { source, target, input, calls, run } = await fixture();
    const exported = run("export", [], source);
    assert.equal(exported.status, 0, exported.stderr);
    writeFileSync(input, exported.stdout);
    const database = new DatabaseSync(target);
    database.exec(`CREATE TABLE ${table} (id INTEGER)`);
    database.close();
    const before = readFileSync(target);
    const rejected = run("import", ["--apply", "--file", input]);
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(rejected.stderr, /non-empty store/);
    assert.deepEqual(readFileSync(target), before);
    assert.ok(recordedCalls(calls).every((call) => !call.importing));
  }
});

test("D1 export writes a protected file only on apply and preserves it on failure", async () => {
  const { directory, source, target, input, run } = await fixture();
  writeFileSync(input, "existing backup");
  const preview = run("export", ["--file", input], source);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(readFileSync(input, "utf8"), "existing backup");
  const exported = run("export", ["--apply", "--file", input], source);
  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(readFileSync(input, "utf8"), exported.stdout);
  assert.equal(statSync(input).mode & 0o777, 0o600);
  const failed = run("export", ["--apply", "--file", input], target);
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(failed.stdout, "");
  assert.equal(readFileSync(input, "utf8"), exported.stdout);
  const folder = join(directory, "a-directory");
  mkdirSync(folder);
  const wrongPath = run("export", ["--apply", "--file", folder], source);
  assert.equal(wrongPath.status, 1, wrongPath.stderr);
  assert.equal(wrongPath.stdout, "");
  assert.deepEqual(readdirSync(folder), []);
});

test("D1's CLI encoding preserves bindings without interpreting values or quoted identifiers", () => {
  const comment = storedComment("d1-bindings");
  const selected = {
    "visitor-identities": { recovery: "keep", layers: [{ sql: 'odd ? "table', columns: { id: "row?", source: "source", identifier: "identifier", name: 'a "column?' } }] },
  };
  const database = new DatabaseSync(":memory:");
  try {
    database.exec('CREATE TABLE "odd ? ""table" ("row?" TEXT, source TEXT, identifier TEXT, "a ""column?" TEXT); CREATE TABLE untouched (id INTEGER); INSERT INTO untouched VALUES (9)');
    const text = "'); DROP TABLE untouched; -- ? 你好\n\u0000after";
    const statements = sqlInsertStatements(selected, { writes: [{ action: "insert", kind: "visitor-identities", layer: 0, rows: [{ id: comment.authorId, source: comment.source, identifier: comment.identifier, name: text }] }] });
    database.exec(statements.map(d1StatementText).join(";\n"));
    assert.equal(database.prepare('SELECT hex("a ""column?") AS text FROM "odd ? ""table"').get().text, Buffer.from(text).toString("hex").toUpperCase());
    assert.equal(database.prepare("SELECT id FROM untouched").get().id, 9);
    assert.equal(database.prepare(d1StatementText(sqlSnapshotStatements(selected)[0])).get().id, comment.authorId);
    assert.equal(database.prepare(d1StatementText({ sql: "SELECT '?' AS literal, ? AS value", parameters: [7] })).get().value, 7);
    assert.throws(() => d1StatementText({ sql: "SELECT ?", parameters: [] }), /unsupported parameter/);
    assert.throws(() => d1StatementText({ sql: "SELECT 1", parameters: [2] }), /invalid bindings/);
  } finally {
    database.close();
  }
});

test("D1's import guard rechecks user schema at the commit boundary", async () => {
  const { source, target, input, calls, run } = await fixture();
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  writeFileSync(input, exported.stdout);
  const raced = run("import", ["--apply", "--file", input], target, { FAKE_D1_RACE: "1" });
  assert.equal(raced.status, 1, raced.stderr);
  assert.equal(raced.stdout, "");
  assert.equal(recordedCalls(calls).filter((call) => call.importing).length, 1);
  const database = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(database.prepare("SELECT value FROM concurrent_writer").get().value, "preserve");
    assert.throws(() => database.prepare(`SELECT * FROM ${comments.table}`), /no such table/);
    assert.throws(() => database.prepare(`SELECT * FROM ${reactions.table}`), /no such table/);
    assert.equal(database.prepare("SELECT value FROM _cf_KV").get().value, "preserve");
  } finally {
    database.close();
  }
});

test("D1 lost acknowledgement is reported as unconfirmed and never retried automatically", async () => {
  const { source, target, input, calls, run } = await fixture();
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  writeFileSync(input, exported.stdout);
  const interrupted = run("import", ["--apply", "--file", input], target, { FAKE_D1_LOST_ACK: "1" });
  assert.equal(interrupted.status, 1, interrupted.stderr);
  assert.match(interrupted.stderr, /completion is unconfirmed/);
  assert.equal(interrupted.stdout, "");
  assert.equal(recordedCalls(calls).filter((call) => call.importing).length, 1);
  const after = run("export", [], target);
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, exported.stdout);
  const retried = run("import", ["--apply", "--file", input]);
  assert.equal(retried.status, 1, retried.stderr);
  assert.match(retried.stderr, /non-empty store/);
  assert.equal(recordedCalls(calls).filter((call) => call.importing).length, 1);
});

test("D1 refuses missing and unsuccessful results instead of exporting partial data", async () => {
  const { source, input, run } = await fixture();
  writeFileSync(input, "existing backup");
  for (const mode of ["missing", "failed", "malformed", "invalid-json"]) {
    const refused = run("export", ["--apply", "--file", input], source, { FAKE_D1_RESPONSE: mode });
    assert.equal(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /completion is unconfirmed/);
    assert.equal(refused.stdout, "");
    assert.equal(readFileSync(input, "utf8"), "existing backup");
  }
});

test("#58 D1 cleanup failures preserve the original operation error and report both", async () => {
  const { source, input, run } = await fixture();
  writeFileSync(input, "existing backup");
  for (const cleanup of ["unlink", "rmdir"]) {
    const refused = run("export", ["--apply", "--file", input], source, { FAKE_D1_RESPONSE: "invalid-json", FAKE_D1_CLEANUP: cleanup });
    assert.equal(refused.status, 1, refused.stderr);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /Wrangler D1 returned invalid JSON; completion is unconfirmed/);
    assert.match(refused.stderr, /D1 recovery temporary-file cleanup failed/);
    assert.doesNotMatch(refused.stderr, /D1 recovery operation completed/);
    assert.match(refused.stderr, cleanup === "unlink" ? /EISDIR|EPERM/ : /ENOTEMPTY/);
    assert.equal(readFileSync(input, "utf8"), "existing backup");
  }
});

test("#58 D1 export preserves a successful snapshot when cleanup fails", async () => {
  const { directory, source, input, calls, run } = await fixture();
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  const before = readFileSync(source);
  for (const mode of [[], ["--apply"]]) {
    writeFileSync(input, "existing backup");
    const previous = new Set(readdirSync(directory));
    const result = run("export", [...mode, "--file", input], source, { FAKE_D1_CLEANUP: "unlink" });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, exported.stdout);
    assert.equal(readFileSync(input, "utf8"), mode.length ? exported.stdout : "existing backup");
    assert.match(result.stderr, /D1 recovery operation completed/);
    const leftovers = readdirSync(directory).filter((name) => !previous.has(name) && name.startsWith("blogu-d1-recovery-"));
    assert.equal(leftovers.length, 1);
    const notice = result.stderr.split("\n").find((line) => /[Dd]elete.*recovery data/.test(line));
    assert.ok(notice?.includes(join(directory, leftovers[0])), result.stderr);
    assert.deepEqual(readFileSync(source), before);
  }
  assert.ok(recordedCalls(calls).every((call) => !call.importing));
});

test("#58 D1 import preview preserves a successful snapshot when cleanup fails", async () => {
  const { directory, source, target, input, calls, run } = await fixture();
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  writeFileSync(input, exported.stdout);
  const preview = run("import", ["--file", input]);
  assert.equal(preview.status, 0, preview.stderr);
  const before = readFileSync(target);
  const result = run("import", ["--file", input], target, { FAKE_D1_CLEANUP: "unlink" });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, preview.stdout);
  assert.match(result.stderr, /D1 recovery operation completed/);
  const leftovers = readdirSync(directory).filter((name) => name.startsWith("blogu-d1-recovery-"));
  assert.equal(leftovers.length, 1);
  const notice = result.stderr.split("\n").find((line) => /[Dd]elete.*recovery data/.test(line));
  assert.ok(notice?.includes(join(directory, leftovers[0])), result.stderr);
  assert.deepEqual(readFileSync(target), before);
  for (const mode of [[], ["--apply"]]) {
    const refused = run("import", [...mode, "--file", input], target, { FAKE_D1_RESPONSE: "invalid-json", FAKE_D1_CLEANUP: "unlink" });
    assert.equal(refused.status, 1, refused.stderr);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /Wrangler D1 returned invalid JSON/);
    assert.deepEqual(readFileSync(target), before);
  }
  const invalid = JSON.parse(exported.stdout);
  invalid.version = 99;
  writeFileSync(input, JSON.stringify(invalid));
  const rejected = run("import", ["--apply", "--file", input], target, { FAKE_D1_CLEANUP: "unlink" });
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.equal(rejected.stdout, "");
  assert.match(rejected.stderr, /unsupported recovery format version/);
  assert.deepEqual(readFileSync(target), before);
  assert.ok(recordedCalls(calls).every((call) => !call.importing));
});

test("#58 a completed D1 import reports its result and leftover recovery data when cleanup fails", async () => {
  const { directory, source, target, input, calls, run } = await fixture();
  const exported = run("export", [], source);
  assert.equal(exported.status, 0, exported.stderr);
  writeFileSync(input, exported.stdout);
  const imported = run("import", ["--apply", "--file", input], target, { FAKE_D1_CLEANUP: "import-unlink" });
  assert.equal(imported.status, 1, imported.stderr);
  assert.match(imported.stdout, /"applied":true/);
  assert.equal(JSON.parse(imported.stdout).applied, true);
  assert.match(imported.stderr, /D1 recovery operation completed/);
  assert.match(imported.stderr, /D1 recovery temporary-file cleanup failed/);
  assert.match(imported.stderr, /[Dd]elete.*recovery data/);
  assert.doesNotMatch(imported.stderr, /completion is unconfirmed/);
  const leftovers = readdirSync(directory).filter((name) => name.startsWith("blogu-d1-recovery-"));
  assert.equal(leftovers.length, 1);
  const leftover = join(directory, leftovers[0]);
  const cleanupNotice = imported.stderr.split("\n").find((line) => /[Dd]elete.*recovery data/.test(line));
  assert.ok(cleanupNotice.includes(leftover), imported.stderr);
  const imports = recordedCalls(calls).filter((call) => call.importing);
  assert.equal(imports.length, 1);
  assert.equal(readFileSync(join(leftover, "import.sql.retained"), "utf8"), imports[0].sql);
  const restored = run("export", [], target);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(restored.stdout, exported.stdout);
});

test("D1 imports empty selected layers and records the bootstrapped migrations", async () => {
  const { input, target, run } = await fixture();
  const document = await exportRecovery({ register, facilities: { sql: new InMemoryRecoveryFacility() } });
  writeFileSync(input, JSON.stringify(document));
  const imported = run("import", ["--apply", "--file", input]);
  assert.equal(imported.status, 0, imported.stderr);
  const after = run("export", [], target);
  assert.equal(after.status, 0, after.stderr);
  const restored = JSON.parse(after.stdout);
  assert.deepEqual(restored.entries.migrations.records[0].records.map(({ version }) => version), Array.from({ length: LATEST_MIGRATION + 1 }, (_, version) => version));
  restored.entries.migrations = document.entries.migrations;
  assert.deepEqual(restored, document);
  const database = new DatabaseSync(target);
  try {
    assert.equal(await migrate(nodeDatabase(database)), 0);
  } finally {
    database.close();
  }
});

for (const ledger of ["empty", "incomplete"]) {
  test(`D1 restores populated data with an ${ledger} migration ledger and can migrate again`, async () => {
    const { source, target, input, run } = await fixture();
    const exported = run("export", [], source);
    assert.equal(exported.status, 0, exported.stderr);
    const document = JSON.parse(exported.stdout);
    const migrations = document.entries.migrations.records[0];
    migrations.records = ledger === "empty" ? [] : migrations.records.slice(0, -1);
    writeFileSync(input, JSON.stringify(document));
    const imported = run("import", ["--apply", "--file", input]);
    assert.equal(imported.status, 0, imported.stderr);
    const database = new DatabaseSync(target);
    try {
      const before = database.prepare("SELECT * FROM comments").all();
      assert.equal(before[0].content, "你好 'quoted'; -- ?");
      assert.equal(await migrate(nodeDatabase(database)), 0);
      assert.deepEqual(database.prepare("SELECT * FROM comments").all(), before);
      assert.deepEqual(database.prepare("SELECT version FROM migrations ORDER BY version").all().map(({ version }) => version), Array.from({ length: LATEST_MIGRATION + 1 }, (_, version) => version));
      for (const record of migrations.records) {
        assert.equal(database.prepare("SELECT applied_at FROM migrations WHERE version = ?").get(record.version).applied_at, record.appliedAt);
      }
    } finally {
      database.close();
    }
  });
}
