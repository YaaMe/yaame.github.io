import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authoringFiles } from "./fixtures/authoring-files.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const baselineFile = new URL("./fixtures/authoring-baseline.json", import.meta.url);
const draft = '---\ntitle: "A title"\ndate: 2025-01-01T00:30:00+08:00\ntags: [reading, travel]\npinned: false\n---\nA body.\n';
const post = "src/content/posts/2025-01.md";
const scenarios = [
  { name: "post defaults and local timestamps", commands: [["newpost"], ["newpost", "2025-year"], ["newpost", "2024-02-29", "--no-interactive"], ["newpost", "2025-year"]] },
  { name: "post calendar and argument refusals", commands: [["newpost", "2025-02-29"], ["newpost", "2025-99"], ["newpost", "0099-01-01"], ["newpost", "--title"], ["newpost", "--unknown"], ["newpost", "2025-01", "extra"]] },
  { name: "dedicated tags and usage", files: { [post]: '---\ntags:\n  - reading\n  - orphan\nother:\n  - travel\n---\n' }, commands: [["newtag", "travel", "旅行"], ["newtag", "travel", "Again"], ["newtag", "9Upper_tag", "Label"], ["newtag", "bad-slug", "Label"], ["newtag"], ["tags"]] },
  { name: "frontmatter dry run and check", files: { [post]: draft, "src/content/posts/essay.md": "---\ntitle: Essay\n---\n# Heading\n\nBody text.\n", "src/content/posts/bare.md": "Body" }, commands: [["frontmatter", "--dry-run"], ["frontmatter", "--check"]] },
  { name: "frontmatter fill and preserve metadata", files: { [post]: draft, "src/content/posts/2025-99.md": "---\ntitle: Odd month\ndescription:\ntags:\n---\n正文足够长。后面一句。\n", "src/content/posts/2025-year.md": '---\ntitle: "Written"\ndescription: "Keep"\ntags:\n  - travel\n---\nChanged body\n' }, commands: [["frontmatter"], ["frontmatter"]] },
  { name: "frontmatter force", files: { [post]: draft }, commands: [["frontmatter", "--force"]] },
  { name: "pin edits", files: { [post]: draft }, commands: [["pin", "2025-01"], ["pin", "2025-01"], ["pin", "--remove", "2025-01"], ["pin", "--remove", "2025-01"], ["pin", "missing"], ["pin"]] },
  { name: "pin without title and malformed frontmatter", files: { [post]: "---\ndate: 2025-01-01\n---\nBody\n", "src/content/posts/bare.md": "Bare" }, commands: [["pin", "2025-01"], ["pin", "bare"]] },
  { name: "follow edits and refusals", commands: [["follow", "@z@remote.test"], ["follow", "a@remote.test"], ["follow", "a@remote.test"], ["follow", "--remove", "z@remote.test"], ["follow", "--remove", "missing@remote.test"], ["follow", "bad"], ["follow"]] },
  { name: "note inline and collision across archives", files: { "src/content/notes/2001.json": '{"notes":[{"id":"aaaaaaaa","published":"2001-01-01T00:00:00Z","content":"Keep"}]}' }, commands: [["note", "Hello", "world"]] },
  { name: "note draft dry run UTC boundary", files: { "draft.md": draft }, commands: [["note", "--file", "draft.md"]] },
  { name: "note draft apply UTC boundary", files: { "draft.md": draft, "src/content/notes/2024.json": '{"extra":true,"notes":[{"id":"oldnote2","published":"2024-12-31T23:00:00Z","content":"Later"}]}' }, env: { APPLY: "1" }, commands: [["note", "--file", "draft.md"]] },
  { name: "note undated draft", files: { "draft.md": "Plain body" }, commands: [["note", "--file", "draft.md"]] },
  { name: "note draft refusals", files: { "open.md": "---\ntitle: x", "empty.md": "---\ntitle: x\n---\n", "bad.md": "---\ndate: impossible\n---\nBody" }, commands: [["note", "--file", "open.md"], ["note", "--file", "empty.md"], ["note", "--file", "bad.md"], ["note", "--file", "missing"], ["note"]] },
  { name: "note slug unpublished", files: { [post]: draft }, commands: [["note", "--file", "2025-01"]] },
  { name: "note slug published refusal", files: { [post]: draft }, env: { PROBE: "200" }, commands: [["note", "--file", "2025-01"]] },
  { name: "note slug force published", files: { [post]: draft }, env: { PROBE: "200", FORCE: "1", APPLY: "1" }, commands: [["note", "--file", "2025-01"]] },
  { name: "note network refusal even with force", files: { [post]: draft }, env: { PROBE: "throw", FORCE: "1" }, commands: [["note", "--file", "2025-01"]] },
  { name: "note comments refusal precedes probe", files: { [post]: draft, "src/content/comments/posts/2025-01.json": "{}" }, env: { PROBE: "throw", FORCE: "1" }, commands: [["note", "--file", "2025-01"]] },
  { name: "note explicit path keeps B4 behavior", files: { [post]: draft }, env: { PROBE: "throw", APPLY: "1" }, commands: [["note", "--file", post]] },
  { name: "note malformed host refusal even with force", files: { [post]: draft, "owner choices/activitypub.ts": 'export const AP = { actorHost: "bad host", user: "writer" } as const;\n' }, env: { PROBE: "validate-url", FORCE: "1", APPLY: "1" }, commands: [["note", "--file", "2025-01"]] },
  { name: "note unreadable configuration", files: { [post]: draft, "owner choices/activitypub.ts": "export const AP = {};\n" }, commands: [["note", "--file", "2025-01"]] },
  { name: "interactive entry requires tty", commands: [["new"]] },
];

