import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function run(name, args, env) {
  return spawnSync("bash", [`scripts/platform/node/${name}.sh`, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("node recovery entry points support help and reject conflicting state flags", () => {
  const directory = mkdtempSync(join(tmpdir(), "blogu-57-help-"));
  for (const name of ["export", "import"]) {
    const help = run(name, ["--help"], { AP_DATA_DIR: directory });
    assert.equal(help.status, 0, `${name}: ${help.stderr}`);
    assert.match(help.stdout, /Usage:/);
    assert.equal(help.stderr, "");

    const refused = run(name, ["--dry-run", "--apply"], { AP_DATA_DIR: directory });
    assert.equal(refused.status, 2, `${name}: ${refused.stderr}`);
    assert.match(refused.stderr, /cannot be used together/);
  }
});

test("node recovery entry points round-trip records using temporary directories", () => {
  const source = mkdtempSync(join(tmpdir(), "blogu-57-source-"));
  const targetParent = mkdtempSync(join(tmpdir(), "blogu-57-target-parent-"));
  const target = join(targetParent, "target");
  writeFileSync(join(source, "ap_followers.json"), JSON.stringify([{ id: "alice" }]));
  writeFileSync(join(source, "ap_following.json"), JSON.stringify([{ id: "bob" }]));

  const exported = run("export", ["--dry-run"], { AP_DATA_DIR: source });
  assert.equal(exported.status, 0, exported.stderr);
  const document = JSON.parse(exported.stdout);
  assert.equal(document.format, "blogu-recovery");
  assert.deepEqual(document.entries.followers.records[0].records, [
    { key: "ap:followers", value: [{ id: "alice" }] },
  ]);

  const input = join(source, "recovery.json");
  writeFileSync(input, `${JSON.stringify(document, null, 2)}\n`);
  const imported = run("import", ["--apply", "--file", input], { AP_DATA_DIR: target });
  assert.equal(imported.status, 0, imported.stderr);

  const roundTrip = run("export", ["--dry-run"], { AP_DATA_DIR: target });
  assert.equal(roundTrip.status, 0, roundTrip.stderr);
  assert.deepEqual(JSON.parse(roundTrip.stdout), document);
  assert.equal(readFileSync(join(target, "ap_followers.json"), "utf8"), "[{\"id\":\"alice\"}]");
});

test("node recovery import previews without changing an empty directory", () => {
  const source = mkdtempSync(join(tmpdir(), "blogu-57-source-preview-"));
  const targetParent = mkdtempSync(join(tmpdir(), "blogu-57-target-preview-parent-"));
  const target = join(targetParent, "target");
  writeFileSync(join(source, "ap_followers.json"), JSON.stringify([{ id: "alice" }]));
  const exported = run("export", ["--dry-run"], { AP_DATA_DIR: source });
  const input = join(source, "recovery.json");
  writeFileSync(input, exported.stdout);

  const preview = run("import", ["--dry-run", "--file", input], { AP_DATA_DIR: target });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(existsSync(target), false);
});

test("node recovery import refuses a selected non-empty store without changing it", () => {
  const source = mkdtempSync(join(tmpdir(), "blogu-57-source-nonempty-"));
  const target = mkdtempSync(join(tmpdir(), "blogu-57-target-nonempty-"));
  writeFileSync(join(source, "ap_followers.json"), JSON.stringify([{ id: "alice" }]));
  writeFileSync(join(target, "ap_followers.json"), JSON.stringify([{ id: "existing" }]));
  const exported = run("export", ["--dry-run"], { AP_DATA_DIR: source });
  const input = join(source, "recovery.json");
  writeFileSync(input, exported.stdout);

  const imported = run("import", ["--apply", "--file", input], { AP_DATA_DIR: target });
  assert.notEqual(imported.status, 0);
  assert.match(imported.stderr, /non-empty store/i);
  assert.equal(readFileSync(join(target, "ap_followers.json"), "utf8"), "[{\"id\":\"existing\"}]");
});

test("node recovery import validates the document before it stages any write", () => {
  const source = mkdtempSync(join(tmpdir(), "blogu-57-source-invalid-"));
  const targetParent = mkdtempSync(join(tmpdir(), "blogu-57-target-invalid-parent-"));
  const target = join(targetParent, "target");
  writeFileSync(join(source, "ap_followers.json"), JSON.stringify([{ id: "alice" }]));
  const exported = run("export", ["--dry-run"], { AP_DATA_DIR: source });
  const document = JSON.parse(exported.stdout);
  document.entries.followers.records[0].records[0] = { key: "ap:followers" };
  const input = join(source, "recovery-invalid.json");
  writeFileSync(input, JSON.stringify(document));

  const imported = run("import", ["--apply", "--file", input], { AP_DATA_DIR: target });
  assert.notEqual(imported.status, 0);
  assert.match(imported.stderr, /must contain only key and value/i);
  assert.equal(existsSync(target), false);
});

test("a crash at the single directory rename leaves an absent or complete target", () => {
  const source = mkdtempSync(join(tmpdir(), "blogu-57-source-crash-"));
  const targetParent = mkdtempSync(join(tmpdir(), "blogu-57-target-crash-parent-"));
  const target = join(targetParent, "target");
  mkdirSync(target);
  writeFileSync(join(source, "ap_followers.json"), JSON.stringify([{ id: "alice" }]));
  const exported = run("export", ["--dry-run"], { AP_DATA_DIR: source });
  const input = join(source, "recovery.json");
  writeFileSync(input, exported.stdout);

  const crashed = run("import", ["--apply", "--file", input], {
    AP_DATA_DIR: target,
    RECOVERY_TEST_KILL_AT_COMMIT: "after",
  });
  assert.ok(crashed.signal === "SIGKILL" || crashed.status === 137);
  if (existsSync(target)) {
    const after = run("export", ["--dry-run"], { AP_DATA_DIR: target });
    assert.equal(after.status, 0, after.stderr);
    assert.deepEqual(JSON.parse(after.stdout), JSON.parse(exported.stdout));
  }
});

test("export refuses a missing AP_DATA_DIR and import refuses a missing parent", () => {
  const parent = mkdtempSync(join(tmpdir(), "blogu-57-missing-"));
  const missing = join(parent, "missing");
  const exported = run("export", ["--dry-run"], { AP_DATA_DIR: missing });
  assert.notEqual(exported.status, 0);
  assert.match(exported.stderr, /AP_DATA_DIR.*does not exist/i);

  const mistyped = join(parent, "not-a-directory");
  writeFileSync(mistyped, "not a directory");
  const mistypedExport = run("export", ["--dry-run"], { AP_DATA_DIR: mistyped });
  assert.notEqual(mistypedExport.status, 0);
  assert.match(mistypedExport.stderr, /AP_DATA_DIR.*not a directory/i);

  const input = join(parent, "recovery.json");
  writeFileSync(input, JSON.stringify({}));
  const imported = run("import", ["--dry-run", "--file", input], {
    AP_DATA_DIR: join(parent, "missing-parent", "target"),
  });
  assert.notEqual(imported.status, 0);
  assert.match(imported.stderr, /AP_DATA_DIR parent does not exist/i);
});
