import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { main as promoteMain } from "../scripts/promote.mjs";
import { main as tombstoneMain } from "../scripts/tombstone.mjs";
import { main as unpromoteMain } from "../scripts/unpromote.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const row = (name, extra = {}) => ({
  activityId: `https://social.test/activities/${name}`,
  objectId: `https://social.test/objects/${name}`,
  rootId: "https://blog.test/users/owner/notes/2026-10",
  actorId: `https://social.test/users/${name}`,
  replyToId: null,
  content: `<p>${name}</p>`,
  published: "2026-10-10T00:00:00Z",
  ...extra,
});

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "blogu-52-comments-cli-"));
  for (const path of [
    "scripts/promote.mjs", "scripts/promote-filter.mjs", "scripts/promote-text.mjs",
    "scripts/tombstone.mjs", "scripts/unpromote.mjs", "scripts/comments-store.mjs",
    "scripts/comments-rows.mjs",
    "scripts/comments-cli.mjs", "src/lib/comment-schema.ts", "src/data.config.generated.mjs",
  ]) {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
  }
  const following = join(cwd, "src/integrations/activitypub/following.json");
  mkdirSync(dirname(following), { recursive: true });
  const follow = (names) => writeFileSync(following, JSON.stringify({ follow: names.map((name) => `${name}@social.test`) }));
  follow(["alice"]);
  const commentsDir = join(cwd, "src/content/comments");
  const archive = join(cwd, "src/content/comments/posts/2026-10.json");
  const fileForComment = () => archive;
  const filter = (thread) => {
    const followed = JSON.parse(readFileSync(following, "utf8")).follow;
    return thread.filter((comment) => followed.includes(`${comment.actorId.split("/").at(-1)}@social.test`));
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
  const input = { rows: [row("alice"), row("bob")], actorNames: { [row("alice").actorId]: "Alice" } };
  const preview = await result("promote", input);
  assert.deepEqual(preview.states.map(({ activityId, state }) => [activityId, state]), [[row("alice").activityId, "pending"]]);
  assert.equal(existsSync(archive), false);
  await result("promote", { ...input, apply: true });
  assert.equal(JSON.parse(readFileSync(archive, "utf8")).comments[0].name, "Alice");
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
    rows: [row("bad", { actorId: row("alice").actorId, content: `<p>${"x".repeat(10001)}</p>` }), row("alice")],
    actorNames: {},
    apply: true,
  });
  assert.equal(output.invalid.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(archive, "utf8")).comments.map(({ activityId }) => activityId), [row("alice").activityId]);
});

// Interface/order: a preview yields no SQL deletion request; applying edits git
// before handing the id back to the shell, and repeating sees no stored state.
test("JSON unpromote only hands back a deletion after editing the archive", async (t) => {
  const { archive, result } = fixture(t);
  await result("promote", { rows: [row("alice")], actorNames: {}, apply: true });
  const input = { id: row("alice").activityId, rows: [row("alice")] };
  assert.equal((await result("unpromote", input)).deleteId, undefined);
  assert.equal(existsSync(archive), true);
  assert.equal((await result("unpromote", { ...input, apply: true })).deleteId, input.id);
  assert.equal(existsSync(archive), false);
  await assert.rejects(result("unpromote", { id: input.id, rows: [], apply: true }), /not a promoted comment/i);
});

test("JSON tombstones converge after removing the last comment file", async (t) => {
  const { archive, result } = fixture(t);
  await result("promote", { rows: [row("alice")], actorNames: {}, apply: true });
  const input = { rows: [{ activityId: row("alice").activityId, deletedAt: "2026-10-12T00:00:00Z" }] };
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
    const output = run(operation, { id: row("alice").activityId });
    assert.equal(output.status, 1, `${operation}: ${output.stderr}`);
    assert.equal(output.stdout, "");
    assert.equal(existsSync(archive), false);
  }
});
