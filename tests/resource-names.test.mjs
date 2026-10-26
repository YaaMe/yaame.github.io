import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { site } from "../src/config/site.config.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const templates = [
  ["wrangler.jsonc.template", "wrangler.jsonc", "blogu"],
  ["worker/wrangler.jsonc", "worker/wrangler.generated.jsonc", "ap-consumer"],
];
const workflow = readFileSync(join(root, ".github/workflows/key.yml"), "utf8");
const keySteps = [...workflow.matchAll(/^        run: \|\n((?:^          .*\n|^\n)+)/gm)]
  .map((match) => match[1].replace(/^ {10}/gm, ""));

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "blogu-resource-names-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const path of [
    "package.json", "src/config/site.config.ts", "scripts/resource-names.mjs",
    "scripts/wrangler-config.mjs", "scripts/platform/cloudflare/db.sh",
    "scripts/platform/flags.sh", ...templates.map(([path]) => path),
  ]) {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
  }
  const sitePath = join(cwd, "src/config/site.config.ts");
  const siteSource = readFileSync(sitePath, "utf8");
  const setAuthor = (author) => writeFileSync(sitePath, siteSource.replace(
    /^  author: ".*",$/m, author === undefined ? "" : `  author: ${JSON.stringify(author)},`,
  ));
  const env = { ...process.env, CF_KV_ID: "test-kv", CF_D1_ID: "test-d1" };
  const run = (args, overrides = {}) => spawnSync(process.execPath, args, {
    cwd, encoding: "utf8", env: { ...env, ...overrides },
  });
  const readConfig = (path) => JSON.parse(readFileSync(join(cwd, path), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const calls = join(cwd, "calls.jsonl");
  const fakeNpx = join(cwd, "npx");
  writeFileSync(fakeNpx, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
appendFileSync(process.env.CALLS_FILE, JSON.stringify({ args: process.argv.slice(2), input: process.argv.includes("put") ? readFileSync(0, "utf8") : "" }) + "\\n");
console.log('[{"results":[]}]');
`, { mode: 0o755 });
  const shell = (script, overrides = {}) => spawnSync("bash", ["-euo", "pipefail", "-c", script], {
    cwd, encoding: "utf8", input: "",
    env: { ...env, PATH: `${cwd}:${process.env.PATH}`, CALLS_FILE: calls, ...overrides },
  });
  const readCalls = () => existsSync(calls)
    ? readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  return { cwd, run, setAuthor, readConfig, shell, readCalls };
}

test("both templates use the configured author in either build profile", (t) => {
  const app = fixture(t);
  for (const author of [site.author, "another-owner"]) {
    app.setAuthor(author);
    for (const BUILD_PROFILE of ["static", "full"]) {
      for (const [template, output, suffix] of templates) {
        const args = template === templates[0][0] ? [] : [template, output];
        const result = app.run(["scripts/wrangler-config.mjs", ...args], { BUILD_PROFILE, siteWorker: "ignored" });
        assert.equal(result.status, 0, result.stderr);
        const config = app.readConfig(output);
        assert.equal(config.name, `${author}-${suffix}`);
        assert.deepEqual(config.d1_databases, [{ binding: "AP_DB", database_name: `${author}-ap-interactions`, database_id: "test-d1" }]);
        assert.deepEqual(config.kv_namespaces, [{ binding: "AP_KV", id: "test-kv" }]);
        assert.deepEqual(config.queues.producers, [{ queue: `${author}-ap-delivery`, binding: "AP_QUEUE" }]);
        if (suffix === "ap-consumer") {
          assert.deepEqual(config.queues.consumers, [{ queue: `${author}-ap-delivery`, max_batch_size: 10, max_retries: 10 }]);
        }
        assert.doesNotMatch(readFileSync(join(app.cwd, output), "utf8"), /\{\{|\$\{/);
      }
    }
  }
});

test("missing and empty environment variables fail without replacing output", (t) => {
  const app = fixture(t);
  for (const [template, output] of templates) {
    for (const name of ["CF_KV_ID", "CF_D1_ID"]) {
      for (const value of [undefined, ""]) {
        writeFileSync(join(app.cwd, output), "keep existing output");
        const result = app.run(["scripts/wrangler-config.mjs", template, output], { [name]: value });
        assert.equal(result.status, 1);
        assert.ok(result.stderr.includes(name), result.stderr);
        assert.equal(readFileSync(join(app.cwd, output), "utf8"), "keep existing output");
      }
    }
  }
  writeFileSync(join(app.cwd, "custom.template"), '${EXTRA} ${EXTRA} ${PRESENT}');
  const missing = app.run(["scripts/wrangler-config.mjs", "custom.template", "custom.jsonc"], { EXTRA: "", PRESENT: "0" });
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr.match(/EXTRA/g).length, 1);
  assert.ok(!existsSync(join(app.cwd, "custom.jsonc")));
  const filled = app.run(["scripts/wrangler-config.mjs", "custom.template", "custom.jsonc"], { EXTRA: "value", PRESENT: "0" });
  assert.equal(filled.status, 0, filled.stderr);
  assert.equal(readFileSync(join(app.cwd, "custom.jsonc"), "utf8"), "value value 0");
});

test("a missing, empty, non-string or non-slug author fails before output or key operations", (t) => {
  const app = fixture(t);
  assert.equal(keySteps.length, 2);
  for (const author of [undefined, "", " \t", null, 42, "Yaame", "yaame lee", "-yaame", "yaame-"]) {
    app.setAuthor(author);
    for (const [template, output] of templates) {
      writeFileSync(join(app.cwd, output), "keep existing output");
      const result = app.run(["scripts/wrangler-config.mjs", template, output]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /site\.author must be a non-empty string/);
      assert.equal(readFileSync(join(app.cwd, output), "utf8"), "keep existing output");
    }
    for (const script of keySteps) {
      const result = app.shell(script, { AP_KEY_JWK: "test-key", CF_KV_ID: "", CF_D1_ID: "" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /site\.author must be a non-empty string/);
    }
  }
  assert.deepEqual(app.readCalls(), []);
});

test("the key workflow uses both configured Worker names without binding ids", (t) => {
  const app = fixture(t);
  app.setAuthor("another-owner");
  assert.equal(keySteps.length, 2);
  for (const script of keySteps) {
    const result = app.shell(script, { AP_KEY_JWK: "test-key", CF_KV_ID: "", CF_D1_ID: "" });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(app.readCalls(), [
    ...["another-owner-blogu", "another-owner-ap-consumer"].map((worker) => ({
      args: ["wrangler", "secret", "put", "AP_KEY_JWK", "--name", worker], input: "test-key",
    })),
    ...["another-owner-blogu", "another-owner-ap-consumer"].map((worker) => ({
      args: ["wrangler", "secret", "list", "--name", worker], input: "",
    })),
  ]);
});

test("Cloudflare comment commands use the configured D1 name", (t) => {
  const app = fixture(t);
  app.setAuthor("another-owner");
  const result = app.shell('source scripts/platform/cloudflare/db.sh\nrequire_d1\nd1_json "SELECT 1"');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { rows: [] });
  assert.deepEqual(app.readCalls(), [{
    args: ["wrangler", "d1", "execute", "another-owner-ap-interactions", "--remote", "--json", "--command", "SELECT 1"],
    input: "",
  }]);
});
