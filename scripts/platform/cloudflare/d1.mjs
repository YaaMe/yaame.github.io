import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerData from "../../../src/config/data.config.json" with { type: "json" };
import { registerForLayerKinds } from "../../../src/lib/recovery.ts";
import { schemaBootstrapStatements } from "../../../src/integrations/activitypub/store/schema.ts";
import { sqlSnapshotStatements, sqlInsertStatements, sqlUserSchemaStatement, validateSqlPlan } from "../../recovery-sql.mjs";
import { runIfMain } from "../../run-cli.mjs";
import { runRecoveryReader } from "../../recovery-plan.mjs";

const register = registerForLayerKinds(registerData, ["sql"]);
const internalSchema = { excludedPrefixes: ["sqlite_", "_cf_"], excludedNames: ["d1_migrations"] };

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "string") return `CAST(X'${Buffer.from(value, "utf8").toString("hex")}' AS TEXT)`;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error("D1 recovery statement has an unsupported parameter");
}

export function d1StatementText({ sql, parameters }) {
  let output = "";
  let quote = null;
  let parameter = 0;
  for (let index = 0; index < sql.length; index++) {
    const character = sql[index];
    if (quote) {
      output += character;
      if (character === quote) {
        if (sql[index + 1] === quote) output += sql[++index];
        else quote = null;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === "?") {
      output += sqlLiteral(parameters[parameter++]);
    } else {
      output += character;
    }
  }
  if (parameter !== parameters.length || quote) throw new Error("D1 recovery statement has invalid bindings or quoting");
  return output;
}

function resultsFromWrangler(text, expected) {
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("Wrangler D1 returned invalid JSON; completion is unconfirmed");
  }
  if (!Array.isArray(result) || result.length !== expected
    || result.some((part) => part?.success !== true || !Array.isArray(part.results))) {
    throw new Error("Wrangler D1 did not acknowledge every statement successfully; completion is unconfirmed");
  }
  return result.map((part) => part.results);
}

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

function destinationExists(database) {
  return database.query([sqlUserSchemaStatement(internalSchema)])[0].length > 0;
}

function readSnapshot(database) {
  const statements = sqlSnapshotStatements(register);
  const results = database.query(statements);
  return statements.map(({ kind, layer }, index) => ({ kind, layer, rows: results[index] }));
}

function importStatements(plan) {
  const userSchema = sqlUserSchemaStatement(internalSchema);
  const [migrationTable, ...bootstrap] = schemaBootstrapStatements();
  const inserts = sqlInsertStatements(register, plan);
  return [
    {
      sql: `SELECT CASE WHEN EXISTS (${userSchema.sql}) THEN json('recovery destination is not empty') ELSE 1 END`,
      parameters: userSchema.parameters,
    },
    { sql: migrationTable, parameters: [] },
    ...inserts.filter(({ kind }) => kind === "migrations"),
    ...bootstrap.map((sql) => ({ sql, parameters: [] })),
    ...inserts.filter(({ kind }) => kind !== "migrations"),
  ];
}

function cli() {
  return runRecoveryReader({
    label: "D1 recovery reader",
    snapshot: (importMode) => withD1((database) => importMode
      ? { existing: destinationExists(database) }
      : { existing: true, sql: readSnapshot(database) }, { cleanupExitCode: 3 }),
    async prepare(value) {
      const { plan } = await validateSqlPlan(register, value);
      importStatements(plan).forEach(d1StatementText);
      return plan;
    },
    async apply(plan) {
      await withD1((database) => {
        if (destinationExists(database)) throw new Error("cannot import into a non-empty store");
        database.importFile(importStatements(plan));
      });
      return { ...plan, applied: true };
    },
  });
}

await runIfMain(import.meta.url, cli);
