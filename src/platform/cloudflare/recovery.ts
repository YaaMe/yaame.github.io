import { sqlSnapshotStatements, sqlUserSchemaStatement, validateSqlPlan, sqlBootstrapImportStatements, sqlRecoveryRegister } from "../../services/recovery/sql.ts";
import type { SqlPlan, SqlStatement, SqlRow } from "../../services/recovery/sql.ts";
import { requireEmptyDestination } from "../../services/recovery/plan.ts";

const register = sqlRecoveryRegister();
const internalSchema = { excludedPrefixes: ["sqlite_", "_cf_"], excludedNames: ["d1_migrations"] };

type D1RecoveryDatabase = {
  query(statements: SqlStatement[]): SqlRow[][];
  importFile(statements: SqlStatement[]): void;
};

function sqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `CAST(X'${Buffer.from(value, "utf8").toString("hex")}' AS TEXT)`;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error("D1 recovery statement has an unsupported parameter");
}

export function d1StatementText({ sql, parameters }: SqlStatement) {
  let output = "";
  let quote: string | null = null;
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

export function resultsFromWrangler(text: string, expected: number): SqlRow[][] {
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("Wrangler D1 returned invalid JSON; completion is unconfirmed");
  }
  if (!Array.isArray(result) || result.length !== expected
    || result.some((part: { success?: unknown; results?: unknown }) => part?.success !== true || !Array.isArray(part.results))) {
    throw new Error("Wrangler D1 did not acknowledge every statement successfully; completion is unconfirmed");
  }
  return result.map((part: { results: SqlRow[] }) => part.results);
}

export function destinationExists(database: D1RecoveryDatabase) {
  return database.query([sqlUserSchemaStatement(internalSchema)])[0].length > 0;
}

export function readSnapshot(database: D1RecoveryDatabase) {
  const statements = sqlSnapshotStatements(register);
  const results = database.query(statements);
  return statements.map(({ kind, layer }, index) => ({ kind, layer, rows: results[index] }));
}

function importStatements(plan: SqlPlan) {
  return sqlBootstrapImportStatements(register, plan, sqlUserSchemaStatement(internalSchema));
}

export async function preparePlan(value: SqlPlan) {
  const { plan } = await validateSqlPlan(register, value);
  importStatements(plan).forEach(d1StatementText);
  return plan;
}

export function restorePlan(database: D1RecoveryDatabase, plan: SqlPlan) {
  requireEmptyDestination(destinationExists(database));
  database.importFile(importStatements(plan));
}