function exercise(context, scenario) {
  const cwd = mkdtempSync(join(root, ".tmp-authoring-commands-"));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), text); };
  for (const path of authoringFiles) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    copyFileSync(join(root, path), join(cwd, path));
  }
  const register = JSON.parse(readFileSync(join(cwd, "src/config/data.config.json"), "utf8"));
  register.tags.layers[0].git = "owner choices/tags.ts";
  register["ap-config"].layers[0].git = "owner choices/activitypub.ts";
  put("src/config/data.config.json", JSON.stringify(register));
  put("src/config/following.json", '{"extra":true,"follow":[]}\n');
  put("owner choices/tags.ts", 'export const TAGS = {\n  reading: "读书",\n} as const;\n');
  put("owner choices/activitypub.ts", 'export const AP = { actorHost: "probe.test", user: "writer" } as const;\n');
  for (const dir of ["src/content/posts", "src/content/komorebi"]) mkdirSync(join(cwd, dir), { recursive: true });
  for (const [path, text] of Object.entries(scenario.files ?? {})) put(path, text);
  put("fixed.mjs", `
    const OriginalDate = Date;
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : ["2026-01-01T00:30:40.123Z"])); }
      static now() { return new OriginalDate("2026-01-01T00:30:40.123Z").getTime(); }
    };
    let draws = 0;
    Math.random = () => Math.floor(draws++ / 8) / 30;
    globalThis.fetch = async (address, options) => {
      if (process.env.PROBE === "validate-url") new URL(address);
      console.log("probe: " + address + " " + options.headers.accept);
      if (process.env.PROBE === "throw") throw new Error("Offline");
      return new Response(null, { status: Number(process.env.PROBE ?? 404) });
    };
  `);
  const run = (command) => {
    const [script, ...args] = command;
    const result = spawnSync(process.execPath, ["--import", "./fixed.mjs", `scripts/${script}.mjs`, ...args], {
      cwd, encoding: "utf8", env: { ...process.env, TZ: "Asia/Singapore", APPLY: "0", FORCE: "0", PROBE: "404", ...scenario.env },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const generated = run(["data-config"]);
  assert.equal(generated.status, 0, generated.stderr);
  const results = scenario.commands.map(run);
  const files = {};
  function collect(path) {
    if (!existsSync(join(cwd, path))) return;
    for (const entry of readdirSync(join(cwd, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) collect(child);
      else files[child] = readFileSync(join(cwd, child), "utf8");
    }
  }
  collect("src/content"); collect("owner choices");
  files["src/config/following.json"] = readFileSync(join(cwd, "src/config/following.json"), "utf8");
  for (const path of Object.keys(scenario.files ?? {}).filter((p) => !p.includes("/"))) {
    files[path] = existsSync(join(cwd, path)) ? readFileSync(join(cwd, path), "utf8") : null;
  }
  return { results, files };
}

for (const scenario of scenarios) {
  test(`baseline command documents and output: ${scenario.name}`, (context) => {
    const result = exercise(context, scenario);
    assert.deepEqual(result, JSON.parse(readFileSync(baselineFile, "utf8"))[scenario.name]);
  });
}
