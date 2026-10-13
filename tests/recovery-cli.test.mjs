import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import registerData from "../src/data.config.json" with { type: "json" };
import { exportRecovery, registerForLayerKinds } from "../src/lib/recovery.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const runner = new URL("../scripts/run-cli.mjs", import.meta.url).href;
const modules = ["scripts/recovery-records.mjs", "scripts/recovery-sql.mjs", "scripts/platform/node/records.mjs", "scripts/platform/node/sqlite.mjs", "scripts/platform/cloudflare/d1.mjs"];

function fixture(context) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "blogu-recovery-cli-")));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(args, directory, input = "null") {
  return spawnSync(process.execPath, ["--experimental-strip-types", ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    env: { ...process.env, CF_D1_ID: "", AP_DATA_DIR: join(directory, "records"), AP_DB_URL: join(directory, "database.sqlite") },
  });
}

test("#56 renamed recovery commands still execute and report failure; imports stay inert", (context) => {
  const directory = fixture(context);
  for (const module of modules) {
    const renamed = join(root, dirname(module), `.tmp-${randomUUID()} renamed #.mjs`);
    copyFileSync(join(root, module), renamed);
    context.after(() => rmSync(renamed));
    const direct = run([renamed, "--unknown"], directory);
    assert.equal(direct.status, 1, `${module}: ${direct.stderr}`);
    assert.equal(direct.stdout, "");
    assert.match(direct.stderr, /Error:/);
    const imported = run(["--input-type=module", "--eval", `await import(${JSON.stringify(pathToFileURL(renamed).href)}); console.log("imported");`], directory);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "imported\n");
    const stdinImport = run(["--input-type=module", "-"], directory, `await import(${JSON.stringify(pathToFileURL(renamed).href)}); console.log("imported");`);
    assert.equal(stdinImport.status, 0, stdinImport.stderr);
    assert.equal(stdinImport.stdout, "imported\n");
  }
});

test("#56 both recovery adapters require an object, a boolean existing, and an import document", async (context) => {
  const directory = fixture(context);
  for (const kind of ["records", "sql"]) {
    const module = `scripts/recovery-${kind}.mjs`;
    const register = registerForLayerKinds(registerData, [kind]);
    const document = await exportRecovery({ register, facilities: { [kind]: { export: () => [] } } });
    const payload = kind === "records" ? { records: [] } : { sql: Object.entries(document.entries).flatMap(([kind, entry]) => entry.records.map(({ layer }) => ({ kind, layer, rows: [] }))) };
    for (const mode of ["--export", "--import"]) {
      const valid = { ...payload, existing: false, document };
      const success = run([module, mode], directory, JSON.stringify(valid));
      assert.equal(success.status, 0, success.stderr);
      assert.ok(JSON.parse(success.stdout));
      const inputs = [
        [null, /input must be a JSON object/],
        [[], /input must be a JSON object/],
        [{ ...payload, document }, /existing must be a boolean/],
        [{ ...valid, existing: "false" }, /existing must be a boolean/],
        [{ ...valid, existing: null }, /existing must be a boolean/],
      ];
      if (mode === "--import") inputs.push([{ ...payload, existing: false }, /import requires a document/]);
      for (const [input, expected] of inputs) {
        const refused = run([module, mode], directory, JSON.stringify(input));
        assert.equal(refused.status, 1, `${module} ${mode}: ${refused.stderr}`);
        assert.match(refused.stderr, expected);
        assert.equal(refused.stdout, "");
      }
    }
  }
});

test("#58 recovery readers reject missing or conflicting modes before reading input or stores", (context) => {
  const directory = fixture(context);
  const readers = ["scripts/platform/node/records.mjs", "scripts/platform/node/sqlite.mjs", "scripts/platform/cloudflare/d1.mjs"];
  const modes = ["--snapshot", "--validate-plan", "--apply-plan"];
  for (const module of readers) {
    for (const args of [...modes.map((mode) => modes.filter((other) => other !== mode)), modes, []]) {
      const refused = run([module, ...args], directory, "not JSON");
      assert.equal(refused.status, 1, `${module} ${args}: ${refused.stderr}`);
      assert.match(refused.stderr, /needs exactly one of --snapshot, --validate-plan or --apply-plan/);
      assert.equal(refused.stdout, "");
    }
  }
});

test("the CLI runner handles sync and async success and reports stacks for both failure modes", (context) => {
  const directory = fixture(context);
  const entry = join(directory, "entry # with spaces.mjs");
  const alias = join(directory, "entry-alias.mjs");
  symlinkSync(entry, alias);
  for (const asyncPrefix of ["", "async "]) {
    for (const failing of [false, true]) {
      const body = failing ? 'throw new Error("fixture refusal")' : 'console.log("done")';
      writeFileSync(entry, `import { runIfMain } from ${JSON.stringify(runner)};\nawait runIfMain(import.meta.url, ${asyncPrefix}() => { ${body}; });\n`);
      for (const invoked of [entry, alias]) {
        const result = run([invoked], directory);
        assert.equal(result.status, failing ? 1 : 0, result.stderr);
        assert.equal(result.stdout, failing ? "" : "done\n");
        if (failing) {
          assert.match(result.stderr, /Error: fixture refusal\n\s+at /);
        } else {
          assert.equal(result.stderr, "");
        }
      }
    }
  }
});
