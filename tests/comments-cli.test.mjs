import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main as promoteMain } from "../scripts/promote.mjs";
import { main as tombstoneMain } from "../scripts/tombstone.mjs";
import { main as unpromoteMain } from "../scripts/unpromote.mjs";
import { byFollowing } from "../scripts/promote-filter.mjs";
import { storedComment } from "./fixtures/interactions.mjs";
import { interactionRecordFiles } from "./fixtures/interaction-record-files.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const row = (name, extra = {}) => storedComment(name, {
  activityId: `https://social.test/activities/${name}`,
  objectId: `https://social.test/objects/${name}`,
  root: "2026-10",
  inReplyTo: "https://yaame.dev/users/yaame/notes/2026-10",
  identifier: `https://social.test/users/${name}`,
  ...extra,
});

function fixture(t) {
  const cwd = mkdtempSync(join(root, ".tmp-comments-cli-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const path of [
    "scripts/promote.mjs", "scripts/promote-filter.mjs", "scripts/promote-text.mjs",
    "scripts/tombstone.mjs", "scripts/unpromote.mjs", "scripts/comments-store.mjs",
    "scripts/comments-rows.mjs",
    "scripts/comments-cli.mjs", "src/models/content/comments.ts", "src/config/data.config.generated.mjs",
    ...interactionRecordFiles,
    "src/persistence/interactions/sql-text.ts",
  ]) {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
  }
  const following = join(cwd, "src/config/following.json");
  mkdirSync(dirname(following), { recursive: true });
  const follow = (names) => writeFileSync(following, JSON.stringify({ follow: names.map((name) => `${name}@social.test`) }));
  follow(["alice"]);
  const commentsDir = join(cwd, "src/content/comments");
  const archive = join(cwd, "src/content/comments/posts/2026-10.json");
  const fileForComment = () => archive;
  const filter = (thread) => {
    return byFollowing(JSON.parse(readFileSync(following, "utf8")))(thread);
  };
  const run = (name, input, args = [], env = {}) => spawnSync(process.execPath, [
    "--experimental-strip-types", `scripts/${name}.mjs`,
    ...(input?.apply === true ? ["--apply"] : []),
    ...args,
  ], {
    cwd,
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const result = async (name, input) => {
    const main = { promote: promoteMain, tombstone: tombstoneMain, unpromote: unpromoteMain }[name];
    return await main({
      ...input,
      dir: commentsDir,
      ...(name === "promote" ? { fileForComment, filter } : {}),
    });
  };
  return { cwd, archive, follow, run, result };
}

// Interface: stdin drives the same default filter as the platform command;
// following changes revisit stored rows, and unfollowing cannot remove git data.
test("JSON promotion previews, backfills a new follow, and remains add-only", async (t) => {
  const { archive, follow, result } = fixture(t);
  const input = { rows: [row("alice"), row("bob")], actorNames: { [row("alice").identifier]: "Alice" } };
  const preview = await result("promote", input);
  assert.deepEqual(preview.states.map(({ id, state }) => [id, state]), [[row("alice").id, "pending"]]);
  assert.equal(existsSync(archive), false);
  await result("promote", { ...input, apply: true });
  assert.equal(JSON.parse(readFileSync(archive, "utf8")).comments[0].author.name, "Alice");
  follow(["alice", "bob"]);
  const backfill = await result("promote", { ...input, apply: true });
  assert.deepEqual(backfill.states.map(({ state }) => state), ["written back", "pending"]);
  const saved = readFileSync(archive, "utf8");
  follow([]);
  assert.equal((await result("promote", { ...input, apply: true })).writes.length, 0);
  assert.equal(readFileSync(archive, "utf8"), saved);
});

// Branch: one rejected entry cannot stop a valid addition in the same input.
test("JSON promotion reports invalid content and writes the valid selection", async (t) => {
  const { archive, result } = fixture(t);
  const output = await result("promote", {
    rows: [row("bad", { identifier: row("alice").identifier, content: `<p>${"x".repeat(10001)}</p>` }), row("alice")],
    actorNames: {},
    apply: true,
  });
  assert.equal(output.invalid.length, 1);
  assert.match(output.invalid[0].reason, /content exceeds 10000 characters/);
  assert.deepEqual(JSON.parse(readFileSync(archive, "utf8")).comments.map(({ id }) => id), [row("alice").id]);
});

// Interface/order: a preview yields no SQL deletion request; applying edits git
// before handing the id back to the shell, and repeating sees no stored state.
test("JSON unpromote only hands back a deletion after editing the archive", async (t) => {
  const { archive, result } = fixture(t);
  await result("promote", { rows: [row("alice")], actorNames: {}, apply: true });
  const input = { id: row("alice").id, rows: [row("alice")] };
  assert.equal((await result("unpromote", input)).deleteId, undefined);
  assert.equal(existsSync(archive), true);
  assert.equal((await result("unpromote", { ...input, apply: true })).deleteId, input.id);
  assert.equal(existsSync(archive), false);
  await assert.rejects(result("unpromote", { id: input.id, rows: [], apply: true }), /not a promoted comment/i);
});

test("JSON tombstones converge after removing the last comment file", async (t) => {
  const { archive, result } = fixture(t);
  await result("promote", { rows: [row("alice")], actorNames: {}, apply: true });
  const input = { rows: [{ id: row("alice").id, deletedAt: "2026-10-12T00:00:00Z" }] };
  assert.equal((await result("tombstone", input)).states[0].state, "pending");
  assert.equal(existsSync(archive), true);
  await result("tombstone", { ...input, apply: true });
  assert.equal(existsSync(archive), false);
  assert.equal((await result("tombstone", { ...input, apply: true })).states[0].state, "written back");
});

// Checker: malformed input must fail closed before a file can be written.
test("JSON commands reject missing rows", (t) => {
  const { archive, run } = fixture(t);
  for (const operation of ["promote", "tombstone", "unpromote"]) {
    const output = run(operation, { id: row("alice").id });
    assert.equal(output.status, 1, `${operation}: ${output.stderr}`);
    assert.match(output.stderr, /Expected an object with rows on stdin/);
    assert.equal(output.stdout, "");
    assert.equal(existsSync(archive), false);
  }
});

test("JSON commands load their schema dependencies and accept valid input", (t) => {
  const { archive, run } = fixture(t);
  for (const operation of ["promote", "tombstone"]) {
    const output = run(operation, { rows: [] });
    assert.equal(output.status, 0, `${operation}: ${output.stderr}`);
    const result = JSON.parse(output.stdout);
    assert.deepEqual(result.states, []);
    assert.deepEqual(result.writes, []);
    assert.equal(result.shouldWrite, false);
  }
  const target = row("alice");
  const output = run("unpromote", { rows: [target] }, ["--id", target.id]);
  assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout);
  assert.deepEqual(result.d1, { present: true, id: target.id });
  assert.equal(result.archive.present, false);
  assert.equal(result.deleteId, undefined);
  assert.equal(existsSync(archive), false);
});
