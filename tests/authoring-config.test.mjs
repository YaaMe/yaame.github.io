import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { interactionRecordFiles } from "./fixtures/interaction-record-files.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function fixture(context) {
  const cwd = mkdtempSync(join(root, ".tmp-authoring-config-"));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const path of [
    "scripts/data-config.mjs", "scripts/tags.mjs", "scripts/newtag.mjs", "scripts/newpost.mjs",
    "scripts/note.mjs", "scripts/notes-store.mjs", "scripts/comments-store.mjs",
    "src/config/data.config.ts", "src/config/data.config.json", "src/config/following.json",
    "src/lib/key-pattern.ts", "src/lib/recovery.ts",
    ...interactionRecordFiles, "src/services/recovery/interaction-references.ts", "src/models/content/comments.ts",
  ]) {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
  }
  const registerPath = join(cwd, "src/config/data.config.json");
  const register = JSON.parse(readFileSync(registerPath, "utf8"));
  register.tags.layers[0].git = "owner choices/tags.ts";
  register["ap-config"].layers[0].git = "owner choices/activitypub.ts";
  writeFileSync(registerPath, JSON.stringify(register));
  mkdirSync(join(cwd, "owner choices"));
  writeFileSync(join(cwd, "owner choices/tags.ts"), 'export const TAGS = {\n  reading: "Reading",\n} as const;\n');
  writeFileSync(join(cwd, "owner choices/activitypub.ts"), 'export const AP = { actorHost: "probe.test", user: "writer" } as const;\n');
  for (const directory of ["src/content/posts", "src/content/komorebi"]) {
    mkdirSync(join(cwd, directory), { recursive: true });
  }
  const run = (script, args = [], options = []) => spawnSync(process.execPath, [
    ...options, `scripts/${script}.mjs`, ...args,
  ], { cwd, encoding: "utf8", env: { ...process.env, APPLY: "0", FORCE: "0" } });
  const generated = run("data-config");
  assert.equal(generated.status, 0, generated.stderr);
  return { cwd, run };
}

test("tag listing, tag creation and post creation use the registered tag source", (context) => {
  const { cwd, run } = fixture(context);
  const before = run("tags");
  assert.equal(before.status, 0, before.stderr);
  assert.match(before.stdout, /reading\s+Reading/);
  const created = run("newtag", ["travel", "Travel"]);
  assert.equal(created.status, 0, created.stderr);
  assert.match(readFileSync(join(cwd, "owner choices/tags.ts"), "utf8"), /travel: "Travel"/);
  const after = run("tags");
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, /travel\s+Travel/);
  const post = run("newpost", ["2026-10-21", "--no-interactive"]);
  assert.equal(post.status, 0, post.stderr);
  assert.match(readFileSync(join(cwd, "src/content/posts/2026-10-21.md"), "utf8"), /owner choices\/tags\.ts/);
  assert.equal(existsSync(join(cwd, "src/config/tags.ts")), false);
});

test("the note publication probe reads the registered ActivityPub source", (context) => {
  const { cwd, run } = fixture(context);
  const post = join(cwd, "src/content/posts/2026-10-21.md");
  const original = '---\ntitle: "Example"\ndate: 2026-10-21T00:00:00Z\n---\nText\n';
  writeFileSync(post, original);
  writeFileSync(join(cwd, "probe.mjs"), `
    globalThis.fetch = async (address) => {
      console.log("probe: " + address);
      return new Response(null, { status: 404 });
    };
  `);
  const preview = run("note", ["--file", "2026-10-21"], ["--import", "./probe.mjs"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /probe: https:\/\/probe\.test\/users\/writer\/notes\/2026-10-21/);
  assert.equal(readFileSync(post, "utf8"), original);
  assert.equal(existsSync(join(cwd, "src/content/notes/2026.json")), false);
});
