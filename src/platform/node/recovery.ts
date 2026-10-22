import type { DatabaseSync } from "node:sqlite";
import { database as nodeDatabase } from "./database.ts";
import { migrate } from "../../services/interactions/schema.ts";
import {
  exportSqlRecovery, sqlSnapshotStatements, sqlInsertStatements, sqlClearStatements, validateSqlPlan, restoreSqlRecovery, sqlRecoveryRegister,
} from "../../services/recovery/sql.ts";
import type { SqlPlan } from "../../services/recovery/sql.ts";
export { databaseFile } from "./sqlite.ts";

const register = sqlRecoveryRegister();

export function readSqlSnapshot(database: DatabaseSync, selectedRegister = register) {
  return sqlSnapshotStatements(selectedRegister).map(({ kind, layer, sql, parameters }) => ({
    kind,
    layer,
    rows: database.prepare(sql).all(...parameters),
  }));
}

export function writeSqlPlan(database: DatabaseSync, plan: SqlPlan, selectedRegister = register) {
  for (const { sql, parameters } of sqlInsertStatements(selectedRegister, plan)) {
    database.prepare(sql).run(...parameters);
  }
}

export async function restoreSqlPlan(database: DatabaseSync, plan: SqlPlan) {
  await restoreSqlRecovery(plan, {
    async atomic(restore) {
      database.exec("BEGIN IMMEDIATE");
      try {
        await restore();
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    migrate: () => migrate(nodeDatabase(database)),
    clear() {
      for (const { sql, parameters } of sqlClearStatements(register)) database.prepare(sql).run(...parameters);
    },
    insert: (plan) => writeSqlPlan(database, plan),
  });
}

export async function prepareSqlPlan(value: SqlPlan, openDatabase: () => DatabaseSync) {
  const { document, plan } = await validateSqlPlan(register, value);
  const database = openDatabase();
  try {
    await restoreSqlPlan(database, plan);
    const restored = await exportSqlRecovery({ register, snapshot: readSqlSnapshot(database) });
    if (JSON.stringify(restored) !== JSON.stringify(document)) {
      throw new Error("recovery rows cannot be restored without SQLite type conversion");
    }
  } finally {
    database.close();
  }
  return plan;
}
