import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { interactionRecordFiles } from "./fixtures/interaction-record-files.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function fixture(context) {
  const cwd = mkdtempSync(join(root, ".tmp-authoring-config-"));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const path of [
    "scripts/data-config.mjs", "scripts/tags.mjs", "scripts/newtag.mjs", "scripts/newpost.mjs", "scripts/frontmatter.mjs",
    "scripts/note.mjs", "scripts/notes-store.mjs", "scripts/comments-store.mjs",
    "src/config/data.config.ts", "src/config/data.config.json", "src/config/following.json",
    "src/lib/key-pattern.ts", "src/lib/recovery.ts",
    "src/models/content/post-filename.ts", "src/services/authoring/posts.ts",
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

test("post creation retains calendar validation and summary tag defaults", (context) => {
  const { cwd, run } = fixture(context);
  for (const [spec, tags] of [
    ["2025-year", ["summaries", "year"]],
    ["0099-year", ["summaries", "year"]],
    ["0000-01", ["summaries", "month"]],
    ["2026-01", ["summaries", "month"]],
    ["2026-12", ["summaries", "month"]],
    ["2024-02-29", []],
    ["2000-02-29", []],
    ["0100-01-01", []],
  ]) {
    const result = run("newpost", [spec, "--no-interactive", "--title", "Chosen title"]);
    assert.equal(result.status, 0, `${spec}: ${result.stderr}`);
    const source = readFileSync(join(cwd, `src/content/posts/${spec}.md`), "utf8");
    assert.match(source, /title: "Chosen title"/);
    assert.deepEqual([...source.matchAll(/^  - (.+)$/gm)].map((match) => match[1]), tags, spec);
  }
  for (const spec of [
    "2026", "2026-year-01", "2026-00", "2026-13", "2026-99", "2026-1",
    "2026-02-29", "2026-02-30", "2026-04-31", "2026-01-00", "2026-01-32",
    "1900-02-29", "0000-01-01", "0099-01-01", "2026-01-extra", "2026-01.md",
  ]) {
    const result = run("newpost", [spec, "--no-interactive"]);
    assert.equal(result.status, 2, `${spec}: ${result.stderr}`);
    assert.ok(result.stderr.includes(`认不出 "${spec}"`), result.stderr);
    assert.equal(existsSync(join(cwd, `src/content/posts/${spec}.md`)), false, spec);
  }
});

test("frontmatter infers summary tags by shape and leaves other names for a person", (context) => {
  const { cwd, run } = fixture(context);
  const cases = [
    ["2025-year", ["summaries", "year"]],
    ["2025-01", ["summaries", "month"]],
    ["2025-99", ["summaries", "month"]],
    ["0000-00", ["summaries", "month"]],
    ["2025", []], ["2025-year-01", []], ["2025-02-30", []],
    ["2024-02-29", []], ["2025-1", []], ["2025-01-extra", []], ["essay", []],
  ];
  const original = '---\ntitle: "Example"\ndate: 2026-02-01 00:00:00+08:00\n---\nBody text.\n';
  const postPath = (slug) => join(cwd, `src/content/posts/${slug}.md`);
  for (const [slug] of cases) writeFileSync(postPath(slug), original);
  const authored = '---\ntitle: "Kept"\ndescription: "Authored"\ntags:\n  - reading\n---\nBody\n';
  writeFileSync(postPath("2025-12"), authored);
  for (const [flag, status] of [["--dry-run", 0], ["--check", 1]]) {
    const preview = run("frontmatter", [flag]);
    assert.equal(preview.status, status, preview.stderr);
    for (const [slug] of cases) assert.equal(readFileSync(postPath(slug), "utf8"), original, slug);
    assert.equal(readFileSync(postPath("2025-12"), "utf8"), authored);
  }
  const filled = run("frontmatter");
  assert.equal(filled.status, 0, filled.stderr);
  for (const [slug, tags] of cases) {
    const source = readFileSync(postPath(slug), "utf8");
    assert.deepEqual([...source.matchAll(/^  - (.+)$/gm)].map((match) => match[1]), tags, slug);
    assert.match(source, /description: "Body text\."/);
    assert.match(source, /date: 2026-02-01 00:00:00\+08:00/);
    if (!tags.length) assert.ok(filled.stdout.includes(`? ${slug}.md 缺 tags`), filled.stdout);
  }
  assert.equal(readFileSync(postPath("2025-12"), "utf8"), authored);
});

test("interactive tag creation keeps its wider slug grammar", { timeout: 10000 }, async (context) => {
  const { cwd, run } = fixture(context);
  const slug = "9Upper_tag";
  const rejected = run("newtag", [slug, "Label"]);
  assert.equal(rejected.status, 2, rejected.stderr);
  const child = spawn(process.execPath, ["scripts/newpost.mjs", "2026-10-21", "--pick"], { cwd });
  context.after(() => child.kill());
  const answers = [["回车跳过）: ", "n"], ["新标签的英文 slug: ", slug], ["显示名（中文）: ", "Label"]];
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (answers.length && output.includes(answers[0][0])) child.stdin.write(`${answers.shift()[1]}\n`);
  });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(status, 0, errors);
  assert.equal(answers.length, 0, output);
  assert.match(readFileSync(join(cwd, "owner choices/tags.ts"), "utf8"), /9Upper_tag: "Label"/);
  assert.match(readFileSync(join(cwd, "src/content/posts/2026-10-21.md"), "utf8"), /  - 9Upper_tag/);
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
