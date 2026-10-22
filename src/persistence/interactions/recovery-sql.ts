import { quoteSqlIdentifier } from "./sql-text.ts";

export type SqlStatement = { sql: string; parameters: Array<string | number | null> };
export type SqlLayerDescriptor = { kind: string; layer: number; table: string; columns: Record<string, string> };
export type SqlLayerStatement = SqlStatement & { kind: string; layer: number };
export type SqlRow = Record<string, string | number | boolean | null>;
export type SqlWrite = { action: string; kind: string; layer: number; rows: SqlRow[] };
export type SqlSnapshot = { kind: string; layer: number; rows: unknown };

export function sqlLayerDescriptor(kind: string, layer: number, value: Record<string, unknown>): SqlLayerDescriptor {
  if (!value.columns || typeof value.columns !== "object" || Array.isArray(value.columns)
    || Object.keys(value.columns).length === 0
    || new Set(Object.values(value.columns)).size !== Object.keys(value.columns).length) {
    throw new Error(`${kind}[${layer}] has an invalid SQL columns map`);
  }
  return {
    kind,
    layer,
    table: quoteSqlIdentifier(value.sql),
    columns: Object.fromEntries(Object.entries(value.columns).map(([logical, physical]) => [logical, quoteSqlIdentifier(physical)])),
  };
}

export function snapshotStatement({ kind, layer, table, columns }: SqlLayerDescriptor): SqlLayerStatement {
  return {
    kind,
    layer,
    sql: `SELECT ${Object.entries(columns).map(([logical, physical]) => `${physical} AS ${quoteSqlIdentifier(logical)}`).join(", ")} FROM ${table}`,
    parameters: [],
  };
}

export function insertStatements({ kind, layer, table, columns }: SqlLayerDescriptor, rows: SqlRow[]): SqlLayerStatement[] {
  const sql = `INSERT INTO ${table} (${Object.values(columns).join(", ")}) VALUES (${Object.keys(columns).map(() => "?").join(", ")})`;
  return rows.map((row) => ({
    kind,
    layer,
    sql,
    parameters: Object.keys(columns).map((logical) => typeof row[logical] === "boolean" ? Number(row[logical]) : row[logical]) as SqlStatement["parameters"],
  }));
}

export function clearStatement({ kind, layer, table }: SqlLayerDescriptor): SqlLayerStatement {
  return { kind, layer, sql: `DELETE FROM ${table}`, parameters: [] };
}

export function sqlUserSchemaStatement({ excludedPrefixes = ["sqlite_"], excludedNames = [] }: {
  excludedPrefixes?: string[];
  excludedNames?: string[];
} = {}): SqlStatement {
  const predicates = [
    ...excludedPrefixes.map(() => "substr(name, 1, length(?)) != ?"),
    ...excludedNames.map(() => "name != ?"),
  ];
  return {
    sql: `SELECT 1 FROM sqlite_schema${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""} LIMIT 1`,
    parameters: [...excludedPrefixes.flatMap((prefix) => [prefix, prefix]), ...excludedNames],
  };
}

export function requireEmptySqlStatement(userSchema: SqlStatement): SqlStatement {
  return {
    sql: `SELECT CASE WHEN EXISTS (${userSchema.sql}) THEN json('recovery destination is not empty') ELSE 1 END`,
    parameters: userSchema.parameters,
  };
}
