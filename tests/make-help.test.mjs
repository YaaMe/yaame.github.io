import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const makefile = readFileSync(join(root, "Makefile"), "utf8");
const headings = ["写作", "联邦与评论", "检查（CI 跑 make check）", "维护", "部署", "本地开发"];

function runHelp(extraFiles = []) {
  return spawnSync("make", ["--no-print-directory", "-f", "Makefile", ...extraFiles.flatMap((file) => ["-f", file]), "help"], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, MAKEFLAGS: "", MFLAGS: "", MAKELEVEL: "0" },
  });
}

function extraMakefile(context, contents) {
  const directory = mkdtempSync(join(tmpdir(), "blogu-help-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "extra.mk");
  writeFileSync(path, contents);
  return path;
}

test("make help lists every phony target once under its group with aligned descriptions", () => {
  const result = runHelp();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const phonyTargets = [...makefile.replace(/\\\r?\n/g, " ").matchAll(/^\.PHONY:\s*([^\n]+)/gm)]
    .flatMap((match) => match[1].split("#")[0].trim().split(/\s+/));
  const width = Math.max(...phonyTargets.map((target) => target.length));
  const seenHeadings = [];
  const seenTargets = [];
  let heading;
  for (const line of stripVTControlCharacters(result.stdout).trimEnd().split("\n")) {
    if (!line) continue;
    if (!line.startsWith("  ")) {
      assert.ok(headings.includes(line), `unknown heading: ${line}`);
      heading = line;
      seenHeadings.push(heading);
      continue;
    }
    assert.ok(heading, `target without a heading: ${line}`);
    const entry = /^  (\S+)( +)(.+)$/.exec(line);
    assert.ok(entry, `invalid help entry: ${line}`);
    const [, target, padding, description] = entry;
    assert.equal(target.length + padding.length, width + 1, `alignment: ${target}`);
    const rule = makefile.split("\n").find((source) => source.startsWith(`${target}:`));
    assert.ok(rule, `unknown target: ${target}`);
    assert.equal(rule.slice(rule.indexOf("##") + 2).trim(), `[${heading}] ${description}`);
    seenTargets.push(target);
  }
  assert.deepEqual(seenHeadings, headings);
  assert.deepEqual(seenTargets.toSorted(), [...new Set(phonyTargets)].toSorted());
  const expectedOrder = headings.flatMap((group) => [...new Set(phonyTargets)].filter((target) =>
    makefile.split("\n").some((line) => line.startsWith(`${target}:`) && line.includes(`## [${group}] `))));
  assert.deepEqual(seenTargets, expectedOrder);
});

test("make help includes a new grouped target and grows the name column", (context) => {
  const target = "a-new-target-longer-than-the-current-column";
  const fixture = extraMakefile(context, `.PHONY: ${target}\n${target}: ## [写作] extra description\n`);
  const result = runHelp([fixture]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const output = stripVTControlCharacters(result.stdout);
  assert.equal(output.split(`  ${target} `).length - 1, 1);
  assert.ok(output.indexOf(`  ${target} `) < output.indexOf("联邦与评论\n"));
  for (const line of output.split("\n").filter((line) => line.startsWith("  "))) {
    const [, name, padding] = /^  (\S+)( +)/.exec(line);
    assert.equal(name.length + padding.length, target.length + 1);
  }
});

for (const [name, comment] of [["missing-group", "description only"], ["unknown-group", "[typo] description"]]) {
  test(`make help rejects ${name} and names the target`, (context) => {
    const fixture = extraMakefile(context, `.PHONY: ${name}\n${name}: ## ${comment}\n`);
    const result = runHelp([fixture]);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(name));
    assert.equal(result.stdout, "");
  });
}

test("help grouping preserves suppression of target names used as note text", () => {
  const result = spawnSync("make", ["--no-print-directory", "--dry-run", "po", "fix"], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, MAKEFLAGS: "", MFLAGS: "", MAKELEVEL: "0" },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node scripts\/note\.mjs fix/);
  assert.doesNotMatch(result.stdout, /node scripts\/frontmatter\.mjs/);
});
