import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { d1StatementText, resultsFromWrangler, destinationExists, readSnapshot, preparePlan, restorePlan } from "../../../src/platform/cloudflare/recovery.ts";
import { runIfMain } from "../../run-cli.mjs";
import { runRecoveryReader } from "../../recovery-plan.mjs";

async function withD1(operation, { cleanupExitCode = 1 } = {}) {
  const databaseId = process.env.CF_D1_ID;
  if (!databaseId) throw new Error("CF_D1_ID is required for D1 recovery");
  const directory = mkdtempSync(join(tmpdir(), "blogu-d1-recovery-"));
  const config = join(directory, "wrangler.json");
  let operationFailed = false;
  try {
    writeFileSync(config, JSON.stringify({
      name: "blogu-recovery",
      d1_databases: [{ binding: "RECOVERY_DB", database_name: "blogu-recovery", database_id: databaseId }],
    }), { mode: 0o600 });
    const execute = (args, expected) => {
      const result = spawnSync("npx", [
        "--no-install", "wrangler", "d1", "execute", "RECOVERY_DB", "--config", config, "--remote", "--json", ...args,
      ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
      if (result.error || result.status !== 0) {
        throw new Error("Wrangler D1 command failed; completion is unconfirmed. Check the destination before retrying.");
      }
      return resultsFromWrangler(result.stdout, expected);
    };
    return await operation({
      query(statements) {
        return execute(["--command", statements.map(d1StatementText).join(";\n")], statements.length);
      },
      importFile(statements) {
        const file = join(directory, "import.sql");
        writeFileSync(file, statements.map(d1StatementText).join(";\n") + ";\n", { mode: 0o600 });
        execute(["--file", file, "--yes"], 1);
      },
    });
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      for (const name of ["import.sql", "wrangler.json"]) {
        const path = join(directory, name);
        if (existsSync(path)) unlinkSync(path);
      }
      rmdirSync(directory);
    } catch (error) {
      if (!operationFailed) console.error("D1 recovery operation completed.");
      console.error(`D1 recovery temporary-file cleanup failed: ${error?.stack ?? error}`);
      console.error(`Delete leftover recovery data in ${directory} after confirming no importer owns it.`);
      process.exitCode = operationFailed ? 1 : cleanupExitCode;
    }
  }
}

function cli() {
  return runRecoveryReader({
    label: "D1 recovery reader",
    snapshot: (importMode) => withD1((database) => importMode
      ? { existing: destinationExists(database) }
      : { existing: true, sql: readSnapshot(database) }, { cleanupExitCode: 3 }),
    prepare: preparePlan,
    async apply(plan) {
      await withD1((database) => restorePlan(database, plan));
    },
  });
}

await runIfMain(import.meta.url, cli);
