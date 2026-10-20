/**
 * How promote and tombstone read an open proposal from a git ref. Promote reads
 * every archive document when the reader is made; tombstone reads a document
 * the first time it is asked about and then keeps it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitPullRequestState as promoteState } from "../scripts/promote.mjs";
import { gitPullRequestState as tombstoneState } from "../scripts/tombstone.mjs";
import { DIR } from "../scripts/comments-store.mjs";
import { archivedComment as comment } from "./fixtures/interactions.mjs";

const path = join(DIR, "posts", "root.json");
const elsewhere = join(DIR, "posts", "elsewhere.json");

function repository(t) {
  const directory = mkdtempSync(join(tmpdir(), "blogu-proposal-"));
  const previous = process.cwd();
  t.after(() => {
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  });
  const run = (...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=test@example.test", ...args], { cwd: directory, stdio: "pipe" });
  run("init", "-q", "-b", "main");
  run("commit", "-q", "--allow-empty", "-m", "base");
  run("switch", "-q", "-c", "proposal");
  process.chdir(directory);
  return (comments, message) => {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    if (comments === null) rmSync(file);
    else writeFileSync(file, JSON.stringify({ comments }));
    run("add", "-A", "--", DIR);
    run("commit", "-q", "-m", message);
  };
}

test("promote reads every proposed document when its reader is made", (t) => {
  const propose = repository(t);
  const first = comment("first");
  const later = comment("later");
  propose([first], "propose first");
  const state = promoteState("proposal");
  propose([later], "replace with later");

  assert.equal(state({ path, id: first.id }), true);
  assert.equal(state({ path, id: later.id }), false);
  assert.equal(state({ path: elsewhere, id: first.id }), false);
  assert.deepEqual(state.documents(), [{ path, document: { comments: [first] } }]);
});

test("tombstone reads a proposed document when first asked, then keeps it", (t) => {
  const propose = repository(t);
  const live = comment("withdrawn");
  const stone = comment("withdrawn", { content: undefined, deletedAt: "2026-10-10T00:03:00Z" });
  propose([live], "propose the live comment");
  const state = tombstoneState("proposal");
  propose([stone], "propose the tombstone");

  assert.equal(state({ path, id: live.id, expected: stone }), true);
  propose(null, "propose the removal");
  assert.equal(state({ path, id: live.id, expected: stone }), true);
  assert.equal(state({ path, id: live.id, expected: undefined }), false);
  assert.equal(state({ path: elsewhere, id: live.id, expected: undefined }), true);
  assert.equal(state({ path: elsewhere, id: live.id, expected: stone }), false);
});
