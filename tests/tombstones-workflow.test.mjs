import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const workflowPath = ".github/workflows/tombstones.yml";
const workflow = readFileSync(join(root, workflowPath), "utf8");

function fixture(t, paths) {
  const directory = mkdtempSync(join(root, ".tmp-tombstones-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const path of paths) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
  }
  return directory;
}

test("the data generator validates the register and emits resolved values", (t) => {
  const cwd = fixture(t, ["scripts/data-config.mjs", "src/data.config.ts", "src/data.config.json"]);
  const registerPath = join(cwd, "src/data.config.json");
  const register = JSON.parse(readFileSync(registerPath, "utf8"));
  register["promoted-comments"].layers[0].git = "archive/promoted comments/{posts,notes}/*.json";
  writeFileSync(registerPath, JSON.stringify(register));

  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/data-config.mjs"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const generated = readFileSync(join(cwd, "src/data.config.generated.mjs"), "utf8");
  assert.match(generated, /^\/\/ generated from src\/data\.config\.json, do not edit/);
  assert.match(generated, /"gitRoot": "archive\/promoted comments"/);
  assert.match(readFileSync(join(cwd, "src/data.config.generated.d.ts"), "utf8"), /^\/\/ generated from/);

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
    "src/integrations/activitypub/following.json",
  ]);
  const registerPath = join(cwd, "src/data.config.json");
  const register = JSON.parse(readFileSync(registerPath, "utf8"));
  register["promoted-comments"].layers[0].git = "archive/promoted comments/{posts,notes}/*.json";
  writeFileSync(registerPath, JSON.stringify(register));
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
    gh() { printf '1\\n'; }
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
    assert.deepEqual(calls[0], ["diff", "--quiet", "--", "archive/promoted comments"]);
    if (status === "0") {
      assert.equal(calls.length, 1, "an empty comments diff must not open a PR");
    } else {
      assert.deepEqual(calls.filter(([command]) => command === "add"), [["add", "--", "archive/promoted comments"]]);
    }
  }
});

test("data-check rejects workflow path copies and unscoped Git commands", (t) => {
  const cwd = fixture(t, [
    workflowPath,
    "scripts/data-check.mjs",
    "src/data.config.generated.mjs",
    "src/integrations/activitypub/following.json",
    "src/content.config.ts",
    "src/integrations/activitypub/store/schema.ts",
    "scripts/promote.mjs",
    "scripts/tombstone.mjs",
    "scripts/note.mjs",
    "scripts/notes-store.mjs",
    "scripts/newpost.mjs",
    "scripts/frontmatter.mjs",
    "scripts/pin.mjs",
    "scripts/follow.mjs",
    "scripts/tags.mjs",
    "src/integrations/activitypub/federation.ts",
  ]);
  const check = () => spawnSync(process.execPath, ["--experimental-strip-types", "scripts/data-check.mjs"], { cwd, encoding: "utf8" });
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);

  for (const mutation of [
    (source) => source + '\n# src/content/comments\n',
    (source) => source.replace(/^.*promoted_comments_root=.*$/m, '          promoted_comments_root="some/other/path"'),
    (source) => source.replace(/git diff --quiet[^;]*/, "git diff --quiet"),
    (source) => source.replace(/git add[^\n]*/, "git add --update"),
  ]) {
    const changed = mutation(workflow);
    assert.notEqual(changed, workflow, "the mutation must change the workflow");
    writeFileSync(join(cwd, workflowPath), changed);
    const result = check();
    assert.equal(result.status, 1, changed);
    assert.match(result.stderr, /data register consumer \.github\/workflows\/tombstones\.yml:/);
  }
});
