import registerData from "../src/config/data.config.json" with { type: "json" };
import { RecoveryError, exportRecovery, quoteSqlIdentifier, registerForLayerKinds, selectRecovery } from "../src/lib/recovery.ts";
import { planRecoveryImport, runRecoveryAdapter } from "./recovery-plan.mjs";
import { runIfMain } from "./run-cli.mjs";
import { validateInteractionReferences, validateInteractionRows } from "../src/lib/interactions/records.ts";

// Rows that reference a visitor identity are written after it and cleared before it.
// A kind missing here sorts last and is refused by validateInteractionRows.
const WRITE_RANK = new Map([["visitor-identities", 0], ["comments", 1], ["reactions", 1], ["followers", 1], ["deliveries", 1], ["migrations", 1]]);

function kindRank(kind) {
  return WRITE_RANK.get(kind) ?? 2;
}

function sqlLayerDescriptors(register) {
  const descriptors = [];
  for (const { kind, entry } of selectRecovery(registerForLayerKinds(register, ["sql"])).keep) {
    for (const [layer, value] of entry.layers.entries()) {
      if (!Object.hasOwn(value, "sql")) continue;
      if (!value.columns || typeof value.columns !== "object" || Array.isArray(value.columns)
        || Object.keys(value.columns).length === 0
        || new Set(Object.values(value.columns)).size !== Object.keys(value.columns).length) {
        throw new RecoveryError("INVALID_RECOVERY_REGISTER", `${kind}[${layer}] has an invalid SQL columns map`);
      }
      descriptors.push({
        kind,
        layer,
        table: quoteSqlIdentifier(value.sql),
        columns: Object.fromEntries(Object.entries(value.columns).map(([logical, physical]) => [logical, quoteSqlIdentifier(physical)])),
      });
    }
  }
  return descriptors;
}

export function sqlSnapshotStatements(register) {
  return sqlLayerDescriptors(register).map(({ kind, layer, table, columns }) => ({
    kind,
    layer,
    sql: `SELECT ${Object.entries(columns).map(([logical, physical]) => `${physical} AS ${quoteSqlIdentifier(logical)}`).join(", ")} FROM ${table}`,
    parameters: [],
  }));
}

export function sqlInsertStatements(register, plan) {
  const descriptors = sqlLayerDescriptors(register);
  const writes = [...plan.writes].sort((left, right) => kindRank(left.kind) - kindRank(right.kind));
  const rowsByKind = new Map();
  const statements = writes.flatMap((write) => {
    const descriptor = descriptors.find(({ kind, layer }) => kind === write.kind && layer === write.layer);
    if (!descriptor || write.action !== "insert") throw new Error("SQL recovery write plan has an unknown layer or action");
    const { kind, layer, table, columns } = descriptor;
    validateInteractionRows(kind, write.rows);
    rowsByKind.set(kind, [...rowsByKind.get(kind) ?? [], ...write.rows]);
    const sql = `INSERT INTO ${table} (${Object.values(columns).join(", ")}) VALUES (${Object.keys(columns).map(() => "?").join(", ")})`;
    return write.rows.map((row) => ({
      kind,
      layer,
      sql,
      parameters: Object.keys(columns).map((logical) => typeof row[logical] === "boolean" ? Number(row[logical]) : row[logical]),
    }));
  });
  validateInteractionReferences(rowsByKind);
  return statements;
}

export function sqlClearStatements(register) {
  return sqlLayerDescriptors(register).sort((left, right) => kindRank(right.kind) - kindRank(left.kind)).map(({ kind, layer, table }) => ({
    kind, layer, sql: `DELETE FROM ${table}`, parameters: [],
  }));
}

export function sqlUserSchemaStatement({ excludedPrefixes = ["sqlite_"], excludedNames = [] } = {}) {
  const predicates = [
    ...excludedPrefixes.map(() => "substr(name, 1, length(?)) != ?"),
    ...excludedNames.map(() => "name != ?"),
  ];
  return {
    sql: `SELECT 1 FROM sqlite_schema${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""} LIMIT 1`,
    parameters: [...excludedPrefixes.flatMap((prefix) => [prefix, prefix]), ...excludedNames],
  };
}

export async function exportSqlRecovery({ register, snapshot }) {
  const descriptors = sqlLayerDescriptors(register);
  if (!Array.isArray(snapshot) || snapshot.length !== descriptors.length
    || descriptors.some(({ kind, layer }) => snapshot.filter((item) => item?.kind === kind && item.layer === layer).length !== 1)) {
    throw new RecoveryError("INVALID_RECOVERY_RECORDS", "SQL snapshot must cover every selected layer exactly once");
  }
  const document = await exportRecovery({
    register,
    facilities: {
      sql: {
        export({ kind, layerIndex }) {
          return snapshot.find((item) => item.kind === kind && item.layer === layerIndex).rows;
        },
      },
    },
  });
  for (const entry of Object.values(document.entries)) {
    for (const payload of entry.records) {
      payload.records.sort((left, right) => {
        const leftJson = JSON.stringify(left);
        const rightJson = JSON.stringify(right);
        return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
      });
    }
  }
  return document;
}

export async function importSqlRecovery({ register, document, existing }) {
  sqlLayerDescriptors(register);
  return planRecoveryImport({
    register,
    document,
    kind: "sql",
    existing,
    facility: ({ kind, layerIndex, records }) => [{ action: "insert", kind, layer: layerIndex, rows: records }],
  });
}

export async function validateSqlPlan(register, value) {
  if (!value || !Array.isArray(value.writes) || value.writes.some((write) => write?.action !== "insert")) {
    throw new Error("SQL recovery write plan is malformed");
  }
  const document = await exportSqlRecovery({ register, snapshot: value.writes });
  const plan = await importSqlRecovery({ register, document, existing: false });
  return { document, plan };
}

async function cli() {
  const register = registerForLayerKinds(registerData, ["sql"]);
  return runRecoveryAdapter({
    exportFn: (input) => exportSqlRecovery({ register, snapshot: input.sql }),
    importFn: (input) => importSqlRecovery({ register, document: input.document, existing: input.existing }),
  });
}

await runIfMain(import.meta.url, cli);
