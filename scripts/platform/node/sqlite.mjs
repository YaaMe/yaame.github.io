import { chmodSync, existsSync, lstatSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databaseFile, readSqlSnapshot, restoreSqlPlan, prepareSqlPlan } from "../../../src/platform/node/recovery.ts";
import { sqlUserSchemaStatement } from "../../../src/services/recovery/sql.ts";
import { requireEmptyDestination } from "../../../src/services/recovery/plan.ts";
import { runIfMain } from "../../run-cli.mjs";
import { runRecoveryReader } from "../../recovery-plan.mjs";

function requireFile(path, required) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat && required) throw new Error(`AP_DB_URL does not exist: ${path}`);
  if (stat && !stat.isFile()) throw new Error(`AP_DB_URL is not a regular file: ${path}`);
  return stat;
}

function destinationExists(path) {
  const parent = dirname(path);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory()) {
    throw new Error(`AP_DB_URL parent does not exist or is not a directory: ${parent}`);
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (lstatSync(`${path}${suffix}`, { throwIfNoEntry: false })) {
      throw new Error(`cannot import with a SQLite sidecar present: ${path}${suffix}`);
    }
  }
  if (!requireFile(path, false)) return false;
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const { sql, parameters } = sqlUserSchemaStatement();
    return Boolean(database.prepare(sql).get(...parameters));
  } finally {
    database.close();
  }
}

async function applyPlan(path, plan) {
  requireEmptyDestination(destinationExists(path));
  const stage = mkdtempSync(join(dirname(path), ".blogu-recovery-sqlite-"));
  const stagedFile = join(stage, "database.sqlite");
  try {
    const database = new DatabaseSync(stagedFile);
    try {
      await restoreSqlPlan(database, plan);
    } finally {
      database.close();
    }
    chmodSync(stagedFile, 0o600);
    requireEmptyDestination(destinationExists(path));
    if (process.env.RECOVERY_TEST_KILL_AT_COMMIT === "before") process.kill(process.pid, "SIGKILL");
    renameSync(stagedFile, path);
    if (process.env.RECOVERY_TEST_KILL_AT_COMMIT === "after") process.kill(process.pid, "SIGKILL");
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function snapshot(path, importMode) {
  if (importMode) return { existing: destinationExists(path) };
  requireFile(path, true);
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("BEGIN");
    const result = { existing: true, sql: readSqlSnapshot(database) };
    database.exec("COMMIT");
    return result;
  } finally {
    database.close();
  }
}

function cli() {
  const path = databaseFile(process.env.AP_DATA_DIR ?? ".data", process.env.AP_DB_URL);
  if (!path || path === ":memory:") throw new Error("AP_DB_URL must name a database file");
  return runRecoveryReader({
    label: "node SQLite reader",
    snapshot: (importMode) => snapshot(path, importMode),
    prepare: (value) => prepareSqlPlan(value, () => new DatabaseSync(":memory:")),
    apply: (plan) => applyPlan(path, plan),
  });
}

await runIfMain(import.meta.url, cli);
