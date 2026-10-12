import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import registerData from "../../../src/data.config.json" with { type: "json" };
import { registerForLayerKinds } from "../../../src/lib/recovery.ts";
import { databaseFile } from "../../../src/platform/node-sqlite.ts";
import { migrate } from "../../../src/integrations/activitypub/store/schema.ts";
import {
  exportSqlRecovery, importSqlRecovery, sqlSnapshotStatements, sqlInsertStatements, sqlClearStatements, sqlUserSchemaStatement,
} from "../../recovery-sql.mjs";
import { runIfMain } from "../../run-cli.mjs";

const register = registerForLayerKinds(registerData, ["sql"]);

export function readSqlSnapshot(database, selectedRegister = register) {
  return sqlSnapshotStatements(selectedRegister).map(({ kind, layer, sql, parameters }) => ({
    kind,
    layer,
    rows: database.prepare(sql).all(...parameters),
  }));
}

export function writeSqlPlan(database, plan, selectedRegister = register) {
  for (const { sql, parameters } of sqlInsertStatements(selectedRegister, plan)) {
    database.prepare(sql).run(...parameters);
  }
}

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

async function documentFromPlan(plan) {
  if (!plan || !Array.isArray(plan.writes) || plan.writes.some((write) => write?.action !== "insert")) {
    throw new Error("SQL recovery write plan is malformed");
  }
  return exportSqlRecovery({ register, snapshot: plan.writes });
}

async function populate(database, plan) {
  database.exec("BEGIN IMMEDIATE");
  try {
    await migrate(drizzle({ client: database }));
    for (const { sql, parameters } of sqlClearStatements(register)) database.prepare(sql).run(...parameters);
    writeSqlPlan(database, plan);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function preparePlan(value) {
  const document = await documentFromPlan(value);
  const plan = await importSqlRecovery({ register, document, existing: false });
  const database = new DatabaseSync(":memory:");
  try {
    await populate(database, plan);
    const restored = await exportSqlRecovery({ register, snapshot: readSqlSnapshot(database) });
    if (JSON.stringify(restored) !== JSON.stringify(document)) {
      throw new Error("recovery rows cannot be restored without SQLite type conversion");
    }
  } finally {
    database.close();
  }
  return plan;
}

async function applyPlan(path, plan) {
  if (destinationExists(path)) throw new Error("cannot import into a non-empty store");
  const stage = mkdtempSync(join(dirname(path), ".blogu-recovery-sqlite-"));
  const stagedFile = join(stage, "database.sqlite");
  try {
    const database = new DatabaseSync(stagedFile);
    try {
      await populate(database, plan);
    } finally {
      database.close();
    }
    chmodSync(stagedFile, 0o600);
    if (destinationExists(path)) throw new Error("cannot import into a non-empty store");
    if (process.env.RECOVERY_TEST_KILL_AT_COMMIT === "before") process.kill(process.pid, "SIGKILL");
    renameSync(stagedFile, path);
    if (process.env.RECOVERY_TEST_KILL_AT_COMMIT === "after") process.kill(process.pid, "SIGKILL");
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return { ...plan, applied: true };
}

async function cli() {
  const path = databaseFile(process.env.AP_DATA_DIR ?? ".data", process.env.AP_DB_URL);
  if (!path || path === ":memory:") throw new Error("AP_DB_URL must name a database file");
  const argv = process.argv.slice(2);
  let result;
  if (argv.includes("--snapshot")) {
    if (argv.includes("--import")) {
      const fileIndex = argv.indexOf("--file");
      if (fileIndex === -1 || !argv[fileIndex + 1]) throw new Error("import requires --file PATH");
      result = { existing: destinationExists(path), document: JSON.parse(readFileSync(argv[fileIndex + 1], "utf8")) };
    } else {
      requireFile(path, true);
      const database = new DatabaseSync(path, { readOnly: true });
      try {
        database.exec("BEGIN");
        result = { existing: true, sql: readSqlSnapshot(database) };
        database.exec("COMMIT");
      } finally {
        database.close();
      }
    }
  } else if (argv.includes("--apply-plan") || argv.includes("--validate-plan")) {
    const plan = await preparePlan(JSON.parse(readFileSync(0, "utf8")));
    result = argv.includes("--apply-plan") ? await applyPlan(path, plan) : plan;
  } else {
    throw new Error("node SQLite reader needs --snapshot, --validate-plan or --apply-plan");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

await runIfMain(import.meta.url, cli);
