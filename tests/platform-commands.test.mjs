import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function fakeNpx() {
  const directory = mkdtempSync(join(tmpdir(), "blogu-52-npx-"));
  const npx = join(directory, "npx");
  writeFileSync(npx, "#!/usr/bin/env bash\nprintf '[{\"results\":[]}]\\n'\n");
  chmodSync(npx, 0o755);
  return directory;
}

function run(name, args, extra = {}) {
  const path = `scripts/platform/cloudflare/${name}.sh`;
  return spawnSync("bash", [path, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${extra.npx ?? fakeNpx()}:${process.env.PATH}`,
      ...extra.env,
    },
  });
}

test("Cloudflare entry points share flag parsing and help has no host reads", () => {
  for (const name of ["promote", "tombstone", "unpromote"]) {
    const help = run(name, ["--help"], { env: { CF_D1_ID: "", CF_KV_ID: "" } });
    assert.equal(help.status, 0, `${name}: ${help.stderr}`);
    assert.match(help.stdout, /Usage:/);
    assert.equal(help.stderr, "");

    const refused = run(name, ["--dry-run", "--apply"], {
      env: { CF_D1_ID: "", CF_KV_ID: "" },
    });
    assert.equal(refused.status, 2, `${name}: ${refused.stderr}`);
    assert.match(refused.stderr, /cannot be used together/);
    const fileFlag = run(name, ["--file", "not-a-recovery-command.json"], {
      env: { CF_D1_ID: "", CF_KV_ID: "" },
    });
    assert.equal(fileFlag.status, 2, fileFlag.stderr);
    assert.match(fileFlag.stderr, /unknown option: --file/);
  }
});

test("Cloudflare dry runs use fake D1 and unpromote reports a missing target", () => {
  const npx = fakeNpx();
  const env = { CF_D1_ID: "fake", CF_KV_ID: "fake" };
  for (const name of ["promote", "tombstone"]) {
    const preview = run(name, ["--dry-run"], { npx, env });
    assert.equal(preview.status, 0, `${name}: ${preview.stderr}`);
    assert.doesNotMatch(preview.stderr, /APPLY_HINT|--apply/);
  }
  const missing = run("unpromote", ["--dry-run"], {
    npx,
    env: { ...env, ID: "https://example.test/missing" },
  });
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /not a promoted comment/i);
});
