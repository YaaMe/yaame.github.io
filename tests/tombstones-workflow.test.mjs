import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const workflowPath = ".github/workflows/tombstones.yml";
const workflow = readFileSync(join(root, workflowPath), "utf8");

function fixture(t, paths) {
  const directory = mkdtempSync(join(root, ".tmp-tombstones-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const path of [...paths, "src/lib/interactions/records.ts", "src/lib/interactions/key-scheme.ts", "src/integrations/activitypub/config.ts"]) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
  }
  return directory;
}

function osFixture(paths) {
  const directory = mkdtempSync(join(tmpdir(), "blogu-52-workflow-"));
  for (const path of paths) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
  }
  return directory;
}

test("the data generator validates the register and emits resolved values", (t) => {
  const cwd = fixture(t, ["scripts/data-config.mjs", "src/data.config.ts", "src/data.config.json", "src/lib/key-pattern.ts", "src/lib/recovery.ts", "src/integrations/activitypub/following.json"]);
  const registerPath = join(cwd, "src/data.config.json");
  const register = JSON.parse(readFileSync(registerPath, "utf8"));
  register["promoted-comments"].layers[0].git = "archive/promoted comments/{posts,notes}/*.json";
  register.sessions.layers[0].records = "auth:{tenant_id}:{Token2}";
  register.comments.layers[0].sql = 'quoted "table';
  register.comments.layers[0].columns.content = 'quoted "column';
  writeFileSync(registerPath, JSON.stringify(register));

  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/data-config.mjs"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const generated = readFileSync(join(cwd, "src/data.config.generated.mjs"), "utf8");
  assert.match(generated, /^\/\/ generated from src\/data\.config\.json, do not edit/);
  assert.match(generated, /"gitRoot": "archive\/promoted comments"/);
  assert.match(readFileSync(join(cwd, "src/data.config.generated.d.ts"), "utf8"), /^\/\/ generated from/);
  assert.match(readFileSync(join(cwd, "src/data.config.generated.d.ts"), "utf8"), /key: \(tenant_id: string, Token2: string\) => string/);
  const consumer = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { sessions, comments } from "./src/data.config.generated.mjs";
    console.log(JSON.stringify([sessions.key("owner", "token"), comments.table, comments.quotedColumns.content]));
  `], { cwd, encoding: "utf8" });
  assert.equal(consumer.status, 0, consumer.stderr);
  assert.deepEqual(JSON.parse(consumer.stdout), ["auth:owner:token", '"quoted ""table"', '"quoted ""column"']);

  register.comments.origin = "strangers";
  writeFileSync(registerPath, JSON.stringify(register));
  const invalid = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/data-config.mjs"], { cwd, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /data register comments\.origin/);
});

test("the tombstone workflow scopes both Git operations to the relocated register root", (t) => {
  const cwd = fixture(t, [
    "scripts/data-config.mjs",
    "src/data.config.ts",
    "src/data.config.json",
    "src/lib/key-pattern.ts",
    "src/lib/recovery.ts",
    "src/integrations/activitypub/following.json",
  ]);
  const registerPath = join(cwd, "src/data.config.json");
  const register = JSON.parse(readFileSync(registerPath, "utf8"));
  register["promoted-comments"].layers[0].git = "archive/promoted comments/{posts,notes}/*.json";
  writeFileSync(registerPath, JSON.stringify(register));
  const archive = join(cwd, "archive/promoted comments/posts/example.json");
  mkdirSync(dirname(archive), { recursive: true });
  writeFileSync(archive, "{}\n");
  const generated = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/data-config.mjs"], { cwd, encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);

  const script = workflow.split("        run: |\n").at(-1).replace(/^ {10}/gm, "");
  const callsPath = join(cwd, "git-calls");
  const stub = `
    git() {
      printf '%s\\0' "$@" >> "$GIT_CALLS"
      printf '\\n' >> "$GIT_CALLS"
      if [ "$1" = diff ]; then return "$DIFF_STATUS"; fi
    }
    gh() { if [[ "$*" == *"--state open"* ]]; then printf '0\\n'; else printf '1\\n'; fi; }
  `;
  for (const status of ["0", "1"]) {
    writeFileSync(callsPath, "");
    const result = spawnSync("bash", ["-e", "-c", stub + script], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CALLS: callsPath, DIFF_STATUS: status },
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(callsPath, "utf8").trimEnd().split("\n").map((call) => call.split("\0").slice(0, -1));
    assert.deepEqual(calls[0], ["add", "-A", "--", "archive/promoted comments"]);
    assert.deepEqual(calls[1], ["diff", "--cached", "--quiet", "--", "archive/promoted comments"]);
    if (status === "0") {
      assert.equal(calls.length, 2, "an empty comments diff must not open a PR");
    } else {
      assert.deepEqual(calls.filter(([command]) => command === "add"), [["add", "-A", "--", "archive/promoted comments"]]);
    }
  }
});

test("an open proposal is untouched when either reconciliation reports no write", (t) => {
  for (const [workflowName, operation, branch] of [
    ["tombstones.yml", "tombstone", "tombstones"],
    ["promotions.yml", "promote", "promotions"],
  ]) {
    const workflowText = readFileSync(join(root, ".github/workflows", workflowName), "utf8");
    assert.match(workflowText, /if: steps\.reconcile\.outputs\.should-write == 'true'/);
    const cwd = osFixture([
      workflowName === "tombstones.yml" ? ".github/workflows/tombstones.yml" : ".github/workflows/promotions.yml",
      "src/data.config.generated.mjs",
      "src/integrations/activitypub/following.json",
    ]);
    const archiveRoot = join(cwd, "src/content/comments");
    mkdirSync(archiveRoot, { recursive: true });
    const entry = join(cwd, `scripts/platform/cloudflare/${operation}.sh`);
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, "#!/usr/bin/env bash\nprintf '{\"shouldWrite\":false}\\n'\n");
    chmodSync(entry, 0o755);

    const script = workflowText.split("        run: |\n").at(-2).replace(/^ {10}/gm, "");
    const callsPath = join(cwd, `${operation}-workflow-calls`);
    const stub = `
      make() { :; }
      git() {
        printf '%s\\0' "$@" >> "$GIT_CALLS"
        printf '\\n' >> "$GIT_CALLS"
      }
      gh() {
        printf 'gh:%s\\n' "$*" >> "$GIT_CALLS"
        printf '1\\n'
      }
    `;
    const result = spawnSync("bash", ["-e", "-c", stub + script], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        DEPLOY_TARGET: "cloudflare",
        GIT_CALLS: callsPath,
        GITHUB_OUTPUT: join(cwd, `${operation}-workflow-output`),
      },
    });
    assert.equal(result.status, 0, `${workflowName}: ${result.stderr}`);
    const calls = readFileSync(callsPath, "utf8");
    assert.match(calls, /gh:pr list .*--state open/);
    assert.match(readFileSync(join(cwd, `${operation}-workflow-output`), "utf8"), /should-write=false/);
    assert.doesNotMatch(calls, new RegExp(`git switch -c comments/${branch}`));
    assert.doesNotMatch(calls, new RegExp(`git push --force origin comments/${branch}`));
  }
});

const dataCheckInputs = [
  "Makefile",
  workflowPath,
  "scripts/data-check.mjs",
  "src/lib/key-pattern.ts",
  "src/data.config.generated.mjs",
  "src/integrations/activitypub/following.json",
  "src/content.config.ts",
  "src/integrations/activitypub/store/schema.ts",
  "src/integrations/activitypub/store/migration-history.ts",
  "scripts/promote.mjs",
  "scripts/comments-store.mjs",
  "scripts/comments-rows.mjs",
  "scripts/comments-cli.mjs",
  "scripts/promote-filter.mjs",
  "scripts/unpromote.mjs",
  "scripts/tombstone.mjs",
  "scripts/note.mjs",
  "scripts/notes-store.mjs",
  "scripts/newpost.mjs",
  "scripts/frontmatter.mjs",
  "scripts/pin.mjs",
  "scripts/follow.mjs",
  "scripts/tags.mjs",
  "src/integrations/activitypub/federation.ts",
  "src/integrations/activitypub/outbox.ts",
  "src/integrations/auth/session-core.ts",
  "worker/consumer.ts",
  ".github/workflows/promotions.yml",
  ".github/promotion-pr.md",
];
const dataCheck = (cwd) => spawnSync(process.execPath, ["--experimental-strip-types", "scripts/data-check.mjs"], { cwd, encoding: "utf8" });

test("data-check rejects workflow path copies and unscoped Git commands", (t) => {
  const cwd = fixture(t, dataCheckInputs);
  const check = () => dataCheck(cwd);
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);

  for (const mutation of [
    (source) => source + '\n# src/content/comments\n',
    (source) => source.replace(/^.*promoted_comments_root=.*$/m, '          promoted_comments_root="some/other/path"'),
    (source) => source.replaceAll("git diff --cached --quiet", "git diff --quiet"),
    (source) => source.replace(/git add[^\n]*/, "git add --update"),
  ]) {
    const changed = mutation(workflow);
    assert.notEqual(changed, workflow, "the mutation must change the workflow");
    writeFileSync(join(cwd, workflowPath), changed);
    const result = check();
    assert.equal(result.status, 1, changed);
    assert.match(result.stderr, /data register consumer \.github\/workflows\/tombstones\.yml:/);
  }

  const promotePath = join(cwd, "scripts/promote.mjs");
  const promoteSource = readFileSync(promotePath, "utf8");
  writeFileSync(promotePath, `${promoteSource}\nconst forbidden = ["wrangler", "d1"];\n`);
  const invalidWrangler = check();
  assert.equal(invalidWrangler.status, 1);
  assert.match(invalidWrangler.stderr, /host-specific Wrangler reference/);

  const workerPath = join(cwd, "worker/consumer.ts");
  const worker = readFileSync(workerPath, "utf8");
  const changedWorker = worker.replace("deliveryFailures.key", "deliveryFailures.records");
  assert.notEqual(changedWorker, worker, "the worker mutation must change the source");
  writeFileSync(workerPath, changedWorker);
  const invalidWorker = check();
  assert.equal(invalidWorker.status, 1);
  assert.match(invalidWorker.stderr, /data register consumer worker\/consumer\.ts:/);
});

test("data-check scans every line of the table declarations and keeps the migration history to history", (t) => {
  const schemaPath = "src/integrations/activitypub/store/schema.ts";
  const historyPath = "src/integrations/activitypub/store/migration-history.ts";
  const schema = readFileSync(join(root, schemaPath), "utf8");
  const history = readFileSync(join(root, historyPath), "utf8");
  const cwd = fixture(t, dataCheckInputs);
  const valid = dataCheck(cwd);
  assert.equal(valid.status, 0, valid.stderr);

  for (const [path, source, mutation, message] of [
    [schemaPath, schema, (text) => `${text}\nexport const copy = () => "SELECT 1 FROM 'comments'";\n`, /store\/schema\.ts: repeats comments table comments/],
    [schemaPath, schema, (text) => text.replace('import { MIGRATIONS } from "./migration-history.ts";\n', "const MIGRATIONS = [];\n"), /store\/schema\.ts: expected from "\.\/migration-history\.ts"/],
    [historyPath, history, (text) => `import { sql } from "drizzle-orm";\n${text}`, /migration-history\.ts: holds more than the shipped migration list/],
    [historyPath, history, (text) => `${text}\nexport const live = (db) => db.run("SELECT 1");\n`, /migration-history\.ts: holds more than the shipped migration list/],
    [historyPath, history, (text) => text.replace("export const MIGRATIONS", "const MIGRATIONS"), /migration-history\.ts: expected export const MIGRATIONS/],
  ]) {
    const changed = mutation(source);
    assert.notEqual(changed, source, "the mutation must change the source");
    writeFileSync(join(cwd, path), changed);
    const result = dataCheck(cwd);
    assert.equal(result.status, 1, changed);
    assert.match(result.stderr, message);
    writeFileSync(join(cwd, path), source);
  }

  rmSync(join(cwd, historyPath));
  const missing = dataCheck(cwd);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /migration-history\.ts: ENOENT/);
});
