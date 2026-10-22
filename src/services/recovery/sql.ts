import registerData from "../../config/data.config.json" with { type: "json" };
import { RecoveryError, exportRecovery, registerForLayerKinds, selectRecovery } from "./index.ts";
import type { RecoveryRegister } from "./index.ts";
import { planRecoveryImport } from "./plan.ts";
import { validateInteractionRows } from "../../models/interactions/records.ts";
import { validateInteractionReferences } from "./interaction-references.ts";
import {
  sqlLayerDescriptor, snapshotStatement, insertStatements, clearStatement, requireEmptySqlStatement,
} from "../../persistence/interactions/recovery-sql.ts";
import type { SqlRow, SqlWrite, SqlSnapshot, SqlStatement } from "../../persistence/interactions/recovery-sql.ts";
import { migrationLedgerStatement, schemaBootstrapStatements } from "../interactions/schema.ts";
export { sqlUserSchemaStatement } from "../../persistence/interactions/recovery-sql.ts";
export type { SqlRow, SqlWrite, SqlSnapshot, SqlStatement } from "../../persistence/interactions/recovery-sql.ts";
export type SqlPlan = { imported: string[]; writes: SqlWrite[] };

export function sqlRecoveryRegister(): RecoveryRegister {
  return registerForLayerKinds(registerData, ["sql"]);
}

// Rows that reference a visitor identity are written after it and cleared before it.
// A kind missing here sorts last and is refused by validateInteractionRows.
const WRITE_RANK = new Map([["visitor-identities", 0], ["comments", 1], ["reactions", 1], ["followers", 1], ["deliveries", 1], ["migrations", 1]]);

function kindRank(kind: string) {
  return WRITE_RANK.get(kind) ?? 2;
}

function withRecoveryRegisterErrors<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw new RecoveryError("INVALID_RECOVERY_REGISTER", error instanceof Error ? error.message : String(error));
  }
}

function sqlLayerDescriptors(register: RecoveryRegister) {
  const descriptors = [];
  for (const { kind, entry } of selectRecovery(registerForLayerKinds(register, ["sql"])).keep) {
    for (const [layer, value] of entry.layers.entries()) {
      if (!Object.hasOwn(value, "sql")) continue;
      descriptors.push(withRecoveryRegisterErrors(() => sqlLayerDescriptor(kind, layer, value)));
    }
  }
  return descriptors;
}

export function sqlSnapshotStatements(register: RecoveryRegister) {
  return sqlLayerDescriptors(register).map((descriptor) => withRecoveryRegisterErrors(() => snapshotStatement(descriptor)));
}

export function sqlInsertStatements(register: RecoveryRegister, plan: SqlPlan) {
  const descriptors = sqlLayerDescriptors(register);
  const writes = [...plan.writes].sort((left, right) => kindRank(left.kind) - kindRank(right.kind));
  const rowsByKind = new Map<string, SqlRow[]>();
  const statements = writes.flatMap((write) => {
    const descriptor = descriptors.find(({ kind, layer }) => kind === write.kind && layer === write.layer);
    if (!descriptor || write.action !== "insert") throw new Error("SQL recovery write plan has an unknown layer or action");
    const { kind } = descriptor;
    validateInteractionRows(kind, write.rows);
    rowsByKind.set(kind, [...rowsByKind.get(kind) ?? [], ...write.rows]);
    return insertStatements(descriptor, write.rows);
  });
  validateInteractionReferences(rowsByKind);
  return statements;
}

export function sqlClearStatements(register: RecoveryRegister) {
  return sqlLayerDescriptors(register).sort((left, right) => kindRank(right.kind) - kindRank(left.kind)).map(clearStatement);
}

export async function restoreSqlRecovery(plan: SqlPlan, execution: {
  atomic: (restore: () => Promise<void>) => Promise<void>;
  migrate: () => Promise<unknown>;
  clear: () => void;
  insert: (plan: SqlPlan) => void;
}) {
  await execution.atomic(async () => {
    await execution.migrate();
    execution.clear();
    execution.insert(plan);
  });
}

export function sqlBootstrapImportStatements(register: RecoveryRegister, plan: SqlPlan, userSchema: SqlStatement): SqlStatement[] {
  const ledger = migrationLedgerStatement();
  const bootstrap = schemaBootstrapStatements({ includeLedger: false });
  const inserts = sqlInsertStatements(register, plan);
  return [
    requireEmptySqlStatement(userSchema),
    { sql: ledger, parameters: [] },
    ...inserts.filter(({ kind }) => kind === "migrations"),
    ...bootstrap.map((sql) => ({ sql, parameters: [] })),
    ...inserts.filter(({ kind }) => kind !== "migrations"),
  ];
}

export async function exportSqlRecovery({ register, snapshot }: { register: RecoveryRegister; snapshot: SqlSnapshot[] }) {
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
          return snapshot.find((item) => item.kind === kind && item.layer === layerIndex)!.rows;
        },
      },
    },
  });
  for (const entry of Object.values(document.entries)) {
    for (const payload of entry.records) {
      (payload.records as SqlRow[]).sort((left, right) => {
        const leftJson = JSON.stringify(left);
        const rightJson = JSON.stringify(right);
        return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
      });
    }
  }
  return document;
}

export async function importSqlRecovery({ register, document, existing }: { register: RecoveryRegister; document: unknown; existing: unknown }) {
  sqlLayerDescriptors(register);
  return planRecoveryImport<SqlWrite>({
    register,
    document,
    kind: "sql",
    existing,
    facility: ({ kind, layerIndex, records }) => [{ action: "insert", kind, layer: layerIndex, rows: records as SqlRow[] }],
  });
}

export async function validateSqlPlan(register: RecoveryRegister, value: SqlPlan) {
  if (!value || !Array.isArray(value.writes) || value.writes.some((write) => write?.action !== "insert")) {
    throw new Error("SQL recovery write plan is malformed");
  }
  const document = await exportSqlRecovery({ register, snapshot: value.writes });
  const plan = await importSqlRecovery({ register, document, existing: false });
  return { document, plan };
}
